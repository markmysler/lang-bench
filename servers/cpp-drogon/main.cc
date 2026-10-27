// C++ + Drogon server for lang-bench (docs/SPEC.md).
#include <drogon/drogon.h>

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdlib>
#include <functional>
#include <memory>
#include <random>
#include <string>
#include <thread>

using namespace drogon;
using Callback = std::function<void(const HttpResponsePtr &)>;
using Clock = std::chrono::steady_clock;

static long fib(int n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
static int param(const HttpRequestPtr &req, const std::string &name, int def, int lo, int hi) {
  const std::string &v = req->getParameter(name);
  const char *b = v.data(), *e = b + v.size();
  if (b != e && *b == '+') ++b;
  long n;
  auto [p, ec] = std::from_chars(b, e, n);
  if (b == e || *b == '+' || ec != std::errc() || p != e) return def;
  return static_cast<int>(std::clamp<long>(n, lo, hi));
}

static int env(const char *key, int def) {
  const char *v = std::getenv(key);
  int n = v ? std::atoi(v) : 0;
  return n > 0 ? n : def;
}

static std::string envStr(const char *key) {
  const char *v = std::getenv(key);
  return v ? v : "";
}

static HttpResponsePtr text(const std::string &body,
                            HttpStatusCode code = k200OK) {
  auto res = HttpResponse::newHttpResponse();
  res->setStatusCode(code);
  res->setContentTypeCode(CT_TEXT_PLAIN);
  res->setBody(body);
  return res;
}

// db returns the pool, created on first use so the server starts without a database for other
// workloads. Drogon opens its DB_POOL connections in the background and retries failed ones;
// queries wait in its buffer until a connection is ready.
static const orm::DbClientPtr &db() {
  static const orm::DbClientPtr client = orm::DbClient::newPgClient(
      "host=" + envStr("DB_HOST") + " port=" + envStr("DB_PORT") + " dbname=" + envStr("DB_NAME") +
          " user=" + envStr("DB_USER") + " password=" + envStr("DB_PASSWORD"),
      env("DB_POOL", 16));
  return client;
}

// randomRow reads one random row. Drogon prepares a statement with parameters once per connection
// and reuses it after that.
template <typename Ok, typename Fail>
static void randomRow(Ok &&ok, Fail &&fail) {
  thread_local std::mt19937 rng{std::random_device{}()};
  thread_local std::uniform_int_distribution<int> ids{1, 10000};
  db()->execSqlAsync(
      "SELECT id, randomnumber FROM world WHERE id = $1",
      [ok = std::forward<Ok>(ok)](const orm::Result &r) {
        Json::Value row;
        row["id"] = r[0][0ul].as<int>();
        row["randomNumber"] = r[0][1ul].as<int>();
        ok(std::move(row));
      },
      std::forward<Fail>(fail), ids(rng));
}

// waitUntil calls done on this event loop once end has passed. Timers should not fire early, but
// any shortfall is waited out with another timer, so /io never answers early.
static void waitUntil(trantor::EventLoop *loop, Clock::time_point end, std::function<void()> done) {
  auto left = end - Clock::now();
  if (left <= Clock::duration::zero()) {
    done();
    return;
  }
  loop->runAfter(std::chrono::duration<double>(left),
                 [loop, end, done = std::move(done)]() mutable { waitUntil(loop, end, std::move(done)); });
}

// Queries runs n queries one after the other, each starting when the previous one has answered.
struct Queries : std::enable_shared_from_this<Queries> {
  Json::Value rows{Json::arrayValue};
  int n;
  Callback callback;

  Queries(int n, Callback &&callback) : n(n), callback(std::move(callback)) {}

  void next() {
    if (static_cast<int>(rows.size()) == n) {
      callback(HttpResponse::newHttpJsonResponse(std::move(rows)));
      return;
    }
    randomRow(
        [self = shared_from_this()](Json::Value &&row) {
          self->rows.append(std::move(row));
          self->next();
        },
        [self = shared_from_this()](const orm::DrogonDbException &e) {
          self->callback(text(e.base().what(), k500InternalServerError));
        });
  }
};

int main() {
  app().registerHandler(
      "/health", [](const HttpRequestPtr &, Callback &&cb) { cb(text("ok")); }, {Get});
  app().registerHandler(
      "/plaintext", [](const HttpRequestPtr &, Callback &&cb) { cb(text("Hello, World!")); }, {Get});
  app().registerHandler(
      "/json",
      [](const HttpRequestPtr &, Callback &&cb) {
        Json::Value body;
        body["message"] = "Hello, World!";
        cb(HttpResponse::newHttpJsonResponse(std::move(body)));
      },
      {Get});
  app().registerHandler(
      "/cpu",
      [](const HttpRequestPtr &req, Callback &&cb) {
        int n = param(req, "n", 20, 0, 32);
        Json::Value body;
        body["n"] = n;
        body["fib"] = static_cast<Json::Int64>(fib(n));
        cb(HttpResponse::newHttpJsonResponse(std::move(body)));
      },
      {Get});
  app().registerHandler(
      "/io",
      [](const HttpRequestPtr &req, Callback &&cb) {
        int ms = param(req, "ms", 10, 0, 1000);
        // A timer on this connection's event loop: the thread keeps serving other requests.
        waitUntil(trantor::EventLoop::getEventLoopOfCurrentThread(),
                  Clock::now() + std::chrono::milliseconds(ms), [ms, cb = std::move(cb)] {
                    Json::Value body;
                    body["ms"] = ms;
                    cb(HttpResponse::newHttpJsonResponse(std::move(body)));
                  });
      },
      {Get});
  app().registerHandler(
      "/db",
      [](const HttpRequestPtr &, Callback &&cb) {
        auto shared = std::make_shared<Callback>(std::move(cb));
        randomRow([shared](Json::Value &&row) { (*shared)(HttpResponse::newHttpJsonResponse(std::move(row))); },
                  [shared](const orm::DrogonDbException &e) {
                    (*shared)(text(e.base().what(), k500InternalServerError));
                  });
      },
      {Get});
  app().registerHandler(
      "/queries",
      [](const HttpRequestPtr &req, Callback &&cb) {
        std::make_shared<Queries>(param(req, "n", 1, 1, 500), std::move(cb))->next();
      },
      {Get});

  // One event loop thread per pinned CPU; nothing is logged per request.
  app()
      .setLogLevel(trantor::Logger::kWarn)
      .setThreadNum(env("CPUS", static_cast<int>(std::thread::hardware_concurrency())))
      .addListener("0.0.0.0", static_cast<uint16_t>(env("PORT", 8080)))
      .run();
}

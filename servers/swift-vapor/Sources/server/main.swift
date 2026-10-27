// Swift + Vapor server for lang-bench (docs/SPEC.md).
import Fluent
import FluentPostgresDriver
import Logging
import NIOPosix
import Vapor

final class World: Model, Content, @unchecked Sendable {
    static let schema = "world"

    @ID(custom: "id", generatedBy: .user) var id: Int32?
    // Fluent encodes a model by property name, so the JSON key is randomNumber.
    @Field(key: "randomnumber") var randomNumber: Int32

    init() {}
}

struct Message: Content { let message: String }
struct Fib: Content { let n: Int; let fib: Int }
struct Wait: Content { let ms: Int }

func fib(_ n: Int) -> Int {
    n < 2 ? n : fib(n - 1) + fib(n - 2)
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
func param(_ req: Request, _ name: String, _ def: Int, _ lo: Int, _ hi: Int) -> Int {
    for pair in (req.url.query ?? "").split(separator: "&") {
        let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        if kv[0] == name {
            guard kv.count == 2, let n = Int(kv[1]) else { return def }
            return max(lo, min(hi, n))
        }
    }
    return def
}

func env(_ key: String, _ def: Int) -> Int {
    if let s = Environment.get(key), let n = Int(s), n > 0 { return n }
    return def
}

func randomRow(_ db: any Database) async throws -> World {
    guard let w = try await World.find(Int32.random(in: 1...10000), on: db) else {
        throw Abort(.internalServerError, reason: "row not found")
    }
    return w
}

// Errors and start-up messages only, to stderr.
LoggingSystem.bootstrap { label in
    var handler = StreamLogHandler.standardError(label: label)
    handler.logLevel = .notice
    return handler
}

let cpus = env("CPUS", System.coreCount)
// One NIO event loop thread per pinned CPU, set explicitly rather than detected.
let group = MultiThreadedEventLoopGroup(numberOfThreads: cpus)
let app = try await Application.make(.production, .shared(group))

app.http.server.configuration.hostname = "0.0.0.0"
app.http.server.configuration.port = env("PORT", 8080)
// Vapor's default middleware logs every request; keep only the error handler.
app.middleware = Middlewares()
app.middleware.use(ErrorMiddleware.default(environment: app.environment))

// Fluent keeps one pool per event loop, so DB_POOL is shared out between them. The pools connect
// on first use, so the server starts without a database for other workloads.
app.databases.use(
    .postgres(
        configuration: SQLPostgresConfiguration(
            hostname: Environment.get("DB_HOST") ?? "localhost",
            port: env("DB_PORT", 5432),
            username: Environment.get("DB_USER") ?? "bench",
            password: Environment.get("DB_PASSWORD") ?? "bench",
            database: Environment.get("DB_NAME") ?? "bench",
            tls: .disable),
        maxConnectionsPerEventLoop: max(1, env("DB_POOL", 16) / cpus)),
    as: .psql)

app.get("health") { _ in "ok" }
app.get("plaintext") { _ in "Hello, World!" }
app.get("json") { _ in Message(message: "Hello, World!") }
app.get("cpu") { req in
    let n = param(req, "n", 20, 0, 32)
    return Fib(n: n, fib: fib(n))
}
app.get("io") { req async throws in
    let ms = param(req, "ms", 10, 0, 1000)
    // Sleep until a deadline on the monotonic clock, and again if woken before it.
    let deadline = ContinuousClock.now + .milliseconds(ms)
    while ContinuousClock.now < deadline {
        try await Task.sleep(until: deadline, clock: .continuous)
    }
    return Wait(ms: ms)
}
app.get("db") { req async throws in
    try await randomRow(req.db)
}
app.get("queries") { req async throws in
    let n = param(req, "n", 1, 1, 500)
    var rows: [World] = []
    rows.reserveCapacity(n)
    for _ in 0..<n {
        rows.append(try await randomRow(req.db))
    }
    return rows
}

do {
    try await app.execute()
} catch {
    app.logger.report(error: error)
    try? await app.asyncShutdown()
    exit(1)
}
try await app.asyncShutdown()
try await group.shutdownGracefully()

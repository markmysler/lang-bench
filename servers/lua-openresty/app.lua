-- OpenResty handlers for lang-bench (docs/SPEC.md). nginx.conf routes each endpoint here.
local cjson = require "cjson"
local ffi = require "ffi"
local pgmoon = require "pgmoon"
local semaphore = require "ngx.semaphore"
local new_tab = require "table.new"

local _M = {}

local function env(key, def)
  local n = tonumber(os.getenv(key) or "")
  if n and n > 0 then return math.floor(n) end
  return def
end

local cpus = env("CPUS", 1)

-- DB_POOL is for the whole container, so each worker gets an equal share of it. The cosocket pool
-- keeps up to pool_size idle connections; a semaphore of the same size caps the connections in use
-- (see random_row). Connections are opened on first use, so the server starts without a database.
local pool_size = math.max(1, math.floor(env("DB_POOL", 16) / cpus))
local db_config = {
  host = os.getenv("DB_HOST"),
  port = env("DB_PORT", 5432),
  user = os.getenv("DB_USER"),
  password = os.getenv("DB_PASSWORD"),
  database = os.getenv("DB_NAME"),
  pool_name = "bench",
  pool_size = pool_size,
}
local db_slots -- created per worker in init_worker

-- A monotonic clock with nanosecond resolution: ngx.now() is cached per event loop iteration and
-- only has millisecond resolution, too coarse to prove that /io waited long enough.
ffi.cdef [[
  typedef struct { long tv_sec; long tv_nsec; } lb_timespec;
  int clock_gettime(int clk_id, lb_timespec *tp);
]]
local CLOCK_MONOTONIC = 1
local ts = ffi.new("lb_timespec")
local function now()
  ffi.C.clock_gettime(CLOCK_MONOTONIC, ts)
  return tonumber(ts.tv_sec) + tonumber(ts.tv_nsec) * 1e-9
end

function _M.init_worker()
  -- Each worker gets its own random sequence of ids.
  math.randomseed(ngx.now() * 1000 + ngx.worker.pid())
  db_slots = semaphore.new(pool_size)
end

local function fib(n)
  if n < 2 then return n end
  return fib(n - 1) + fib(n - 2)
end

-- param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
local function param(name, def, lo, hi)
  local v = ngx.req.get_uri_args()[name]
  if type(v) == "table" then v = v[1] end
  if type(v) ~= "string" then return def end
  local sign, digits = v:match("^([+-]?)(%d+)$")
  if not digits then return def end
  local n = tonumber(digits)
  if sign == "-" then n = -n end
  return math.max(lo, math.min(hi, n))
end

local function fail(err)
  ngx.status = 500
  ngx.header["Content-Type"] = "text/plain"
  ngx.print(tostring(err))
end

-- random_row reads one row on a connection taken from the worker's pool and puts it back.
-- A request first takes one of pool_size slots, waiting in FIFO order when all are in use. The
-- cosocket pool's own limit (its backlog option) is not used: under load, a queued connect that is
-- resumed can find the freed connection already taken and opens another one past the limit, so the
-- pool overflows and connections are closed and reopened all the time.
-- pgmoon sends a query with parameters as an unnamed prepared statement (parse, bind, execute).
-- It declares a Lua number parameter as numeric, and integer = numeric cannot use the primary
-- key index (a scan of the whole table), so the query casts it back to integer.
local function random_row()
  local ok, err = db_slots:wait(60)
  if not ok then return nil, "waiting for a database connection: " .. err end
  local pg = pgmoon.new(db_config)
  ok, err = pg:connect()
  if not ok then
    db_slots:post(1)
    return nil, err
  end
  local res
  res, err = pg:query("SELECT id, randomnumber FROM world WHERE id = $1::integer",
    math.random(1, 10000))
  if res then
    pg:keepalive()
  else
    pg:disconnect()
  end
  db_slots:post(1)
  if not res then return nil, err end
  return { id = res[1].id, randomNumber = res[1].randomnumber }
end

function _M.health()
  ngx.print("ok")
end

function _M.plaintext()
  ngx.print("Hello, World!")
end

function _M.json()
  ngx.print(cjson.encode({ message = "Hello, World!" }))
end

function _M.cpu()
  local n = param("n", 20, 0, 32)
  ngx.print(cjson.encode({ n = n, fib = fib(n) }))
end

-- /io waits with ngx.sleep, which suspends only this request's coroutine. nginx timers are set
-- from its cached clock and can fire early, so any shortfall is waited out with another sleep.
function _M.io()
  local ms = param("ms", 10, 0, 1000)
  local deadline = now() + ms / 1000
  ngx.sleep(ms / 1000)
  local left = deadline - now()
  while left > 0 do
    ngx.sleep(math.ceil(left * 1000) / 1000)
    left = deadline - now()
  end
  ngx.print(cjson.encode({ ms = ms }))
end

function _M.db()
  local row, err = random_row()
  if not row then return fail(err) end
  ngx.print(cjson.encode(row))
end

function _M.queries()
  local n = param("n", 1, 1, 500)
  -- array_mt makes cjson encode the table as a JSON array whatever its length.
  local rows = setmetatable(new_tab(n, 0), cjson.array_mt)
  for i = 1, n do
    local row, err = random_row()
    if not row then return fail(err) end
    rows[i] = row
  end
  ngx.print(cjson.encode(rows))
end

return _M

// Zig + Zap server for lang-bench (docs/SPEC.md).
const std = @import("std");
const zap = @import("zap");
const pg = @import("pg");

const allocator = std.heap.smp_allocator;

const Row = struct { id: i32, randomNumber: i32 };

fn fib(n: i64) i64 {
    return if (n < 2) n else fib(n - 1) + fib(n - 2);
}

// parseInt accepts an optional sign and decimal digits only; anything else, or an overflow, is null.
fn parseInt(s: []const u8) ?i64 {
    var digits = s;
    var negative = false;
    if (digits.len > 0 and (digits[0] == '+' or digits[0] == '-')) {
        negative = digits[0] == '-';
        digits = digits[1..];
    }
    if (digits.len == 0) return null;
    var n: i64 = 0;
    for (digits) |c| {
        if (c < '0' or c > '9') return null;
        n = std.math.mul(i64, n, 10) catch return null;
        n = std.math.add(i64, n, c - '0') catch return null;
    }
    return if (negative) -n else n;
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
fn param(r: zap.Request, name: []const u8, def: i64, lo: i64, hi: i64) i64 {
    const n = parseInt(r.getParamSlice(name) orelse return def) orelse return def;
    return std.math.clamp(n, lo, hi);
}

fn env(key: []const u8, def: usize) usize {
    const n = parseInt(std.posix.getenv(key) orelse return def) orelse return def;
    return if (n > 0) @intCast(n) else def;
}

fn sendText(r: zap.Request, body: []const u8) !void {
    try r.setContentType(.TEXT);
    try r.sendBody(body);
}

// sendJson serialises value with std.json and sends it as application/json.
fn sendJson(r: zap.Request, value: anytype) !void {
    var out: std.Io.Writer.Allocating = .init(allocator);
    defer out.deinit();
    try std.json.Stringify.value(value, .{}, &out.writer);
    try r.sendJson(out.written());
}

// wait sleeps the handling thread for at least ms milliseconds; any shortfall is slept again.
fn wait(ms: i64) void {
    const total: u64 = @intCast(ms * std.time.ns_per_ms);
    var timer = std.time.Timer.start() catch return std.Thread.sleep(total);
    var elapsed: u64 = 0;
    while (elapsed < total) : (elapsed = timer.read()) std.Thread.sleep(total - elapsed);
}

var pool: ?*pg.Pool = null;
var pool_lock: std.Thread.Mutex = .{};

// getPool returns the pool, created on first use so the server starts without a database for other
// workloads. If the database cannot be reached the request fails and the next one tries again.
fn getPool() !*pg.Pool {
    if (@atomicLoad(?*pg.Pool, &pool, .acquire)) |p| return p;
    pool_lock.lock();
    defer pool_lock.unlock();
    if (pool) |p| return p;
    const p = try pg.Pool.init(allocator, .{
        .size = @intCast(env("DB_POOL", 16)),
        .connect = .{
            .host = std.posix.getenv("DB_HOST") orelse "127.0.0.1",
            .port = @intCast(env("DB_PORT", 5432)),
        },
        .auth = .{
            .username = std.posix.getenv("DB_USER") orelse "bench",
            .password = std.posix.getenv("DB_PASSWORD") orelse "bench",
            .database = std.posix.getenv("DB_NAME") orelse "bench",
        },
    });
    @atomicStore(?*pg.Pool, &pool, p, .release);
    return p;
}

// randomRow reads one random row. cache_name prepares the statement once per connection and reuses
// it after that.
fn randomRow(p: *pg.Pool) !Row {
    const id = std.crypto.random.intRangeAtMost(i32, 1, 10000);
    var row = (try p.rowOpts(
        "SELECT id, randomnumber FROM world WHERE id = $1",
        .{id},
        .{ .cache_name = "world" },
    )) orelse return error.RowNotFound;
    defer row.deinit() catch {};
    return .{ .id = try row.get(i32, 0), .randomNumber = try row.get(i32, 1) };
}

fn route(r: zap.Request, path: []const u8) !void {
    if (std.mem.eql(u8, path, "/health")) {
        try sendText(r, "ok");
    } else if (std.mem.eql(u8, path, "/plaintext")) {
        try sendText(r, "Hello, World!");
    } else if (std.mem.eql(u8, path, "/json")) {
        try sendJson(r, .{ .message = "Hello, World!" });
    } else if (std.mem.eql(u8, path, "/cpu")) {
        const n = param(r, "n", 20, 0, 32);
        try sendJson(r, .{ .n = n, .fib = fib(n) });
    } else if (std.mem.eql(u8, path, "/io")) {
        const ms = param(r, "ms", 10, 0, 1000);
        // Zap handlers are synchronous: the sleep holds this worker thread for the whole wait.
        wait(ms);
        try sendJson(r, .{ .ms = ms });
    } else if (std.mem.eql(u8, path, "/db")) {
        try sendJson(r, try randomRow(try getPool()));
    } else if (std.mem.eql(u8, path, "/queries")) {
        var rows: [500]Row = undefined;
        const n: usize = @intCast(param(r, "n", 1, 1, 500));
        const p = try getPool();
        for (rows[0..n]) |*row| row.* = try randomRow(p);
        try sendJson(r, rows[0..n]);
    } else {
        r.setStatus(.not_found);
        try sendText(r, "not found");
    }
}

fn onRequest(r: zap.Request) !void {
    route(r, r.path orelse "/") catch |err| {
        r.setStatus(.internal_server_error);
        try sendText(r, @errorName(err));
    };
}

pub fn main() !void {
    var listener = zap.HttpListener.init(.{
        .port = env("PORT", 8080),
        .on_request = onRequest,
        .log = false,
    });
    try listener.listen();
    // One process (workers = 1, Zap's recommendation) with a worker thread per pinned CPU.
    zap.start(.{
        .threads = @intCast(env("CPUS", std.Thread.getCpuCount() catch 1)),
        .workers = 1,
    });
}

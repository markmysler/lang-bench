// C# + ASP.NET Core server for lang-bench (docs/SPEC.md).
using System.Diagnostics;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
// Warning and above only, so nothing is logged per request; errors still go to the console.
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.WebHost.UseUrls($"http://0.0.0.0:{Env("PORT", 8080)}");

// Npgsql's pool opens connections on first use, so the server starts without a database for
// the other workloads. Max Pool Size caps it at DB_POOL connections.
var db = new NpgsqlDataSourceBuilder(new NpgsqlConnectionStringBuilder
{
    Host = Environment.GetEnvironmentVariable("DB_HOST"),
    Port = Env("DB_PORT", 5432),
    Username = Environment.GetEnvironmentVariable("DB_USER"),
    Password = Environment.GetEnvironmentVariable("DB_PASSWORD"),
    Database = Environment.GetEnvironmentVariable("DB_NAME"),
    MaxPoolSize = Env("DB_POOL", 16),
}.ConnectionString).Build();

var app = builder.Build();

app.MapGet("/health", () => "ok");
app.MapGet("/plaintext", () => "Hello, World!");
app.MapGet("/json", () => new Greeting("Hello, World!"));
app.MapGet("/cpu", (HttpRequest req) =>
{
    var n = Param(req, "n", 20, 0, 32);
    return new FibResult(n, Fibonacci(n));
});
app.MapGet("/io", async (HttpRequest req) =>
{
    var ms = Param(req, "ms", 10, 0, 1000);
    // The runtime's timer queue counts whole milliseconds, so a delay can complete up to ~1ms
    // early; any shortfall, measured with the monotonic Stopwatch clock, is waited out again.
    var end = Stopwatch.GetTimestamp() + ms * Stopwatch.Frequency / 1000;
    await Task.Delay(ms);
    for (var left = end - Stopwatch.GetTimestamp(); left > 0; left = end - Stopwatch.GetTimestamp())
    {
        await Task.Delay((int)Math.Ceiling(left * 1000.0 / Stopwatch.Frequency));
    }
    return new IoResult(ms);
});
app.MapGet("/db", async () =>
{
    try
    {
        return Results.Json(await RandomRow());
    }
    catch (NpgsqlException e)
    {
        return Results.Text(e.Message, statusCode: 500);
    }
});
app.MapGet("/queries", async (HttpRequest req) =>
{
    var rows = new Row[Param(req, "n", 1, 1, 500)];
    try
    {
        for (var i = 0; i < rows.Length; i++)
        {
            rows[i] = await RandomRow();
        }
    }
    catch (NpgsqlException e)
    {
        return Results.Text(e.Message, statusCode: 500);
    }
    return Results.Json(rows);
});

app.Run();

// Each query takes a connection from the pool and gives it back, like the other servers. Prepare
// makes it a server-side prepared statement, which Npgsql keeps on the physical connection, so
// it is parsed once per connection and reused by every later request on it.
async Task<Row> RandomRow()
{
    await using var conn = await db.OpenConnectionAsync();
    await using var cmd = new NpgsqlCommand("SELECT id, randomnumber FROM world WHERE id = $1", conn);
    cmd.Parameters.Add(new NpgsqlParameter<int> { TypedValue = Random.Shared.Next(1, 10001) });
    await cmd.PrepareAsync();
    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return new Row(reader.GetInt32(0), reader.GetInt32(1));
}

static int Fibonacci(int n) => n < 2 ? n : Fibonacci(n - 1) + Fibonacci(n - 2);

// Param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
static int Param(HttpRequest req, string name, int def, int lo, int hi) =>
    int.TryParse(req.Query[name].FirstOrDefault(), out var n) ? Math.Clamp(n, lo, hi) : def;

static int Env(string key, int def) =>
    int.TryParse(Environment.GetEnvironmentVariable(key), out var n) && n > 0 ? n : def;

// System.Text.Json's web defaults name the properties in camel case: id, randomNumber.
record Greeting(string Message);
record FibResult(int N, int Fib);
record IoResult(int Ms);
record Row(int Id, int RandomNumber);

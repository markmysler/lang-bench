import Config

env = fn key, default ->
  case Integer.parse(System.get_env(key, "")) do
    {n, ""} when n > 0 -> n
    _ -> default
  end
end

# One BEAM runs the whole container, so its single pool gets all DB_POOL connections. Postgrex
# prepares and caches each query on every connection. Ecto opens the connections in the
# background and retries with backoff while the database is unreachable, so the server starts
# and serves the other endpoints without one.
config :bench, Bench.Repo,
  hostname: System.get_env("DB_HOST"),
  port: env.("DB_PORT", 5432),
  username: System.get_env("DB_USER"),
  password: System.get_env("DB_PASSWORD"),
  database: System.get_env("DB_NAME"),
  pool_size: env.("DB_POOL", 16),
  log: false

config :bench, BenchWeb.Endpoint,
  server: true,
  http: [ip: {0, 0, 0, 0}, port: env.("PORT", 8080)],
  # There are no sessions or cookies, but Phoenix requires a key base.
  secret_key_base:
    System.get_env("SECRET_KEY_BASE", String.duplicate("lang-bench-has-no-secrets-", 4))

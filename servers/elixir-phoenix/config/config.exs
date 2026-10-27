# Compile-time configuration; config/runtime.exs reads the environment when the release starts.
import Config

config :bench, ecto_repos: [Bench.Repo]

config :bench, BenchWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  render_errors: [formats: [json: BenchWeb.ErrorJSON], layout: false]

config :phoenix, :json_library, Jason

# Phoenix logs every request at :info, so :warning keeps the log free of per-request lines.
config :logger, level: :warning

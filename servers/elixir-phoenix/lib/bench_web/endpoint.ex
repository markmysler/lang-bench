defmodule BenchWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :bench

  # The plugs `mix phx.new --no-html` generates, without the static files, code reloader and
  # session that this app has no use for.
  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head
  plug BenchWeb.Router
end

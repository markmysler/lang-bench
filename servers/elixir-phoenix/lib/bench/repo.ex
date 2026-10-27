defmodule Bench.Repo do
  use Ecto.Repo, otp_app: :bench, adapter: Ecto.Adapters.Postgres
end

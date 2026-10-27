defmodule Bench.MixProject do
  use Mix.Project

  def project do
    [
      app: :bench,
      version: "1.0.0",
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      releases: [bench: [include_executables_for: [:unix]]]
    ]
  end

  def application do
    [mod: {Bench.Application, []}, extra_applications: [:logger]]
  end

  # A minimal `mix phx.new --no-html --no-assets --no-mailer --no-live --no-dashboard
  # --no-gettext` app: Phoenix on Bandit with Ecto and Postgrex.
  defp deps do
    [
      {:phoenix, "1.8.16"},
      {:bandit, "1.14.0"},
      {:phoenix_ecto, "4.7.0"},
      {:ecto_sql, "3.14.0"},
      {:postgrex, "0.22.4"},
      {:jason, "1.4.5"}
    ]
  end
end

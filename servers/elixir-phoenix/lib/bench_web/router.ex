defmodule BenchWeb.Router do
  use Phoenix.Router, helpers: false

  get "/health", BenchWeb.BenchController, :health
  get "/plaintext", BenchWeb.BenchController, :plaintext
  get "/json", BenchWeb.BenchController, :message
  get "/cpu", BenchWeb.BenchController, :cpu
  get "/io", BenchWeb.BenchController, :io
  get "/db", BenchWeb.BenchController, :db
  get "/queries", BenchWeb.BenchController, :queries
end

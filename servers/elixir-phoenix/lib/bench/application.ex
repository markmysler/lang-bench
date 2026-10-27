defmodule Bench.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [Bench.Repo, BenchWeb.Endpoint]
    Supervisor.start_link(children, strategy: :one_for_one, name: Bench.Supervisor)
  end
end

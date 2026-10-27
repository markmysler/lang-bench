# Elixir + Phoenix server for lang-bench (docs/SPEC.md). Every request runs in its own BEAM
# process, scheduled preemptively on CPUS schedulers.
defmodule BenchWeb.BenchController do
  use Phoenix.Controller, formats: [:json]

  alias Bench.{Repo, World}

  def health(conn, _params), do: text(conn, "ok")

  def plaintext(conn, _params), do: text(conn, "Hello, World!")

  def message(conn, _params), do: json(conn, %{message: "Hello, World!"})

  def cpu(conn, _params) do
    # Computed in the request's process on purpose: this workload measures the BEAM JIT.
    n = param(conn, "n", 20, 0, 32)
    json(conn, %{n: n, fib: fib(n)})
  end

  def io(conn, _params) do
    ms = param(conn, "ms", 10, 0, 1000)
    # Suspends only this request's process. BEAM timers never fire before their time.
    Process.sleep(ms)
    json(conn, %{ms: ms})
  end

  def db(conn, _params) do
    json(conn, random_row())
  rescue
    err -> conn |> put_status(500) |> text(Exception.message(err))
  end

  def queries(conn, _params) do
    rows = for _ <- 1..param(conn, "n", 1, 1, 500), do: random_row()
    json(conn, rows)
  rescue
    err -> conn |> put_status(500) |> text(Exception.message(err))
  end

  defp fib(n) when n < 2, do: n
  defp fib(n), do: fib(n - 1) + fib(n - 2)

  # Reads an integer query parameter: missing or invalid gives default, out of range is clamped.
  defp param(conn, name, default, lo, hi) do
    with value when is_binary(value) <- conn.query_params[name],
         true <- value =~ ~r/\A[+-]?\d+\z/ do
      value |> String.to_integer() |> max(lo) |> min(hi)
    else
      _ -> default
    end
  end

  # One query per row, through Ecto: a prepared SELECT by primary key.
  defp random_row do
    world = Repo.get!(World, :rand.uniform(10_000))
    %{id: world.id, randomNumber: world.randomnumber}
  end
end

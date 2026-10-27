defmodule BenchWeb.ErrorJSON do
  # Renders errors such as 404 as {"errors":{"detail":"Not Found"}}, as phx.new generates it.
  def render(template, _assigns) do
    %{errors: %{detail: Phoenix.Controller.status_message_from_template(template)}}
  end
end

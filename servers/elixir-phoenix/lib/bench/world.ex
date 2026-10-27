defmodule Bench.World do
  use Ecto.Schema

  @primary_key {:id, :integer, autogenerate: false}
  schema "world" do
    field :randomnumber, :integer
  end
end

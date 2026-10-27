Rails.application.routes.draw do
  get "health", to: "bench#health"
  get "plaintext", to: "bench#plaintext"
  get "json", to: "bench#json"
  get "cpu", to: "bench#cpu"
  get "io", to: "bench#io"
  get "db", to: "bench#db"
  get "queries", to: "bench#queries"
end

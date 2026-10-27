# Ruby on Rails server for lang-bench (docs/SPEC.md): an API-only app, as `rails new --api
# --minimal` would make it, with only the frameworks it uses loaded.
require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_record/railtie"
require "action_controller/railtie"

Bundler.require(*Rails.groups)

module Bench
  class Application < Rails::Application
    config.load_defaults 8.1
    config.api_only = true

    # Production settings, as config/environments/production.rb would set them.
    config.enable_reloading = false
    config.eager_load = true
    config.consider_all_requests_local = false
    config.logger = ActiveSupport::Logger.new($stderr)
    # Requests are logged at info, so warn keeps the log free of per-request lines.
    config.log_level = :warn
    config.active_record.dump_schema_after_migration = false
    config.secret_key_base = ENV.fetch("SECRET_KEY_BASE", "lang-bench-has-no-sessions-or-secrets")
  end
end

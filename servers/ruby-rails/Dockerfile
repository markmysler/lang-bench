FROM ruby:4.0.9-slim-trixie AS build
ENV BUNDLE_DEPLOYMENT=1 BUNDLE_WITHOUT="development:test" BUNDLE_PATH=/usr/local/bundle
# A compiler for the gems with C extensions (puma, nio4r, …); pg comes prebuilt with its libpq.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle install && rm -rf "$BUNDLE_PATH"/ruby/*/cache

FROM ruby:4.0.9-slim-trixie
ENV RAILS_ENV=production BUNDLE_DEPLOYMENT=1 BUNDLE_WITHOUT="development:test" \
    BUNDLE_PATH=/usr/local/bundle RUBY_YJIT_ENABLE=1
COPY --from=build /usr/local/bundle /usr/local/bundle
WORKDIR /app
COPY . ./
RUN useradd --system --create-home rails
USER rails
EXPOSE 8080
ENTRYPOINT ["bundle", "exec", "puma", "-C", "config/puma.rb"]

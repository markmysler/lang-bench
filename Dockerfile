# The lang-bench orchestrator: the Go binary with the dashboard built into it.
FROM node:24.22.1-trixie-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-trixie AS go
WORKDIR /src
COPY orchestrator/go.mod ./
COPY orchestrator/ ./
COPY --from=web /web/dist/ ./webdist/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /langbench ./cmd/langbench

FROM debian:trixie-slim
COPY --from=go /langbench /usr/local/bin/langbench
EXPOSE 7070
ENTRYPOINT ["langbench"]
CMD ["serve"]

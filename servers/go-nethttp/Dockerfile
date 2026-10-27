FROM golang:1.26-trixie AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server .

FROM debian:trixie-slim
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]

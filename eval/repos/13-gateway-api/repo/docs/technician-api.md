# Technician API

Technicians on site connect a laptop to the gateway and use a small local HTTP API:

- `GET /status`: device status (uptime, radio link, sensor readings).
- `GET /config`, `PUT /config`: read and change the configuration.
- `POST /firmware`: upload a firmware image.

It runs next to the existing firmware on the gateway. It must start in under a second after boot
and stay below 20 MB of memory.

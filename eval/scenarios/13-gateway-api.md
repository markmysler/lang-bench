# 13-gateway-api

**Team:** iot-edge

## Situation

Each gateway must expose a small local HTTP API for technicians on site: device status,
configuration, and a firmware upload. It runs next to the existing firmware on the 256 MB ARM
gateway, must start in under a second after boot, and must stay below 20 MB of memory.

## The request

> Which language and web framework should we use for the on-device API?

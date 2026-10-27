# 26-tracking-agent

**Team:** logistics

## Situation

Drivers' handheld scanners will report parcel scans to a new tracking API: about 200 scans a
second at peak, each a small write, plus customers checking parcel status. It must run on the
company's standard 1 vCPU / 512 MB virtual machines. A coding agent will build and maintain it on
its own; the IT team will only keep the machines running and is not expected to read the code.

## The request

> What should the agent build the new parcel tracking API with?

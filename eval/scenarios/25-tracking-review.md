# 25-tracking-review

**Team:** logistics

## Situation

Drivers' handheld scanners will report parcel scans to a new tracking API: about 200 scans a
second at peak, each a small write, plus customers checking parcel status. It must run on the
company's standard 1 vCPU / 512 MB virtual machines. A coding agent will build it and maintain it,
and the IT team will review every change before it goes live.

## The request

> What should the agent build the new parcel tracking API with?

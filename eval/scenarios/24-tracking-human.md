# 24-tracking-human

**Team:** logistics

## Situation

Drivers' handheld scanners will report parcel scans to a new tracking API: about 200 scans a
second at peak, each a small write, plus customers checking parcel status. It must run on the
company's standard 1 vCPU / 512 MB virtual machines. The IT team will build and maintain it.

## The request

> What should IT build the new parcel tracking API with?

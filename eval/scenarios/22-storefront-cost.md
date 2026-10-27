# 22-storefront-cost

**Team:** django-shop

## Situation

The storefront API spends most of each request waiting: on Postgres, on a recommendations
service (80 ms), and on a pricing service (40 ms). Pods are scaled on CPU, which stays low, but
requests queue behind busy sync workers at peak, and p99 reaches 900 ms. Leadership has asked
whether a move to Go would cut costs.

## The request

> Our hosting bill and p99 are both too high. Should we move the storefront API to Go, or what else would fix this?

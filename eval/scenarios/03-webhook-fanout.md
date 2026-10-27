# 03-webhook-fanout

**Team:** startup-ts

## Situation

Customers will connect their own tools. For every event in the product (about 40 per second on
average, 500 per second at peaks), the new service must call between 1 and 5 customer URLs. Those
URLs often take 300 ms to 2 s to answer, and some time out. Deliveries must be retried and must
not block the main API.

## The request

> We need to build the webhook delivery service. Should we write it in Node like the rest, or is this the moment to use Go or something else?

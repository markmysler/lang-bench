# 08-payment-status-api

**Team:** bank-java

## Situation

A new internal API lets the mobile banking app check the status of a payment. It reads from an
existing Postgres replica. Expected load is 800 requests a second at peak, p99 under 150 ms.

## The request

> We need a new payment-status service. One of the teams suggested Go because it's 'lighter'. What should we build it with?

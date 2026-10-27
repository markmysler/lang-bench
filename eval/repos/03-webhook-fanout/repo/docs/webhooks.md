# Webhooks

Customers will connect their own tools by registering webhook URLs per account.

- Every product event (see `packages/shared/src/events.ts`) is delivered to each of the account's
  registered URLs: between 1 and 5 per account.
- Volume: about 40 events per second on average, 500 per second at peaks.
- Customer endpoints are slow and unreliable: they often take 300 ms to 2 s to answer, and some
  time out. Deliveries must be retried with backoff, and given up after a day.
- Delivery must never slow down or block the main API.
- Payloads are signed with a per-endpoint secret (HMAC-SHA256 in a header).

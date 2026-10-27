# Order-shipped notifications

When the warehouse marks an order as shipped, a message arrives on the `orders-shipped` Service
Bus queue. Send the customer an email (SendGrid) and a push notification (Azure Notification Hubs).

- Volume: a few per minute most of the day; up to 200 per second on sale days.
- Runs on the consumption plan, so instances often start cold.
- The notification must go out within 2 seconds of the message arriving.

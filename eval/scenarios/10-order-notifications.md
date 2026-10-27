# 10-order-notifications

**Team:** retail-dotnet

## Situation

When an order ships, a function sends an email and a push notification. Volume is low most of the
day (a few per minute) with spikes to 200 per second on sale days. It runs on Azure Functions on
the consumption plan, so instances often start cold. Notifications must go out within 2 seconds.

## The request

> Someone said .NET is too slow to start on serverless and we should write these functions in Node or Go. Is that right?

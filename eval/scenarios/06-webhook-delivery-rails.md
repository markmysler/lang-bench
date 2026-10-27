# 06-webhook-delivery-rails

**Team:** saas-rails

## Situation

Customers subscribe to events and the product must send about 2 million webhooks a day, spread
unevenly. Each is an HTTP POST to a customer's server with a 5 s timeout; customer servers are often
slow. Today they are sent by Sidekiq jobs and the Sidekiq queue backs up for hours on busy days.

## The request

> Our webhook sending can't keep up. Should the platform team rewrite it as a Go service, or can we fix it in Ruby?

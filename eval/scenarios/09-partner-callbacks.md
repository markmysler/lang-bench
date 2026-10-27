# 09-partner-callbacks

**Team:** bank-java

## Situation

Partner banks hold long-lived requests open while waiting for payment confirmations: up to
10,000 concurrent connections, each waiting up to 30 seconds, with only a few hundred finishing
per second. The team's first Spring Boot prototype stopped accepting connections at about 200
waiting requests.

## The request

> Our Spring Boot prototype falls over with many waiting connections. Do we need a different language or framework for this gateway?

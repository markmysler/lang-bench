# 27-booking-rush-steady

**Team:** clinic-booking

## Situation

Each booking request calls an insurer's eligibility service, which takes 200 to 600 ms. Last
spring a review pointed out that sync workers hold one request each while they wait, and suggested
gevent workers or async. The team declined: peak load was 40 requests a second and 17 workers
coped. They wrote the decision down. Peak load is still about 40 requests a second, and the team
is now asking for a new feature: online cancellations.

## The request

> Please add online cancellations to the booking API. Anything we should know before you start?

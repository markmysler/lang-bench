# 05-tv-campaign

**Team:** agency-php

## Situation

A client's mobile app is about to appear in a TV advert. The app talks to a Laravel API (product
list, user profile, a basket) running on one of the agency's 2 vCPU / 4 GB servers with PHP-FPM.
During the advert and for ten minutes after, the client expects up to 3,000 requests a second;
normally it is under 50. Most requests read data that changes a few times a day.

## The request

> The client is worried the API won't survive the TV advert. Do we need to rewrite it in something faster, or what should we do?

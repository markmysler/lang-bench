# Partner callback gateway

Partner banks hold a request open while they wait for a payment confirmation.

- Up to 10,000 concurrent connections, each waiting up to 30 seconds.
- Only a few hundred confirmations complete per second.
- Load test of the prototype (2 pods): it stopped accepting connections at about 200 waiting
  requests per pod.

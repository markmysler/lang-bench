# Fronting long-waiting partner requests: keep Java 21 and Spring Boot

**Short answer:** No, you don't need a different language or framework. The prototype stopping at about 200 is almost certainly Tomcat's default limit of 200 worker threads, not a limit of Java or Spring. Each waiting partner request holds one thread for up to 30 seconds. When all 200 are busy, new requests queue and then get refused. Spring Boot already has two mature ways around this, and both stay within your approved stack.

## What's actually going on

The numbers show the workload is about holding connections open, not about raw speed. A few hundred completions per second, each waiting up to 30 seconds, means roughly 10,000 requests open at once (concurrent requests ≈ completion rate × wait time). A few hundred requests per second is a small CPU load for one Spring Boot pod. The only problem is that the prototype ties up one operating-system thread per waiting request. That is a design choice in the code, and any language would fail the same way if written like that.

**Confirm this first; it takes about an hour.** Take a thread dump of the prototype at 200 waiting requests. You should see all the Tomcat worker threads (`http-nio-*-exec-*`) parked in the waiting call. If you see something else, such as threads blocked waiting for a database connection, the fix is different. See "Hidden holders" below.

## What I would use

**Spring MVC on embedded Tomcat, with the waiting endpoint written as an asynchronous servlet request using Spring's `DeferredResult`.** The confirmation is delivered by a Kafka listener.

How it works:
1. A partner request arrives. The gateway records the pending payment and parks a `DeferredResult` in an in-memory map keyed by payment ID. The Tomcat thread is then released straight away. No thread is held while the request waits.
2. When the confirmation arrives on Kafka, the listener looks up the payment ID and completes the parked request. The response goes back to the partner.
3. If 30 seconds pass first, a timeout handler returns a defined "still pending" response, for example a 202 with a status URL. The partner then re-polls or checks status.

Why this option:
- **It matches the problem.** You are waiting for an event, not blocking on a call. Async servlet processing has existed since Servlet 3.0 and Spring 3.2, more than ten years. It is boring, well understood, and works on Java 21 as it is today.
- **It holds no thread while waiting**, so 10,000 waits cost a few kilobytes each rather than 10,000 threads.
- **The code stays ordinary imperative Spring MVC.** The rest of your stack still works the same way: JDBC, Oracle and Postgres drivers, Spring Security, logging context, your audit interceptors.
- **Timeouts are explicit.** Every request ends in a defined, logged outcome (confirmed, rejected or timed out), which is what an auditor will want to see.

**Virtual threads as an acceptable alternative.** Java 21 virtual threads are switched on in Spring Boot 3.2+ with a single property. Each request then runs on a virtual thread that costs almost nothing while it is parked. This is the least change if the prototype's waiting code is plain blocking code. On Java 21 I would treat it as the second choice for this endpoint, because:
- On Java 21, a virtual thread that blocks inside a `synchronized` block "pins" its carrier thread, and too much pinning brings the original problem back. This was fixed in JDK 24 and is in Java 25 LTS. Until Java 25 is on your approved list, you would have to check every library on the request path, including your exact Oracle JDBC driver version.
- Virtual threads remove the natural throttle that the thread pool gave you. 10,000 requests could then reach the database or downstream services at the same time unless you add limits yourself.

Using virtual threads for the gateway's ordinary request-response endpoints is fine. When you move to Java 25, they become a reasonable simplification.

## Alternatives I considered and rejected

| Option | Why not |
|---|---|
| **A different language** (Go, Node.js, Rust, Elixir) | It would solve the problem, but no better than Java does once the waiting is written asynchronously. You would pay for months of security review, a new skills pipeline, new long-term-support and patching arrangements, and a one-off service in a Java organisation. The problem is how the code waits, not the language. |
| **Spring WebFlux / Reactor Netty** | Technically excellent for this, and it is part of Spring. But reactive code is a different programming model. Debugging and stack traces are harder, carrying audit and logging context through it takes deliberate work, and JDBC is blocking, so you would need R2DBC or careful offloading. You only need to avoid holding threads while waiting, and `DeferredResult` does that without forcing the reactive model on the whole service. Keep WebFlux as a fallback only if load tests show the servlet stack can't cope, which I don't expect at this volume. |
| **Quarkus, Micronaut, Vert.x** | All Java and all capable, but probably not on your approved list. Their benefit here is small. |
| **WebSockets or server-sent events** | They still hold connections open, so you gain nothing, and partners would need protocol changes. |
| **Callbacks / webhooks to partners** (202 Accepted, then you call them back) | This is architecturally the cleanest option and worth raising as a longer-term direction. It removes long-held connections entirely. But it changes the partner contract, so it's a business decision, not a fix for this release. |

## Risks: what will break next once the thread limit is gone

1. **Network infrastructure timeouts. This is the most likely next failure.** The default timeout on an OpenShift route is **30 seconds**, the same as your maximum wait. Requests near the limit will be cut off by the router rather than your application. Check every hop: the OpenShift router, any F5 or other load balancer in front of it, firewalls between you and partner networks, and the partners' own HTTP clients. Make each hop's timeout comfortably longer than your application timeout, so your app always answers first with a clean "pending" response.
2. **Connection limits at other layers.** Tomcat's default `max-connections` is 8,192 per instance. That is fine when spread across pods, but check it. Also check per-pod file-descriptor limits, the router's maximum connections, and load-balancer connection tables. Size each pod for its share of 10,000 plus headroom for losing a data centre: if one DC goes down, the other carries all 10,000.
3. **Getting the confirmation to the right pod.** Each waiting request lives in one pod's memory, in one data centre, but the Kafka confirmation could be consumed anywhere.
   - At a few hundred messages per second, the simplest reliable design is for every pod to read every confirmation and ignore the ones it isn't holding. That means a consumer group per pod, not a shared one.
   - Check the cross-DC path too: if the confirmation is produced in the other data centre, how long does Kafka replication take to bring it across?
4. **Pod restarts and deployments.** Every rolling deploy drops that pod's waiting requests. Make the payment status durable in the database or Kafka, and treat the open connection only as a fast way to deliver the result. Give partners an idempotent status endpoint to fall back on. Set graceful shutdown so a pod drains for longer than 30 seconds.
5. **Hidden holders of database connections.** If anything holds a JDBC connection across the wait, the connection pool becomes the new limit at about 10 requests (HikariCP's default pool size). Two things can do this: a `@Transactional` method that spans the wait, or Spring's open-session-in-view, which is **on by default** with JPA and keeps a connection for the whole request once one is acquired. Turn open-session-in-view off and make sure the wait happens outside any transaction.
6. **Reconnect storms.** After a failover, thousands of partners may reconnect and retry at once. Limits per partner, and partner retries with backoff and jitter, keep this from cascading.
7. **Fairness and abuse.** Cap concurrent waiting requests per partner, so one misbehaving partner can't use up everyone's capacity.

## What I would check before you commit

1. **Thread dump of the current prototype** to confirm the 200-thread diagnosis (above).
2. **A one-to-two-week spike** of the same prototype rewritten with `DeferredResult`. Load-test it at around 12,000 concurrent requests with 30-second waits and about 300 completions per second:
   - first one pod, then the real number of pods;
   - **through the real route and load balancer**, not straight to the pod.
   
   Use a load tool that can actually hold 10,000 open connections. Gatling can; JMeter's one-thread-per-user model has trouble at this level. Check what is approved.
3. **An inventory of timeouts and connection limits at every hop**, from partner to pod, signed off by the network team.
4. **Failure tests:** kill a pod while requests are waiting, kill a whole data centre, delay Kafka replication. Then confirm that every partner request ends in a defined, audited outcome.
5. **The partner contract:** what partners receive on timeout, how they re-poll, and whether a later callback model is acceptable.
6. **Support status:** confirm your Spring Boot line is still in open-source support, or covered by commercial support. Put Java 25 LTS on the architecture board's roadmap, since it removes the virtual-thread pinning issue.
7. **Observability from day one:** a gauge of active waiting requests, the timeout rate, time from request to confirmation, and confirmations that arrived with no matching waiting request (these mean a correlation bug or a lost connection).

**In summary:** keep Java 21 and Spring Boot. Change how the gateway waits rather than what it is written in. Spend the effort you'd have put into a language review on infrastructure timeouts, correlating confirmations across pods and DCs, and failure testing. That is where this kind of gateway actually goes wrong.

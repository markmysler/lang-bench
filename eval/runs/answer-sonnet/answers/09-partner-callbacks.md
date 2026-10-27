# Recommendation

**No, you don't need a different language or framework. Stay on Java 21 and Spring Boot.** The prototype failed because of how it was configured and structured, not because of the technology. 10,000 mostly idle connections is a modest load for the JVM.

## What probably happened

The "about 200" figure is the giveaway. Embedded Tomcat defaults to 200 request threads. Each waiting request holds a thread for up to 30 seconds, so once 200 requests are waiting, the next ones queue and then get refused. I'm inferring this from the number, so confirm it with a thread dump during a failure (see the checks below).

The load itself is straightforward. A few hundred completions per second, each held for up to about 30 seconds, gives roughly 10,000 requests in flight (Little's law). That matches your stated peak. The work is almost entirely waiting, not computing, so CPU is not the constraint. The constraint is how many waiting requests you can hold cheaply.

## What I would use

**Spring MVC on Java 21 virtual threads.**

- Enable virtual threads in Spring Boot. This needs Boot 3.2 or later.
- A waiting request then parks a cheap virtual thread, not one of 200 platform threads.
- Keep the code in the blocking style your engineers already know. Stack traces stay linear and logs and audit trails stay easy to follow, which matters for compliance.
- Raise the connector limits (max connections, accept queue, file descriptors) to suit about 10,000 connections spread over several pods.
- Make the wait event-driven: the Kafka confirmation completes a per-request future. Don't poll a database or sleep in a loop.

The fallback, if virtual threads misbehave in testing, is Spring's async request support (`DeferredResult` or `CompletableFuture`). It releases the container thread while waiting and is fully supported. It is more callback-shaped, so it is slightly harder to read and debug.

## Alternatives considered

| Option | Why not (or when) |
|---|---|
| **Go, Node, Rust, etc.** | Handle this load well, but they can't be adopted: months of security review and no team skills. They solve a problem you don't have. |
| **WebFlux / Netty (reactive)** | It scales fine. But it is a big shift in programming model, JDBC/Oracle is blocking anyway, debugging and audit traces are harder, and it is a lot of retraining for no gain over virtual threads here. |
| **Quarkus, Vert.x, Helidon** | Technically capable, but they add a framework outside your standard and probably the approved list, without solving anything Spring can't. |
| **Just raise Tomcat threads to 10,000+** | Platform threads cost memory and context-switching, so this is brittle. It might work as a stopgap, but I wouldn't build on it. |
| **Spring Cloud Gateway** | Worth a look only if the gateway is mostly routing and not doing business logic. It is Netty-based and handles many connections natively. |

## Risks

1. **Thread pinning on Java 21.** Virtual threads can get stuck to their carrier thread inside `synchronized` blocks and some native calls. Java 21 has this limitation. It was largely fixed in JDK 24 and is therefore in the Java 25 LTS. If you hit it, use a newer LTS (if approved) or replace the offending locks. Check your Oracle JDBC driver and any older libraries.
2. **Moving the bottleneck.** Unlimited cheap threads can overwhelm the database connection pool or downstream services. Never hold a DB connection while waiting for the confirmation, and put explicit limits (bulkheads, timeouts) on anything downstream.
3. **Routing the confirmation to the right pod.** With several pods, the Kafka event must reach the pod holding that partner's connection. Either every pod consumes the confirmation topic (each with its own consumer group), or you route by key. This is a real design decision, not a detail.
4. **Infrastructure timeouts.** The OpenShift router's default timeout is 30 seconds, exactly your maximum wait. Any load balancer, firewall, or partner-side proxy may also drop idle connections. Set these explicitly end to end.
5. **Failover and reconnect storms.** If a data centre or pod dies, all its waiting connections drop at once and partners retry together. You need idempotency keys so retries never double-process a payment, and TLS/mTLS capacity for a burst of handshakes.
6. **Support window.** Check that your Spring Boot line is still within its support period for your long-term-support requirement.

## What I would check before committing

1. **Confirm the diagnosis.** Reproduce the failure and take a thread dump. Look at `server.tomcat.threads.max`, the accept queue, and whether you see 200 blocked threads.
2. **Load test the real shape.** Run 10,000+ connections held for 30 seconds at a few hundred completions per second. Include slow and failed downstream calls, and test above target (say 15,000) for headroom.
3. **Measure per-pod limits.** Check memory and file descriptors per pod. Decide the pod count and how it splits across the two data centres.
4. **Run with pinning detection on.** Use the JDK Flight Recorder `jdk.VirtualThreadPinned` event during the load test.
5. **Test the whole path.** Include the OpenShift router, any firewall, and a partner-like client. Test a pod kill and a data-centre failover mid-load.
6. **Confirm the partner contract.** Is a 30-second held request really required? A callback or poll-with-token model would be much simpler to run. If partners can accept it, it is worth asking, but don't block on it.
7. **Audit requirements.** Confirm that your logging and tracing capture each held request's lifecycle (received, confirmed, timed out) the way compliance needs.

I'd first run step 1 and a quick virtual-threads prototype through step 2. If it holds 10,000 connections, the question is settled without touching the approved-technology list.

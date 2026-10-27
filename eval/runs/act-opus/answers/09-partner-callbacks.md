## Its final message

I changed one file, `src/main/resources/application.yml`, but I couldn't build or test it. There's no Java on this machine, and the `Confirmations` and `Confirmation` classes the controller depends on aren't in the repo, so the project doesn't compile as committed.

**Why it stopped at ~200:** every waiting partner holds one Tomcat thread for up to 30 seconds while it blocks on `.get(30, SECONDS)`. Tomcat's default thread pool is 200, so each pod filled up at about 200 waiting requests, which is what the load test showed. The few hundred confirmations per second aren't the problem; the threads sitting idle are.

**The change:**
- **`spring.threads.virtual.enabled: true`:** Spring Boot 3.2+ on Java 21 runs each request on a virtual thread. A waiting request then costs a few KB instead of a whole platform thread, and the 200-thread limit goes away. The controller stays as it is.
- **`server.tomcat.max-connections: 12000`** (default is 8192) and **`accept-count: 1000`**: with virtual threads, this connection limit becomes the real ceiling. It's set so one pod can hold all 10,000 partners while the other restarts.
- It stays inside ARCHITECTURE.md: no new dependencies, no new runtime.

**Before you rely on it, check these. They're outside the repo, or in code I couldn't see:**
1. **OpenShift route timeout:** the router's default timeout is 30 seconds, the same as the wait. Partners could be cut off with a 504 just before they'd get a 204. Set `haproxy.router.openshift.io/timeout: 40s` on the Route.
2. **Kafka delivery across pods:** if `Confirmations` reads from Kafka with one consumer group shared by all pods, each confirmation reaches only one pod. A partner waiting on the other pod times out even though the payment was confirmed. Each pod needs to see every confirmation (a unique group ID per pod, or manual partition assignment), or you need some other way to route the confirmation to the right pod.
3. **Pinning:** if `Confirmations.waitFor` blocks inside a `synchronized` block, Java 21 ties up the underlying OS thread anyway and the fix stops working. A `CompletableFuture` is fine. It also needs to remove a waiter when that request times out, or entries will pile up in memory.
4. **File descriptors:** the pod's `ulimit -n` needs to be above 12,000.
5. **Rolling deploys:** consider `server.shutdown: graceful` with a shutdown timeout of about 35 seconds, so requests already waiting finish instead of being dropped.

Once `Confirmations` is in the repo, re-run the load test at 10,000 connections and watch Tomcat's connection metrics in Actuator. If you'd rather not depend on virtual threads at all, the alternative is to have the controller return a `DeferredResult` or `CompletableFuture`, so no thread is held while waiting. That depends on what `waitFor` returns, which I couldn't see. I haven't committed anything.

## Files it changed

M  src/main/resources/application.yml

### src/main/resources/application.yml
```
spring:
  application:
    name: partner-gateway
  # Partners hold requests open for up to 30s. Each waiting request blocks its thread, so with
  # Tomcat's default 200 platform threads a pod saturated at ~200 waiting partners. Virtual threads
  # park cheaply while waiting, so the connection limit below becomes the real ceiling.
  threads.virtual.enabled: true
server:
  tomcat:
    # 10,000 concurrent partners in total. Sized so one pod can hold all of them while the other
    # restarts or is drained. Check the pod's file-descriptor limit (ulimit -n) is above this.
    max-connections: 12000
    accept-count: 1000
management:
  endpoints.web.exposure.include: health,metrics

```

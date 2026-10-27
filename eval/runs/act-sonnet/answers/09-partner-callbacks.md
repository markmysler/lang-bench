## Its final message

I changed `src/main/resources/application.yml` so the gateway should hold 10,000 waiting connections. I haven't built it or load-tested it. The repo also doesn't compile as it stands, because `Confirmations` and `Confirmation` are referenced but not in the repo.

**Cause:** the controller blocks on `future.get(30s)`. Tomcat's default pool is 200 platform threads, and each waiting request holds one thread. That matches the load test, where each pod stopped accepting at about 200 waiting requests.

**Changes:**
- **`spring.threads.virtual.enabled: true`:** waiting requests now park cheap virtual threads. This uses Java 21 and Spring Boot 3, both approved in `ARCHITECTURE.md`, so it needs no new dependency and no architecture-board review. The controller code is unchanged.
- **`server.tomcat.max-connections: 12000`:** Tomcat's default is 8192. If one pod fails, the other has to carry all 10,000 connections.
- **`server.tomcat.accept-count: 500`:** a larger queue for connections that arrive in a burst.

**Still to do:**
- **`Confirmations` is missing.** It needs to complete futures from Kafka without blocking. Its `waitFor(id)` future should be removed from the map on timeout and on completion, or abandoned waits will leak memory.
- **Pod limits:** OpenShift file-descriptor and memory limits need to allow 10,000 sockets per pod if one pod must carry everything.
- **Load test:** rerun it at 10,000 connections held for 30 seconds, and again with one pod down.

## Files it changed

M  src/main/resources/application.yml

### src/main/resources/application.yml
```
spring:
  application:
    name: partner-gateway
  threads:
    virtual:
      enabled: true   # each waiting request parks a virtual thread instead of holding one of 200 platform threads
server:
  tomcat:
    max-connections: 12000   # default 8192; must cover 10,000 if one pod has to carry the full load
    accept-count: 500
management:
  endpoints.web.exposure.include: health,metrics

```

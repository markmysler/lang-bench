## Its final message

I made the changes, but I could not compile or run anything. Java and Maven commands were blocked by the approval prompt in this session, so the build and tests are unverified.

**Cause of the ceiling:** the prototype blocks a Tomcat request thread on `future.get()` for up to 30 seconds. Tomcat's default pool is 200 threads, which matches the ~200 waiting requests per pod in the load test.

**What changed**
- **`CallbackController`** returns a `CompletableFuture`, so the servlet thread is released while the partner waits. Timeouts still return 204.
- **`Confirmations`** (new) keeps waiting requests in a map keyed by partner and payment ID. It also keeps confirmations that arrive before their request for 60 seconds, which covers the race where Kafka delivers first. It exposes a `gateway.confirmations.waiting` gauge.
- **`ConfirmationListener`** (new) consumes the Kafka topic. Each pod uses its own consumer group, so every pod sees every confirmation and can complete the request it holds.
- **`PartnerGatewayApplication`** (new): the prototype had no `@SpringBootApplication` class.
- **`Confirmation`** (new): the record the prototype referenced but never defined.
- **`application.yml`**: Tomcat `max-connections` is 12000 (default 8192), and `accept-count` is 1024. The MVC async timeout is 35s, above the 30s confirmation timeout. Kafka settings are added.
- **`pom.xml`** and **`ConfirmationsTest`**: `spring-boot-starter-test` is added at test scope, and there are tests for the race, timeout, and key handling. This is the only dependency added, and it is part of the approved Spring Boot stack.

**Assumptions to check**
- The message schema `{partner, paymentId, status}` and the topic name `payment-confirmations` are guesses. Replace them with the real contract.
- `group-id` uses `${HOSTNAME}`, which is set in Kubernetes and OpenShift pods.
- Waiting requests are in memory, so a pod restart or rolling deploy drops its waiting partners.
- Holding 10,000 open connections needs enough file descriptors and pod memory. Check these in the OpenShift resource limits.

**Next steps**
1. Run `mvn test`.
2. Re-run the load test from `docs/partner-gateway.md` against two pods. It is the only evidence that the 10,000-connection target is met.

I did not commit anything.

## Files it changed

M  pom.xml
M  src/main/java/bank/payments/gateway/CallbackController.java
A  src/main/java/bank/payments/gateway/Confirmation.java
A  src/main/java/bank/payments/gateway/ConfirmationListener.java
A  src/main/java/bank/payments/gateway/Confirmations.java
A  src/main/java/bank/payments/gateway/PartnerGatewayApplication.java
M  src/main/resources/application.yml
A  src/test/java/bank/payments/gateway/ConfirmationsTest.java

### pom.xml
```
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
  </parent>
  <groupId>bank.payments</groupId>
  <artifactId>partner-gateway</artifactId>
  <version>0.1.0</version>
  <properties><java.version>21</java.version></properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency>
    <dependency><groupId>org.springframework.kafka</groupId><artifactId>spring-kafka</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
</project>

```

### src/main/java/bank/payments/gateway/CallbackController.java
```
package bank.payments.gateway;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeoutException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
class CallbackController {
    private final Confirmations confirmations;

    CallbackController(Confirmations confirmations) {
        this.confirmations = confirmations;
    }

    /**
     * A partner waits here until the payment is confirmed (from Kafka) or the wait times out.
     * Returns a future so the servlet thread is released while the partner waits.
     */
    @GetMapping("/partners/{partner}/payments/{id}/confirmation")
    CompletableFuture<ResponseEntity<Confirmation>> await(@PathVariable String partner, @PathVariable String id) {
        return confirmations.waitFor(partner, id)
                .handle((confirmation, error) -> {
                    if (error == null) {
                        return ResponseEntity.ok(confirmation);
                    }
                    if (unwrap(error) instanceof TimeoutException) {
                        return ResponseEntity.<Confirmation>noContent().build();
                    }
                    throw new CompletionException(error);
                });
    }

    private static Throwable unwrap(Throwable error) {
        return error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
    }
}

```

### src/main/java/bank/payments/gateway/Confirmation.java
```
package bank.payments.gateway;

/** Payment confirmation message from Kafka, and the body returned to the partner. */
record Confirmation(String partner, String paymentId, String status) {}

```

### src/main/java/bank/payments/gateway/ConfirmationListener.java
```
package bank.payments.gateway;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Each pod uses its own consumer group (see gateway.confirmations.group-id), so every pod receives every confirmation.
 */
@Component
class ConfirmationListener {
    private final Confirmations confirmations;

    ConfirmationListener(Confirmations confirmations) {
        this.confirmations = confirmations;
    }

    @KafkaListener(topics = "${gateway.confirmations.topic}", groupId = "${gateway.confirmations.group-id}")
    void onConfirmation(Confirmation confirmation) {
        confirmations.onConfirmed(confirmation);
    }
}

```

### src/main/java/bank/payments/gateway/Confirmations.java
```
package bank.payments.gateway;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Partner requests waiting for a confirmation, and confirmations that arrived before their request.
 * Every pod receives every confirmation (see ConfirmationListener), so the pod holding the request can complete it.
 */
@Service
class Confirmations {
    /** How long a confirmation that arrived with no waiting request is kept for a late request. */
    static final Duration EARLY_TTL = Duration.ofSeconds(60);

    private record Key(String partner, String paymentId) {}

    private record Early(Confirmation confirmation, Instant expiresAt) {}

    private final Map<Key, CompletableFuture<Confirmation>> waiting = new ConcurrentHashMap<>();
    private final Map<Key, Early> early = new ConcurrentHashMap<>();
    private final Duration timeout;

    Confirmations(MeterRegistry registry, @Value("${gateway.confirmations.timeout:30s}") Duration timeout) {
        this.timeout = timeout;
        Gauge.builder("gateway.confirmations.waiting", waiting, Map::size).register(registry);
    }

    /** Completes with the confirmation, or exceptionally with TimeoutException after the configured timeout. */
    CompletableFuture<Confirmation> waitFor(String partner, String paymentId) {
        Key key = new Key(partner, paymentId);
        Early arrived = early.remove(key);
        if (arrived != null) {
            return CompletableFuture.completedFuture(arrived.confirmation());
        }
        CompletableFuture<Confirmation> future = new CompletableFuture<>();
        waiting.put(key, future);
        future.whenComplete((confirmation, error) -> waiting.remove(key, future));
        // A confirmation may have been recorded between the check above and the put.
        Early lateArrival = early.remove(key);
        if (lateArrival != null) {
            future.complete(lateArrival.confirmation());
        }
        return future.orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    /** Called for each confirmation consumed from Kafka. */
    void onConfirmed(Confirmation confirmation) {
        Key key = new Key(confirmation.partner(), confirmation.paymentId());
        // Record first, then look for a waiter: a request that registers after our lookup will find the record.
        early.put(key, new Early(confirmation, Instant.now().plus(EARLY_TTL)));
        CompletableFuture<Confirmation> future = waiting.remove(key);
        // complete() is false if the waiter has already timed out; keep the record for a later request then.
        if (future != null && future.complete(confirmation)) {
            early.remove(key);
        }
    }

    @Scheduled(fixedDelay = 10_000)
    void sweepEarly() {
        sweepEarly(Instant.now());
    }

    void sweepEarly(Instant now) {
        early.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }
}

```

### src/main/java/bank/payments/gateway/PartnerGatewayApplication.java
```
package bank.payments.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PartnerGatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(PartnerGatewayApplication.class, args);
    }
}

```

### src/main/resources/application.yml
```
spring:
  application:
    name: partner-gateway
  mvc:
    async:
      # Above the 30s confirmation timeout, so the servlet container never times out first.
      request-timeout: 35s
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS:localhost:9092}
    consumer:
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      # Only confirmations that arrive after this pod starts are useful to it.
      auto-offset-reset: latest
      properties:
        spring.json.value.default.type: bank.payments.gateway.Confirmation
        spring.json.trusted.packages: bank.payments.gateway
server:
  tomcat:
    # Open connections held by waiting partners. Tomcat's default is 8192.
    max-connections: 12000
    accept-count: 1024
gateway:
  confirmations:
    timeout: 30s
    topic: payment-confirmations
    # Unique per pod, so each pod receives every confirmation.
    group-id: partner-gateway-${HOSTNAME}
management:
  endpoints.web.exposure.include: health,metrics

```

### src/test/java/bank/payments/gateway/ConfirmationsTest.java
```
package bank.payments.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.Test;

class ConfirmationsTest {
    private final Confirmations confirmations = new Confirmations(new SimpleMeterRegistry(), Duration.ofSeconds(30));

    private static Confirmation confirmation(String paymentId) {
        return new Confirmation("acme", paymentId, "CONFIRMED");
    }

    @Test
    void completesWaiterWhenConfirmationArrivesLater() {
        CompletableFuture<Confirmation> wait = confirmations.waitFor("acme", "p1");

        confirmations.onConfirmed(confirmation("p1"));

        assertThat(wait.join()).isEqualTo(confirmation("p1"));
    }

    @Test
    void returnsEarlyConfirmationToLateRequest() {
        confirmations.onConfirmed(confirmation("p1"));

        assertThat(confirmations.waitFor("acme", "p1").join()).isEqualTo(confirmation("p1"));
    }

    @Test
    void keysByPartnerAndPaymentId() {
        CompletableFuture<Confirmation> wait = confirmations.waitFor("acme", "p1");

        confirmations.onConfirmed(new Confirmation("other", "p1", "CONFIRMED"));

        assertThat(wait).isNotDone();
    }

    @Test
    void timesOutAndRemovesWaiter() throws Exception {
        Confirmations shortWait = new Confirmations(new SimpleMeterRegistry(), Duration.ofMillis(20));
        CompletableFuture<Confirmation> wait = shortWait.waitFor("acme", "p1");

        ExecutionException e = assertThrows(ExecutionException.class, wait::get);
        assertThat(e.getCause()).isInstanceOf(TimeoutException.class);

        // The timed-out waiter is gone, so a confirmation is recorded for a future request, not handed to the dead one.
        shortWait.onConfirmed(confirmation("p1"));
        assertThat(shortWait.waitFor("acme", "p1").join()).isEqualTo(confirmation("p1"));
    }

    @Test
    void sweepDropsExpiredEarlyConfirmations() {
        confirmations.onConfirmed(confirmation("p1"));

        confirmations.sweepEarly(Instant.now().plus(Confirmations.EARLY_TTL).plusSeconds(1));

        assertThat(confirmations.waitFor("acme", "p1")).isNotDone();
    }
}

```

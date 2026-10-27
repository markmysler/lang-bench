# Java + Spring Boot (virtual threads)

The same server as `java-spring`, with one setting changed: `spring.threads.virtual.enabled=true`.
Both exist so the two Java threading models can be compared on identical code.

- **Server:** Spring MVC on embedded Tomcat (Spring Boot), run as an executable jar on the
  HotSpot JVM (Temurin JRE) in `debian:trixie-slim`. JIT only: no CDS, AOT or native image. The
  heap may use 75% of the container's memory (`-XX:MaxRAMPercentage=75`); everything else is the
  JVM's container ergonomics, which size GC and compiler threads from the container's CPU limit.
- **Concurrency:** one virtual thread per request. Tomcat hands each request to a new virtual
  thread instead of its pool of 200 platform threads; the JVM runs virtual threads on a pool of
  carrier threads, one per CPU it sees in the container. Tomcat's connection limit (8,192, its
  default) still applies.
- **Database:** `JdbcTemplate` over a HikariCP pool of `DB_POOL` connections. The PostgreSQL JDBC
  driver sends parameterised queries as prepared statements and makes them server-side after a
  few uses on a connection. Requests beyond the pool size wait for a connection, as with platform
  threads.
- **`/io`:** `Thread.sleep` in the handler, which on a virtual thread unmounts it and frees its
  carrier, so waits are not limited by a thread pool.

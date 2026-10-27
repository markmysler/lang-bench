# Java + Spring Boot (platform threads)

- **Server:** Spring MVC on embedded Tomcat (Spring Boot), run as an executable jar on the
  HotSpot JVM (Temurin JRE) in `debian:trixie-slim`. JIT only: no CDS, AOT or native image. The
  heap may use 75% of the container's memory (`-XX:MaxRAMPercentage=75`); everything else is the
  JVM's container ergonomics, which size GC and compiler threads from the container's CPU limit.
- **Concurrency:** one Tomcat worker thread (a platform thread) per in-flight request, with
  Tomcat's defaults: up to 200 threads. This is the classic Spring MVC model. `java-spring-vt` is
  the same server with virtual threads, so the two models can be compared directly.
- **Database:** `JdbcTemplate` over a HikariCP pool of `DB_POOL` connections. The PostgreSQL JDBC
  driver sends parameterised queries as prepared statements and makes them server-side after a
  few uses on a connection.
- **`/io`:** `Thread.sleep` in the handler, which blocks its worker thread for the whole wait, so
  at most 200 waits run at once.

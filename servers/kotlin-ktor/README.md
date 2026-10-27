# Kotlin + Ktor

- **Server:** Ktor 3 on its Netty engine (Netty's NIO transport, Ktor's default), built with
  Gradle into one fat jar and run on the HotSpot JVM (Temurin JRE) in `debian:trixie-slim`, as
  `java-spring` is. JIT only: no CDS, AOT or native image. The heap may use 60% of the container's
  memory (`-XX:MaxRAMPercentage=60`, as in `java-spring`; at 75% java-spring-vt ran out of memory
  at 512 MB); everything else is the JVM's container ergonomics. SLF4J logs warnings and errors
  only, so nothing is logged per request.
- **Concurrency:** coroutines. Ktor's Netty defaults are sized from the JVM's processor count,
  which container ergonomics take from the CPU limit, so it equals `CPUS`: `CPUS / 2 + 1` event
  loops each for accepting and for connection I/O, and `CPUS` threads running the handlers.
- **Database:** HikariCP pool of `DB_POOL` connections over the PostgreSQL JDBC driver. The pool
  starts on first use and never fails for a missing database, so the server starts without one.
  JDBC blocks, so each request's queries run inside `withContext(Dispatchers.IO)` (up to 64
  threads), keeping the event loops free. The driver sends parameterised queries as prepared
  statements and makes them server-side after a few uses on a connection.
- **`/io`:** `delay(ms)`, which suspends the coroutine and frees its thread. Any shortfall against
  `System.nanoTime()` is waited out with another delay, so it never answers early.
- **JSON:** kotlinx.serialization through Ktor's `ContentNegotiation`, which sends
  `Content-Type: application/json` without a charset parameter.

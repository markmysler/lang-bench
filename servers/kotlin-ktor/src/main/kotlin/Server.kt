// Kotlin + Ktor server for lang-bench (docs/SPEC.md).
package bench

import com.zaxxer.hikari.HikariDataSource
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import java.sql.SQLException
import java.util.concurrent.ThreadLocalRandom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

@Serializable data class Message(val message: String)
@Serializable data class Fib(val n: Int, val fib: Int)
@Serializable data class Io(val ms: Int)
@Serializable data class Row(val id: Int, val randomNumber: Int)

fun fib(n: Int): Int = if (n < 2) n else fib(n - 1) + fib(n - 2)

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
fun param(value: String?, def: Int, lo: Int, hi: Int): Int = value?.toIntOrNull()?.coerceIn(lo, hi) ?: def

fun env(key: String, def: Int): Int = System.getenv(key)?.toIntOrNull()?.takeIf { it > 0 } ?: def

// wait suspends for at least ms milliseconds. delay frees the thread while it waits; any
// shortfall against the monotonic clock is waited out with another delay, so it never ends early.
suspend fun wait(ms: Int) {
    val end = System.nanoTime() + ms * 1_000_000L
    delay(ms.toLong())
    while (true) {
        val left = end - System.nanoTime()
        if (left <= 0) break
        delay((left + 999_999) / 1_000_000)
    }
}

fun main() {
    // HikariCP: a pool of DB_POOL connections (minimum idle defaults to the same size). Built with
    // the no-argument constructor, the pool only starts on the first getConnection, and -1 means it
    // never fails for a missing database, so the server starts and serves other workloads without one.
    val db = HikariDataSource().apply {
        jdbcUrl = "jdbc:postgresql://${System.getenv("DB_HOST")}:${env("DB_PORT", 5432)}/${System.getenv("DB_NAME")}"
        username = System.getenv("DB_USER")
        password = System.getenv("DB_PASSWORD")
        maximumPoolSize = env("DB_POOL", 16)
        initializationFailTimeout = -1
    }

    // JDBC blocks, so callers run this on Dispatchers.IO. The statement is a PreparedStatement;
    // the PostgreSQL driver makes it server-side after a few uses on the same connection.
    fun randomRow(): Row = db.connection.use { conn ->
        conn.prepareStatement("SELECT id, randomnumber FROM world WHERE id = ?").use { st ->
            st.setInt(1, ThreadLocalRandom.current().nextInt(1, 10001))
            st.executeQuery().use { rs ->
                rs.next()
                Row(rs.getInt(1), rs.getInt(2))
            }
        }
    }

    embeddedServer(Netty, port = env("PORT", 8080), host = "0.0.0.0") {
        install(ContentNegotiation) { json() }
        routing {
            get("/health") { call.respondText("ok") }
            get("/plaintext") { call.respondText("Hello, World!") }
            get("/json") { call.respond(Message("Hello, World!")) }
            get("/cpu") {
                val n = param(call.request.queryParameters["n"], 20, 0, 32)
                call.respond(Fib(n, fib(n)))
            }
            get("/io") {
                val ms = param(call.request.queryParameters["ms"], 10, 0, 1000)
                wait(ms)
                call.respond(Io(ms))
            }
            get("/db") {
                try {
                    call.respond(withContext(Dispatchers.IO) { randomRow() })
                } catch (e: SQLException) {
                    call.respondText(e.message ?: "database error", status = HttpStatusCode.InternalServerError)
                }
            }
            get("/queries") {
                val n = param(call.request.queryParameters["n"], 1, 1, 500)
                try {
                    call.respond(withContext(Dispatchers.IO) { List(n) { randomRow() } })
                } catch (e: SQLException) {
                    call.respondText(e.message ?: "database error", status = HttpStatusCode.InternalServerError)
                }
            }
        }
    }.start(wait = true)
}

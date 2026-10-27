// Java + Spring Boot server for lang-bench (docs/SPEC.md).
package bench;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class Server {
    record Message(String message) {}
    record Fib(int n, int fib) {}
    record Io(int ms) {}
    record Row(int id, int randomNumber) {}

    private static final RowMapper<Row> ROW = (rs, i) -> new Row(rs.getInt(1), rs.getInt(2));

    private final JdbcTemplate db;

    public Server(JdbcTemplate db) {
        this.db = db;
    }

    public static void main(String[] args) {
        SpringApplication.run(Server.class, args);
    }

    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }

    // param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
    static int param(String value, int def, int lo, int hi) {
        try {
            return Math.max(lo, Math.min(hi, Integer.parseInt(value)));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    // JdbcTemplate runs this as a PreparedStatement; the PostgreSQL driver switches it to a
    // server-side prepared statement after a few uses on the same connection.
    private Row randomRow() {
        return db.queryForObject("SELECT id, randomnumber FROM world WHERE id = ?", ROW,
                ThreadLocalRandom.current().nextInt(1, 10001));
    }

    @GetMapping(value = "/health", produces = MediaType.TEXT_PLAIN_VALUE)
    public String health() {
        return "ok";
    }

    @GetMapping(value = "/plaintext", produces = MediaType.TEXT_PLAIN_VALUE)
    public String plaintext() {
        return "Hello, World!";
    }

    @GetMapping(value = "/json", produces = MediaType.APPLICATION_JSON_VALUE)
    public Message json() {
        return new Message("Hello, World!");
    }

    @GetMapping(value = "/cpu", produces = MediaType.APPLICATION_JSON_VALUE)
    public Fib cpu(@RequestParam(required = false) String n) {
        int v = param(n, 20, 0, 32);
        return new Fib(v, fib(v));
    }

    @GetMapping(value = "/io", produces = MediaType.APPLICATION_JSON_VALUE)
    public Io io(@RequestParam(required = false) String ms) throws InterruptedException {
        int v = param(ms, 10, 0, 1000);
        Thread.sleep(v);
        return new Io(v);
    }

    @GetMapping(value = "/db", produces = MediaType.APPLICATION_JSON_VALUE)
    public Row db() {
        return randomRow();
    }

    @GetMapping(value = "/queries", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<Row> queries(@RequestParam(required = false) String n) {
        Row[] rows = new Row[param(n, 1, 1, 500)];
        for (int i = 0; i < rows.length; i++) {
            rows[i] = randomRow();
        }
        return List.of(rows);
    }

    // Database errors answer 500 with the message as plain text, like the other servers.
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<String> dbError(DataAccessException e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .contentType(MediaType.TEXT_PLAIN).body(e.getMessage());
    }
}

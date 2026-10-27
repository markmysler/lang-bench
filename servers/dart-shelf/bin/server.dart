// Dart + Shelf server for lang-bench (docs/SPEC.md).
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';

import 'package:postgres/postgres.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_router/shelf_router.dart';

int env(String key, int def) {
  final n = int.tryParse(Platform.environment[key] ?? '');
  return n != null && n > 0 ? n : def;
}

Future<void> main() async {
  final cpus = env('CPUS', Platform.numberOfProcessors);
  // As PID 1 in the container, the process has no default signal handlers, so exit explicitly.
  for (final sig in [ProcessSignal.sigterm, ProcessSignal.sigint]) {
    sig.watch().listen((_) => exit(0));
  }
  // One isolate per CPU, each with its own event loop and heap. They all bind port 8080 with
  // shared: true and the VM spreads incoming connections between them.
  for (var i = 1; i < cpus; i++) {
    await Isolate.spawn(serve, cpus);
  }
  await serve(cpus);
}

int fib(int n) => n < 2 ? n : fib(n - 1) + fib(n - 2);

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
int param(Request req, String name, int def, int lo, int hi) {
  final n = int.tryParse(req.url.queryParameters[name] ?? '', radix: 10);
  return n == null ? def : max(lo, min(hi, n));
}

// wait sleeps for at least ms milliseconds. A Dart timer may fire slightly before its deadline,
// so any shortfall, measured on the monotonic Stopwatch, is waited out with another timer.
Future<void> wait(int ms) async {
  final sw = Stopwatch()..start();
  await Future.delayed(Duration(milliseconds: ms));
  for (var left = ms * 1000 - sw.elapsedMicroseconds; left > 0; left = ms * 1000 - sw.elapsedMicroseconds) {
    await Future.delayed(Duration(microseconds: left));
  }
}

Response json(Object body) =>
    Response.ok(jsonEncode(body), headers: {'content-type': 'application/json'});

Future<void> serve(int cpus) async {
  // DB_POOL is for the whole container, so each isolate gets an equal share of it.
  // The pool connects on first use, so the server starts without a database for other workloads.
  final db = Pool.withEndpoints(
    [
      Endpoint(
        host: Platform.environment['DB_HOST'] ?? 'localhost',
        port: env('DB_PORT', 5432),
        database: Platform.environment['DB_NAME'] ?? 'bench',
        username: Platform.environment['DB_USER'],
        password: Platform.environment['DB_PASSWORD'],
      ),
    ],
    settings: PoolSettings(
      maxConnectionCount: max(1, env('DB_POOL', 16) ~/ cpus),
      sslMode: SslMode.disable,
    ),
  );
  final rnd = Random();
  // Pool.execute would parse the query again on every call, so the statement is prepared once per
  // pooled connection and reused after that. The pool keeps one Connection object per connection.
  final statements = Expando<Statement>();

  Future<Map<String, int>> randomRow() async {
    final rows = await db.withConnection((conn) async {
      final statement = statements[conn] ??=
          await conn.prepare(Sql(r'SELECT id, randomnumber FROM world WHERE id = $1'));
      return statement.run([1 + rnd.nextInt(10000)]);
    });
    final row = rows.first;
    return {'id': row[0] as int, 'randomNumber': row[1] as int};
  }

  final app = Router()
    ..get('/health', (Request req) => Response.ok('ok'))
    ..get('/plaintext', (Request req) => Response.ok('Hello, World!'))
    ..get('/json', (Request req) => json({'message': 'Hello, World!'}))
    ..get('/cpu', (Request req) {
      final n = param(req, 'n', 20, 0, 32);
      return json({'n': n, 'fib': fib(n)});
    })
    ..get('/io', (Request req) async {
      final ms = param(req, 'ms', 10, 0, 1000);
      await wait(ms);
      return json({'ms': ms});
    })
    ..get('/db', (Request req) async {
      try {
        return json(await randomRow());
      } catch (err) {
        return Response.internalServerError(body: err.toString());
      }
    })
    ..get('/queries', (Request req) async {
      final rows = <Map<String, int>>[];
      try {
        for (var i = param(req, 'n', 1, 1, 500); i > 0; i--) {
          rows.add(await randomRow());
        }
      } catch (err) {
        return Response.internalServerError(body: err.toString());
      }
      return json(rows);
    });

  await shelf_io.serve(app.call, InternetAddress.anyIPv4, env('PORT', 8080), shared: true);
}

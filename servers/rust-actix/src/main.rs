// Rust + Actix Web server for lang-bench (docs/SPEC.md).
use std::collections::HashMap;
use std::time::Duration;

use actix_web::{App, HttpResponse, HttpServer, Responder, web};
use serde::Serialize;
use sqlx::{PgPool, postgres::PgPoolOptions};

#[derive(Serialize)]
struct Row {
    id: i32,
    #[serde(rename = "randomNumber")]
    random_number: i32,
}

#[derive(Serialize)]
struct Message {
    message: &'static str,
}

#[derive(Serialize)]
struct Fib {
    n: u64,
    fib: u64,
}

#[derive(Serialize)]
struct Wait {
    ms: u64,
}

fn fib(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    fib(n - 1) + fib(n - 2)
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
// Parsed by hand because a typed Query extractor would reject bad input with a 400.
fn param(q: &HashMap<String, String>, name: &str, def: i64, lo: i64, hi: i64) -> i64 {
    match q.get(name).and_then(|v| v.parse::<i64>().ok()) {
        Some(n) => n.clamp(lo, hi),
        None => def,
    }
}

fn env(key: &str, def: usize) -> usize {
    match std::env::var(key).ok().and_then(|v| v.parse::<usize>().ok()) {
        Some(n) if n > 0 => n,
        _ => def,
    }
}

async fn random_row(db: &PgPool) -> Result<Row, sqlx::Error> {
    let id = rand::random_range(1..=10000);
    // sqlx prepares the statement on first use per connection and caches it.
    let (id, random_number): (i32, i32) =
        sqlx::query_as("SELECT id, randomnumber FROM world WHERE id = $1")
            .bind(id)
            .fetch_one(db)
            .await?;
    Ok(Row { id, random_number })
}

fn db_error(e: sqlx::Error) -> HttpResponse {
    HttpResponse::InternalServerError()
        .content_type("text/plain; charset=utf-8")
        .body(e.to_string())
}

async fn cpu(q: web::Query<HashMap<String, String>>) -> impl Responder {
    let n = param(&q, "n", 20, 0, 32) as u64;
    web::Json(Fib { n, fib: fib(n) })
}

async fn io(q: web::Query<HashMap<String, String>>) -> impl Responder {
    let ms = param(&q, "ms", 10, 0, 1000) as u64;
    actix_web::rt::time::sleep(Duration::from_millis(ms)).await;
    web::Json(Wait { ms })
}

async fn db(db: web::Data<PgPool>) -> HttpResponse {
    match random_row(&db).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => db_error(e),
    }
}

async fn queries(db: web::Data<PgPool>, q: web::Query<HashMap<String, String>>) -> HttpResponse {
    let n = param(&q, "n", 1, 1, 500) as usize;
    let mut rows = Vec::with_capacity(n);
    for _ in 0..n {
        match random_row(&db).await {
            Ok(row) => rows.push(row),
            Err(e) => return db_error(e),
        }
    }
    HttpResponse::Ok().json(rows)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let workers = env("CPUS", std::thread::available_parallelism().map_or(1, |n| n.get()));
    let var = |k: &str| std::env::var(k).unwrap_or_default();
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        var("DB_USER"),
        var("DB_PASSWORD"),
        var("DB_HOST"),
        var("DB_PORT"),
        var("DB_NAME")
    );
    // Each Actix worker is a thread with its own single-threaded Tokio runtime, and a connection
    // belongs to the runtime that opened it, so each worker gets its own pool with an equal share
    // of DB_POOL. The pool connects on first use, so the server starts without a database.
    let per_worker = (env("DB_POOL", 16) / workers).max(1) as u32;

    HttpServer::new(move || {
        let pool = PgPoolOptions::new()
            .max_connections(per_worker)
            .connect_lazy(&url)
            .expect("database url");
        App::new()
            .app_data(web::Data::new(pool))
            .route("/health", web::get().to(|| async { "ok" }))
            .route("/plaintext", web::get().to(|| async { "Hello, World!" }))
            .route(
                "/json",
                web::get().to(|| async { web::Json(Message { message: "Hello, World!" }) }),
            )
            .route("/cpu", web::get().to(cpu))
            .route("/io", web::get().to(io))
            .route("/db", web::get().to(db))
            .route("/queries", web::get().to(queries))
    })
    // Actix defaults to one worker per physical core it detects; use exactly the pinned cores.
    .workers(workers)
    .bind(("0.0.0.0", env("PORT", 8080) as u16))?
    .run()
    .await
}

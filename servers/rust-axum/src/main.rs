// Rust + Axum server for lang-bench (docs/SPEC.md).
use std::collections::HashMap;
use std::time::Duration;

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::get,
};
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

type DbError = (StatusCode, String);

async fn random_row(db: &PgPool) -> Result<Row, DbError> {
    let id = rand::random_range(1..=10000);
    // sqlx prepares the statement on first use per connection and caches it.
    let (id, random_number): (i32, i32) =
        sqlx::query_as("SELECT id, randomnumber FROM world WHERE id = $1")
            .bind(id)
            .fetch_one(db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Row { id, random_number })
}

async fn cpu(Query(q): Query<HashMap<String, String>>) -> Json<Fib> {
    let n = param(&q, "n", 20, 0, 32) as u64;
    Json(Fib { n, fib: fib(n) })
}

async fn io(Query(q): Query<HashMap<String, String>>) -> Json<Wait> {
    let ms = param(&q, "ms", 10, 0, 1000) as u64;
    tokio::time::sleep(Duration::from_millis(ms)).await;
    Json(Wait { ms })
}

async fn db(State(db): State<PgPool>) -> Result<Json<Row>, DbError> {
    Ok(Json(random_row(&db).await?))
}

async fn queries(
    State(db): State<PgPool>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<Row>>, DbError> {
    let n = param(&q, "n", 1, 1, 500) as usize;
    let mut rows = Vec::with_capacity(n);
    for _ in 0..n {
        rows.push(random_row(&db).await?);
    }
    Ok(Json(rows))
}

fn main() {
    // Built by hand instead of #[tokio::main] so the worker count is CPUS, not the host's cores.
    let threads = env("CPUS", std::thread::available_parallelism().map_or(1, |n| n.get()));
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(threads)
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(serve());
}

async fn serve() {
    let var = |k: &str| std::env::var(k).unwrap_or_default();
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        var("DB_USER"),
        var("DB_PASSWORD"),
        var("DB_HOST"),
        var("DB_PORT"),
        var("DB_NAME")
    );
    // The pool connects on first use, so the server starts without a database for other workloads.
    let pool = PgPoolOptions::new()
        .max_connections(env("DB_POOL", 16) as u32)
        .connect_lazy(&url)
        .expect("database url");

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/plaintext", get(|| async { "Hello, World!" }))
        .route("/json", get(|| async { Json(Message { message: "Hello, World!" }) }))
        .route("/cpu", get(cpu))
        .route("/io", get(io))
        .route("/db", get(db))
        .route("/queries", get(queries))
        .with_state(pool);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", var("PORT")))
        .await
        .expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

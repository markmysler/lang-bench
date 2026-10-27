## Its final message

I wrote the technician API as a new crate at `crates/technician-api/`, but I have not compiled or run it. The `cargo` and `rustc` calls were blocked pending approval, so everything was checked by reading only. The tests exist but have not been run.

It implements the four routes in `docs/technician-api.md`:

- **`GET /status`** returns uptime from `/proc/uptime`. The radio and sensor fields are `null` because the firmware's `gateway_status()` in `firmware/src/status.c` is not wired in.
- **`GET /config`** and **`PUT /config`** store one JSON object in a file. Writes go through a temp file, fsync, and rename, so a power cut keeps either the old or the new config.
- **`POST /firmware`** streams the raw body to `firmware.img` in a staging directory. A short body leaves no partial file. It does not verify or install the image.

The server is std-only except for `serde_json`, handles one connection at a time, and has per-connection timeouts. Limits: 8 KiB for the request head, 64 KiB for config, and 32 MiB by default for firmware (`--max-firmware-bytes`). Chunked requests get `501`.

The unit tests cover parsing limits, the config round trip, the firmware short-body and oversize cases, and the 404, 405 and 411 responses. They are in `http.rs` and `server.rs`.

Choices I made that you should check:

- **Listen address defaults to `127.0.0.1:8080`.** The spec does not say where technicians connect, so set `--listen` to the laptop-facing address.
- **Config schema is open.** The spec defines none, so `PUT /config` accepts any JSON object. A bad value can break the device.
- **Storage paths are guesses.** Config and firmware default to `/var/lib/technician-api/`.

Not done:

- No authentication. `PUT /config` and `POST /firmware` are unauthenticated, and this matters because the gateway also has a cellular link.
- No Yocto recipe, service unit, or `Cargo.lock`.
- The crate's `lib.rs` for `sensorlink` declares `pub mod frame;` with no `frame.rs`. I did not touch that crate.

The endpoint summary and open items are in `crates/technician-api/README.md`. Nothing is committed.

To verify, run `cargo test` in `crates/technician-api/`. Approve the cargo command and I'll run it and fix anything it reports.

## Files it changed

A  crates/technician-api/Cargo.toml
A  crates/technician-api/README.md
A  crates/technician-api/src/api.rs
A  crates/technician-api/src/config.rs
A  crates/technician-api/src/firmware.rs
A  crates/technician-api/src/http.rs
A  crates/technician-api/src/main.rs
A  crates/technician-api/src/server.rs
A  crates/technician-api/src/status.rs

### crates/technician-api/Cargo.toml
```
[package]
name = "technician-api"
version = "0.1.0"
edition = "2021"

[dependencies]
serde_json = "1"

```

### crates/technician-api/README.md
```
# technician-api

Local HTTP API for technicians on site. The contract is in [docs/technician-api.md](../../docs/technician-api.md).
Standard library plus `serde_json`, one connection at a time, no async runtime, so it starts fast and stays small.

## Run

```
technician-api [--listen 127.0.0.1:8080] [--config /var/lib/technician-api/config.json] \
               [--firmware-dir /var/lib/technician-api/firmware] [--max-firmware-bytes 33554432]
```

## Endpoints

| Request | Response |
| --- | --- |
| `GET /status` | `200` JSON with `uptime_s`; `radio` and `sensors` are `null` until the firmware status is wired in |
| `GET /config` | `200` stored config, or `{}` before the first write |
| `PUT /config` | body must be a JSON object, at most 64 KiB and sent with `Content-Length`; `200` with the stored object |
| `POST /firmware` | raw image body with `Content-Length`; streamed to `firmware.img` in the firmware dir; `201` with `staged_bytes` |

Errors are JSON `{"error": "..."}`. A short body is `400`, a missing length is `411`, an oversized body is `413`,
a chunked body is `501`, an unknown method on a known path is `405` with `Allow`.

## Open items

- No authentication. The default listen address is loopback only; the port must not be exposed on the cellular side.
- `PUT /config` accepts any JSON object. There is no schema, so a bad value can break the device.
- `POST /firmware` only stages the image. It does not verify a signature or install it.
- Radio link and sensor readings are not read yet; `firmware/src/status.c` (`gateway_status()`) is the source.
- No Yocto recipe or service unit yet.

```

### crates/technician-api/src/api.rs
```
//! Routing and handlers. Handlers get a parsed `Head` and a body reader, so they can run without a
//! socket.

use std::io::{self, Read};

use serde_json::{json, Value};

use crate::config::ConfigStore;
use crate::firmware::FirmwareStore;
use crate::http::{Head, Response};
use crate::status::StatusSource;

/// Largest body PUT /config accepts.
pub const MAX_CONFIG_BYTES: u64 = 64 * 1024;

pub struct App {
    pub status: Box<dyn StatusSource>,
    pub config: ConfigStore,
    pub firmware: FirmwareStore,
}

pub fn handle<R: Read>(app: &App, head: &Head, body: &mut R) -> Response {
    let allow = match head.path.as_str() {
        "/status" => "GET",
        "/config" => "GET, PUT",
        "/firmware" => "POST",
        _ => return Response::error(404, "no such endpoint"),
    };
    match (head.method.as_str(), head.path.as_str()) {
        ("GET", "/status") => get_status(app),
        ("GET", "/config") => get_config(app),
        ("PUT", "/config") => put_config(app, head, body),
        ("POST", "/firmware") => post_firmware(app, head, body),
        _ => Response::error(405, "method not allowed").with_header("Allow", allow),
    }
}

fn get_status(app: &App) -> Response {
    match app.status.status() {
        Ok(value) => Response::json(200, &value),
        Err(e) => Response::error(500, &format!("status unavailable: {e}")),
    }
}

fn get_config(app: &App) -> Response {
    match app.config.read() {
        Ok(value) => Response::json(200, &value),
        Err(e) => Response::error(500, &format!("cannot read config: {e}")),
    }
}

fn put_config<R: Read>(app: &App, head: &Head, body: &mut R) -> Response {
    let Some(len) = head.content_length else {
        return Response::error(411, "Content-Length required");
    };
    if len > MAX_CONFIG_BYTES {
        return Response::error(413, "config body too large");
    }
    let mut bytes = vec![0u8; len as usize];
    if body.read_exact(&mut bytes).is_err() {
        return Response::error(400, "body shorter than Content-Length");
    }
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return Response::error(400, "body is not valid JSON"),
    };
    if !value.is_object() {
        return Response::error(400, "config must be a JSON object");
    }
    match app.config.write(&value) {
        Ok(()) => Response::json(200, &value),
        Err(e) => Response::error(500, &format!("cannot write config: {e}")),
    }
}

fn post_firmware<R: Read>(app: &App, head: &Head, body: &mut R) -> Response {
    let Some(len) = head.content_length else {
        return Response::error(411, "Content-Length required");
    };
    if len == 0 {
        return Response::error(400, "firmware image is empty");
    }
    let max = app.firmware.max_bytes();
    if len > max {
        return Response::error(413, &format!("firmware image exceeds {max} bytes"));
    }
    match app.firmware.stage(body.by_ref(), len) {
        Ok(()) => Response::json(201, &json!({ "staged_bytes": len })),
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
            Response::error(400, "body shorter than Content-Length")
        }
        Err(e) => Response::error(500, &format!("cannot stage firmware: {e}")),
    }
}

```

### crates/technician-api/src/config.rs
```
//! The gateway configuration, stored as one JSON object. The spec does not define a schema, so this
//! module only guarantees that the stored value is a JSON object and that it is replaced atomically.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::PathBuf;

use serde_json::{json, Value};

pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Returns the stored config, or an empty object if none has been written yet.
    pub fn read(&self) -> io::Result<Value> {
        match fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(json!({})),
            Err(e) => Err(e),
        }
    }

    /// Replaces the stored config. Writes a temp file, syncs it, then renames it over the old one,
    /// so a power cut leaves either the old config or the new one on disk.
    pub fn write(&self, value: &Value) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(value)?;
        let tmp = self.path.with_extension("tmp");
        let mut file = File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, &self.path)?;
        match self.path.parent() {
            Some(dir) if !dir.as_os_str().is_empty() => File::open(dir)?.sync_all(),
            _ => Ok(()),
        }
    }
}

```

### crates/technician-api/src/firmware.rs
```
//! Firmware uploads are streamed to disk, never buffered in memory (the gateway has 256 MB shared
//! with the radio stack). The image is renamed into the staging slot only once every byte has
//! arrived. Nothing here verifies or installs the image; that is a separate step.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const STAGED: &str = "firmware.img";
const PARTIAL: &str = "firmware.img.partial";

pub struct FirmwareStore {
    dir: PathBuf,
    max_bytes: u64,
}

impl FirmwareStore {
    pub fn new(dir: PathBuf, max_bytes: u64) -> Self {
        Self { dir, max_bytes }
    }

    pub fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    /// Copies exactly `len` bytes from `body` into the staging slot, replacing any earlier upload.
    /// Fails with `UnexpectedEof` if the body ends early and leaves no partial file behind.
    pub fn stage<R: Read>(&self, body: R, len: u64) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let partial = self.dir.join(PARTIAL);
        if let Err(e) = write_exact(&partial, body, len) {
            let _ = fs::remove_file(&partial);
            return Err(e);
        }
        fs::rename(&partial, self.dir.join(STAGED))
    }
}

fn write_exact<R: Read>(path: &Path, body: R, len: u64) -> io::Result<()> {
    let mut file = File::create(path)?;
    let copied = io::copy(&mut body.take(len), &mut file)?;
    if copied != len {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "body shorter than Content-Length",
        ));
    }
    file.sync_all()
}

```

### crates/technician-api/src/http.rs
```
//! HTTP/1.1 request parsing and response writing, just enough for this API. Every response says
//! `Connection: close`, so there is one request per connection and no pipelining to handle.

use std::io::{self, BufRead, Read, Write};

use serde_json::{json, Value};

/// Limit on the request line plus headers. Bodies are not counted here.
const MAX_HEAD_BYTES: usize = 8 * 1024;

#[derive(Debug)]
pub struct Head {
    pub method: String,
    pub path: String,
    pub content_length: Option<u64>,
    pub expect_continue: bool,
}

#[derive(Debug)]
pub enum HttpError {
    /// Malformed request; answered with 400.
    BadRequest(&'static str),
    /// Request line plus headers exceed `MAX_HEAD_BYTES`; answered with 431.
    HeadTooLarge,
    /// Feature we do not implement; answered with 501.
    NotImplemented(&'static str),
    /// The client went away or timed out; nothing is sent back.
    Io(io::Error),
}

/// Reads the request line and headers, leaving the reader positioned at the body.
pub fn read_head<R: BufRead>(reader: &mut R) -> Result<Head, HttpError> {
    let mut budget = MAX_HEAD_BYTES;
    let request_line = read_line(reader, &mut budget)?;
    let mut parts = request_line.split_whitespace();
    let (method, path, version) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(method), Some(path), Some(version), None) => (method, path, version),
        _ => return Err(HttpError::BadRequest("malformed request line")),
    };
    if version != "HTTP/1.1" {
        return Err(HttpError::BadRequest("only HTTP/1.1 is supported"));
    }

    let mut head = Head {
        method: method.to_string(),
        path: path.to_string(),
        content_length: None,
        expect_continue: false,
    };
    loop {
        let line = read_line(reader, &mut budget)?;
        let line = line.trim_end();
        if line.is_empty() {
            return Ok(head);
        }
        let (name, value) = line
            .split_once(':')
            .ok_or(HttpError::BadRequest("malformed header"))?;
        let value = value.trim();
        if name.eq_ignore_ascii_case("content-length") {
            let len = value
                .parse::<u64>()
                .map_err(|_| HttpError::BadRequest("invalid Content-Length"))?;
            if head.content_length.replace(len).is_some() {
                return Err(HttpError::BadRequest("duplicate Content-Length"));
            }
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(HttpError::NotImplemented(
                "Transfer-Encoding is not supported; send Content-Length",
            ));
        } else if name.eq_ignore_ascii_case("expect") {
            head.expect_continue = value.eq_ignore_ascii_case("100-continue");
        }
    }
}

fn read_line<R: BufRead>(reader: &mut R, budget: &mut usize) -> Result<String, HttpError> {
    let mut line = String::new();
    // `take` caps how much one unterminated line can pull into memory.
    let read = (&mut *reader)
        .take(*budget as u64 + 1)
        .read_line(&mut line)
        .map_err(HttpError::Io)?;
    if read == 0 {
        return Err(HttpError::Io(io::ErrorKind::UnexpectedEof.into()));
    }
    if read > *budget {
        return Err(HttpError::HeadTooLarge);
    }
    *budget -= read;
    Ok(line)
}

pub struct Response {
    status: u16,
    content_type: &'static str,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
}

impl Response {
    pub fn json(status: u16, value: &Value) -> Self {
        Self {
            status,
            content_type: "application/json",
            headers: Vec::new(),
            body: serde_json::to_vec(value).expect("serializing a Value cannot fail"),
        }
    }

    pub fn error(status: u16, message: &str) -> Self {
        Self::json(status, &json!({ "error": message }))
    }

    pub fn with_header(mut self, name: &'static str, value: &str) -> Self {
        self.headers.push((name, value.to_string()));
        self
    }

    pub fn write_to<W: Write>(&self, out: &mut W) -> io::Result<()> {
        write!(out, "HTTP/1.1 {} {}\r\n", self.status, reason(self.status))?;
        write!(
            out,
            "Content-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
            self.content_type,
            self.body.len()
        )?;
        for (name, value) in &self.headers {
            write!(out, "{name}: {value}\r\n")?;
        }
        out.write_all(b"\r\n")?;
        out.write_all(&self.body)?;
        out.flush()
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str) -> Result<Head, HttpError> {
        read_head(&mut raw.as_bytes())
    }

    #[test]
    fn parses_request_line_and_content_length() {
        let head = parse("PUT /config HTTP/1.1\r\nContent-Length: 12\r\n\r\n").unwrap();
        assert_eq!(head.method, "PUT");
        assert_eq!(head.path, "/config");
        assert_eq!(head.content_length, Some(12));
        assert!(!head.expect_continue);
    }

    #[test]
    fn header_names_are_case_insensitive() {
        let head = parse("POST /firmware HTTP/1.1\r\ncontent-length: 5\r\nExpect: 100-continue\r\n\r\n")
            .unwrap();
        assert_eq!(head.content_length, Some(5));
        assert!(head.expect_continue);
    }

    #[test]
    fn rejects_chunked_bodies() {
        let result = parse("POST /firmware HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n");
        assert!(matches!(result, Err(HttpError::NotImplemented(_))));
    }

    #[test]
    fn rejects_oversized_hea
…(cut)
```

### crates/technician-api/src/main.rs
```
//! Local HTTP API for technicians on site. See docs/technician-api.md.

mod api;
mod config;
mod firmware;
mod http;
mod server;
mod status;

use std::net::TcpListener;
use std::path::PathBuf;

use api::App;
use config::ConfigStore;
use firmware::FirmwareStore;
use status::ProcStatus;

const DEFAULT_LISTEN: &str = "127.0.0.1:8080";
const DEFAULT_CONFIG: &str = "/var/lib/technician-api/config.json";
const DEFAULT_FIRMWARE_DIR: &str = "/var/lib/technician-api/firmware";
const DEFAULT_MAX_FIRMWARE_BYTES: u64 = 32 * 1024 * 1024;

fn main() {
    if let Err(e) = run() {
        eprintln!("technician-api: {e}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let mut listen = DEFAULT_LISTEN.to_string();
    let mut config = PathBuf::from(DEFAULT_CONFIG);
    let mut firmware_dir = PathBuf::from(DEFAULT_FIRMWARE_DIR);
    let mut max_firmware = DEFAULT_MAX_FIRMWARE_BYTES;

    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--listen" => listen = value,
            "--config" => config = value.into(),
            "--firmware-dir" => firmware_dir = value.into(),
            "--max-firmware-bytes" => {
                max_firmware = value
                    .parse()
                    .map_err(|_| format!("invalid --max-firmware-bytes: {value}"))?;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    let app = App {
        status: Box::new(ProcStatus),
        config: ConfigStore::new(config),
        firmware: FirmwareStore::new(firmware_dir, max_firmware),
    };
    let listener = TcpListener::bind(listen.as_str()).map_err(|e| format!("cannot bind {listen}: {e}"))?;
    eprintln!("technician-api: listening on {listen}");
    server::run(listener, &app);
    Ok(())
}

```

### crates/technician-api/src/server.rs
```
//! One connection at a time. Technicians are a handful of people on one laptop, so there is no
//! thread pool. The socket timeouts stop a stalled client from blocking the next one forever.

use std::io::{BufReader, Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use crate::api::{handle, App};
use crate::http::{read_head, HttpError, Response};

const IO_TIMEOUT: Duration = Duration::from_secs(30);

pub fn run(listener: TcpListener, app: &App) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
                let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
                serve_connection(stream, app);
            }
            Err(e) => eprintln!("technician-api: accept failed: {e}"),
        }
    }
}

pub fn serve_connection<S: Read + Write>(stream: S, app: &App) {
    let mut reader = BufReader::new(stream);
    let head = match read_head(&mut reader) {
        Ok(head) => head,
        Err(HttpError::BadRequest(msg)) => return send(reader.get_mut(), Response::error(400, msg)),
        Err(HttpError::HeadTooLarge) => {
            return send(reader.get_mut(), Response::error(431, "request head too large"))
        }
        Err(HttpError::NotImplemented(msg)) => return send(reader.get_mut(), Response::error(501, msg)),
        Err(HttpError::Io(_)) => return,
    };
    if head.expect_continue {
        let _ = reader.get_mut().write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
    }
    let response = handle(app, &head, &mut reader);
    send(reader.get_mut(), response);
}

fn send<S: Write>(out: &mut S, response: Response) {
    if let Err(e) = response.write_to(out) {
        eprintln!("technician-api: write failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use std::io::{self, Cursor};
    use std::path::{Path, PathBuf};

    use serde_json::{json, Value};

    use super::*;
    use crate::config::ConfigStore;
    use crate::firmware::FirmwareStore;
    use crate::status::StatusSource;

    struct FixedStatus;

    impl StatusSource for FixedStatus {
        fn status(&self) -> io::Result<Value> {
            Ok(json!({ "uptime_s": 42 }))
        }
    }

    /// Stands in for a socket: reads come from `input`, writes are collected in `output`.
    struct Fake {
        input: Cursor<Vec<u8>>,
        output: Vec<u8>,
    }

    impl Read for Fake {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.input.read(buf)
        }
    }

    impl Write for Fake {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.output.write(buf)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("technician-api-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn app_in(dir: &Path) -> App {
        App {
            status: Box::new(FixedStatus),
            config: ConfigStore::new(dir.join("config.json")),
            firmware: FirmwareStore::new(dir.join("fw"), 1024),
        }
    }

    fn request(line: &str, body: &str) -> Vec<u8> {
        format!("{line} HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
    }

    /// Runs one request through the connection handler and returns the raw response text.
    fn exchange(app: &App, raw: Vec<u8>) -> String {
        let mut fake = Fake { input: Cursor::new(raw), output: Vec::new() };
        serve_connection(&mut fake, app);
        String::from_utf8(fake.output).unwrap()
    }

    fn body_of(response: &str) -> &str {
        response.split_once("\r\n\r\n").unwrap().1
    }

    #[test]
    fn get_status_returns_device_status() {
        let dir = scratch("status");
        let text = exchange(&app_in(&dir), request("GET /status", ""));
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        let value: Value = serde_json::from_str(body_of(&text)).unwrap();
        assert_eq!(value["uptime_s"], 42);
    }

    #[test]
    fn config_round_trips_through_put_and_get() {
        let dir = scratch("config");
        let app = app_in(&dir);
        let put = exchange(&app, request("PUT /config", r#"{"poll_s":5}"#));
        assert!(put.starts_with("HTTP/1.1 200 OK\r\n"));
        let get = exchange(&app, request("GET /config", ""));
        let value: Value = serde_json::from_str(body_of(&get)).unwrap();
        assert_eq!(value["poll_s"], 5);
    }

    #[test]
    fn config_is_empty_object_before_first_write() {
        let dir = scratch("config-empty");
        let text = exchange(&app_in(&dir), request("GET /config", ""));
        assert_eq!(body_of(&text), "{}");
    }

    #[test]
    fn put_config_rejects_non_object_json() {
        let dir = scratch("config-array");
        let text = exchange(&app_in(&dir), request("PUT /config", "[1,2]"));
        assert!(text.starts_with("HTTP/1.1 400 Bad Request\r\n"));
    }

    #[test]
    fn put_config_requires_content_length() {
        let dir = scratch("config-len");
        let raw = b"PUT /config HTTP/1.1\r\n\r\n{}".to_vec();
        let text = exchange(&app_in(&dir), raw);
        assert!(text.starts_with("HTTP/1.1 411 Length Required\r\n"));
    }

    #[test]
    fn post_firmware_stages_the_image() {
        let dir = scratch("fw-ok");
        let text = exchange(&app_in(&dir), request("POST /firmware", "abcd"));
        assert!(text.starts_with("HTTP/1.1 201 Created\r\n"));
        assert_eq!(std::fs::read(dir.join("fw/firmware.img")).unwrap(), b"abcd");
    }

    #[test]
    fn post_firmware_rejects_short_body_and_keeps_no_partial_file() {
        let dir = scratch("fw-short");
        let raw = b"POST /firmware HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc".to_vec();
        let text = exchange(&app_in(&dir), raw);
        assert!(text.starts_with
…(cut)
```

### crates/technician-api/src/status.rs
```
//! Device status. The spec also asks for radio link and sensor readings; those come from
//! `gateway_status()` in firmware/src/status.c, which is not wired in yet, so those fields are null.

use std::{fs, io};

use serde_json::{json, Value};

pub trait StatusSource {
    fn status(&self) -> io::Result<Value>;
}

/// Reads uptime from `/proc/uptime`.
pub struct ProcStatus;

impl StatusSource for ProcStatus {
    fn status(&self) -> io::Result<Value> {
        let raw = fs::read_to_string("/proc/uptime")?;
        let uptime_s = raw
            .split_whitespace()
            .next()
            .and_then(|secs| secs.split('.').next())
            .and_then(|secs| secs.parse::<u64>().ok())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "unparseable /proc/uptime"))?;
        Ok(json!({ "uptime_s": uptime_s, "radio": null, "sensors": null }))
    }
}

```

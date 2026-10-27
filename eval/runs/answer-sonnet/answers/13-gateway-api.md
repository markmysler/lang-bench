# Recommendation: Rust, with axum on hyper, as a separate process

I'd build the API as its own small Rust daemon, not inside the existing firmware. It would use axum (on hyper) with a single-threaded tokio runtime and trimmed features. I haven't measured anything on your hardware. The numbers below are what I'd expect, and the spike at the end is there to confirm them.

## Why

- **Memory safety on a network-facing parser.** This is the main reason. The API parses untrusted input on a device you can't easily reach for ten years. Your team already uses Rust, so this adds no new language.
- **Footprint.** A single-threaded hyper server usually idles at a few MB of RSS. A stripped binary built with size optimization, LTO and `panic=abort` is typically 3–6 MB. Both are well inside 20 MB and a sub-second start, and the real memory budget goes to TLS, buffers and per-connection state.
- **Separate process.** A fault in the API can't take down the sensor firmware. You can run it as an unprivileged user with systemd sandboxing, restart it under a watchdog, and update it independently. It talks to the firmware over whatever IPC already exists (unix socket, shared memory and so on).
- **axum over bare hyper.** With little web experience on the team, extractors and body-size limits make it harder to get the basics wrong. You'd have about a dozen endpoints, so you don't need more than routing and JSON. I'd check the dependency count in the spike. If axum adds a lot over bare hyper, drop to hyper.

## Alternatives I considered

- **C libraries (libmicrohttpd, CivetWeb, Mongoose).** These are small, mature and familiar, and they change slowly, which is good for long-term patching. But you'd be writing the API logic in C next to an HTTP parser, and memory-safety bugs are the exact risk here. This is my fallback if Rust misses the budget.
- **A stock web server in front (lighttpd, nginx) with a Rust or C backend.** This hardens TLS and slow-client handling, and Yocto already packages these servers. The cost is a second process, more configuration, and another component to patch for ten years. I'd only do this if you need features such as a heavily used web UI.
- **Python, Node, Java.** These blow the memory budget (30–60+ MB for Python) and the one-second start on an A53. Python stays in test tooling only.
- **Go.** Memory is feasible at roughly 10–20 MB, but it's close to the limit. The binaries are 8 MB or more, which hurts small updates, and it's a fourth language for the team.
- **Synchronous Rust servers (tiny_http, rouille).** These have the most predictable memory. But they have much smaller communities and less security scrutiny than hyper, which matters over a decade.

## Risks

1. **Dependency churn over ten years.** This is the biggest one. Security fixes land on the newest hyper, tokio and rustls releases. Crates raise their minimum Rust version and make breaking changes. Plan for scheduled dependency refreshes, not a frozen tree. Vendor all sources, pin the toolchain, and keep a build container so you can rebuild a 2026 release in 2034. Use cargo-deny or cargo-audit in CI.
2. **Web-security mistakes.** Authentication, credential handling, input validation and upload handling are where inexperienced teams get hurt, more than in the HTTP stack. Keep the API surface small and get an outside review or pen test before shipping.
3. **Async Rust.** It has a learning curve, and a stray blocking call can stall the server. Keep handlers thin.
4. **Firmware upload.** A bad design here can brick devices or exhaust RAM. Stream the body to storage, never buffer it. Enforce a size cap. Verify the signature in the existing update path, not in the API.

## What I'd check before committing

Run a one- or two-week spike on real hardware with the real firmware running. It should include status, config and upload endpoints with TLS enabled.

- **Memory:** measure PSS as well as RSS at peak. Peak means one upload, a few clients polling, and TLS handshakes at the same time. Set hard caps on connections, header size and body size.
- **Upload staging:** if `/tmp` is tmpfs, an upload eats RAM. Also check that dirty page cache from a large write doesn't cause memory pressure at 256 MB.
- **Startup:** measure "listening" time from boot. Don't generate keys or certificates at boot. RSA keygen on an A53 can take seconds, and early-boot entropy can be poor. Provision per-device ECDSA certificates instead.
- **Update size:** rebuild the binary a few times and measure delta size with your update tool. Rust binaries can produce larger deltas than expected unless builds are reproducible and flags are stable.
- **TLS library:** decide between rustls and a system library (OpenSSL or mbedTLS) that the firmware already ships. Reusing one saves flash and means one patch stream.
- **Platform:** confirm 32-bit or 64-bit userland, glibc or musl, and that your Yocto release has a supported Rust toolchain.
- **Clients:** find out whether the API is used by a browser UI or only by tools. A browser adds CSRF, static assets and CORS to the design, and I'd keep it to a JSON API plus a CLI if you can.
- **Authentication model:** settle this before building. It needs per-device credentials with no defaults, and rate limiting on login.

If the spike shows RSS comfortably under about 10 MB, the startup target is met, and the dependency tree is manageable, commit to it. If not, fall back to a C library with fuzzing on the request path.

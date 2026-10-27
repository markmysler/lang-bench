# On-device HTTP API: language and framework recommendation

## Recommendation: Rust, using axum on a single-threaded tokio runtime

Rust with axum is the best fit for your constraints and your team. Here are the reasons, ordered by how much weight I gave each one.

1. **Memory safety matters most here.** This process parses untrusted input from the network, including a large firmware upload. It will be in the field for ten years, and in many cases nobody will look at it after it ships. Bugs in HTTP request parsing, especially multipart body parsing, are a classic source of serious vulnerabilities in C web servers. Rust removes that whole class of bug, and your team already writes it.
2. **It fits the resource budget easily.** I'd expect a release build on the single-threaded tokio runtime to use a few MB of resident memory when idle. It starts in milliseconds, so the 1-second requirement comes down to systemd ordering, not the language. A stripped binary with size optimisations is typically a few MB before compression. These are typical figures, not measurements on your hardware, so confirm them on your gateway.
3. **Patches come quickly from upstream.** axum is a thin layer over hyper and tokio, which are the most widely deployed and most heavily fuzzed HTTP and async stack in Rust. Over ten years, the most-scrutinised stack is the one most likely to get fast fixes.
4. **It's easy for newcomers to web development.** You write plain handler functions, use serde to turn JSON into structs, and get request limits and timeouts as ready-made middleware. Your engineers won't need to learn a large web framework.

### How I'd configure it

- **Single-threaded runtime.** On a single-threaded tokio runtime you don't create one thread per core, and glibc creates fewer memory pools (malloc arenas). Both keep memory use flat. A handful of technicians doesn't need parallelism.
- **systemd socket activation.** systemd holds the port open from early boot and starts the service only when a technician connects. That makes the start-up requirement trivial, and the service uses no memory when nobody is on site. You can optionally have it exit after a period of inactivity.
- **Enforce the 20 MB budget in systemd** with `MemoryMax=20M`, and use watchdog pings via `sd_notify` so a hung process gets restarted. Run it as a dedicated non-root user.
- **Firmware upload:**
  - Stream the upload straight to the inactive A/B partition or a staging file. Never hold it in RAM.
  - Hand it to your update agent (RAUC, SWUpdate or Mender) for signature checking. The HTTP layer only transports the file; it must never be the thing that decides whether the firmware is trusted.
  - If the client isn't a browser form, accept the file as a raw request body with a known length instead of multipart. That's a simpler format to parse and gives attackers less to work with.
- **Hard limits on everything.** Set a maximum number of connections, header and body timeouts (which protects against slow-drip "slowloris" attacks), and size limits per route.

## Alternatives I considered

| Option | Why I didn't choose it |
|---|---|
| **Plain hyper 1.x (no axum)** | The strongest alternative. hyper 1.x has a stable API, whereas axum is still 0.x and releases breaking changes roughly once a year. With only about four endpoints, routing by hand is manageable. I'd still pick axum for ergonomics, but this is a reasonable choice if API stability over a decade matters more to you. |
| **Go, standard library only** | A serious contender. Go's compatibility promise and a built-in HTTP server with no third-party dependencies are very good properties over ten years. Against it: your team doesn't know Go, it adds another toolchain to maintain for a decade, binaries are bigger (bad over cellular), and garbage-collected memory use is less predictable against a hard 20 MB cap. |
| **C: libmicrohttpd, CivetWeb, Mongoose** | Proven and small, but this is exactly the code where memory-safety bugs appear: libmicrohttpd's POST/multipart processor has had a buffer-overflow CVE. Mongoose is licensed GPL or commercial. |
| **C++: cpp-httplib, Drogon, Crow, Boost.Beast** | Same memory-safety concern as C, without C's simplicity. Drogon and Beast are heavy for this job. cpp-httplib uses one thread per connection. |
| **Python (FastAPI or Flask), Node.js** | The interpreter and libraries alone are likely to use most or all of the 20 MB, and starting up in under a second on a Cortex-A53 is doubtful. Ruled out. |
| **Rust: tiny_http, rouille** | Fewer dependencies, but less maintenance activity and much less scrutiny than hyper. Over ten years that is worse, not better. |

## Risks

1. **Dependency count.** axum, tokio and hyper pull in roughly 80 to 120 crates. Every one of them is something you might have to patch, audit for licences and list in an SBOM. To manage this:
   - Turn off default features.
   - Run `cargo-deny` and `cargo-audit` in CI.
   - Vendor all crates into your own source mirror, so a build in 2034 doesn't depend on crates.io.
2. **Yocto's Rust version vs. what the crates need.** Each Yocto release fixes a Rust version, while upstream crates keep raising the minimum Rust version they require. A security fix in hyper three years from now may need a newer compiler than your Yocto layer provides. Plan either to move to new Yocto LTS releases on schedule or to maintain your own toolchain layer.
3. **API churn from axum's 0.x releases.** Budget a small upgrade every year rather than freezing dependencies and facing a five-year jump just when an urgent CVE lands. tokio's LTS branches help with this.
4. **Update size.** Rust links everything into one binary, so a patch to one dependency means shipping the whole binary again. It compresses to well under a few MB, but link-time optimisation can make binary-level diffs less effective. Measure this with your actual delta-update mechanism.
5. **TLS and authentication are harder than the framework choice.** Technicians' browsers will warn about self-signed certificates. You need per-device credentials rather than default passwords. Provision keys at manufacturing, not at first boot: RSA key generation on an A53 can take seconds. You also need to choose:
   - **rustls:** memory-safe, but TLS fixes require rebuilding your binary. Prefer the `ring` backend, which cross-compiles more easily than `aws-lc-rs`.
   - **The system OpenSSL:** TLS fixes arrive with your normal Yocto security updates.
6. **Regulation.** The EU Cyber Resilience Act's vulnerability-reporting obligations apply from September 2026, and IEC 62443-4-2 will likely matter to your customers. Both require secure defaults, an SBOM and patches throughout the support period. Rust's dependency lockfile and Yocto's SPDX output make the SBOM part manageable, but only if you vendor and track dependencies from day one.

## What I'd check before you commit

Run a one- to two-week spike on real hardware:

1. **Build a skeleton with the four endpoints using your Yocto release's own Rust recipe.** This immediately shows whether there are compiler-version conflicts.
2. **Measure memory on the target device** (look at PSS in `/proc/<pid>/smaps_rollup`, not just RSS):
   - when idle;
   - with 10 concurrent clients;
   - during a full-size firmware upload;
   - while slow-drip clients hold connections open.
   Then run a multi-week soak test to look for memory growth or fragmentation.
3. **Measure cold start from systemd**, both with and without socket activation.
4. **Simulate a security patch:** upgrade one dependency, rebuild, and measure the actual delta through RAUC, SWUpdate or Mender over a throttled link.
5. **Run `cargo tree`, `cargo-deny` and a licence check**, and decide whether that dependency count is acceptable to you.
6. **Check your update agent's built-in web server.** For example, SWUpdate ships its own embedded Mongoose-based web server. Disable it so you don't run two HTTP stacks, or decide deliberately to reuse it for uploads.
7. **Ask who the client is.** If technicians use a browser, keep the UI to a static page built into the binary, with no front-end framework. Your team shouldn't have to maintain a JavaScript toolchain for ten years. If they use a tool or app, a JSON-only API is simpler still.

If the spike shows the dependency count or compiler-version friction is unacceptable, switch to plain hyper. I'd only revisit Go if Rust toolchain maintenance inside Yocto turns out to be painful.

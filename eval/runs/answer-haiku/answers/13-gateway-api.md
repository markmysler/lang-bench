## Recommendation

Write the API in **Rust, using a small synchronous HTTP server with no async runtime and no web framework**. A crate like `tiny_http` is a reasonable starting point, with `serde_json` for the JSON. Keep the dependency list short, vendor it, and pin it. Use **C with libmicrohttpd** as the fallback if the Rust build for your Yocto image turns out to be painful.

The API has about five endpoints. The framework matters much less than three things: the HTTP parser, authentication, and how the upload is handled.

- **Why Rust:** The HTTP parser is the one part of this code that reads untrusted network input, and it has to be patched for ten years. Rust removes whole classes of memory-safety bugs there. Your team already maintains Rust components, so you are not adding a new language.
- **Why not a full framework** (Axum, Actix, Rocket): They bring an async runtime and large dependency trees, which are hard to keep patched and inflate memory. You don't need routing middleware or extractors for five endpoints.
- **Why C is the fallback:** If Yocto's Rust integration for your image is awkward, a C server built on a small library like libmicrohttpd is a mature choice. It's also easy for your C team to audit. Choosing C over Rust costs you memory safety in the parser, not the requirements.

## Alternatives considered

- **Python (Flask/FastAPI):** Rejected. The interpreter and framework typically take 30–60 MB resident and noticeably longer than a second to start on a Cortex-A53. Every Yocto upgrade also has to carry the Python stack.
- **Node.js:** Rejected for the same reasons, with a larger baseline memory footprint.
- **Go:** Technically viable. A static binary with the standard library's HTTP server would fit in the budget. I'd pass only because it adds a third language and a runtime with its own GC and release cadence for a ten-year product.
- **C++ with cpp-httplib:** Possible, but it is thread-per-connection and pulls in OpenSSL. The parsing is still in C++ with its usual risks.
- **Async Rust (Axum/Tokio):** Works, but you pay in runtime size, dependency count, and update churn for no benefit at this scale.

## Risks

1. **Authentication and transport.** Decide who can reach this port (Ethernet, Wi-Fi, USB, or the cellular side) before choosing a stack. If it is reachable beyond a physically controlled network, you need real authentication, not a default password. TLS adds binary size and certificate lifecycle work, so decide whether it is required.
2. **Firmware upload integrity.** The API must not be the thing that trusts the image. The upload should be verified against the same signature and rollback rules the existing updater enforces, and the staging path should go through the existing update logic, not a parallel one.
3. **Memory during upload.** Stream the upload to the staging partition in fixed-size chunks, cap its size, and allow one upload at a time. Buffering a firmware image in RAM on a 256 MB board is a path to an out-of-memory kill.
4. **Duplicated business logic.** Config and status should be read and written through the existing firmware's interfaces (a Unix socket or the current IPC), not reimplemented. Two copies of config validation will drift.
5. **Decade-long maintenance.** Pin the Rust toolchain and crate versions, vendor them, and run `cargo audit` or `cargo deny` in CI. Check that every dependency's license is acceptable for commercial firmware. Keep the number of crates small enough that you can read them.
6. **Team skill.** Nobody on the team has much web experience, so keep the HTTP surface minimal and write tests in Python against the running service. Your existing Python test tooling fits that well.
7. **Coexistence on the board.** Watch CPU and memory contention with the sensor-handling firmware, and make sure the port and any sockets don't conflict with existing services. Run it under systemd with socket activation if you can, which also helps with startup time.

## What to check before committing

1. **Build a spike on the real image.** Cross-compile a minimal Rust server and a minimal C server for your Cortex-A53 Yocto target, then measure on the actual board:
   - Cold-boot start time to first response, with a cold page cache.
   - Resident memory (RSS and PSS) at idle, under normal use, and during a 50 MB upload.
   - Binary size and image size increase.
   
   Don't trust library numbers from the internet. Measure on your hardware. The spike should take a few days per language.
2. **Check the Yocto Rust story.** Confirm your meta-rust layer version, the libc you're targeting, build times, and whether the image already ships Rust.
3. **Write the threat model.** Who can reach the port, how do they authenticate, and does the link need encryption?
4. **Confirm the update path.** Read how the existing firmware verifies and installs images, and make sure the API hands off to that path instead of replacing it.
5. **Confirm the config interface.** Identify the IPC or function boundary where the API should read and write configuration.
6. **Review the dependency list** from the spike: count the crates, check their licenses, and check their maintenance status.

Cellular constraints mainly affect how firmware reaches the gateway, not the local API. If remote updates are planned, treat them as a separate design.

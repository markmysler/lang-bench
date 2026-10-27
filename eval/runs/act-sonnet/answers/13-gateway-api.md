## Its final message

I haven't written any code yet. The spec leaves several decisions open, and each one changes what I'd build. I also can't run `cargo` in this session, so I couldn't compile or test anything I wrote.

**What I'd build:** a new Rust crate, `crates/techapi`, added to the image in `acme-gateway.bb`. This fits the repo's "newer components in Rust" convention. It would be a single-threaded blocking server on `tiny_http` with `serde_json`. That has no async runtime, starts almost instantly, and should use a few MB of RAM. It would be a lean, auditable dependency set, which matters for ten years of security patches. Firmware uploads would be streamed to disk rather than buffered, so memory stays under 20 MB. I'd also make the release profile size-optimised (`opt-level="z"`, LTO, strip), since updates go over cellular.

**What I need from you:**
1. **Authentication.** The spec has none, but `PUT /config` and `POST /firmware` on a ten-year field device are high-risk. Is physical access to the laptop port the only trust boundary, or do you want a token or password? I'd bind to the technician interface only, never `0.0.0.0`. Which interface or address is that?
2. **Status.** `firmware/src/status.c` calls `gateway_status()`, but `status.h` isn't in the repo, so I can't see the struct layout. Should I call the C function over FFI, or does the firmware expose something else, such as a socket or shared memory? The spec also lists "radio link" and "sensor readings", and I'd need their exact fields.
3. **Config.** Where is the configuration stored, in what format, and does the firmware need a reload signal after a change? Should `PUT` validate against a schema, and who owns that schema?
4. **Firmware upload.** How is an image installed (RAUC, swupdate, a custom flasher)? Does it need signature verification before install, and should the device reboot afterward? I'd insist on verification, and on rejecting images that fail it.

Tell me your answers, or tell me to pick sensible defaults and I'll go with the design above. I'd put the unknowns behind a small trait so they're easy to swap later.

## Files it changed

(none)

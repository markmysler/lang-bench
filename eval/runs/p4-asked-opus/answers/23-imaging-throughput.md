# Is Ruby the problem? Almost certainly not.

Your own numbers point elsewhere:

- 50,000 images × 150–400 ms of CPU comes to **about 2 to 5.5 CPU-hours** of work in total.
- It took **6 hours** of wall-clock time.

So the catalogue was processed as if you had about one CPU core working on it, and possibly less. Your setup isn't too slow per image. It just isn't running enough images at the same time.

Even if it were slow per image, Ruby isn't where that time goes. libvips is written in C, and your tagging model almost certainly runs in native code too (ONNX Runtime, TensorFlow or similar). Ruby only passes data between those calls, which is typically a few milliseconds of a 150–400 ms job. Rewriting the workers in Go or Rust would still call the same libvips and the same model. My guess is it would save something like 5–10% of the CPU time, and you'd pay for that with a second codebase in a language the founder can't easily review.

**My recommendation: stay on Ruby and Sidekiq, and fix how much work runs in parallel and how efficiently each image is processed.** To meet the under-one-hour target you need to process about 14 images per second. At 400 ms per image that keeps about 6 cores fully busy. Allowing for network wait and other overhead, plan for **12–16 vCPUs while a big catalogue is running**, and scale back down afterwards.

## What I'd do, in order

**1. Measure before changing anything (a day or two).**
- Look at the CPU graphs from the 6-hour run. Low CPU use means a concurrency or I/O problem. Every core pinned means you need more cores or cheaper processing per image.
- Time each step of one job separately: download, decode, resize, watermark, tagging, upload and database writes. Compare the wall-clock time of a job with the CPU time it used. If a job takes 2 s of wall-clock time but only 300 ms of CPU, you're mostly waiting on the network.
- Profile one job with a Ruby profiler such as stackprof or vernier to see how much time is spent in Ruby itself versus native code. **This is the number that would change my mind.** If Ruby turns out to be more than about 20–25% of CPU time, look at what that code is doing before blaming the language.

**2. Make each image cheaper. This is often the biggest single win.**
- Use libvips' "thumbnail" or shrink-on-load path rather than decoding the full image and then resizing it. For large JPEGs this is often several times faster.
- Decode each image once. Don't re-read the original separately for resizing, watermarking and tagging.
- Feed the tagging model a small version of the image (models usually want about 224–512 px), not the full-resolution photo.
- If you use Rails' ActiveStorage, check for hidden work: automatic analysis jobs, variants being generated, and blobs downloaded more than once.
- Find out how tagging actually runs: in-process, as a separate service, or through an external API. Running the model on batches of images rather than one at a time can raise throughput a lot.

**3. Run more images at once, using processes rather than threads.**
- Ruby has a global lock that limits how much Ruby code can run in parallel within one process. Whether your libvips binding releases that lock during image operations depends on the version, so don't rely on it. Instead, run **one Sidekiq process per core** in each container.
- Prevent too many threads competing for the cores. libvips and the model runtime each start their own thread pools. With 8 processes × 8 libvips threads × 8 model threads on an 8-core machine, everything slows down. Limit both to one or two threads per process (libvips has a `VIPS_CONCURRENCY` setting, and the model runtime has a thread-count setting).
- Check memory per process, because that limits how many fit in a container. Using the jemalloc memory allocator helps Ruby a lot.

**4. Scale on demand.**
- Add worker containers automatically when the queue gets deep, and scale them down to near zero when it's empty.
- Put bulk catalogue jobs on a separate queue from small interactive uploads, so one customer's 50,000 photos don't hold up everyone else.

## On cost per image

Running images in parallel doesn't make the total CPU work bigger. It packs the same work into a shorter time. At typical cloud prices of a few cents per vCPU-hour, a 50,000-image catalogue costs well under a dollar in compute either way. The cost risk is paying for idle machines, which is why autoscaling matters more than which language you use. Making each image cheaper (step 2) lowers cost per image directly.

## Alternatives I considered

| Option | Why not now |
|---|---|
| **Rewrite the workers in Go or Rust** | Same libvips and model underneath, so small gains. Adds a second codebase the founder can't review well, and costs weeks you'd rather spend on customers. Worth reconsidering only if profiling shows a lot of time in Ruby. |
| **Move the tagging part to Python** | Do this only if your model or its tooling needs Python's machine-learning ecosystem. It doesn't make anything faster. |
| **imgproxy or Thumbor (off-the-shelf resize/watermark services built on libvips)** | Good for resizing images on the fly when they're requested. They don't fit a batch pipeline that includes tagging. Keep them in mind for later. |
| **Serverless fan-out (e.g. AWS Lambda, Cloud Run jobs)** | Well suited to bursty batches. But packaging libvips plus the model, cold starts and new tooling add moving parts. Try autoscaled containers first. |
| **GPUs for tagging** | Only worth it if tagging dominates CPU time *and* you batch images. Probably overkill at your volume. |

## Risks once you scale out

- **Other systems become the bottleneck.** Each Sidekiq thread holds a database connection, so check your database connection limits and pool size. Also check request-rate limits on object storage, Redis memory, and your cloud account's vCPU quota. Ask for a quota increase now.
- **Failures in large batches.** Out of 50,000 photos, some will be corrupt or huge. Make jobs safe to retry, cap the maximum pixel count so a single enormous image can't exhaust memory, and track progress per catalogue so a customer sees "49,870 done, 130 failed" rather than an endless spinner.
- **Memory growth** in long-running Ruby processes handling large images. Restart workers periodically or after a set number of jobs.

## Before you commit, check these

1. CPU utilisation during the 6-hour run.
2. The per-step timing and the share of time in Ruby versus native code, from step 1 above.
3. A scaling test: run one container with 1, 2, 4 and N worker processes and confirm images per second rises roughly in step. If it stalls, find the shared bottleneck (network, database, storage) before adding machines.
4. How and where the tagging model runs.

If those checks come out as I expect, you should get under an hour within a couple of weeks without leaving Ruby. If profiling shows a large share of time in Ruby, that's the point to look again at a rewrite. Even then, I'd move only the hot part rather than rebuild everything.

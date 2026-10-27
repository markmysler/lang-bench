## Short answer

Probably not Ruby, and I wouldn't rewrite now. Your numbers suggest the 6 hours comes mostly from how the work is scheduled and where it waits, not from how fast it runs on the CPU. Measure that first. It takes days, not months, and it decides whether a rewrite is worth anything.

## What the numbers say

- 50,000 images × 0.15–0.4 s of CPU is about 2–6 CPU-hours of actual compute.
- The run took 6 hours of wall-clock time. That means the average number of busy cores was under one.
- Under one hour means about 14 images/s. At 0.3–0.4 s each, that is roughly 4–6 cores fully busy, before any headroom. Plan for 12+ cores of real compute.

So the gap is mostly idle time: too little concurrency, work queued behind one worker, waiting on storage or network, models loaded per job, or threads fighting each other. A faster language doesn't fix any of those.

## Where the time actually goes

- **libvips is already C.** Ruby only issues the calls. Rewriting in Go or Rust would speed up the thin layer around it, not the 150–400 ms of image work. Ruby overhead per image is likely a few milliseconds.
- **The tagging model is probably the biggest single cost.** Models are usually served from Python or a native runtime whichever language orchestrates them. The levers are batching (often a big gain on CPU, larger on GPU), a faster runtime such as ONNX Runtime, quantization, or a smaller input resolution.
- **Decoding full-size JPEGs is often wasteful.** libvips can decode JPEGs at reduced size directly (shrink-on-load, exposed as thumbnail in ruby-vips). If you decode once at the size you need and reuse that for resize, watermark and tagging, you can cut CPU per image a lot without changing the output.
- **Thread oversubscription.** libvips runs its own thread pool. If each Sidekiq thread also uses libvips threads, the cores thrash. The usual fix is one libvips thread per worker and more worker processes.

## What I'd do

1. **Profile one production-sized run this week.** Record per-stage CPU time (decode, resize, watermark, encode, tag), CPU utilization of each container during a bulk job, and time spent waiting on storage and the database.
2. **Fix the scheduling first.** Split the 50k job into chunks (for example 200–500 images each), fan them out across many worker processes, give bulk work its own queue so it doesn't starve other customers, and scale containers up during bulk runs and back down after.
3. **Fix the per-image costs.** Shrink-on-load, one decode per image, one libvips thread per worker, models loaded once per process, and batched inference for tagging.
4. **Move the tagging model out of the job path if it's the bottleneck.** Put it behind a small inference service that batches requests. This is the step that most likely gives a large gain, and it works regardless of what language Rails or the workers use.
5. **Keep the processing boundary clean.** Define the worker contract as "image location and job parameters in, derived images and tags out." Then the language of the worker can change later without touching the API, and you don't need to decide now.

With those changes I'd expect to reach the one-hour target on modest hardware, but I haven't seen your traces, so treat that as a hypothesis to confirm.

## Alternatives considered

- **Rewrite processing in Go or Rust now.** Gains are small, since the work is in libvips and the model. It costs months of a two-person team's time, and you lose the founder's ability to review the code, which is the main quality control when an agent writes most of it. Revisit only if profiling shows the worker's own orchestration is the bottleneck, and then rewrite just the worker.
- **Rewrite the model side in Python.** Possibly right for inference, but do it as a separate service, not as a rewrite of the whole pipeline.
- **Buy GPUs.** Worth testing once batching is in place. For CPU-bound resize work they add little, and GPU time is expensive per image unless utilization is high.

## Risks

- **Rewrite risk:** new bugs in the image pipeline, output that differs from what pilot customers already receive, and months without new features.
- **Scheduling risk:** more parallelism means more concurrent storage reads and writes, more memory per container, and a noisy-neighbour problem if one customer's catalogue saturates the workers. Fairness and limits per customer matter as soon as you fan out.
- **Cost risk:** scaling out is only cheap per image if utilization stays high. Idle workers during bulk runs cost money; autoscaling or spot/preemptible capacity for batch work helps, with retries built in.

## Check before committing to anything

- The per-stage CPU profile and per-container utilization from a real 50k run.
- Storage and network latency per image, and whether downloads and uploads are a meaningful share of the wall-clock time.
- Sidekiq concurrency, queue layout, retry behaviour, and whether the 50k run is one job or fanned out.
- Memory per worker, and whether the tagging model is loaded once per process or per job.
- Whether the 6-hour figure included retries or failures, which would inflate it.

If the profile shows the workers are saturated on compute, the next question is the tagging model and decode costs. If they're mostly idle, fix the scheduling and concurrency before touching any code's speed.

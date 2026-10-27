**Short answer:** Ruby is very unlikely to be your problem, and I wouldn't rebuild now. I'd fix parallelism and measure per-stage cost first. I haven't seen your code, so the numbers below are inferences from what you told me.

## Why I don't think it's Ruby

- **The numbers.** 50,000 images at 150–400 ms is about 2–5.5 CPU-hours of work. It took 6 hours. That means you used roughly one core, or less. The job was serial or starved, not slow per image.
- **Where the time goes.** The 150–400 ms is mostly libvips and the tagging model. Both are native code, and Ruby only calls them. A rewrite in Go, Rust or Node would run the same libvips and the same model. I'd expect it to save a few percent per image at most.
- **What the target needs.** Under one hour takes at least 5–6 cores fully busy. Allowing for overhead, plan on about 10. Getting a catalogue done in 10–15 minutes takes 30–40 cores. That is a scaling problem.

## What I'd do

1. **Scale out the existing Sidekiq workers.**
   - Run more containers with few threads each.
   - Set `VIPS_CONCURRENCY=1` per job. Otherwise vips threads and Sidekiq threads oversubscribe the CPU and slow each other down.
   - Autoscale worker count on queue depth, and scale to near zero afterwards. Cost per image stays about the same, because you pay for CPU-seconds either way. A burst of 40 cores for 10 minutes costs about what 1 core for 6 hours does.
2. **Make each image cheaper.** This is where your cost-per-image goal actually lives.
   - Use libvips shrink-on-load (`thumbnail` rather than load-then-resize). It is often a several-fold win on large photos.
   - Look hard at the tagging model, because it is probably the biggest slice. Options are a quantized or smaller model, ONNX Runtime, batching, or a GPU or dedicated inference service if the volume justifies it.
3. **Handle catalogue jobs deliberately.**
   - Fan out one job per image, or per small batch of 20–50, so Redis and the database don't take 50k tiny writes.
   - Give each customer a fair share of the queue so one upload doesn't starve the others.
   - Add retries that are safe to repeat, and a progress or completion signal for the customer.
4. **Check I/O.** Downloading 50k originals and uploading results can dominate. Fetch and write in parallel, and check the storage provider's rate limits.

## Alternatives I considered

- **Rewrite everything in Go or Rust.** I'd skip it. There's little speedup, because the heavy work is native already. You'd also spend weeks of a two-person company on a rewrite, and the founder would have to review code in a language they don't know. For agent-written code that review is your main safety net, so I wouldn't give it up.
- **Rewrite only the processing worker in another language.** Same objection. It adds a second runtime to operate, with little gain.
- **Move the tagging model to a Python or ONNX service.** This is the one place a different runtime can pay off, if the model is currently run awkwardly from Ruby. Decide after measuring, not before.
- **Serverless fan-out (Lambda or Cloud Run jobs).** It could suit bursty load, but it adds cold starts, libvips packaging and per-invocation costs. I'd revisit it only if container autoscaling proves too slow or clumsy.

## Risks

- **Memory.** Parallel vips and a model in every worker can exhaust container memory, and long-running Sidekiq processes can bloat. Set memory limits and recycle workers.
- **Hidden bottlenecks.** Once the CPU is no longer the limit, Postgres, Redis or storage may be. Load test to find out.
- **Autoscaling lag.** If new containers take minutes to start, a one-hour target still works but a 10-minute one won't.
- **Cost surprises.** Elastic scaling needs a ceiling and an alert so a runaway job can't produce a large bill.

## Check before committing (about a day of work)

1. **Profile 200 images in a single process,** timing each stage: download, decode, resize, watermark, tagging, encode, upload and DB writes. This shows where the 150–400 ms goes and what is worth optimizing.
2. **Look at the six-hour run.** What was CPU utilization on the workers? How many Sidekiq processes and threads were running? Was the queue always full? I expect low utilization, which would confirm the problem is concurrency.
3. **Find out how the tagging model runs.** Is it in-process Ruby bindings, an external API or a separate service? If it is a paid external API, the bill and rate limits matter more than any language choice.
4. **Run a scaling experiment.** Run the same 5,000-image batch on 1, 4 and 8 cores. If throughput scales near-linearly, you've confirmed the approach. If it flattens, you've found the real bottleneck.
5. **Set the target as a number.** For example, "50k in 20 minutes at under X cents per image" gives you a core count and a budget to check against.

I'd revisit a rewrite only if profiling shows Ruby code itself, such as serialization, ActiveRecord overhead or GVL contention, taking a large share of per-image time. Even then I'd fix that spot first. Based on what you've described, I'd expect to hit your one-hour target with configuration and scaling, with no rewrite.

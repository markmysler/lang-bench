**Short answer: no, not as a reason to rewrite.** .NET is slower to cold-start than Node or Go, but for this workload the bigger problems are the hosting plan, how the app initialises, and the 200/s spike. Changing language would leave those in place.

## What I'd use

Keep it in .NET, on the isolated worker model, and fix the hosting first:

1. **Measure before changing anything.** Break a cold start into host startup, worker startup, your DI and client initialisation, and function execution. Load-test a sale-day spike in staging. Most teams find the time is in their own startup code (building the container, creating Cosmos and Service Bus clients, loading secrets from Key Vault), not in the runtime.
2. **Move this function to Flex Consumption if you're on classic Consumption.** Flex supports always-ready instances, so you pay for a warm baseline sized for the "few per minute" periods and let it scale out for spikes. It also supports per-instance concurrency, so one instance can process many messages, which means fewer cold starts during a spike. Check current plan limits and pricing in Microsoft's docs, since this area changes often.
3. **Reduce startup cost in code.** Use ReadyToRun compilation, trim dependencies, initialise clients lazily or once per instance, and avoid heavy work in static constructors.
4. **Keep Service Bus between order-shipped and the send.** It absorbs the spike. The catch is that a queue cannot guarantee "within 2 seconds" during a backlog, so the SLA needs a precise definition (see below).

If measurement shows that even warm .NET can't meet the target at peak, the next step is still .NET: your existing **AKS** estate with KEDA scaling on queue depth, and a minimum replica count above zero. That's warm, predictable, and uses a platform you already run. Premium plan (pre-warmed instances) is the other option, but its fixed cost is higher.

## Alternatives I considered

- **Node (TypeScript).** Cold starts are usually lower, and Node is well supported on Functions. The team has some TypeScript skill, but the bulk is .NET, so you'd be splitting the stack and duplicating things like domain models, templates and retry policies. This is the lower-risk non-.NET option if measurement says the runtime really is the problem.
- **Go (custom handler).** Fastest cold start, but the biggest skill shift, with the most hiring, on-call and tooling cost. It's hard to justify for a notification sender.
- **Rewrite everything in Node or Go.** Not justified by what you've described.
- **Stay on consumption as-is and accept cold starts.** That fails the 2-second target on exactly the days that matter.

## Risks

- **The 2-second target is undefined.** Does it run from the order-shipped event to the provider accepting the email, or to delivery? Third-party latency (email provider, APNs/FCM) sits outside your compute and may dominate. Define it before you design for it.
- **Backlog breaks latency.** If a spike queues faster than you drain it, messages wait. That's a throughput and scaling problem, not a cold-start problem.
- **Provider rate limits.** 200/s may exceed email or push quotas, and compute won't fix that. Check this first.
- **Duplicates.** Service Bus is at-least-once, so retries can send the same email twice. Make sends idempotent using the order and notification ID.
- **Cost trade-off.** Always-ready and Premium cost money 24/7 to cover a few hours of peak. Compare that with the cost of consumption plus cold-start misses on sale days.
- **Language sprawl.** A second or third language affects hiring, on-call, observability and shared libraries across 120 engineers.

## Checks before committing

- Current plan, hosting model (isolated or in-process), and .NET version. The in-process model is being retired, so verify its end-of-support date.
- Cold-start breakdown from the measurement above, and p95/p99 latency under a replayed sale-day spike.
- Service Bus trigger settings: prefetch, batch size, concurrency per instance.
- Email and push provider quotas and throttling at 200/s.
- The written definition of the 2-second SLA and where it's measured.
- The cost of your options at baseline and at peak, compared on the same sheet.

I haven't checked current Flex, Premium or support-date details against Microsoft's docs, so verify those before you decide. The recommendation rests on the workload you described and not on benchmarks I've run.

# Short answer

The claim is partly true but points at the wrong problem. I'd keep .NET and fix the hosting plan, not the language.

## Why the language isn't the main issue

- A cold start on the consumption plan includes allocating an instance, mounting storage, starting the Functions host, starting your worker process, and then running your code. Runtime startup is one slice of that. Node does start faster than .NET, but it's typically a few hundred milliseconds to a second or so. That figure is a general expectation, not a measurement of your workload.
- Go on Functions runs as a custom handler. That means a host process plus your process, so it gives up much of the advantage. It's also not a first-class Microsoft-supported model, which conflicts with your support priority.
- A rewrite wouldn't meet the 2-second goal reliably either. Cold starts would still vary, and every new instance during a spike is cold.
- At a few messages per minute, an instance usually stays warm. Cold starts hit after idle periods and, more importantly, when scaling out on sale days. Scale-out lag matters more than the first cold start. Service Bus-triggered scaling reacts to backlog, so the queue builds while instances spin up.
- Your team is strong in .NET, only a few know TypeScript, and nobody is named for Go. Rewriting would cost more in libraries, observability, on-call and code review than it saves.

## What I'd use

- **Hosting:** .NET isolated worker on **Azure Functions Flex Consumption**, with a small number of always-ready instances for the trigger. Raise that number on a schedule before known sale days. Set per-instance concurrency so each instance handles many messages in parallel.
- **Messaging:** a Service Bus topic with two subscriptions, one for email and one for push. A slow email provider then can't delay push, and each side scales and retries independently.
- **Startup hygiene:** minimal dependencies, ReadyToRun compilation, singleton and reused HTTP clients, no heavy work in startup, and warm connections to the providers.
- **Idempotency:** Service Bus delivers at least once, so deduplicate on order ID and channel. Otherwise customers will get duplicate emails during retries and scale events.

## Alternatives considered

- **Node or Go rewrite:** covered above. Small gain, high cost, and Go has weaker support.
- **Staying on plain consumption:** cheapest, but it can't give a 2-second guarantee at spike onset.
- **Functions Premium (EP plans):** pre-warmed instances and no cold starts, and it's the mature option. It costs more because you pay for the baseline continuously. It's the fallback if Flex doesn't fit, for example because of region or networking limits.
- **AKS with KEDA and a .NET worker service:** it fits your existing platform and is always warm. But node and pod scale-out also takes time, and you'd take on more operations work. I'd consider it only if you already run spare capacity there.
- **Native AOT:** gives the fastest .NET startup, but I don't believe Functions supports it in a supported way. Check before relying on it.

## Risks

- **The downstream providers probably dominate the 2 seconds.** Email and push provider latency, plus their rate limits at 200/s, may matter more than anything in your code.
- **Always-ready instances add a fixed cost.** The Functions bill will rise from near-zero at idle, so model it.
- **Scale-out during the ramp** can still leave a short backlog if the ramp is steep.
- **Platform timelines:** the in-process .NET model and .NET 8 both reach end of support around **10 November 2026**, about two weeks from now. Linux consumption also has a announced retirement date. Verify both with Microsoft.
- **Flex Consumption** is newer than Premium, so check its limits and feature gaps.

## What I'd check before committing

1. **How the 2 seconds is defined.** It could run from the shipping event, from enqueue, or from function start, and the target could be p95, p99 or 100%. A hard 100% needs warm capacity whatever the language.
2. **Your current setup:** in-process or isolated model, .NET version, and Windows or Linux consumption. In Application Insights, find how often cold starts happen and how long they take today.
3. **Where the time goes.** Trace one notification end to end: enqueue, trigger, function, provider accepted, delivered. This may show that cold start isn't your biggest slice.
4. **A load test that mimics a sale day.** Go from idle to 200/s on Flex and on Premium, and compare p50, p95 and p99 latency and backlog.
5. **Provider limits and throttling** at 200/s for both email and push.
6. **Service Bus tier and settings:** prefetch and concurrency, and whether the tier supports the throughput.
7. **A cost model** using real execution counts: always-ready baseline plus execution cost, compared against Premium.
8. **Regional availability and networking needs** for Flex, such as VNet integration to the providers or Service Bus.

If the load test shows cold starts are a meaningful share of your latency, the cheapest fix is warm capacity. The language isn't the lever.

# Should the notification functions move from .NET to Node or Go?

**No. Changing language won't reliably get you under 2 seconds, and it would cost you a lot.** What decides your latency here is the plan and how you scale, not the language. Keep the functions in .NET and change the hosting.

## Why the language isn't the main problem

A cold start on Consumption has several steps. Azure has to find an instance, load your package, start the Functions host, start the language worker, and run your startup code. Only the last two depend on the language, and with modern .NET on the isolated model they're a smaller share than people expect. Older .NET setups did start slowly, which is probably where the claim comes from.

For your trigger, the bigger delay is usually earlier. You're probably triggered from Service Bus. On Consumption, nothing is running when the app has scaled to zero. The scale controller has to notice the message and allocate an instance before any code runs. That can take several seconds whatever the language. A Node or Go function waits just as long.

Sale-day spikes have the same issue. On Consumption, non-HTTP triggers add instances gradually, not instantly. Going from a few messages a minute to 200 a second builds a backlog first. Again, that has nothing to do with the language.

## What I would do

1. **Stay on .NET, using the isolated worker model on .NET 10 (the current LTS).** Turn on ReadyToRun compilation. Keep startup code light: no blocking calls to Key Vault or config at startup, and create SDK clients once and reuse them.
2. **Move this app to the Flex Consumption plan with one or two "always-ready" instances.** That keeps a warm instance for the quiet hours, so normal traffic never cold-starts. Flex also scales out faster than the old Consumption plan and lets one instance handle many messages at once. You still pay mostly per use. The always-ready baseline costs little, but run your numbers through the pricing calculator.
3. **Raise the always-ready count ahead of sale days.** You know the dates, so schedule the change instead of waiting for the platform to react.
4. **Split email and push into separate subscriptions or functions.** That way a slow email provider can't hold up push, and each can be retried and dead-lettered on its own.
5. **Define the 2 seconds precisely.** Measure from "message enqueued" to "provider accepted the send". You can't control when it reaches the inbox or the phone.

## Alternatives I considered

| Option | Why not (or when) |
|---|---|
| **Rewrite in Node** | Node also runs as a separate worker, so the platform delays above still apply. Only a few of your engineers know TypeScript, and they work on the front end. You'd have to rebuild shared models, telemetry and libraries, and run a second toolchain. |
| **Rewrite in Go** | On Azure Functions, Go only runs as a "custom handler". Microsoft supports that mechanism but doesn't treat Go as a first-class language, and the SDK and binding support is thinner. That clashes with your aim of staying on Microsoft support. |
| **Premium plan (EP1+) with a minimum instance** | It solves cold starts, but you pay for at least one instance around the clock, which costs much more than Flex always-ready. It's a fallback if Flex isn't available in your region or lacks a feature you need. |
| **AKS with KEDA scaling on Service Bus** | Worth a look if your clusters have spare capacity. With a minimum of one replica there's no cold start, and the extra cost is close to zero. The catch is more operational ownership than Functions. |
| **Native AOT .NET** | It would cut startup time, but check whether it's officially supported for Functions before relying on it. You probably don't need it once instances stay warm. |

## Risks

- **Model and runtime deadlines, which may be urgent.** Microsoft ends support for the .NET in-process model on 10 November 2026, two weeks from today, and .NET 8 support ends at the same time. If these functions are on in-process or .NET 8, you need to migrate anyway. Flex only supports isolated, so the move fits that work. The old Linux Consumption plan is also being retired (announced for 2028) and isn't getting new runtime versions.
- **The email and push providers will probably throttle you before your code does.** Azure Communication Services Email has low default sending limits that you have to ask to raise. Notification Hubs throughput depends on its tier. At 200 a second this is the most likely failure, so check it first.
- **Flex Consumption limits.** It's Linux-only, there are no deployment slots, and it's available in some regions only. Make sure your regions, VNet setup and deployment process fit.
- **Duplicate sends.** Faster scaling and retries mean more chances to send the same notification twice, so make the handlers idempotent. Key on order ID plus notification type.

## What I'd check before committing

1. **Where the time actually goes today.** Use Application Insights to split latency into time from enqueue to the function starting versus time inside the function. Compare cold and warm runs. If most of it is before your code starts, as I expect, a rewrite does nothing.
2. **Your current setup:** in-process or isolated, which .NET version, Windows or Linux Consumption, package size, and what runs at startup.
3. **A one- or two-day spike test on Flex.** Use one always-ready instance and replay a sale-day profile from idle up to 200 a second. Track p95 and p99 of enqueue-to-provider-accepted.
4. **Provider quotas** for email and push at 200 a second, plus a lead time for raising them before the next sale.
5. **Cost comparison** of today's Consumption bill against Flex with one or two always-ready instances, against Premium EP1, and against spare AKS capacity.

If the spike test on Flex with a warm baseline hits 2 seconds at p99, the language debate is settled with no rewrite. If it doesn't, the data will show which step is slow, and that tells you what to fix next.

# Should you build this in Laravel?

Yes, start in Laravel. But don't let Laravel's normal web processes hold the widget connections. Use Laravel for the product and **Laravel Reverb** for the live connections. Reverb is Laravel's own WebSocket server, and it runs as a separate long-lived process.

Holding 50,000 connections open isn't the hard part. A properly tuned server in almost any modern stack can do that. The real difficulties are the same in every language:

- thousands of widgets reconnecting at once after an outage or deploy
- how many people each message gets sent to
- making sure no message is lost when a connection drops

A new language doesn't solve any of these, and it would slow down your strongest developer.

## What I'd use

- **Laravel (PHP-FPM, the standard setup)** for everything that is a normal request: accounts, the agent dashboard, the API, billing, and sending messages. Sending a message is a normal request: save it, then broadcast it.
- **Laravel Reverb** to keep the widget connections open and push messages to them. One Reverb process handles many thousands of connections without a worker per connection. When one process isn't enough, you run several behind a load balancer and they coordinate through Redis.
- **Laravel Echo / pusher-js in the widget.** These clients speak the Pusher protocol, and that is your most useful safety net. Reverb, Soketi, Pusher and Ably (through its compatibility mode) all speak it too. If Reverb disappoints, you change servers in configuration and don't rewrite the app.
- **Redis** for queues and coordination between Reverb processes. **Postgres or MySQL** for messages.
- **Forge or Ploi** to set up the VMs. Forge has Reverb support built in.

Design rules that matter more than which framework you pick:

1. **Save the message first, then broadcast it.** A broadcast is sent once and not retried. When a widget reconnects, it fetches "messages since the last ID I saw" over normal HTTP. Every message gets an ID so the widget can ignore duplicates. This is what makes delivery reliable.
2. **Send typing indicators as client events ("whispers").** They pass through Reverb only and never reach PHP. Limit them to about one every 2–3 seconds.
3. **Broadcast chat messages straight away, or on a dedicated high-priority queue.** If they share a queue with emails and exports, a backlog in those will delay the chat.
4. **Give each conversation its own private channel.** Don't use presence channels for visitors. If 5,000 visitors sit on one shared presence channel, every visitor joining or leaving is announced to all the others, so the traffic grows with the square of the visitor count.
5. **Log visitors in with tokens, not session cookies.** Your widget runs inside your customers' sites, where browsers increasingly block or partition cookies. Put the widget in an iframe so the host page's CSS and JavaScript can't break it.
6. **Run Reverb separately from app deploys.** Restarting Reverb disconnects every widget at once. Normal deploys shouldn't touch it.

## Alternatives I considered

| Option | Why not (for now) |
|---|---|
| **Elixir/Phoenix** | Technically the best fit for this kind of product. But it's a new language for your only developer, and you'd still need everything Laravel gives you for free. At 50k connections you don't need it. |
| **Node.js or Go for the whole product** | You'd give up your biggest advantage, speed in Laravel, and gain nothing, because the connection layer can already be separate. |
| **Managed Pusher / Ably** | Fastest to start and nothing to operate. But they charge by connections or connection-minutes, so the bill grows with exactly what you plan to have lots of. Somewhere between 10k and 50k connections it becomes one of your biggest costs, while the same load fits on a few VMs. Check the current price sheets. They're still a useful emergency fallback, since they speak the same protocol. |
| **Soketi** | Pusher-compatible and very efficient. Development has slowed noticeably, so check whether it's still maintained before relying on it. A reasonable fallback. |
| **Centrifugo (Go)** | Very fast and proven at scale. It's my choice if Reverb fails your load test. Its downside is a different protocol and client library, so switching later costs more. |
| **Server-sent events or long-polling straight from Laravel** | No. Standard PHP ties up one worker for every open connection, so it can't hold thousands at once. |

## Risks

- **Reverb is fairly young** (released 2024). There are fewer public reports of large deployments than for Pusher or Centrifugo. The protocol safety net and an early load test reduce this risk.
- **Reconnect storms.** If Reverb restarts or the network drops, tens of thousands of widgets reconnect within seconds. Each one asks a Laravel endpoint for permission to join its private channel, and that flood can overwhelm PHP. You need random delays in the widget's reconnect logic and an auth endpoint that is cheap to call.
- **Server limits.** Out of the box, Reverb's PHP event loop can't go past about 1,024 connections. You need the `ext-uv` extension, higher open-file limits, and nginx/load-balancer settings sized for long-lived connections. The load balancer uses two file handles per connection.
- **Hostile host pages.** Some customer sites have strict security policies (CSP) that block connections to your domain unless they add it to an allowlist. Some corporate proxies break WebSockets. Reverb is WebSocket-only, with no HTTP fallback, so serve it over port 443 with TLS.
- **Single points of failure.** Redis and the database. At 2k widgets that's fine. Plan redundancy before you reach about 20k.

## Check before you commit (2–3 days of the first week)

1. **Define what "simultaneous widget" means.** Does every page view with the widget need a live connection, or only an open or active chat? If the widget connects only when someone opens it or a conversation is live, you might need 5–10× fewer connections. This product decision affects cost more than any technology choice.
2. **Load test Reverb on the VM size you plan to rent.** Open 10k, then 50k, connections with realistic message and typing rates. Measure memory, CPU and how long the slowest messages take (99th percentile). Use k6 or a similar tool across several load-generating machines, because one source IP runs out of ports at around 28k–60k connections. Also run two Reverb processes with Redis to prove you can scale out.
3. **Simulate a reconnect storm.** With 10k widgets connected, kill Reverb, then measure how long recovery takes and how hard the auth endpoint gets hit.
4. **Test the widget in hard conditions:** a strict CSP, Safari's tracking protection, a corporate proxy, and a background tab waking up after hours.
5. **Price it out at 2k, 10k and 50k connections:** your VMs (plus the managed Reverb on Laravel Cloud, if you'd consider it) against Pusher and Ably at current prices.

If the load test holds up, which I expect at these numbers, build with confidence. For the first year, one modest VM can run everything. Still keep Reverb as its own supervised process so you can move it to a dedicated machine later. If the test fails, switch the connection layer to Centrifugo or Soketi and keep all the Laravel code.

# Should Node run realtime matchmaking and presence at launch?

**Short answer: yes, stay on Node and TypeScript.** 50,000 concurrent WebSockets is a moderate load, and matching within 2 seconds depends on how you design the matcher, not on the language. The things that take launches down are reconnect storms, load-balancer settings, a matcher that is a single point of failure, and deploys that drop every player at once. Elixir or Go wouldn't fix any of those. Your two back-end developers can only run what they understand when things break at 2 a.m. in launch week.

## What I'd build

Keep it inside your current stack, but as separate services rather than more routes on the REST API:

1. **Realtime gateway (a new Node deployment).** Use plain WebSockets with the `ws` library and a simple JSON message protocol. I'd avoid Socket.IO: it adds protocol overhead, and its Unity clients are third-party and uneven. Run about 6–10 pods at roughly 5–10k connections each. A single Node process can hold far more than that when connections are mostly idle, but smaller pods mean a crash only drops 10–15% of players. The gateway checks the login token itself on connect (for example a JWT issued by your existing REST API) and never queries Postgres to authenticate a connection.
2. **Matchmaker (its own small deployment).** Use a tick loop, for example every 250 ms, with one active matcher per queue (per region or mode). Keep the queue state in Redis so a standby can take over if the active one dies. A Kubernetes Lease or a Redis lock decides which instance is active. Keeping matching out of the gateway processes means a slow matching pass can't freeze everyone's sockets.
3. **Managed Redis from your cloud provider.** Use it for presence (each player has a key that expires unless their heartbeat renews it), for routing messages between pods (player A's invite reaches player B on another pod), and for matchmaking queues. Your team won't have run Redis before, but the managed version is little work to operate and is the standard tool for this.
4. **Postgres stays the system of record** for accounts, inventory and match results. I wouldn't use Postgres LISTEN/NOTIFY as the cross-pod message bus even though your team knows Postgres. At this message volume it adds load and lock contention to the database your accounts and inventory depend on.
5. **Keep the existing REST API separate**, with its own database connection pool. A slow inventory query should never stall presence.

## Alternatives I considered

- **Elixir/Phoenix.** It's honestly the best technical fit: Phoenix Channels and Presence do much of this out of the box, and the runtime is excellent at holding many connections. I'd still say no. Nobody on the team knows it, clustering it on Kubernetes brings failure modes you haven't seen, and your C# developers couldn't read it either. Its advantages matter at millions of connections, not 50,000.
- **Go.** It would use less memory per connection and handles CPU-heavy work better. At 50,000 connections that saving doesn't matter, and you'd be shipping your first Go service during launch. It's worth revisiting if you grow 10x or the matching logic becomes heavy computation.
- **Nakama (a game server with matchmaking, presence and parties built in).** This is the most serious alternative. It has a Unity SDK, lets you write server logic in TypeScript, and runs on Postgres. The catches: you'd be running a second accounts system next to yours, and as I understand it, multi-node clustering is only in the paid editions. Check that, because a single node means no redundancy. It's worth a one-day spike as a comparison.
- **Managed services.** Unity Gaming Services Matchmaker, AWS GameLift FlexMatch, or hosted connection and pub/sub services like Ably or Azure Web PubSub. These take operations work off two people, which is a real benefit. The costs are per-connection-minute pricing at 50,000 concurrent players and dependence on a vendor (Unity's pricing changes are recent history). Get quotes before ruling them out.
- **Open Match (Google's open-source matchmaking framework).** It runs on Kubernetes but involves too many moving parts for a two-person team.

## Risks, roughly by how likely they are to hurt you

1. **Reconnect storms.** A gateway restart, a load-balancer blip or a deploy makes thousands of clients reconnect in the same second, and if each reconnect hits Postgres, it falls over. The fix is mostly in the Unity client: exponential backoff with random jitter. Plus the gateway checking tokens itself, as above.
2. **Load-balancer and ingress settings.** Cloud load balancers often close idle or long-lived connections after 30–60 seconds by default, and some cap how long a WebSocket can stay open. Send an application-level ping every 20–30 seconds and set the timeouts explicitly. Also check connection limits on the ingress controller.
3. **Deploys disconnect players.** Every rolling update drops everyone on the pods it replaces. Have pods drain gracefully (tell clients to reconnect over time rather than dropping them at once) and freeze gateway deploys during launch week.
4. **Autoscaling doesn't fit this traffic.** Connections are long-lived, so scaling on CPU adds pods that receive no existing connections. Scale up before launch to handle at least twice the expected peak, and scale on connection count if you scale at all.
5. **Blocking Node's event loop.** Large synchronous JSON handling or matching work inside a gateway delays every player on that pod. Monitor event-loop lag as a key metric.
6. **Single points of failure.** Plan how the active matcher fails over, and what happens when Redis fails over. Ideally gateways keep connections open and matchmaking pauses for a few seconds rather than everything crashing.
7. **The Unity WebSocket client.** Support varies by platform. .NET's built-in client doesn't work in WebGL builds, and consoles and mobile devices going into the background each need checking.
8. **Presence fan-out.** At a launch-time login surge, telling every friend about every login can multiply messages a lot. Batch or debounce presence updates.
9. **Two people on call.** Write runbooks, and let the C# developers practise the basic recovery steps.

## Checks before you commit

- **Load test at 2x peak (100,000 connections)** with realistic behaviour: a login ramp, idle heartbeats, invites, and matchmaking queues. Measure p95/p99 invite delivery and time-to-match. k6 can script this in JavaScript. You'll need several load-generator machines, because one machine runs out of outbound ports around 30–60k connections.
- **Failure tests under that load:** kill a gateway pod, fail over Redis, kill the active matcher, and run a "everyone reconnects at once" scenario. Watch what happens to Postgres.
- **Define "within 2 seconds" precisely.** I'd suggest: p95 time-to-match when the queue has enough players. Off-peak hours or extreme skill levels can't always match in 2 seconds, so decide how quickly the matching criteria widen.
- **Settle what happens after a match.** Do you allocate dedicated game servers, and how? Use a relay? Or peer-to-peer? That handoff is often what eats the 2 seconds.
- **Confirm your provider's load-balancer timeout and WebSocket limits**, and test the Unity client on every platform you ship.
- **Spend a day comparing against Nakama and UGS Matchmaker**, and get a quote from a managed pub/sub service. If one is clearly cheaper to run for two people, that's worth knowing before you build.

Two things would change my recommendation. One is load tests at 100,000 connections that show Node can't keep event-loop lag down even after you fix the hot paths. That's unlikely for this workload. The other is if a managed service turns out cheap enough that you don't need to run any of this yourselves.

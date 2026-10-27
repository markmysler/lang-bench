# Recommendation: Python, discord.py and FastAPI in one process, with SQLite for storage

You already know Python, so the weekend goes into building rather than learning a new language. FastAPI is the useful thing to learn here. It works much like Flask, it's widely used for APIs in industry, and it teaches type hints and async, which carry over to other work.

## The design point to settle first

**An HTTP API can't record voice joins by itself.** Discord only reports "user X joined channel Y" over a WebSocket connection that a bot holds open all the time (the `voice_state_update` event). So the real system is:

1. **A bot process** that stays connected to Discord, listens for voice events, and writes rows to a database.
2. **A small web API** that reads those rows and serves the weekly stats to your web page.

I'd run both in **one Python process**. discord.py and FastAPI both use Python's asyncio, so FastAPI can start the bot when it starts up and they share one event loop. That gives you one container, one deploy and one log stream.

It also means **the bot doesn't need to call your API at all.** Its `/stats` slash command can read the database directly. The API only needs to serve the web page, which makes it smaller and easier to secure.

**Storage:** use SQLite, which is just one file. With 50 users you'll write maybe a few thousand rows a month. Store sessions as (user, channel, joined_at, left_at) rather than just joins, because "hours in voice this week" is the statistic people will want.

**Memory:** the whole process should use roughly 80–150 MB, well within 512 MB. Measure it once it's running rather than taking my word for it.

## Alternatives I considered

| Option | Why not (for you, now) |
|---|---|
| **Flask** (what you know) | A fine fallback if you want the fastest start. But Flask is synchronous and discord.py is async, so running them together means threads or two processes, and two processes are awkward in a single free container. You'd also learn less. |
| **Node.js + discord.js + Express** | discord.js is excellent, but you'd be learning a new language and debugging deploys in the same weekend. A good *second* project. |
| **Go** | Very small memory use and a single binary, which is nice on a Pi. But it's a whole new language, so you'd be unlikely to finish this weekend. |
| **Django** | Too much framework for two endpoints. |
| **Java/Spring, .NET** | Heavy on memory for 512 MB, and a steep learning curve. |
| **Hosted database (Supabase, Neon)** | Only worth it if your host has no persistent disk (see the risks below). Some free tiers pause inactive projects, so check their current rules. |

## Risks, most serious first

1. **Free hosts often put idle containers to sleep.** Many free tiers stop a container after a period with no HTTP traffic. When it sleeps, the bot disconnects and **misses voice events without any error**. If your host does this, it can't run this project, whatever language you pick.
2. **Storage that gets wiped.** Many free container hosts reset the filesystem on every redeploy or restart. Your SQLite file, and all your history, would go with it.
3. **The Raspberry Pi avoids both problems.** It's always on and has a real disk. The catch is making the web page reachable from outside your home. Cloudflare Tunnel or Tailscale Funnel can do that without opening ports on your router, but it's an extra step. Honestly, **the Pi may be the better host for this project.**
4. **Gaps when the bot restarts.** If the bot is down when someone leaves, that session never gets an end time. When the bot starts, it should close any open sessions and record who is currently in voice. This is the bug most people only find later.
5. **Time zones.** Store everything in UTC. Decide what "this week" means: which day it starts on, and in which time zone.
6. **Privacy.** You'd be recording when people are in voice. Tell the server, consider letting people opt out, and think about whether the web page should be public or show only totals. It's good practice, and it's in the spirit of Discord's developer terms.
7. **Secrets.** Keep the bot token in an environment variable and never commit it to Git. Bots scan public repositories for leaked tokens within minutes.

## Check these before you commit

- [ ] **Does your free host sleep idle containers?** Look this up in its docs; it's the main deciding question.
- [ ] **Does it have a persistent disk or volume on the free tier?** If not, use the Pi or a free hosted database.
- [ ] **Does it allow long-running processes with outbound WebSockets?** Most do, but confirm.
- [ ] **Enable the right "intents" in the Discord Developer Portal.** Intents are the event types your bot asks Discord to send. Voice states is not privileged, so it's easy to turn on. If you want member names beyond what the voice events include, you'll need the privileged Server Members intent.
- [ ] **Check the latest discord.py and FastAPI releases** support the Python version on your host or Pi. They should, but it takes two minutes.

## A realistic weekend plan

- **Saturday:** get the bot running on your laptop, logging joins and leaves to SQLite. Add the startup cleanup from risk 4.
- **Sunday:** write the weekly stats query, add a `/stats` slash command, add one FastAPI endpoint and a plain HTML page that fetches from it, then deploy.

If you reach Sunday evening with only the bot logging to SQLite on the Pi, that still counts as working. You can add the web page the following weekend.

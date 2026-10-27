## What I'd use

**Python with FastAPI, SQLite for storage, and uvicorn running one worker.**

- **It builds on what you know.** It's still Python, so the weekend goes on the actual problem. Routes, JSON and request handling work the way they did in your Flask tutorial.
- **It's a useful thing to learn.** FastAPI is widely used in industry. It will teach you type hints, request validation with Pydantic and auto-generated docs. The docs page at `/docs` is handy for poking at your own API while you build it.
- **It fits in 512 MB.** FastAPI with one uvicorn worker typically idles at a few tens of MB. At a few requests a minute you'll never be near the limit.
- **SQLite is enough.** 50 users and a few writes a minute is tiny. There's no database server to run or pay for, and SQL is a skill worth having.

**Data model tip:** store raw events (user ID, channel, joined-at, left-at, all in UTC) and compute the weekly statistics with queries. Don't store pre-computed totals, because you'll want to change what "weekly" means later.

## Alternatives I considered

- **Stay with Flask.** This is the safest choice, and a perfectly good one if you want zero new concepts. I lean to FastAPI only because you asked what's useful to learn, and the extra concepts are small. If the weekend gets tight, drop back to Flask without guilt.
- **Node/Express.** You know a little JavaScript, but you'd be learning a new language and a new framework at once. Your bot is probably in Python (`discord.py`), so you'd also end up with two languages.
- **Django.** It's powerful but heavy for three or four endpoints, and it's a lot of ceremony for a weekend.
- **Go.** It's excellent for small memory footprints and I'd suggest it as a later project. Learning a new language from scratch is a poor fit for "working this weekend".

## Risks, most serious first

1. **Free hosts often have ephemeral disks.** The container filesystem may be wiped on each redeploy or restart, so a SQLite file would vanish with your history. Check whether the host offers a persistent volume. If it doesn't, either use a free hosted Postgres (Neon and Supabase have free tiers) or run on the Pi.
2. **Free hosts often sleep when idle.** A sleeping container is fine for an API, but a Discord bot needs a constantly open connection. If the bot lives on that host, sleep means missed voice events. The Pi is arguably a better home for the bot, even if the API runs elsewhere.
3. **Missed events create bad data.** If the bot restarts or crashes, a "joined" event may never get its "left". Decide up front how to handle open sessions. For example, on startup close any open sessions and re-read who is currently in voice.
4. **Write endpoints need protection.** Otherwise anyone who finds the URL can post fake data. A shared secret in a header, kept in an environment variable and never committed to Git, is enough at this scale. You'll also need CORS configured for the web page to call the API.
5. **Privacy.** You're logging who is in which voice channel and when. Tell your server members, store Discord user IDs rather than anything extra, and check Discord's developer policy.
6. **Time zones.** Define the start of the week and what time zone it uses before you write the statistics queries. Store UTC and convert at the edges.

## What I'd check before committing

- Does the host give you a **persistent disk**, and what are its sleep and idle rules? These terms change, so read the current docs rather than trusting a blog post.
- Which process records the events? The simplest design is for the bot to write to the database or call the API, and for the API to only serve reads and accept the bot's writes.
- Does the bot only need the voice-state events? That's a non-privileged Discord intent, so you shouldn't need the privileged members intent.
- Deploy a "hello world" version to the host **first**, before any real code. Confirm it stays up, survives a restart and keeps a file on disk. That tells you whether the plan works before you've built anything.

If the host fails the persistence and sleep checks, the fallback is the Raspberry Pi. The same code runs there, and you'd also learn about running a service that restarts on its own (systemd).

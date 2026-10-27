## My recommendation: Python with Flask, SQLite, and discord.py

Use **Python 3 with Flask** for the API, **SQLite** for storage, and **discord.py** for the bot. Keep the bot and API in one repo, and probably one process at first.

**Why:**
- **You already know it.** You have Python from your course and a Flask tutorial behind you, so you can finish this weekend. Learning a new language and framework and deploying at the same time is how side projects stall.
- **One language for the whole project.** discord.py is the most common Discord library for Python, so the bot, the API, and the stats logic all share one language.
- **The load is trivial.** 50 users and a few requests a minute is well within what Flask handles. Performance is not a reason to choose anything else.
- **It fits in 512 MB.** A Flask app plus discord.py with SQLite usually uses somewhere around 50–150 MB. Check this on your host rather than trusting the estimate.
- **SQLite needs no database server.** It's one file, which suits a free tier. Python's standard library includes it.

**What "learning something useful" gets you:** HTTP and JSON APIs, a real database, scheduled or event-driven work, and deployment. Those skills transfer to almost any job or project. Flask's simplicity makes the underlying ideas easier to see.

## Alternatives I considered

- **FastAPI (Python):** My pick if you were starting from zero. It's modern, has type hints, and generates interactive API docs automatically. It's a bit more to learn now, and you already have a Flask base, so I'd switch to it later rather than now.
- **Django (Python):** Comes with an ORM, admin panel, and auth. Too much machinery for a small API. Worth learning eventually, but it would slow you down here.
- **Node.js with Express (JavaScript):** Good if you want to learn JavaScript more deeply. discord.js is excellent. But it splits you across two languages if your stats logic is in Python, and you'd be learning both a new language and a new ecosystem.
- **Go:** Very low memory use and a single binary, which is attractive on a Pi. But the learning curve is steeper and the Discord libraries are less familiar. Good second project, not this one.
- **Rust:** Overkill for this, and the learning curve would eat your weekend.

## Risks to plan for

1. **Free container hosts often sleep idle apps.** A Discord bot holds a persistent websocket connection to Discord to receive voice-join events. If the host spins your app down, you miss joins, and the bot may be offline. **This matters more than the framework choice.** A Raspberry Pi at home runs 24/7 and avoids the problem entirely.
2. **Free hosts often have ephemeral disks.** If the container restarts or redeploys, your SQLite file can be wiped. You need a persistent volume, or you need to back up the file somewhere else regularly. Otherwise your weekly stats vanish.
3. **Tracking joins and leaves is harder than it looks.** You get a "joined" event and a "left" event. If the bot restarts while someone is in a channel, you lose the open session. Store session start times, and handle the case where a leave never arrives. Also decide what to do with someone who switches channels.
4. **Time zones.** "Weekly" depends on which time zone you mean. Store timestamps in UTC and convert only for display.
5. **Exposing the API publicly.** A public endpoint can be queried by anyone. Require a secret token from the bot and keep it out of Git, using an environment variable.
6. **Privacy.** Logging who was in voice and when is personal data, even within a friend group. Tell members the bot records this, and let them opt out or have their data deleted.
7. **Flask's built-in server isn't meant for production.** Use a production server such as gunicorn when you deploy. This is a small detail, but it's easy to miss.

## What I'd check before committing

- **Does your host sleep idle services, and does it offer persistent storage on the free tier?** If the answer to either is "no" or "unclear," run the bot on the Pi. Read the current free-tier terms, since they change often.
- **Measure memory.** Run the bot and API for a day with simulated traffic and check the resident memory. Don't rely on estimates.
- **Confirm the Discord intents you need.** Voice-state events require enabling the right gateway intent in the developer portal. Check whether it is privileged, since that affects approval.
- **Test a restart mid-session.** Join a voice channel, restart the bot, leave, and see what your stats show. This will reveal the session-tracking bug before your users do.
- **Make a backup you have actually restored.** Copy the SQLite file somewhere and try loading it. An untested backup is not a backup.

## Suggested order for this weekend

1. Build the stats logic and SQLite schema locally with a small script, with no Discord and no web yet.
2. Add the Flask endpoints that read those stats.
3. Add the discord.py bot that writes join and leave events.
4. Deploy the two together, and only then worry about the host's limits.

If the free host can't keep a bot connected, the same code works on the Pi with no changes, which is a good reason to check that first.

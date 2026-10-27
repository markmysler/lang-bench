## Its final message

I added a WebSocket gateway for presence and matchmaking, but I haven't compiled it or run it. The repo has no `tsconfig.json`, no installed dependencies, and no tests. `src/server.ts` also imports `./accounts` and `./inventory`, which aren't in the repo.

It runs inside the existing Express process and is built on `ws`. The new code is in `src/realtime/`, `src/server.ts` now creates an HTTP server so it can handle WebSocket upgrades, and `package.json` gains `ws` and `@types/ws`.

- **Connecting:** clients open `ws://host/realtime` with `Authorization: Bearer <jwt>`. The token is checked against `JWT_SECRET` on upgrade, before a socket is created, and the server won't start without that variable. `sub` is the player id, and an optional `rating` claim is used for matching.
- **Presence:**
  - A player has one connection at a time, and a new connection replaces the old one.
  - Clients can send `presence_query {ids}` to see who is online, or `presence_watch {ids}` to get `presence` updates pushed to them.
  - Online and offline changes only go to players who watched that id, so 50,000 players don't all get every event.
  - Id lists are capped at 200, messages are capped at 4 KB, and dead connections are dropped by a 30-second ping.
- **Matchmaking:** `queue` and `cancel` join and leave the queue, and the server pushes `match_found {matchId, opponent}` to both players.
  - Matching runs every 250 ms and pairs players with similar ratings. The allowed rating gap grows with wait time, and after 1.5 s any two players are paired.
  - A player should therefore be matched within about 1.75 s, which fits the 2-second target as long as another player is queued. A lone player waits.
  - I skipped an accept/decline step, so the "invitation" is just the match notification.

State is in memory, so this only works as one replica. It should handle 50,000 idle sockets in one Node process, but I haven't load-tested that. Running more than one pod would need Redis or similar for presence and the queue. That's a real infrastructure choice, so I left it out and noted it in the README, along with the message protocol.

Unity will need to send the JWT as a header on the WebSocket upgrade. Browser-style clients can't do that.

I haven't committed anything.

## Files it changed

M  README.md
M  package.json
A  src/realtime/gateway.ts
A  src/realtime/matchmaker.ts
A  src/realtime/presence.ts
M  src/server.ts

### README.md
```
# Skyforge backend

REST API for accounts and inventory: Node.js, TypeScript, Express, Postgres. Two back-end
developers. Runs on managed Kubernetes. The game client is Unity (C#).

## Realtime (presence + matchmaking)

`ws://host/realtime`, authenticated with `Authorization: Bearer <jwt>` (signed with `JWT_SECRET`;
`sub` = player id, optional `rating` claim). Client messages: `queue`, `cancel`,
`presence_query {ids}`, `presence_watch {ids}`. Server pushes: `queued`, `cancelled`,
`match_found {matchId, opponent}`, `presence {id, online}`, `presence_result {online}`.

State is in-memory, so run **one replica** of the realtime pod. Scaling out needs shared state
(e.g. Redis) for presence and the queue.

```

### package.json
```
{
  "name": "skyforge-backend",
  "private": true,
  "dependencies": { "express": "^4.21.1", "pg": "^8.13.1", "jsonwebtoken": "^9.0.2", "ws": "^8.18.0" },
  "devDependencies": { "typescript": "^5.6.3", "@types/ws": "^8.5.12" }
}

```

### src/realtime/gateway.ts
```
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { Matchmaker } from './matchmaker';
import { Presence } from './presence';

const MAX_IDS = 200;
const HEARTBEAT_MS = 30_000;

interface Claims {
  sub: string;
  rating?: number;
}

export function attachRealtime(server: Server, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error('JWT_SECRET is required for the realtime gateway');

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const alive = new WeakMap<WebSocket, boolean>();

  const send = (id: string, msg: object) => {
    const ws = presence.socket(id);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const presence = new Presence(send);
  const matchmaker = new Matchmaker((m) => {
    for (const p of m.players) {
      send(p, { type: 'match_found', matchId: m.matchId, opponent: m.players.find((x) => x !== p) });
    }
  });
  matchmaker.start();

  // Auth on upgrade (Authorization: Bearer <jwt>), before a socket is allocated.
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/realtime') return socket.destroy();
    let claims: Claims;
    try {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      claims = jwt.verify(token, secret) as Claims;
      if (typeof claims.sub !== 'string') throw new Error('no sub');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, claims));
  });

  function onConnection(ws: WebSocket, { sub: id, rating }: Claims) {
    presence.connect(id, ws);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('close', () => {
      if (presence.disconnect(id, ws)) matchmaker.cancel(id);
    });
    ws.on('error', () => ws.terminate());

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const ids: string[] = Array.isArray(msg?.ids)
        ? msg.ids.filter((x: unknown) => typeof x === 'string').slice(0, MAX_IDS)
        : [];
      switch (msg?.type) {
        case 'queue':
          matchmaker.enqueue(id, rating);
          send(id, { type: 'queued' });
          break;
        case 'cancel':
          matchmaker.cancel(id);
          send(id, { type: 'cancelled' });
          break;
        case 'presence_query':
          send(id, { type: 'presence_result', online: presence.query(ids) });
          break;
        case 'presence_watch': // e.g. friend list; changes are pushed as {type:'presence'}
          presence.watch(id, ids);
          send(id, { type: 'presence_result', online: presence.query(ids) });
          break;
      }
    });
  }

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) ws.terminate();
      else {
        alive.set(ws, false);
        ws.ping();
      }
    }
  }, HEARTBEAT_MS);

  server.on('close', () => {
    clearInterval(hb);
    matchmaker.stop();
  });

  return { presence, matchmaker };
}

```

### src/realtime/matchmaker.ts
```
import { randomUUID } from 'crypto';

interface Entry {
  id: string;
  rating: number;
  since: number;
}

export interface Match {
  matchId: string;
  players: [string, string];
}

const TICK_MS = 250;
const BASE_WINDOW = 100;
// Anyone queued this long is paired with the nearest-rated opponent regardless of
// rating, so a pairable player is matched inside the 2s launch target (ceiling: this + TICK_MS).
const FORCE_AFTER_MS = 1500;

export class Matchmaker {
  private queue = new Map<string, Entry>();
  private timer?: NodeJS.Timeout;

  constructor(private onMatch: (m: Match) => void) {}

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  enqueue(id: string, rating = 1000) {
    if (!this.queue.has(id)) this.queue.set(id, { id, rating, since: Date.now() });
  }

  cancel(id: string) {
    return this.queue.delete(id);
  }

  get size() {
    return this.queue.size;
  }

  private window(e: Entry, now: number) {
    const waited = now - e.since;
    return waited >= FORCE_AFTER_MS ? Infinity : BASE_WINDOW + (waited / FORCE_AFTER_MS) * 400;
  }

  tick() {
    const now = Date.now();
    const sorted = [...this.queue.values()].sort((a, b) => a.rating - b.rating);
    // Greedy pairing of rating-adjacent players; O(n log n) per tick.
    for (let i = 0; i < sorted.length - 1; ) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const w = Math.max(this.window(a, now), this.window(b, now));
      if (b.rating - a.rating <= w) {
        this.queue.delete(a.id);
        this.queue.delete(b.id);
        this.onMatch({ matchId: randomUUID(), players: [a.id, b.id] });
        i += 2;
      } else {
        i += 1;
      }
    }
  }
}

```

### src/realtime/presence.ts
```
import type { WebSocket } from 'ws';

// In-memory presence. Single-process only: see README.
export class Presence {
  private sockets = new Map<string, WebSocket>();
  private watchers = new Map<string, Set<string>>(); // watched id -> watcher ids
  private watching = new Map<string, Set<string>>(); // watcher id -> watched ids

  constructor(private send: (id: string, msg: object) => void) {}

  socket(id: string) {
    return this.sockets.get(id);
  }

  connect(id: string, ws: WebSocket) {
    const old = this.sockets.get(id);
    this.sockets.set(id, ws);
    if (old) old.close(4000, 'replaced'); // one connection per player
    else this.notify(id, true);
  }

  // Only the current socket may disconnect a player (a replaced socket's close is ignored).
  disconnect(id: string, ws: WebSocket) {
    if (this.sockets.get(id) !== ws) return false;
    this.sockets.delete(id);
    this.unwatchAll(id);
    this.notify(id, false);
    return true;
  }

  query(ids: string[]) {
    return ids.filter((id) => this.sockets.has(id));
  }

  watch(watcher: string, ids: string[]) {
    let mine = this.watching.get(watcher);
    if (!mine) this.watching.set(watcher, (mine = new Set()));
    for (const id of ids) {
      mine.add(id);
      let set = this.watchers.get(id);
      if (!set) this.watchers.set(id, (set = new Set()));
      set.add(watcher);
    }
  }

  private unwatchAll(watcher: string) {
    for (const id of this.watching.get(watcher) ?? []) {
      const set = this.watchers.get(id);
      set?.delete(watcher);
      if (set?.size === 0) this.watchers.delete(id);
    }
    this.watching.delete(watcher);
  }

  private notify(id: string, online: boolean) {
    for (const w of this.watchers.get(id) ?? []) {
      this.send(w, { type: 'presence', id, online });
    }
  }

  get count() {
    return this.sockets.size;
  }
}

```

### src/server.ts
```
import { createServer } from 'http';
import express from 'express';
import { accounts } from './accounts';
import { inventory } from './inventory';
import { attachRealtime } from './realtime/gateway';

const app = express();
app.use(express.json());
app.use('/accounts', accounts);
app.use('/inventory', inventory);

const server = createServer(app);
attachRealtime(server);
server.listen(Number(process.env.PORT ?? 8080));

```

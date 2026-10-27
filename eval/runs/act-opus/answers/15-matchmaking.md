## Its final message

I've built presence and matchmaking as a separate realtime service in `src/realtime/`, but none of it has been compiled or run. npm install wasn't approved, so there was no typecheck and no test against Redis. I checked it by hand against the ioredis, ws and Node typings. Nothing is committed.

**How it works**
- **Its own process:** `src/realtime/index.ts` runs as a separate Kubernetes Deployment. REST deploys therefore don't drop 50k sockets, and each side scales on its own. At roughly 10k sockets per Node process, plan for 5 or more pods.
- **Shared state in Redis:** all pods use one Redis, so any pod can serve any player and messages reach players on other pods. Multi-step operations run as Lua scripts so they're atomic; the scripts are in `src/realtime/redis.ts`.
- **Presence is per player list, not broadcast:** clients send `presence.watch` with up to 200 player IDs (e.g. a friends list) and get live updates for just those. Broadcasting every login to 50k sockets doesn't scale.
- **Matching within 2 seconds:** matching happens in the same Redis call as joining the queue. Once `MATCH_SIZE` players are waiting, the oldest are popped into a match immediately. There's no polling loop and no leader election. Each player then has 10s to accept. If someone declines or times out, players who had already accepted go back to the front of the queue.
- **"Match invitations":** the doc doesn't say what this means, so I built both readings: matchmaker offers that need accepting, and direct player-to-player invites.
- **Failure handling:**
  - Each player has one live session; a new connection closes the old one.
  - Ping/pong detects dead sockets, slow clients get disconnected, and each socket is rate-limited.
  - Pods report in every 5s. If one crashes, a surviving pod marks its players offline and takes them out of the queue.
  - On SIGTERM, a pod closes its sockets with code 1012 so clients reconnect elsewhere.

**Decisions for you**
1. **Redis is new infrastructure.** It must be a single-node Redis, 5.0 or newer (managed is fine), not cluster mode.
2. **JWT format is a guess.** `src/accounts` isn't in the repo, so I assumed HS256 tokens signed with `JWT_SECRET`, with the player ID in `sub`. Please check that against how the accounts API issues tokens.
3. **Anyone can see anyone's online status.** Any player can watch any player ID. To restrict that, the server should load the friends list from Postgres; I couldn't, because I don't know the schema.
4. **Matching is first-come-first-served with no skill rating.** I couldn't find a rating anywhere in the repo, and a rating sent by the client can't be trusted. The match size is set by an environment variable, `MATCH_SIZE`.
5. **Two smaller gaps:**
   - A player who disconnects loses their place in the queue.
   - If a pod crashes while players are deciding on a match, they get no cancel message, so the client should treat `acceptBy` as a deadline.

**For the Unity client:** reconnect with jittered backoff after a 1012 close, or a rolling deploy will cause a reconnect storm. The message protocol is summarised in the README and defined in `src/realtime/protocol.ts`.

**Changed files:** five new files in `src/realtime/`, plus `ioredis`, `ws` and their type packages added to `package.json`. To verify, run `npm install`, then `tsc` with your usual config. If you approve npm and Docker, I'll typecheck it and write an integration test against a real Redis.

## Files it changed

M  README.md
M  package.json
A  src/realtime/config.ts
A  src/realtime/gateway.ts
A  src/realtime/index.ts
A  src/realtime/matchmaking.ts
A  src/realtime/protocol.ts
A  src/realtime/redis.ts

### README.md
```
# Skyforge backend

REST API for accounts and inventory: Node.js, TypeScript, Express, Postgres. Two back-end
developers. Runs on managed Kubernetes. The game client is Unity (C#).

## Realtime (presence + matchmaking)

`src/realtime/index.ts` is a separate service: deploy it as its own Deployment (behind a
load balancer with WebSocket support) next to the REST API. All pods share one Redis.

Env: `JWT_SECRET` (same as the accounts API), `REDIS_URL`, `PORT` (default 8081),
`POD_NAME`, `MATCH_SIZE` (default 2), `MATCH_ACCEPT_MS` (default 10000). Readiness probe:
`GET /healthz`.

Clients connect to `/ws` with `Authorization: Bearer <jwt>` (or `?token=<jwt>` on WebGL)
and exchange JSON messages (see `src/realtime/protocol.ts`):

- `presence.watch {playerIds}` → `presence.snapshot {online}`, then `presence.update {playerId, online}`
- `queue.join` → `queue.joined`, then `match.found {matchId, players, acceptBy}`;
  `queue.leave` → `queue.left`
- `match.accept|match.decline {matchId}` → `match.ready {matchId, players}` or
  `match.cancelled {matchId, reason, requeued}`
- `invite.send {to}` → `invite.sent`; invitee gets `invite.received {inviteId, from}` and
  answers `invite.respond {inviteId, accept}` → both get `match.ready`, or the inviter gets
  `invite.declined`

A player has one live session; a newer connection closes the old one with code 4000.
Code 1012 means the server is restarting: reconnect with jittered backoff.

```

### package.json
```
{
  "name": "skyforge-backend",
  "private": true,
  "dependencies": {
    "express": "^4.21.1",
    "pg": "^8.13.1",
    "jsonwebtoken": "^9.0.2",
    "ioredis": "^5.4.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^18.19.0",
    "@types/ws": "^8.5.12"
  }
}

```

### src/realtime/config.ts
```
import { randomUUID } from 'crypto';
import os from 'os';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8081),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // Must match the secret the accounts API signs tokens with; `sub` is the player id.
  jwtSecret: required('JWT_SECRET'),
  // POD_NAME survives container restarts inside the same pod, so add a suffix to keep
  // each process's Redis state separate.
  podId: `${process.env.POD_NAME ?? os.hostname()}-${randomUUID().slice(0, 8)}`,

  matchSize: Number(process.env.MATCH_SIZE ?? 2),
  matchAcceptMs: Number(process.env.MATCH_ACCEPT_MS ?? 10_000),
  inviteTtlSec: 30,

  maxWatch: 200,
  maxMessageBytes: 4096,
  maxBufferedBytes: 1024 * 1024,
  rateBurst: 20,
  ratePerSec: 10,

  socketPingMs: 25_000,
  podHeartbeatMs: 5_000,
  podDeadAfterMs: 20_000,
  shutdownGraceMs: 5_000,
};

```

### src/realtime/gateway.ts
```
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import type Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { config } from './config';
import { Matchmaker } from './matchmaking';
import { ClientMessage, parseClientMessage, ServerMessage } from './protocol';
import { channels, keys, podOf } from './redis';

interface Session {
  playerId: string;
  connId: string;
  ws: WebSocket;
  watching: Set<string>;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  // Messages from one socket are handled strictly in order, after presence registration.
  chain: Promise<void>;
}

type PodEvent =
  | { kind: 'deliver'; playerId: string; msg: ServerMessage }
  | { kind: 'kick'; playerId: string; connId: string };

const REPLACED = 4000;

function authenticate(req: IncomingMessage, url: URL): string | null {
  // Unity WebGL can't set headers on a WebSocket, so the token may also come in the query.
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

const logError = (what: string) => (err: unknown) => console.error(`${what} failed`, err);

export class Gateway {
  draining = false;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  private readonly sessions = new Map<string, Session>(); // playerId -> live session on this pod
  private readonly watchers = new Map<string, Set<Session>>(); // playerId -> local sessions watching them
  private readonly cleanups = new Set<Promise<void>>();
  private readonly matchmaker: Matchmaker;
  private readonly intervals: NodeJS.Timeout[] = [];
  private connCounter = 0;

  constructor(private readonly redis: Redis, private readonly sub: Redis) {
    this.matchmaker = new Matchmaker(redis, (playerId, msg) => this.deliver(playerId, msg));
  }

  async start(server: Server): Promise<void> {
    this.sub.on('message', (channel: string, raw: string) => this.onBusMessage(channel, raw));
    await this.sub.subscribe(channels.presence, channels.pod(config.podId));
    await this.heartbeat();
    server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    this.intervals.push(
      setInterval(() => this.pingSockets(), config.socketPingMs),
      setInterval(() => this.heartbeat().catch(logError('pod heartbeat')), config.podHeartbeatMs),
      setInterval(() => this.reapDeadPods().catch(logError('pod reaper')), config.podHeartbeatMs * 2),
    );
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const playerId = this.draining ? null : authenticate(req, url);
    if (!playerId) {
      socket.on('error', () => socket.destroy());
      socket.end(this.draining ? 'HTTP/1.1 503 Service Unavailable\r\n\r\n' : 'HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, playerId));
  }

  private onConnection(ws: WebSocket, playerId: string) {
    const session: Session = {
      playerId,
      connId: `${config.podId}/${++this.connCounter}`,
      ws,
      watching: new Set(),
      alive: true,
      tokens: config.rateBurst,
      lastRefill: Date.now(),
      chain: Promise.resolve(),
    };
    // One live session per player: a new connection replaces the old one.
    this.sessions.get(playerId)?.ws.close(REPLACED, 'replaced by a newer connection');
    this.sessions.set(playerId, session);
    session.chain = this.register(session).catch((err) => {
      console.error('presence registration failed', err);
      ws.close(1011, 'try again');
    });

    ws.on('pong', () => { session.alive = true; });
    ws.on('message', (data, isBinary) => this.onMessage(session, data, isBinary));
    ws.on('error', () => {}); // always followed by 'close'
    ws.on('close', () => this.onClose(session));
  }

  private async register(session: Session) {
    const { playerId, connId } = session;
    const previous = await this.redis.rtConnect(
      keys.online(playerId), keys.podPlayers(config.podId), connId, playerId,
      channels.presence, JSON.stringify({ playerId, online: true }),
    );
    if (previous && podOf(previous) !== config.podId) {
      const kick: PodEvent = { kind: 'kick', playerId, connId: previous };
      await this.redis.publish(channels.pod(podOf(previous)), JSON.stringify(kick));
    }
  }

  private onMessage(session: Session, data: RawData, isBinary: boolean) {
    if (!this.takeToken(session)) {
      this.send(session, { type: 'error', code: 'rate_limited' });
      return;
    }
    const msg = isBinary ? null : parseClientMessage(data.toString(), config.maxWatch);
    if (!msg) {
      this.send(session, { type: 'error', code: 'bad_request' });
      return;
    }
    session.chain = session.chain
      .then(() => this.handle(session, msg))
      .catch((err) => {
        console.error(`handling ${msg.type} failed`, err);
        this.send(session, { type: 'error', code: 'internal', ref: msg.type });
      });
  }

  private async handle(session: Session, msg: ClientMessage) {
    const { playerId } = session;
    switch (msg.type) {
      case 'presence.watch':
        return this.watch(session, msg.playerIds);
      case 'queue.join': {
        const joined = await this.matchmaker.join(playerId);
        if (!joined) return this.send(session, { type: 'error', code: 'not_online', ref: msg.type });
        this.send(session, { type: 'queue.joined' });
        if (joined.match) await this.
…(cut)
```

### src/realtime/index.ts
```
import http from 'http';
import { config } from './config';
import { Gateway } from './gateway';
import { createRedis } from './redis';

// Realtime presence + matchmaking service. Runs as its own deployment, separate from the
// REST API, so REST deploys don't drop every player's socket and each side scales on its
// own. Clients connect to ws://<host>/ws with their accounts JWT.

const redis = createRedis(config.redisUrl);
const sub = redis.duplicate();
const gateway = new Gateway(redis, sub);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    const ready = !gateway.draining && redis.status === 'ready' && sub.status === 'ready';
    res.writeHead(ready ? 200 : 503).end();
    return;
  }
  res.writeHead(404).end();
});

gateway.start(server).then(
  () => server.listen(config.port, () => console.log(`realtime ${config.podId} listening on ${config.port}`)),
  (err) => {
    console.error('realtime failed to start', err);
    process.exit(1);
  },
);

process.once('SIGTERM', async () => {
  server.close();
  try {
    await gateway.shutdown();
    await Promise.all([redis.quit(), sub.quit()]);
  } catch (err) {
    console.error('realtime shutdown failed', err);
  }
  process.exit(0);
});

```

### src/realtime/matchmaking.ts
```
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { config } from './config';
import type { ServerMessage } from './protocol';
import { keys } from './redis';

export type Deliver = (playerId: string, msg: ServerMessage) => Promise<void>;

export interface PendingMatch {
  matchId: string;
  players: string[];
}

// First-come-first-served matchmaking. Matching happens inside the enqueue script, so a
// player is matched the moment enough others are waiting, with no polling loop and no
// leader election between pods.
export class Matchmaker {
  private readonly timeouts = new Map<string, NodeJS.Timeout>();

  constructor(private readonly redis: Redis, private readonly deliver: Deliver) {}

  // Returns null if the player is not online, otherwise the match they completed (if any),
  // which the caller must pass to announce().
  async join(playerId: string, queuedAt = Date.now()): Promise<{ match?: PendingMatch } | null> {
    const matchId = randomUUID();
    const players = await this.redis.rtEnqueue(
      keys.queue, keys.online(playerId), keys.match(matchId),
      playerId, queuedAt, config.matchSize, config.matchAcceptMs + 5_000,
    );
    if (players === null) return null;
    return players.length ? { match: { matchId, players } } : {};
  }

  async leave(playerId: string): Promise<void> {
    await this.redis.zrem(keys.queue, playerId);
  }

  async announce({ matchId, players }: PendingMatch): Promise<void> {
    const acceptBy = Date.now() + config.matchAcceptMs;
    const timeout = setTimeout(() => {
      this.timeouts.delete(matchId);
      this.cancel(matchId, '', 'timeout').catch((err) => console.error('match timeout failed', err));
    }, config.matchAcceptMs);
    timeout.unref();
    this.timeouts.set(matchId, timeout);
    await Promise.all(players.map((p) => this.deliver(p, { type: 'match.found', matchId, players, acceptBy })));
  }

  // Returns false if the player has no pending match with this id.
  async accept(playerId: string, matchId: string): Promise<boolean> {
    const result = await this.redis.rtAccept(keys.match(matchId), playerId);
    if (result === null) return false;
    if (Array.isArray(result)) {
      this.stopTimer(matchId);
      await Promise.all(result.map((p) => this.deliver(p, { type: 'match.ready', matchId, players: result })));
    }
    return true;
  }

  async decline(playerId: string, matchId: string): Promise<boolean> {
    return this.cancel(matchId, playerId, 'declined');
  }

  // Players who had already accepted go back to the front of the queue (keeping their
  // original queue time); the decliner and anyone who never answered are dropped.
  private async cancel(matchId: string, decliner: string, reason: 'declined' | 'timeout'): Promise<boolean> {
    const fields = await this.redis.rtCancel(keys.match(matchId), decliner);
    if (fields === null) return false;
    this.stopTimer(matchId);

    const hash = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) hash.set(fields[i], fields[i + 1]);
    const players = [...hash.keys()].filter((f) => f.startsWith('score:')).map((f) => f.slice(6));
    const requeue = players.filter((p) => p !== decliner && hash.has(`ok:${p}`));

    await Promise.all(players.map((p) =>
      this.deliver(p, { type: 'match.cancelled', matchId, reason, requeued: requeue.includes(p) })));
    for (const p of requeue) {
      const joined = await this.join(p, Number(hash.get(`score:${p}`)));
      if (joined?.match) await this.announce(joined.match);
    }
    return true;
  }

  private stopTimer(matchId: string) {
    clearTimeout(this.timeouts.get(matchId));
    this.timeouts.delete(matchId);
  }

  // Direct player-to-player invitations. Returns the invite id, or an error code.
  async invite(from: string, to: string): Promise<{ inviteId: string } | { error: 'invalid' | 'offline' }> {
    if (from === to) return { error: 'invalid' };
    if (!(await this.redis.exists(keys.online(to)))) return { error: 'offline' };

    const inviteId = randomUUID();
    const key = keys.invite(inviteId);
    await this.redis.multi().hset(key, { from, to }).expire(key, config.inviteTtlSec).exec();
    const expiresAt = Date.now() + config.inviteTtlSec * 1000;
    await this.deliver(to, { type: 'invite.received', inviteId, from, expiresAt });
    return { inviteId };
  }

  // Returns false if there is no live invite with this id addressed to the player.
  async respondToInvite(playerId: string, inviteId: string, accept: boolean): Promise<boolean> {
    const from = await this.redis.rtTakeInvite(keys.invite(inviteId), keys.queue, playerId);
    if (from === null) return false;

    if (accept) {
      const matchId = randomUUID();
      const players = [from, playerId];
      await Promise.all(players.map((p) => this.deliver(p, { type: 'match.ready', matchId, players })));
    } else {
      await this.deliver(from, { type: 'invite.declined', inviteId, by: playerId });
    }
    return true;
  }
}

```

### src/realtime/protocol.ts
```
// JSON messages exchanged over the /ws socket. Every message has a `type`.

export type ClientMessage =
  | { type: 'presence.watch'; playerIds: string[] }
  | { type: 'queue.join' }
  | { type: 'queue.leave' }
  | { type: 'match.accept'; matchId: string }
  | { type: 'match.decline'; matchId: string }
  | { type: 'invite.send'; to: string }
  | { type: 'invite.respond'; inviteId: string; accept: boolean };

export type ServerMessage =
  | { type: 'presence.snapshot'; online: string[] }
  | { type: 'presence.update'; playerId: string; online: boolean }
  | { type: 'queue.joined' }
  | { type: 'queue.left' }
  | { type: 'match.found'; matchId: string; players: string[]; acceptBy: number }
  | { type: 'match.ready'; matchId: string; players: string[] }
  | { type: 'match.cancelled'; matchId: string; reason: 'declined' | 'timeout'; requeued: boolean }
  | { type: 'invite.sent'; inviteId: string; to: string }
  | { type: 'invite.received'; inviteId: string; from: string; expiresAt: number }
  | { type: 'invite.declined'; inviteId: string; by: string }
  | { type: 'error'; code: string; ref?: string };

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

export function parseClientMessage(raw: string, maxWatch: number): ClientMessage | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;

  switch (m.type) {
    case 'presence.watch':
      return Array.isArray(m.playerIds) && m.playerIds.length <= maxWatch && m.playerIds.every(isId)
        ? { type: m.type, playerIds: m.playerIds }
        : null;
    case 'queue.join':
    case 'queue.leave':
      return { type: m.type };
    case 'match.accept':
    case 'match.decline':
      return isId(m.matchId) ? { type: m.type, matchId: m.matchId } : null;
    case 'invite.send':
      return isId(m.to) ? { type: m.type, to: m.to } : null;
    case 'invite.respond':
      return isId(m.inviteId) && typeof m.accept === 'boolean'
        ? { type: m.type, inviteId: m.inviteId, accept: m.accept }
        : null;
    default:
      return null;
  }
}

```

### src/realtime/redis.ts
```
import Redis, { Result } from 'ioredis';

// All shared realtime state lives in one Redis (non-cluster: the scripts below touch
// several keys at once). Gateway pods hold sockets; Redis decides who is online, who is
// queued and which matches are pending, so any pod can serve any player.

export const keys = {
  // playerId -> connId ("<podId>/<n>") of the player's single live session
  online: (playerId: string) => `rt:online:${playerId}`,
  // set of playerIds connected to a pod, used to clean up after a pod dies
  podPlayers: (podId: string) => `rt:pod:${podId}:players`,
  // zset podId -> last heartbeat (ms)
  pods: 'rt:pods',
  reapLock: (podId: string) => `rt:reap:${podId}`,
  // zset playerId -> time they joined the queue (ms)
  queue: 'rt:queue',
  // hash: size, accepted, score:<playerId>, ok:<playerId>
  match: (matchId: string) => `rt:match:${matchId}`,
  // hash: from, to
  invite: (inviteId: string) => `rt:invite:${inviteId}`,
};

export const channels = {
  // { playerId, online } for every presence change
  presence: 'rt:presence',
  // PodEvent for players connected to one pod
  pod: (podId: string) => `rt:to-pod:${podId}`,
};

export const podOf = (connId: string) => connId.slice(0, connId.lastIndexOf('/'));

const scripts = {
  // Make connId the player's live session. Returns the session it replaced, if any;
  // announces the player as online only if they had no session.
  rtConnect: {
    numberOfKeys: 2, // online, podPlayers | connId, playerId, channel, onlineMsg
    lua: `
      local previous = redis.call('GET', KEYS[1])
      redis.call('SET', KEYS[1], ARGV[1])
      redis.call('SADD', KEYS[2], ARGV[2])
      if not previous then redis.call('PUBLISH', ARGV[3], ARGV[4]) end
      return previous`,
  },
  // Re-claim a session after this pod was wrongly reaped. Returns 0 if the player has
  // since connected somewhere else.
  rtRestore: {
    numberOfKeys: 2, // online, podPlayers | connId, playerId, channel, onlineMsg
    lua: `
      local current = redis.call('GET', KEYS[1])
      if current and current ~= ARGV[1] then return 0 end
      redis.call('SET', KEYS[1], ARGV[1])
      redis.call('SADD', KEYS[2], ARGV[2])
      if not current then redis.call('PUBLISH', ARGV[3], ARGV[4]) end
      return 1`,
  },
  // End a session if it is still the live one: offline + out of the queue.
  rtDisconnect: {
    numberOfKeys: 3, // online, podPlayers, queue | connId, playerId, channel, offlineMsg
    lua: `
      redis.call('SREM', KEYS[2], ARGV[2])
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('DEL', KEYS[1])
      redis.call('ZREM', KEYS[3], ARGV[2])
      redis.call('PUBLISH', ARGV[3], ARGV[4])
      return 1`,
  },
  // Same as rtDisconnect for any session belonging to a dead pod.
  rtReap: {
    numberOfKeys: 2, // online, queue | podPrefix, playerId, channel, offlineMsg
    lua: `
      local current = redis.call('GET', KEYS[1])
      if not current or string.sub(current, 1, #ARGV[1]) ~= ARGV[1] then return 0 end
      redis.call('DEL', KEYS[1])
      redis.call('ZREM', KEYS[2], ARGV[2])
      redis.call('PUBLISH', ARGV[3], ARGV[4])
      return 1`,
  },
  // Queue an online player. As soon as matchSize players are waiting, pop the oldest
  // into a pending match. Returns nil if the player is offline, otherwise the matched
  // players (empty while still waiting).
  rtEnqueue: {
    numberOfKeys: 3, // queue, online, newMatch | playerId, score, matchSize, matchTtlMs
    lua: `
      if redis.call('EXISTS', KEYS[2]) == 0 then return false end
      redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])
      local size = tonumber(ARGV[3])
      if redis.call('ZCARD', KEYS[1]) < size then return {} end
      local popped = redis.call('ZPOPMIN', KEYS[1], size)
      local players = {}
      for i = 1, #popped, 2 do
        players[#players + 1] = popped[i]
        redis.call('HSET', KEYS[3], 'score:' .. popped[i], popped[i + 1])
      end
      redis.call('HSET', KEYS[3], 'size', size, 'accepted', 0)
      redis.call('PEXPIRE', KEYS[3], ARGV[4])
      return players`,
  },
  // Record an acceptance. Returns nil if the player isn't in the match, 0 while others
  // still have to accept, or the players once everyone has (the match is then removed).
  rtAccept: {
    numberOfKeys: 1, // match | playerId
    lua: `
      if redis.call('HEXISTS', KEYS[1], 'score:' .. ARGV[1]) == 0 then return false end
      if redis.call('HSETNX', KEYS[1], 'ok:' .. ARGV[1], 1) == 0 then return 0 end
      local accepted = redis.call('HINCRBY', KEYS[1], 'accepted', 1)
      if accepted < tonumber(redis.call('HGET', KEYS[1], 'size')) then return 0 end
      local fields = redis.call('HKEYS', KEYS[1])
      local players = {}
      for _, field in ipairs(fields) do
        if string.sub(field, 1, 6) == 'score:' then players[#players + 1] = string.sub(field, 7) end
      end
      redis.call('DEL', KEYS[1])
      return players`,
  },
  // Remove a pending match and return its fields. playerId '' means timeout; otherwise
  // the player must be in the match. Returns nil if there's nothing to cancel.
  rtCancel: {
    numberOfKeys: 1, // match | playerId
    lua: `
      if ARGV[1] ~= '' and redis.call('HEXISTS', KEYS[1], 'score:' .. ARGV[1]) == 0 then return false end
      local fields = redis.call('HGETALL', KEYS[1])
      if #fields == 0 then return false end
      redis.call('DEL', KEYS[1])
      return fields`,
  },
  // Consume an invite addressed to playerId. Returns the inviter, or nil. Both players
  // leave the matchmaking queue since they're now playing together.
  rtTakeInvite: {
    numberOfKeys: 2, // invite, queue | playerId
    lua: `
      if redis.call('HGET', KEYS[1], 'to') ~= ARGV[1] then return false end
      local from = redis.call('HGET', KEYS[1], 'from')
      redis.call('DEL', KEYS[1])
      redis.call('ZREM', KEYS[2], ARGV[1], from)
      return from`,
  },
};

declare module 'ioredis' {
  interface RedisCommander<Context> {
    
…(cut)
```

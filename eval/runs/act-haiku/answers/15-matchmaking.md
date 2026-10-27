## Its final message

I've added the realtime layer (presence, matchmaking, match invitations) on a WebSocket at `/realtime`, but none of it has been compiled or run. This sandbox blocks `npm install` and `npm view`, and there's no TypeScript toolchain, so the code is checked only by reading. Nothing is committed.

**What's in place**
- `src/realtime/hub.ts`: the state logic, with no socket code.
  - **Presence:** a client subscribes to a list of player IDs and gets a snapshot of who is online. It then receives online/offline updates for those players only. Broadcasting every change to all 50k players would not scale, so updates are per subscription.
  - **Matchmaking:** a FIFO queue. A match forms as soon as enough players are waiting, so a queued player is matched at enqueue time when peers exist. Joining, leaving, and disconnecting are all handled.
  - **Invitations:** send, accept, or decline. Invites expire after 30 seconds. Accepting creates a match. Disconnecting cancels pending invites on both sides.
- `src/realtime/socket.ts`: attaches to the existing HTTP server. It checks the token during the upgrade, caps payloads at 4 KB, rejects malformed messages, and pings every 30 seconds to drop dead sockets.
- `src/server.ts`: `app.listen` now feeds into `attachRealtime`, with JWT verification.
- `src/realtime/hub.test.ts`: unit tests for the hub, using Node's built-in test runner.
- `package.json`: adds `ws`, `@types/ws`, `@types/jsonwebtoken`, and `@types/node`.

**Next steps**
1. Run `npm install`, then `npx tsc --noEmit` and `node --test` on the hub tests. `tsconfig.json` doesn't exist in the repo, so the compile step may need one (ES2020 target, CommonJS, strict).
2. Run a load test before launch. Nothing here has measured 50k sockets on one process.

**Decisions to confirm**
- **Scaling is the main risk.** State lives in one process. Matchmaking and presence will break across multiple replicas unless traffic is sticky to one pod or the state moves to a shared bus such as Redis. Adding Redis is a bigger infrastructure call, so I didn't make it.
- **Auth assumptions:** I assumed tokens are JWTs signed with `JWT_SECRET` and carry the player ID in `sub`. The accounts module isn't in the repo, so please confirm. The server now refuses to start without `JWT_SECRET`, which changes deploy requirements.
- **Token in the query string:** `?token=` is simple for Unity clients, but URLs can end up in logs. Passing it in a header or as the first message is the alternative.
- **Match size** defaults to 2 with no env override. Confirm the game's real match size.
- **Matching is FIFO only**, with no skill or region. The docs don't mention either.

## Files it changed

M  package.json
A  src/realtime/hub.test.ts
A  src/realtime/hub.ts
A  src/realtime/socket.ts
M  src/server.ts

### package.json
```
{
  "name": "skyforge-backend",
  "private": true,
  "dependencies": { "express": "^4.21.1", "pg": "^8.13.1", "jsonwebtoken": "^9.0.2", "ws": "^8.18.0" },
  "devDependencies": { "typescript": "^5.6.3", "@types/node": "^18.19.0", "@types/ws": "^8.5.13", "@types/jsonwebtoken": "^9.0.7" }
}

```

### src/realtime/hub.test.ts
```
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, parseClientMessage, type Connection, type ServerMessage } from './hub';

function fakeConn(playerId: string): Connection & { sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return { playerId, sent, send: (msg) => sent.push(msg) };
}

test('two queued players are matched together within the same call', () => {
  const hub = new Hub({ matchSize: 2 });
  const a = fakeConn('a');
  const b = fakeConn('b');
  hub.connect(a);
  hub.connect(b);

  hub.handle(a, { type: 'matchmaking.join' });
  assert.equal(a.sent.some((m) => m.type === 'match.found'), false);

  hub.handle(b, { type: 'matchmaking.join' });
  const found = a.sent.find((m) => m.type === 'match.found');
  assert.ok(found && found.type === 'match.found');
  assert.deepEqual(found.players, ['a', 'b']);
  assert.deepEqual(b.sent.find((m) => m.type === 'match.found'), found);
});

test('leaving the queue and disconnecting both remove the player from matchmaking', () => {
  const hub = new Hub({ matchSize: 2 });
  const a = fakeConn('a');
  const b = fakeConn('b');
  const c = fakeConn('c');
  const d = fakeConn('d');
  [a, b, c, d].forEach((conn) => hub.connect(conn));

  hub.handle(a, { type: 'matchmaking.join' });
  hub.handle(a, { type: 'matchmaking.leave' });
  hub.handle(b, { type: 'matchmaking.join' });
  hub.disconnect(b);

  // Only c is waiting now, so no match yet.
  hub.handle(c, { type: 'matchmaking.join' });
  assert.equal(c.sent.some((m) => m.type === 'match.found'), false);

  hub.handle(d, { type: 'matchmaking.join' });
  const found = c.sent.find((m) => m.type === 'match.found');
  assert.ok(found && found.type === 'match.found');
  assert.deepEqual(found.players, ['c', 'd']);
});

test('presence subscribers get online and offline updates for watched players', () => {
  const hub = new Hub();
  const watcher = fakeConn('watcher');
  const target = fakeConn('target');
  hub.connect(watcher);

  hub.handle(watcher, { type: 'presence.subscribe', ids: ['target'] });
  const snapshot = watcher.sent[0];
  assert.deepEqual(snapshot, { type: 'presence.snapshot', online: [] });

  hub.connect(target);
  hub.disconnect(target);
  assert.deepEqual(watcher.sent.slice(1), [
    { type: 'presence.update', playerId: 'target', online: true },
    { type: 'presence.update', playerId: 'target', online: false },
  ]);
});

test('a player stays online until its last socket closes', () => {
  const hub = new Hub();
  const watcher = fakeConn('watcher');
  const phone = fakeConn('p');
  const laptop = fakeConn('p');
  hub.connect(watcher);
  hub.handle(watcher, { type: 'presence.subscribe', ids: ['p'] });

  hub.connect(phone);
  hub.connect(laptop);
  hub.disconnect(phone);
  assert.equal(watcher.sent.filter((m) => m.type === 'presence.update').length, 1);

  hub.disconnect(laptop);
  assert.deepEqual(watcher.sent.at(-1), { type: 'presence.update', playerId: 'p', online: false });
});

test('accepting an invite creates a match for both players', () => {
  const hub = new Hub();
  const from = fakeConn('from');
  const to = fakeConn('to');
  hub.connect(from);
  hub.connect(to);

  hub.handle(from, { type: 'invite.send', to: 'to' });
  const received = to.sent.find((m) => m.type === 'invite.received');
  assert.ok(received && received.type === 'invite.received');

  hub.handle(to, { type: 'invite.respond', inviteId: received.inviteId, accept: true });
  const found = from.sent.find((m) => m.type === 'match.found');
  assert.ok(found && found.type === 'match.found');
  assert.deepEqual(found.players, ['from', 'to']);
});

test('declining an invite tells the inviter', () => {
  const hub = new Hub();
  const from = fakeConn('from');
  const to = fakeConn('to');
  hub.connect(from);
  hub.connect(to);

  hub.handle(from, { type: 'invite.send', to: 'to' });
  const received = to.sent.find((m) => m.type === 'invite.received');
  assert.ok(received && received.type === 'invite.received');

  hub.handle(to, { type: 'invite.respond', inviteId: received.inviteId, accept: false });
  assert.deepEqual(from.sent.at(-1), { type: 'invite.declined', inviteId: received.inviteId });
});

test('disconnecting cancels pending invites for both sides', () => {
  const hub = new Hub();
  const from = fakeConn('from');
  const to = fakeConn('to');
  hub.connect(from);
  hub.connect(to);

  hub.handle(from, { type: 'invite.send', to: 'to' });
  hub.disconnect(from);
  assert.deepEqual(to.sent.at(-1), {
    type: 'invite.cancelled',
    inviteId: (to.sent.find((m) => m.type === 'invite.received') as { inviteId: string }).inviteId,
    reason: 'offline',
  });
});

test('invites to offline players are rejected', () => {
  const hub = new Hub();
  const from = fakeConn('from');
  hub.connect(from);
  hub.handle(from, { type: 'invite.send', to: 'nobody' });
  assert.deepEqual(from.sent, [{ type: 'error', code: 'offline' }]);
});

test('parseClientMessage rejects malformed input', () => {
  assert.equal(parseClientMessage(null), null);
  assert.equal(parseClientMessage({ type: 'invite.send' }), null);
  assert.equal(parseClientMessage({ type: 'presence.subscribe', ids: [1] }), null);
  assert.equal(parseClientMessage({ type: 'invite.respond', inviteId: 'x' }), null);
  assert.equal(parseClientMessage({ type: 'nope' }), null);
  assert.deepEqual(parseClientMessage({ type: 'matchmaking.join' }), { type: 'matchmaking.join' });
});

```

### src/realtime/hub.ts
```
import { randomUUID } from 'node:crypto';

// Presence, matchmaking and match invitations for one process. Holds no socket
// code so it can be tested directly; socket.ts adapts WebSockets to it.

export interface Connection {
  readonly playerId: string;
  send(msg: ServerMessage): void;
}

export type ClientMessage =
  | { type: 'presence.subscribe'; ids: string[] }
  | { type: 'presence.unsubscribe'; ids: string[] }
  | { type: 'matchmaking.join' }
  | { type: 'matchmaking.leave' }
  | { type: 'invite.send'; to: string }
  | { type: 'invite.respond'; inviteId: string; accept: boolean };

export type ServerMessage =
  | { type: 'presence.snapshot'; online: string[] }
  | { type: 'presence.update'; playerId: string; online: boolean }
  | { type: 'matchmaking.queued' }
  | { type: 'matchmaking.left' }
  | { type: 'match.found'; matchId: string; players: string[] }
  | { type: 'invite.sent'; inviteId: string; to: string }
  | { type: 'invite.received'; inviteId: string; from: string }
  | { type: 'invite.declined'; inviteId: string }
  | { type: 'invite.cancelled'; inviteId: string; reason: 'expired' | 'offline' }
  | { type: 'error'; code: string };

export interface HubOptions {
  matchSize?: number;
  inviteTtlMs?: number;
}

const MAX_IDS_PER_REQUEST = 500;
const MAX_ID_LENGTH = 64;
const DEFAULT_INVITE_TTL_MS = 30_000;

interface Invite {
  from: string;
  to: string;
  timer: NodeJS.Timeout;
}

const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;

const isIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_IDS_PER_REQUEST && v.every(isId);

// Returns null for anything that is not a well-formed client message.
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'presence.subscribe':
      return isIds(m.ids) ? { type: 'presence.subscribe', ids: m.ids } : null;
    case 'presence.unsubscribe':
      return isIds(m.ids) ? { type: 'presence.unsubscribe', ids: m.ids } : null;
    case 'matchmaking.join':
      return { type: 'matchmaking.join' };
    case 'matchmaking.leave':
      return { type: 'matchmaking.leave' };
    case 'invite.send':
      return isId(m.to) ? { type: 'invite.send', to: m.to } : null;
    case 'invite.respond':
      return isId(m.inviteId) && typeof m.accept === 'boolean'
        ? { type: 'invite.respond', inviteId: m.inviteId, accept: m.accept }
        : null;
    default:
      return null;
  }
}

function addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
  let set = index.get(key);
  if (!set) {
    set = new Set();
    index.set(key, set);
  }
  set.add(value);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
  const set = index.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) index.delete(key);
}

export class Hub {
  // playerId -> open sockets. A player is online while this has an entry.
  private readonly sockets = new Map<string, Set<Connection>>();
  // playerId -> players subscribed to that player's presence.
  private readonly watchers = new Map<string, Set<string>>();
  // playerId -> players whose presence that player subscribed to.
  private readonly watching = new Map<string, Set<string>>();
  // Insertion-ordered FIFO of players waiting for a match.
  private readonly queue = new Map<string, true>();
  private readonly invites = new Map<string, Invite>();
  private readonly matchSize: number;
  private readonly inviteTtlMs: number;

  constructor(opts: HubOptions = {}) {
    this.matchSize = opts.matchSize ?? 2;
    this.inviteTtlMs = opts.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  }

  connect(conn: Connection): void {
    let set = this.sockets.get(conn.playerId);
    if (!set) {
      set = new Set();
      this.sockets.set(conn.playerId, set);
      this.broadcastPresence(conn.playerId, true);
    }
    set.add(conn);
  }

  disconnect(conn: Connection): void {
    const set = this.sockets.get(conn.playerId);
    if (!set || !set.delete(conn) || set.size > 0) return;

    // Last socket for this player is gone.
    this.sockets.delete(conn.playerId);
    this.queue.delete(conn.playerId);
    this.cancelInvites(conn.playerId);
    this.unwatchAll(conn.playerId);
    this.broadcastPresence(conn.playerId, false);
  }

  handle(conn: Connection, msg: ClientMessage): void {
    switch (msg.type) {
      case 'presence.subscribe':
        return this.subscribe(conn, msg.ids);
      case 'presence.unsubscribe':
        return this.unsubscribe(conn, msg.ids);
      case 'matchmaking.join':
        return this.joinQueue(conn);
      case 'matchmaking.leave':
        return this.leaveQueue(conn);
      case 'invite.send':
        return this.invite(conn, msg.to);
      case 'invite.respond':
        return this.respond(conn, msg.inviteId, msg.accept);
    }
  }

  private subscribe(conn: Connection, ids: string[]): void {
    const online: string[] = [];
    for (const id of ids) {
      addToIndex(this.watching, conn.playerId, id);
      addToIndex(this.watchers, id, conn.playerId);
      if (this.sockets.has(id)) online.push(id);
    }
    conn.send({ type: 'presence.snapshot', online });
  }

  private unsubscribe(conn: Connection, ids: string[]): void {
    for (const id of ids) {
      removeFromIndex(this.watching, conn.playerId, id);
      removeFromIndex(this.watchers, id, conn.playerId);
    }
  }

  private unwatchAll(playerId: string): void {
    for (const id of this.watching.get(playerId) ?? []) {
      removeFromIndex(this.watchers, id, playerId);
    }
    this.watching.delete(playerId);
  }

  private broadcastPresence(playerId: string, online: boolean): void {
    const msg: ServerMessage = { type: 'presence.update', playerId, online };
    for (const watcher of this.watchers.get(playerId) ?? []) {
    
…(cut)
```

### src/realtime/socket.ts
```
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Hub, parseClientMessage, type Connection, type ServerMessage } from './hub';

export const REALTIME_PATH = '/realtime';

const MAX_PAYLOAD_BYTES = 4096;
const HEARTBEAT_MS = 30_000;

export interface RealtimeOptions {
  // Returns the player id for a valid token, or null if the token is rejected.
  verifyToken: (token: string) => string | null;
  hub?: Hub;
}

// Attaches the realtime endpoint to an existing HTTP server. Clients connect to
// REALTIME_PATH?token=<token>; the token is checked during the upgrade handshake.
export function attachRealtime(server: Server, opts: RealtimeOptions): Hub {
  const hub = opts.hub ?? new Hub();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on('upgrade', (req, socket: Duplex, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== REALTIME_PATH) {
      socket.destroy();
      return;
    }
    const playerId = opts.verifyToken(url.searchParams.get('token') ?? '');
    if (!playerId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(hub, ws, playerId));
  });

  return hub;
}

function onConnection(hub: Hub, ws: WebSocket, playerId: string): void {
  const conn: Connection = {
    playerId,
    send(msg: ServerMessage) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };

  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  hub.connect(conn);

  ws.on('pong', () => {
    alive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return conn.send({ type: 'error', code: 'binary_not_supported' });
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return conn.send({ type: 'error', code: 'invalid_json' });
    }
    const msg = parseClientMessage(raw);
    if (!msg) return conn.send({ type: 'error', code: 'invalid_message' });
    hub.handle(conn, msg);
  });

  // 'error' is always followed by 'close', which does the cleanup.
  ws.on('error', () => {});

  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.disconnect(conn);
  });
}

```

### src/server.ts
```
import express from 'express';
import jwt from 'jsonwebtoken';
import { accounts } from './accounts';
import { inventory } from './inventory';
import { attachRealtime } from './realtime/socket';

const app = express();
app.use(express.json());
app.use('/accounts', accounts);
app.use('/inventory', inventory);

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET must be set');

// Realtime tokens are assumed to be JWTs signed with JWT_SECRET whose `sub` is the player id.
attachRealtime(app.listen(Number(process.env.PORT ?? 8080)), {
  verifyToken(token) {
    try {
      const payload = jwt.verify(token, jwtSecret);
      return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  },
});

```

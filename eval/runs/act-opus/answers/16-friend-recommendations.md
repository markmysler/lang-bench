## Its final message

I've added the feature in `src/pymk/` with a schema change. I haven't run any of it: dependencies aren't installed, there's no database here, and the repo has no Express app or TypeScript setup to compile against. Check it against a staging copy of your data before relying on it.

**Main design decision: suggestions are computed ahead of time, not when the page loads.** At your scale (about 20 memberships per user), even a two-hop search reaches millions of rows, and three hops reaches most of the graph. No query against the live tables will answer in under 300 ms. So:

- **Reading (`GET /users/:userId/people-you-may-know?limit=20`):** looks up the user's stored suggestions in a new `Suggestion` table. That's a small indexed lookup and should stay well under 300 ms however big the graph gets. Each result has the user, `hops` and `sharedConnections`.
- **Computing (`refreshSuggestions` in `src/pymk/compute.ts`):** one SQL query rebuilds one user's top 100 suggestions. A rebuild starts in the background when a user's suggestions are missing or more than 24 hours old. At most 2 run at once per process, with a 15-second timeout. You can also call it directly, for example after someone joins a team.
- It all stays in Postgres and Prisma, so there's no graph database or other new service to run.

**Ranking rules I chose:**
- People who already share a team with the user are never suggested.
- Two hops away (friend of a friend): scored by the number of mutual connections.
- Three hops away: scored by the number of two-hop people leading to them.
- Two-hop people always rank above three-hop people, so the query only searches three hops out when two hops gives fewer than 100 results.

**Limits that keep each rebuild affordable, so scores are approximate:**
- **Big teams are skipped:** teams with more than 500 members are left out of the search, because an all-company team would make everyone a "friend" of everyone.
- **Fan-out cap:** at each hop, only the 200 strongest connections are followed. So mutual-connection counts only include those 200 people.

Both numbers are constants at the top of `compute.ts`. Tune them against real data.

**Things you should know:**
- **The first request returns nothing:** it comes back with `pending: true` and an empty list while the rebuild runs. Suggestions can also be up to a day out of date.
- **No full nightly refresh:** a rebuild probably takes hundreds of milliseconds to a few seconds per user. Doing all 2 million every night isn't realistic, so only users who actually load the feature are kept fresh.
- **No access control:** there's no auth in the repo, so anyone can read any user's suggestions. Add a check that the caller is that user.

**What's left for you:**
1. Run `npx prisma migrate dev --name pymk`. It adds a nullable `User.pymkComputedAt` column and the `Suggestion` table.
2. Mount the endpoint in your app with `app.use(pymkRouter(prisma))`.
3. Optionally, replace the `Membership(teamId)` index with `(teamId, userId)`. Rebuilds could then read memberships from the index alone. On 40M rows, build it with `CREATE INDEX CONCURRENTLY`.

## Files it changed

M  prisma/schema.prisma
A  src/pymk/compute.ts
A  src/pymk/index.ts

### prisma/schema.prisma
```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id             String       @id @default(cuid())
  name           String
  memberships    Membership[]
  /// When `suggestions` was last recomputed; null means never.
  pymkComputedAt DateTime?
  suggestions    Suggestion[] @relation("SuggestionsFor")
  suggestedTo    Suggestion[] @relation("SuggestedUser")
}

model Team {
  id          String       @id @default(cuid())
  name        String
  memberships Membership[]
}

/// Users belong to teams and projects; two users are connected when they share one.
model Membership {
  userId String
  teamId String
  user   User   @relation(fields: [userId], references: [id])
  team   Team   @relation(fields: [teamId], references: [id])

  @@id([userId, teamId])
  @@index([teamId])
}

/// Precomputed "people you may know" results (see src/pymk). Rebuilt per user, never edited in place.
model Suggestion {
  userId          String
  suggestedUserId String
  /// 2 = friend of a friend, 3 = one step further.
  hops            Int
  /// Number of distinct connections linking the two users at that distance.
  score           Int
  user            User   @relation("SuggestionsFor", fields: [userId], references: [id], onDelete: Cascade)
  suggestedUser   User   @relation("SuggestedUser", fields: [suggestedUserId], references: [id], onDelete: Cascade)

  @@id([userId, suggestedUserId])
  @@index([suggestedUserId])
}

```

### src/pymk/compute.ts
```
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Teams larger than this are ignored when walking the graph. An all-company
 * team "connects" everyone and would make every query touch the whole table.
 * Members of big teams are still excluded from a user's own suggestions.
 */
export const MAX_TEAM_SIZE = 500;

/** How many of the strongest ties are expanded at each hop. */
export const FANOUT = 200;

/** How many suggestions are stored per user. */
export const KEEP = 100;

const COMPUTE_TIMEOUT = "15s";

/**
 * True when the team has at most MAX_TEAM_SIZE members. Stops counting at
 * MAX_TEAM_SIZE + 1 so a huge team costs no more than a small one.
 */
const isSmallTeam = (teamId: Prisma.Sql) => Prisma.sql`
  (SELECT count(*) FROM (
     SELECT 1 FROM "Membership" s WHERE s."teamId" = ${teamId} LIMIT ${MAX_TEAM_SIZE + 1}
   ) bounded) <= ${MAX_TEAM_SIZE}`;

/**
 * Rebuilds the stored suggestions for one user.
 *
 * Two users are directly connected when they share a team; those people are
 * never suggested. Candidates two hops away are scored by mutual connections,
 * three hops away by the number of distinct two-hop people leading to them.
 * Closer people always rank first, so hop 3 is only walked when hop 2 can't
 * fill the list.
 *
 * Too slow for the request path (hundreds of thousands of rows per user), so
 * results are stored in "Suggestion" and served from there.
 */
export async function refreshSuggestions(prisma: PrismaClient, userId: string): Promise<void> {
  const t = Prisma.raw('t."teamId"');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${COMPUTE_TIMEOUT}'`);
    await tx.$executeRaw`DELETE FROM "Suggestion" WHERE "userId" = ${userId}`;
    await tx.$executeRaw`
      WITH
      my_teams AS (
        SELECT "teamId" FROM "Membership" WHERE "userId" = ${userId}
      ),
      -- Everyone already sharing a team with the user, including the user.
      direct AS (
        SELECT DISTINCT m."userId"
        FROM my_teams t JOIN "Membership" m ON m."teamId" = t."teamId"
      ),
      my_small_teams AS (
        SELECT "teamId" FROM my_teams t WHERE ${isSmallTeam(t)}
      ),
      hop1 AS (
        SELECT m."userId", count(*) AS shared
        FROM my_small_teams t JOIN "Membership" m ON m."teamId" = t."teamId"
        WHERE m."userId" <> ${userId}
        GROUP BY m."userId"
        ORDER BY shared DESC
        LIMIT ${FANOUT}
      ),
      hop1_small_teams AS (
        SELECT "teamId" FROM (
          SELECT DISTINCT m."teamId" FROM hop1 h JOIN "Membership" m ON m."userId" = h."userId"
        ) t
        WHERE ${isSmallTeam(t)}
      ),
      hop2 AS (
        SELECT m2."userId", count(DISTINCT m1."userId") AS score
        FROM hop1 h
        JOIN "Membership" m1 ON m1."userId" = h."userId"
        JOIN hop1_small_teams st ON st."teamId" = m1."teamId"
        JOIN "Membership" m2 ON m2."teamId" = m1."teamId"
        WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d."userId" = m2."userId")
        GROUP BY m2."userId"
      ),
      -- Empty (and hop 3 skipped) when hop 2 already fills the list.
      hop2_seed AS (
        SELECT "userId" FROM hop2
        WHERE (SELECT count(*) FROM hop2) < ${KEEP}
        ORDER BY score DESC
        LIMIT ${FANOUT}
      ),
      hop2_small_teams AS (
        SELECT "teamId" FROM (
          SELECT DISTINCT m."teamId" FROM hop2_seed h JOIN "Membership" m ON m."userId" = h."userId"
        ) t
        WHERE ${isSmallTeam(t)}
      ),
      hop3 AS (
        SELECT m2."userId", count(DISTINCT m1."userId") AS score
        FROM hop2_seed h
        JOIN "Membership" m1 ON m1."userId" = h."userId"
        JOIN hop2_small_teams st ON st."teamId" = m1."teamId"
        JOIN "Membership" m2 ON m2."teamId" = m1."teamId"
        WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d."userId" = m2."userId")
          AND NOT EXISTS (SELECT 1 FROM hop2 x WHERE x."userId" = m2."userId")
        GROUP BY m2."userId"
      )
      INSERT INTO "Suggestion" ("userId", "suggestedUserId", "hops", "score")
      SELECT ${userId}, c."userId", c.hops, c.score
      FROM (
        SELECT "userId", 2 AS hops, score FROM hop2
        UNION ALL
        SELECT "userId", 3 AS hops, score FROM hop3
      ) c
      ORDER BY c.hops, c.score DESC
      LIMIT ${KEEP}`;
    await tx.user.update({ where: { id: userId }, data: { pymkComputedAt: new Date() } });
  }, { timeout: 20_000 }); // Prisma's 5 s default would cut off before the statement timeout
}

```

### src/pymk/index.ts
```
import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { refreshSuggestions } from "./compute";

export { refreshSuggestions };

/** Stored suggestions older than this are rebuilt in the background on the next read. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Cap on rebuilds running at once from this process, to protect the database. */
const MAX_CONCURRENT_REFRESHES = 2;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const refreshing = new Set<string>();

/**
 * Starts a background rebuild unless one is already running for this user or
 * the process is at capacity. A skipped rebuild is retried on the next read.
 */
function scheduleRefresh(prisma: PrismaClient, userId: string): void {
  if (refreshing.has(userId) || refreshing.size >= MAX_CONCURRENT_REFRESHES) return;
  refreshing.add(userId);
  refreshSuggestions(prisma, userId)
    .catch((err) => console.error(`pymk: refresh failed for user ${userId}`, err))
    .finally(() => refreshing.delete(userId));
}

/**
 * Reads stored suggestions only (a single indexed lookup), so it stays fast
 * however large the graph is. Missing or stale results are rebuilt in the
 * background; until the first rebuild finishes `pending` is true.
 */
export async function getPeopleYouMayKnow(prisma: PrismaClient, userId: string, limit = DEFAULT_LIMIT) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      pymkComputedAt: true,
      suggestions: {
        orderBy: [{ hops: "asc" }, { score: "desc" }],
        take: limit,
        select: { hops: true, score: true, suggestedUser: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) return null;

  const computedAt = user.pymkComputedAt;
  if (!computedAt || Date.now() - computedAt.getTime() > STALE_AFTER_MS) {
    scheduleRefresh(prisma, userId);
  }

  return {
    pending: computedAt === null,
    computedAt,
    suggestions: user.suggestions.map((s) => ({
      user: s.suggestedUser,
      hops: s.hops,
      sharedConnections: s.score,
    })),
  };
}

export function pymkRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/users/:userId/people-you-may-know", async (req, res, next) => {
    try {
      const requested = Number(req.query.limit ?? DEFAULT_LIMIT);
      const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;

      const result = await getPeopleYouMayKnow(prisma, req.params.userId, limit);
      if (!result) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

```

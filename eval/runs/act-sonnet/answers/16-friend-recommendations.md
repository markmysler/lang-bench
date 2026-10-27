## Its final message

I've added people-you-may-know, but I haven't run any of it. There was no database or `npm install` here, so nothing has been type-checked, the Prisma migration hasn't been generated, and the 300 ms target hasn't been measured.

**Approach.** A live 3-hop query over 40M memberships can't meet 300 ms. Suggestions are computed by a batch job and stored in a table. The endpoint then reads that table, which is one indexed lookup plus fetching the suggested users.

**Changes**
- `prisma/schema.prisma`:
  - New `PymkSuggestion` model with top suggestions per user, indexed on `(userId, rank)`.
  - New `Team.size` column.
- `src/pymk/compute.ts`:
  - `computeForUser` walks user → team → user for up to three hops. It leaves out the user and their direct connections, and keeps the top 50 by number of shared connections.
  - `computeAll` is the full rebuild. `npm run pymk:compute` runs it.
- `src/pymk/routes.ts` serves `GET /users/:id/people-you-may-know?limit=` (maximum 50). You still need to mount it with `app.use(pymkRouter(prisma))`, because the repo has no Express entry point yet.
- `package.json` has the new script and dev dependencies (`ts-node`, `typescript`, `@types/express`). There's no `tsconfig.json` yet.

**Assumptions to confirm**
- **Shared connections:** the score is how many people within two hops of the user are directly connected to the candidate. That is the only version of the metric that also works for people three hops away.
- **Large teams:** teams with more than 500 members are not expanded past the first hop, so one huge team can't pull in most of the user base. That cap is the `MAX_EXPANDED_TEAM_SIZE` constant. It means some real three-hop paths are skipped.
- **Freshness:** suggestions are only as fresh as the last batch run. I'd schedule it nightly.
- **Projects:** the schema only has teams, so "shared teams and projects" is covered for teams only.

**Before shipping**
- Run the job against production-sized data. Per-user cost depends on team sizes, and 2M users at 8-way concurrency may need a tighter cap or more workers.
- Generate the migration (`prisma migrate dev`).

## Files it changed

M  package.json
M  prisma/schema.prisma
A  src/pymk/compute.ts
A  src/pymk/routes.ts

### package.json
```
{
  "name": "@acme/api",
  "private": true,
  "scripts": { "pymk:compute": "ts-node src/pymk/compute.ts" },
  "dependencies": { "@prisma/client": "^5.22.0", "express": "^4.21.1" },
  "devDependencies": { "prisma": "^5.22.0", "ts-node": "^10.9.2", "typescript": "^5.6.3", "@types/express": "^4.17.21" }
}

```

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
  id          String       @id @default(cuid())
  name        String
  memberships Membership[]
}

model Team {
  id          String       @id @default(cuid())
  name        String
  /// Denormalised member count, refreshed by the PYMK batch job; used to skip huge teams when expanding hops.
  size        Int          @default(0)
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

/// Precomputed "people you may know": top suggestions per user, rebuilt by src/pymk/compute.ts.
model PymkSuggestion {
  userId      String
  suggestedId String
  /// Distinct people within 2 hops of userId who are directly connected to suggestedId.
  mutual      Int
  hops        Int
  rank        Int

  @@id([userId, suggestedId])
  @@index([userId, rank])
}

```

### src/pymk/compute.ts
```
import { Prisma, PrismaClient } from "@prisma/client";

// Teams larger than this are not expanded past the first hop; otherwise one
// huge team pulls in most of the user base and 3-hop expansion explodes.
const MAX_EXPANDED_TEAM_SIZE = 500;
const SUGGESTIONS_PER_USER = 50;

/**
 * Rebuilds suggestions for one user. Hops go user -> team -> user:
 *   n1 = co-members of the user's teams (hop 1, already connected, excluded)
 *   n2 = co-members of n1's teams (hop 2)
 *   n3 = co-members of n2's teams (hop 3)
 * Candidates are n2 and n3. Ranked by `mutual`: how many people within two hops
 * of the user (n1 and n2) are directly connected to the candidate.
 */
export async function computeForUser(db: PrismaClient, userId: string): Promise<void> {
  const rows = await db.$queryRaw<{ id: string; mutual: number; hops: number }[]>(Prisma.sql`
    WITH n1 AS (
      SELECT DISTINCT m2."userId" AS id
      FROM "Membership" m1 JOIN "Membership" m2 ON m2."teamId" = m1."teamId"
      WHERE m1."userId" = ${userId} AND m2."userId" <> ${userId}
    ),
    n2 AS (
      SELECT DISTINCT m2."userId" AS id
      FROM n1
      JOIN "Membership" m1 ON m1."userId" = n1.id
      JOIN "Team" t ON t.id = m1."teamId" AND t.size <= ${MAX_EXPANDED_TEAM_SIZE}
      JOIN "Membership" m2 ON m2."teamId" = m1."teamId"
      WHERE m2."userId" <> ${userId} AND m2."userId" NOT IN (SELECT id FROM n1)
    ),
    near AS (SELECT id FROM n1 UNION SELECT id FROM n2),
    n3 AS (
      SELECT DISTINCT m2."userId" AS id
      FROM n2
      JOIN "Membership" m1 ON m1."userId" = n2.id
      JOIN "Team" t ON t.id = m1."teamId" AND t.size <= ${MAX_EXPANDED_TEAM_SIZE}
      JOIN "Membership" m2 ON m2."teamId" = m1."teamId"
      WHERE m2."userId" <> ${userId} AND m2."userId" NOT IN (SELECT id FROM near)
    ),
    cand AS (
      SELECT id, 2 AS hops FROM n2
      UNION ALL SELECT id, 3 FROM n3
    )
    SELECT c.id, c.hops, count(DISTINCT p."userId")::int AS mutual
    FROM cand c
    JOIN "Membership" mc ON mc."userId" = c.id
    JOIN "Team" t ON t.id = mc."teamId" AND t.size <= ${MAX_EXPANDED_TEAM_SIZE}
    JOIN "Membership" p ON p."teamId" = mc."teamId" AND p."userId" IN (SELECT id FROM near)
    GROUP BY c.id, c.hops
    ORDER BY mutual DESC, c.hops ASC, c.id
    LIMIT ${SUGGESTIONS_PER_USER}
  `);

  await db.$transaction([
    db.pymkSuggestion.deleteMany({ where: { userId } }),
    db.pymkSuggestion.createMany({
      data: rows.map((r, i) => ({
        userId,
        suggestedId: r.id,
        mutual: r.mutual,
        hops: r.hops,
        rank: i + 1,
      })),
    }),
  ]);
}

/** Full rebuild, meant to run nightly (e.g. a Fly.io scheduled machine). */
export async function computeAll(db: PrismaClient, concurrency = 8): Promise<void> {
  await db.$executeRaw`
    UPDATE "Team" t SET size = s.n
    FROM (SELECT "teamId", count(*)::int AS n FROM "Membership" GROUP BY "teamId") s
    WHERE t.id = s."teamId"`;

  let cursor: string | undefined;
  for (;;) {
    const users = await db.user.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) return;
    cursor = users[users.length - 1].id;

    const queue = users.map((u) => u.id);
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (let id = queue.pop(); id; id = queue.pop()) await computeForUser(db, id);
      }),
    );
  }
}

if (require.main === module) {
  const db = new PrismaClient();
  computeAll(db)
    .then(() => db.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

```

### src/pymk/routes.ts
```
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

export function pymkRouter(db: PrismaClient): Router {
  const router = Router();

  // Served from the precomputed table: one indexed range scan plus a PK lookup.
  router.get("/users/:id/people-you-may-know", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await db.pymkSuggestion.findMany({
      where: { userId: req.params.id },
      orderBy: { rank: "asc" },
      take: limit,
    });
    const users = await db.user.findMany({
      where: { id: { in: rows.map((r) => r.suggestedId) } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json(
      rows.flatMap((r) => {
        const user = byId.get(r.suggestedId);
        return user ? [{ ...user, mutualConnections: r.mutual, hops: r.hops }] : [];
      }),
    );
  });

  return router;
}

```

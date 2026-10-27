## Its final message

I added the people-you-may-know feature in a new file, `src/people-you-may-know.ts`. Nothing has been run or type-checked: the repo has no `src/`, `tsconfig`, `node_modules`, or test setup, and starting a Postgres container for a test needed approval, which I didn't get.

**What's in it**
- `suggestPeople(prisma, userId, limit)` runs raw SQL against the existing `Membership` and `User` tables. It only uses the primary key `(userId, teamId)` and the `teamId` index, so no migration is needed.
- Friends of friends come first, ranked by the number of distinct direct connections they share with the viewer. Three-hop people only fill slots left over after the two-hop query. The query is skipped when two-hop already fills the limit.
- `peopleYouMayKnowRouter(prisma)` exposes `GET /users/:id/people-you-may-know?limit=10`. The limit defaults to 10 and is capped at 50. It returns `{ people: [{ id, name, hops, sharedConnections }] }`.

**Interpretation choices to check**
- "Connected" means sharing a team, as in the Prisma schema comment.
- For three-hop candidates, `sharedConnections` counts distinct second-hop users linking them, not first-hop ones. Otherwise every three-hop candidate would score zero.

**Open risks**
- **The 300 ms target is unverified.** A large team makes the two-hop join grow with the square of its size. With 2M users and 40M memberships, that could be too slow. Benchmark against realistic data before shipping, and consider capping team size or precomputing the projection if it misses.
- **No auth.** The repo has no authentication layer, so the endpoint takes the user ID from the path and anyone can query any user. Put it behind your auth, or read the viewer from the session.
- **Not mounted.** There's no Express app entry point in the repo, so you need to add something like `app.use(peopleYouMayKnowRouter(prisma))`.

I haven't committed anything.

## Files it changed

A  src/people-you-may-know.ts

### src/people-you-may-know.ts
```
import { Prisma, PrismaClient } from "@prisma/client";
import { Router } from "express";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export interface PersonSuggestion {
  id: string;
  name: string;
  /** 2 for friends of friends, 3 for friends of friends of friends. */
  hops: number;
  /** Distinct users one hop closer to the viewer who are connected to this person. */
  sharedConnections: number;
}

/** Direct connections: users who share at least one team with the viewer. */
const friends = (userId: string) => Prisma.sql`
  SELECT DISTINCT m."userId" AS id
  FROM "Membership" m
  JOIN "Membership" mine ON mine."teamId" = m."teamId"
  WHERE mine."userId" = ${userId} AND m."userId" <> ${userId}
`;

/** Friends of friends, ranked by how many of the viewer's friends they share a team with. */
const twoHopQuery = (userId: string, limit: number) => Prisma.sql`
  WITH friends AS (${friends(userId)}),
  candidates AS (
    SELECT cm."userId" AS id, COUNT(DISTINCT f.id)::int AS "sharedConnections"
    FROM friends f
    JOIN "Membership" fm ON fm."userId" = f.id
    JOIN "Membership" cm ON cm."teamId" = fm."teamId"
    WHERE cm."userId" <> ${userId}
      AND NOT EXISTS (SELECT 1 FROM friends x WHERE x.id = cm."userId")
    GROUP BY cm."userId"
  )
  SELECT c.id, u.name, 2 AS hops, c."sharedConnections"
  FROM candidates c
  JOIN "User" u ON u.id = c.id
  ORDER BY c."sharedConnections" DESC, c.id
  LIMIT ${limit}
`;

/** Friends of friends of friends, used only when there are not enough closer candidates. */
const threeHopQuery = (userId: string, limit: number) => Prisma.sql`
  WITH friends AS (${friends(userId)}),
  second AS (
    SELECT DISTINCT cm."userId" AS id
    FROM friends f
    JOIN "Membership" fm ON fm."userId" = f.id
    JOIN "Membership" cm ON cm."teamId" = fm."teamId"
    WHERE cm."userId" <> ${userId}
      AND NOT EXISTS (SELECT 1 FROM friends x WHERE x.id = cm."userId")
  ),
  candidates AS (
    SELECT cm."userId" AS id, COUNT(DISTINCT s.id)::int AS "sharedConnections"
    FROM second s
    JOIN "Membership" sm ON sm."userId" = s.id
    JOIN "Membership" cm ON cm."teamId" = sm."teamId"
    WHERE cm."userId" <> ${userId}
      AND NOT EXISTS (SELECT 1 FROM friends x WHERE x.id = cm."userId")
      AND NOT EXISTS (SELECT 1 FROM second y WHERE y.id = cm."userId")
    GROUP BY cm."userId"
  )
  SELECT c.id, u.name, 3 AS hops, c."sharedConnections"
  FROM candidates c
  JOIN "User" u ON u.id = c.id
  ORDER BY c."sharedConnections" DESC, c.id
  LIMIT ${limit}
`;

/**
 * Suggests people up to three hops away through shared teams. Friends of friends
 * always come first; three-hop people only fill the remaining slots.
 */
export async function suggestPeople(
  prisma: PrismaClient,
  userId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<PersonSuggestion[]> {
  const twoHop = await prisma.$queryRaw<PersonSuggestion[]>(twoHopQuery(userId, limit));
  if (twoHop.length >= limit) return twoHop;

  const threeHop = await prisma.$queryRaw<PersonSuggestion[]>(
    threeHopQuery(userId, limit - twoHop.length),
  );
  return [...twoHop, ...threeHop];
}

/** GET /users/:id/people-you-may-know?limit=10 */
export function peopleYouMayKnowRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/users/:id/people-you-may-know", async (req, res, next) => {
    const requested = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isNaN(requested)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(requested, 1), MAX_LIMIT);

    try {
      res.json({ people: await suggestPeople(prisma, req.params.id, limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

```

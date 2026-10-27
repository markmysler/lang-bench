# Acme Collab

Monorepo for Acme Collab, a project tool for small agencies.

- `apps/web`: Next.js front end, deployed on Vercel.
- `apps/api`: the API, Express + Prisma on Postgres (managed), deployed on Fly.io in containers.
- `packages/shared`: types shared by both.

Four developers, all TypeScript. Redis (Upstash) is used for queues with BullMQ.

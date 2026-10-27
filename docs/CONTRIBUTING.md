# Contributing

## Test first

Every change starts with a test that fails for the right reason, then the least code that makes
it pass.

- **Orchestrator** (Go, `orchestrator/`): unit tests beside the code. The runner is tested
  against a fake Docker engine; the Docker client against recorded API responses.
- **Dashboard** (`web/`): Vitest and Testing Library beside the code. Playwright (`web/e2e/`)
  runs every journey at desktop size and on a Pixel 7, against a recorded run, with axe in both
  themes.
- **Servers**: `langbench conform` holds each one to [SPEC.md](SPEC.md). CI runs it for every
  server.

Before pushing:

```sh
scripts/go.sh vet ./... && scripts/go.sh test -race ./...
cd web && npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e
```

`scripts/go.sh` runs Go in Docker if you don't have it installed.

## Adding a server

1. Create `servers/<language>-<framework>/` with a `Dockerfile`, `server.json`, `README.md` and
   the code. Follow [SPEC.md](SPEC.md) exactly, and copy the shape of an existing server.
2. The final image runs on Debian 13 (trixie). Pin the base image tag and every dependency with
   a lock file.
3. Tune it for production with the cores in `CPUS`, and say how in its README and in `tuning`
   in `server.json`. When a choice could favour or penalise the server, write down why.
4. Images are built through the Docker Engine API's classic builder: no `RUN --mount` and no
   heredocs in the Dockerfile.
5. Build and check it:

   ```sh
   scripts/langbench.sh build postgres <id>
   scripts/langbench.sh conform <id>
   ```

6. Run it at the smallest preset (1 CPU, 512 MB) under every workload and make sure it isn't
   killed for running out of memory.

## Design for both sizes

Phones and desktops are both first-class, in light and dark themes. Design any interface change
for both before writing it. Each server keeps its colour and text badge on every chart of a run;
charts never use more than the eight palette colours, and switch to small multiples beyond that.

## Publishing results

Results land in `results/`, which git ignores. To show a run on the published site, copy it into
`published/` and commit it (see [published/README.md](../published/README.md)).

## Commits

Small commits that each leave the tests green. Write the message as what the change does, with
the reason in the body.

# Architecture

lang-bench is one Go program, the orchestrator, with the dashboard built into it. It runs in a
container and drives Docker through its socket, starting everything else as sibling containers on
the `langbench` network.

```
 Browser (web/)                 Orchestrator (orchestrator/)               Docker
 ──────────────                 ────────────────────────────               ──────
 SettingsPanel ─ POST /api/plan ─► runner.Preview ─► plan.Make
               ─ POST /api/runs ─► runner.Run ──────────────────────────► lb-postgres   (pinned cores)
 LiveView ◄─ SSE /api/runs/current/events ◄─ events                       lb-<server>   (pinned cores)
                                                 ▲                        lb-load-<id>  (pinned cores)
                                                 ├─ docker stats stream ◄─┘  oha, 1 s slices
                                                 └─ load generator logs ◄────┘  one JSON line each
 ResultsPage ◄─ GET /api/runs/{id} ◄─ store (results/<id>.json)
```

## A run

1. **Plan** (`internal/plan`). From the host's CPUs and memory and the share the user allows,
   decide how many servers fit at once. Each needs its preset's cores and memory plus its own
   load generator's; Postgres gets two cores of its own when a database workload is chosen. Core
   0 is left to the system on hosts with four or more. Servers that don't fit wait for later
   batches. The plan's mode, simultaneous, batched or sequential, is recorded with every result.
2. **Images.** Every image the run needs must exist before anything starts.
3. **Batches** (`internal/runner`). For each batch: start the servers with `--cpuset-cpus`,
   `--cpus` and a memory limit with no swap; time them until `/health` answers; stream
   `docker stats` for each; wait for them to settle and record idle memory.
4. **Workloads.** For each workload, start one load generator per server on its own cores. It
   runs oha in one-second slices and prints each slice's JSON on one line
   (`loadgen/slices.sh`). Each line becomes a live event and a point on the charts. Warm-up
   slices are shown but not counted. CPU and memory samples taken while measured slices run are
   averaged per workload.
5. **Result.** Slices are merged (`internal/oha`): throughput and counts exactly, percentiles
   from the mixture of the slices' distributions. The result, with host, settings, plan and image
   ids, is saved to `results/<id>.json`. All containers are removed, also on cancel.

## Events

The runner reports a run as a stream of events (`internal/runner/result.go`): `plan`, `status`,
`ready`, `stats`, `slice`, `workload`, `log`, `error` and `done`. The API keeps every event of
the current run, so a page opened mid-run replays them and then follows live over Server-Sent
Events. The dashboard folds them into its view with one reducer (`web/src/run/liveState.ts`).

## Two builds of the dashboard

`npm run build` is the dashboard served by the orchestrator. `npm run build:static` is a
read-only viewer for GitHub Pages: no Run controls, and runs come from `published/` instead of
the API.

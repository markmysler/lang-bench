# Design: lang-bench as a decision tool for coding agents

Status: proposed, for review. Nothing here is built yet; [ARCHITECTURE.md](ARCHITECTURE.md)
describes what exists today.

## Why

Coding agents pick the stack they know best, or the one most common in their training data. Often
that is right: the team knows it, the libraries exist, the code base already uses it. Sometimes it
is wrong in ways that are expensive later: a sync Python server for a service that mostly waits on
other services, a JVM for a function that cold-starts on every request, a stack that won't fit
in the memory it will be given.

lang-bench already measures what those mistakes cost, in identical containers, with results that
record how to reproduce them. This design turns it into a tool an agent consults, and extends,
when a technology choice is actually open.

## Commitments

1. **Trade-offs and disqualifiers, never a winner.** The tool says which options fall over under
   this project's constraints and why, with the evidence. It does not rank stacks or name the
   best one.
2. **Performance is one criterion of several.** The team's existing skills and code, the
   ecosystem, the deployment target and how reliably agents write the stack all count, and
   usually count more.
3. **Proven by evaluation.** The tool is worth shipping only if agents that use it make better
   choices than agents that don't, on scenarios judged by people. That is measured before the
   tool grows, and again after each phase.

And one scoping decision:

4. **Local first.** Each user's copy is self-contained. Their agent adds the technologies,
   databases and tasks it needs, and the results stay on their machine. A shared dataset with
   upstream contributions is out of scope until the local tool has proven itself.

## Non-goals

- Covering every language and framework. Coverage follows demand: an agent adds what its user is
  deciding between.
- A public leaderboard. The published viewer stays, but is not the product.
- Recommending against a team's existing stack without a constraint that rules it out. Staying
  put is often the right answer, and the evaluation checks that the tool gives it.

## How it is used

**An agent consults it.** A skill tells the agent when to: a new service or project, a rewrite,
or a requirement about throughput, latency, memory, start-up time or cost. The agent describes
the workload and constraints through the MCP server and gets back, per candidate: disqualifiers,
trade-offs with numbers, how sure the evidence is, and what is missing. The agent weighs that with
what it knows about the team and the code base, and explains its choice to the user.

**An agent extends it.** When a candidate isn't covered (a stack, a database, a kind of work),
the agent follows a guide to add it, proves it with `langbench validate`, and runs the
comparison it needs. The guides are written as a skill whose every step ends with a command that
proves the step worked.

**A person audits it.** The dashboard shows every number an agent relied on: the run, its
settings, the machine, the implementation and where it came from.

## Architecture

```
 Coding agent
   │  skill: when to consult, how to read answers, how to extend
   ▼
 MCP server (langbench mcp) ──► query layer ──► local dataset (results/, reference/)
   │                                 ▲
   │ run_shortlist                   │ results with provenance and reference ratios
   ▼                                 │
 orchestrator (today's runner) ──────┘
   │
   ▼
 components: servers/  databases/  tasks/  facts/
   ▲
   │ langbench add / validate
 Coding agent following the guides
```

Today's orchestrator, conformance checks, fair placement and result format stay. New pieces are
the MCP server and skill, the query layer, declarative tasks, database components,
`langbench validate`, provenance, reference servers in every run, ecosystem facts and the
proficiency harness.

### Components

Everything that can be added is a folder with a manifest, so an agent adds one by adding a folder.

**Servers** (`servers/<id>/`, as today). The manifest gains what the server implements:

```json
{
  "id": "go-gin",
  "...": "existing fields",
  "implements": {
    "core": true,
    "tasks": { "crud": ["postgres"], "large-json": [] }
  },
  "provenance": "reference"
}
```

A server need not implement every task, or every task on every database. The matrix is sparse on
purpose: an agent fills only the cells it needs.

**Databases** (`databases/<id>/`, generalising today's `db/`). An image, seed data that is
identical on every machine, a health check, and the resources it gets:

```json
{
  "id": "postgres",
  "engine": "PostgreSQL 18",
  "kind": "relational",
  "env": { "host": "lb-postgres", "port": 5432, "user": "bench", "password": "bench", "name": "bench" },
  "cpus": 2,
  "memoryMB": 1024
}
```

Servers receive the database's connection settings as today's `DB_*` variables, plus `DB_KIND`.

**Tasks** (`tasks/<id>.json`). Today the six endpoints are hard-coded in Go and checked by Go
code. Declarative tasks let an agent add a kind of work without changing the orchestrator:

```json
{
  "id": "crud",
  "description": "Read, update and list rows, as a typical JSON API does",
  "reveals": "ORM and driver overhead, transactions, pool behaviour under writes",
  "needs": { "database": "relational" },
  "endpoints": [
    { "method": "GET", "path": "/crud/items/{id}" },
    { "method": "PUT", "path": "/crud/items/{id}", "body": "item.json" }
  ],
  "conformance": [
    {
      "request": { "method": "GET", "path": "/crud/items/42" },
      "expect": { "status": 200, "contentType": "application/json", "schema": "item.schema.json" }
    }
  ],
  "load": [{ "name": "read-mostly", "mix": { "GET": 9, "PUT": 1 }, "connections": 64 }]
}
```

Conformance becomes an interpreter of these test cases: status, media type, JSON schema, exact
body, field ranges, "differs across requests" (for randomness) and "not before N ms" (for waits).
The six current endpoints are rewritten as the first task, `core`, and must pass exactly as they
do now before anything else changes. Load mixes need the load generator to send more than one
request shape, which oha does not do on its own; see open questions.

A task earns its place by what it reveals that changes decisions. Candidates, in rough order:

| Task              | What it reveals                                                      |
| ----------------- | -------------------------------------------------------------------- |
| `core` (existing) | Framework overhead, raw compute, concurrency model, driver basics    |
| `crud`            | ORM and driver cost on writes and transactions                       |
| `large-json`      | Parsing and serialising big payloads; allocation and GC pressure     |
| `upstream-fanout` | Calling several slow HTTP services per request (the real I/O case)   |
| `sustained`       | Memory growth and GC pauses over minutes rather than seconds         |
| `crypto`          | Password hashing and signing: CPU-heavy work in real request paths   |

**Facts** (`facts/<id>.json`). Things that matter to a choice but aren't measured by running
servers: maturity, release pace, library coverage for common needs (auth, payments, queues,
background jobs, ORMs), hosting support. Every fact has a source and a date, and the query layer
marks a fact as stale after a set age, so the tool never repeats an old answer with confidence:

```json
{
  "subject": "elixir-phoenix",
  "facts": [
    {
      "claim": "Official Stripe SDK",
      "value": false,
      "source": "https://docs.stripe.com/sdks",
      "retrieved": "2026-10-27"
    }
  ]
}
```

### Provenance

Every implementation, and every result made with it, says where it came from:

| Level       | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `reference` | Reviewed by a person and kept in this repository                     |
| `validated` | Added by an agent; passes `langbench validate`; not reviewed         |
| `draft`     | Added by an agent; not yet validated. Never used in answers          |

Answers say which level each piece of evidence has. An answer that rests on `validated`
implementations says so, so the agent and the person can weigh it.

### `langbench validate`

Conformance proves a server answers correctly. It doesn't prove the server is a fair example of
its stack: an agent can pass every check with a pool of one connection, debug mode on, logging
every request, or a cache nobody would use in production. `validate` runs conformance and then
checks fairness under load, at the smallest preset:

- Conformance passes for every task and database the manifest claims.
- The server uses its cores: CPU near 100% × `CPUS` on the CPU workload.
- The pool opens up to `DB_POOL` connections under load, counted in the database.
- No per-request logging: output under load stays below a small limit.
- Database answers aren't cached: random rows really vary, and queries reach the database.
- Waits really wait.
- It is not killed for memory at 1 CPU / 512 MB.
- Base images are pinned to dated tags or digests, and dependencies by a lock file.
- The README states the tuning and the server.json fields are complete.

A server that passes becomes `validated`. Each failure says what to fix.

### Comparing across machines

A result from a laptop can't be compared with one made on another machine. So every run also
measures a small fixed set of reference servers (go-gin, node-express, python-fastapi) on the
same workloads. Results are stored as absolute numbers and as ratios to the references from the
same run. The ratios make a user's own additions roughly comparable with the reference dataset;
the absolute numbers stay for anything machine-specific. The tool says when it compares across
machines, and treats those comparisons as less certain.

Reference servers add a few minutes to each run, so `run_shortlist` runs them only on the
workloads in question.

### The local dataset

- `results/`: the user's own runs, as today, now with provenance and reference ratios.
- `reference/`: runs made by the maintainers on known hardware, kept in the repository, so a new
  user has data before running anything.
- `facts/`: ecosystem facts.

The query layer reads all three, and every answer cites the runs it used.

### Agent proficiency

How reliably agents write working, fair servers in a stack is a real input to the choice, and
one nobody else measures. The harness gives an agent the task spec and a stack, lets it build the
server in a clean folder, and records:

- whether conformance passes, and after how many attempts;
- whether `validate` passes;
- time and tokens spent;
- the agent and model.

Runs are expensive and depend on the agent, so they happen on demand and are stored as facts with
their date and agent, not as fixed truth.

### MCP server

`langbench mcp` serves the Model Context Protocol over stdio, and the dashboard serves it over
HTTP at `/mcp` while it runs. Tools:

| Tool                 | Does                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `describe_coverage`  | Lists the stacks, databases and tasks with data, and their provenance          |
| `assess`             | Takes a workload profile, constraints and candidates; returns per candidate the disqualifiers, trade-offs with numbers, confidence and gaps |
| `explain`            | Explains one trade-off (say, why gunicorn sync collapses on I/O) with the runs behind it |
| `run_shortlist`      | Runs a few candidates on the workloads that matter, with reference servers; long-running, reports progress |
| `add_guide`          | Returns the guide for adding a server, database or task, for agents without the skill |

A workload profile is plain and small, for example:

```json
{
  "shape": "io-heavy",
  "requests": { "peakPerSecond": 2000, "p99BudgetMs": 200 },
  "resources": { "memoryMB": 256, "cpus": 1, "coldStarts": true },
  "database": "postgres",
  "candidates": ["python-fastapi", "python-flask", "node-fastify", "go-gin"],
  "existing": { "languages": ["Python"], "frameworks": ["Flask"] }
}
```

`assess` answers with evidence, not a recommendation. For example (the numbers come from a short
test run, not reference data):

```json
{
  "candidates": [
    {
      "id": "python-flask",
      "disqualified": true,
      "because": "gunicorn sync holds one wait per worker: 270 req/s on 10 ms waits at 1 CPU, below the 2,000 needed",
      "evidence": ["results/20261027-152128-55e0f8.json#python-flask/io"],
      "provenance": "reference",
      "alternatives": "python-flask-gevent reached 2,834 req/s on the same run"
    }
  ],
  "gaps": ["No data on cold starts below 512 MB"],
  "notes": "The team already uses Flask; gevent workers keep the code base."
}
```

### The skill

The skill is the agent-facing manual. It says:

- **When to consult:** an open technology choice, or a stated performance, memory, start-up or
  cost requirement. Not for routine work in an existing stack.
- **How to read answers:** disqualifiers first; then trade-offs; weigh them against team skills,
  existing code and ecosystem facts; say what the evidence didn't cover; never present the tool's
  output as a verdict.
- **How to extend:** step-by-step guides for a server, a database and a task, each step ending in
  a command that proves it worked (`langbench validate`, `langbench conform`, a short run).

## What happens to what exists

- **Orchestrator, runner, planner, conformance, result format:** kept and extended. Result schema
  goes to version 2 (tasks, databases, provenance, reference ratios); version 1 files stay
  readable.
- **The 25 servers:** become the `reference` set for the `core` task on Postgres.
- **Dashboard:** becomes the audit view. Results gain provenance and reference ratios; the Learn
  section gains a page on how agents use the tool.
- **Published viewer:** kept, lower priority.

## Evaluation

**Scenarios.** 15 short project briefs, each with a description of the existing code base (or
none), requirements and constraints. A panel of people decides, for each, which choices are
acceptable and which are disqualified, and why. They should include:

- cases where the constraint rules out the obvious choice (I/O-heavy on gunicorn sync, cold
  starts on the JVM, 256 MB on the edge);
- cases where the team's existing stack is right and the tool should say so;
- cases where the evidence doesn't cover the question and the tool should say that.

**Method.** The same agent and model answer each scenario with and without the tool. People grade
the answers without knowing which is which.

**Success.**

- Fewer disqualified choices with the tool.
- No more needless rewrites: in "stay with the existing stack" scenarios the tool does not
  push the agent elsewhere.
- Rationales cite the constraint and the evidence.
- Gaps are stated, not papered over.

Results are kept in `eval/` and the evaluation reruns after every phase that changes answers.

## Phases

Each phase is a branch and a pull request, merged when CI is green and the exit criteria hold.

**Phase 3: evaluation first.** Scenario briefs and expected judgements in `eval/`; a script that
runs an agent on them without the tool and records its answers for grading. *Exit:* a baseline
graded by people.

**Phase 4: query layer, MCP and skill over today's data.** Result schema 2 with reference ratios;
a `reference/` dataset of full-length runs of the 25 servers; `assess`, `explain`,
`describe_coverage`; the consulting half of the skill. *Exit:* the evaluation, rerun with the
tool, beats the baseline on the success criteria.

**Phase 5: trust.** `langbench validate`, provenance levels, reference servers in every run,
base images pinned across all 25 servers. *Exit:* every reference server passes `validate`;
a deliberately unfair server fails it.

**Phase 6: declarative tasks and databases.** Task and database components; conformance as an
interpreter; `core` rewritten as a task with identical results; one more database (chosen in this
phase) and one more task to prove the mechanism. *Exit:* `core` results match before and after;
the new task and database run end to end.

**Phase 7: guides an agent can follow.** The extending half of the skill, and `langbench add`
scaffolding. *Exit:* an agent with no help adds a stack we don't have, gets it `validated`, and
uses it in a `run_shortlist`.

**Phase 8: facts and proficiency.** The facts format and research guide; the proficiency
harness. *Exit:* the evaluation improves again on scenarios where ecosystem or proficiency
decide.

## Open questions

1. **Mixed request loads.** oha sends one URL. Tasks with mixes (reads and writes) need a load
   generator that does more: oha with several runs side by side, another tool, or our own. To
   decide in phase 6, with the same care as the original choice of oha.
2. **How `assess` turns numbers into disqualifiers.** Fixed thresholds against the stated
   requirements are transparent but brittle; margins and confidence need to be designed with the
   evaluation, not guessed.
3. **Reference hardware.** Where the `reference/` dataset is made, and how often it is renewed.
4. **Which second database.** MySQL is the most common next choice; SQLite tests something
   different (in process, no network); MongoDB tests a different kind. Decided in phase 6 by the
   evaluation's gaps.
5. **Proficiency cost.** One stack takes an agent many minutes and many tokens; the number of
   attempts per stack, and who pays, is decided in phase 8.

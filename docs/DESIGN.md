# Design: lang-bench as a decision tool for coding agents

Status: accepted. Revised on 27 October 2026 after the first evaluation ([eval/README.md](../eval/README.md));
the decisions are at the end. Nothing here is built yet; [ARCHITECTURE.md](ARCHITECTURE.md)
describes what exists today.

## Why

Coding agents pick the stack they know best, or the one most common in their training data. Often
that is right: the team knows it, the libraries exist, the code base already uses it. Sometimes it
is wrong in ways that are expensive later: a sync Python server for a service that mostly waits on
other services, a JVM for a function that cold-starts on every request, a stack that won't fit
in the memory it will be given.

Two things make this matter more than it used to. Many people now build with an agent and have
no stack of their own, so the agent's default goes unchecked. And many projects are maintained by
the agent that wrote them, so "what the team already knows" counts for less than how reliably
agents work in the stack.

lang-bench already measures what those mistakes cost, in identical containers, with results that
record how to reproduce them. This design turns it into a tool an agent consults, and extends,
whenever a project's technology and its objectives might not match.

The first evaluation shaped this revision. When nobody asked which stack to use, agents did worse,
and cheaper models worse again. They never left the team's language; they went wrong on how work
was placed and scaled (WebSockets inside a REST process, CPU work on an event loop). Half of
their performance claims were about things lang-bench didn't measure yet, and the few that were
wrong were wrong where it changed the advice.

## Commitments

1. **Trade-offs and disqualifiers, never a winner.** The tool says which options fall over under
   this project's constraints and why, with the evidence. It does not rank stacks or name the
   best one.
2. **Performance is one criterion of several.** The team's existing skills and code, the
   ecosystem, the deployment target and how reliably agents write the stack all count, and
   usually count more. Which of these weighs most depends on who maintains the project.
3. **Proven by evaluation.** The tool is worth shipping only if agents that use it make better
   choices than agents that don't, on scenarios judged independently of the tool. That is measured before the
   tool grows, and again after each phase.

4. **The team sets the policy.** Who maintains the project, whether a hired person must be able
   to take it over, which technologies are allowed: the team or company decides, once per project,
   and the tool follows.
5. **Flags at any point, decisions remembered.** The tool raises a mismatch between a project's
   technology and its objectives as soon as it sees one; the earlier the better. The team's answer
   is recorded, and a declined flag is not raised again unless it becomes critical.

And one scoping decision:

6. **Local first.** Each user's copy is self-contained. Their agent adds the technologies,
   databases and tasks it needs, and the results stay on their machine. A shared dataset with
   upstream contributions is out of scope until the local tool has proven itself.

## Non-goals

- Covering every language and framework. Coverage follows demand: an agent adds what its user is
  deciding between.
- A public leaderboard. The published viewer stays, but is not the product.
- Pushing a switch when a variant of the team's own stack meets its objectives, or when nothing
  measured rules the stack out. Staying put is often the right answer, and the evaluation checks
  that the tool gives it.
- Answering what it has no data for. A question outside what lang-bench measures gets "not
  measured", not a guess.

## How it is used

**The team sets up a profile.** The first time an agent consults lang-bench in a project, the
skill asks the team a few questions (who maintains it, its objectives, its policies) and saves the
answers in the repository.

**An agent consults it, at any point.** When a project starts, a service is added, an objective
or load changes, or the agent notices while working that the stack and the objectives don't
match. It gets back, per candidate: disqualifiers, trade-offs with numbers and the configuration
behind them, in-stack variants before alternatives, how sure the evidence is, and what is not
measured. The agent weighs that with what it knows, and explains it to the user. Flags and the
team's decisions go into a log the next agent reads first.

**An agent extends it.** When a candidate isn't covered (a stack, a database, a kind of work),
the agent follows a guide to add it, proves it with `langbench validate`, and runs the
comparison it needs. The guides are written as a skill whose every step ends with a command that
proves the step worked.

**A person audits it.** The dashboard shows every number an agent relied on: the run, its
settings, the machine, the implementation and where it came from.

## Project profile and decision log

Both live in the project's repository, in `.langbench/`, so they travel with the code, every agent
working on it reads the same answers, and changes show in the project's history.

**Profile** (`.langbench/profile.json`), set by the team or company:

```json
{
  "maintainedBy": "agent-with-review",
  "handover": "required",
  "stage": "early",
  "objectives": [
    { "name": "concurrency", "target": "10000 simultaneous connections" },
    { "name": "cost", "target": "under 200 USD a month" }
  ],
  "policies": {
    "allowedLanguages": null,
    "hosting": "Fly.io",
    "memoryMB": 512
  },
  "stack": { "languages": ["PHP"], "frameworks": ["Laravel"] }
}
```

- `maintainedBy`: `human-team`, `agent-with-review` or `agent`. It changes how evidence is weighed
  (see the next section).
- `handover`: `required` makes "a hired person could take this over" a hard rule that can rule a
  stack out; `preferred` weighs it; `none` ignores it.
- `stage`: `not-started`, `early` or `established`. It changes what a mismatch leads to: a
  different stack at the start, a separate service or a variant later on.
- `objectives`: ranked, each with a number. A priority without a number is shown against the
  measured profiles but never produces a flag.
- `stack`: empty when there is none yet.

**Decision log** (`.langbench/decisions.json`): every flag raised, with its evidence (numbers and
the runs they came from), what the team decided (`accepted`, `declined` or `deferred`), why if they
said, who decided and when. Before raising a flag an agent checks the log. A declined flag is
raised again only when it has become critical:

- **a requirement is now at risk:** measured capacity, with the safety margin, no longer covers a
  stated objective, for example because the expected load in the profile went up;
- **the evidence changed materially:** new measurements, versions or workloads change the
  conclusion, not just shift it;
- **something broke in production** that the team traces to the flagged mismatch.

A flag raised again says why: "You declined this on 3 March; it is raised again because the
expected load went from 2,000 to 20,000 connections."

## Weighing the evidence

**Objectives against measured profiles.** Each stack and variant has a measured profile on every
workload: throughput, latency, CPU, memory, start-up, connections held. The tool compares the
profile of the project's stack with its ranked objectives. A team whose first objective is
concurrency, on a stack that measures 30 to 40 times below the alternatives on the concurrency workload
with no variant that closes the gap, gets a flag, at whatever stage.

**Variants before alternatives.** A variant is the same language and framework with a different
configuration: gunicorn's sync, gevent and gthread workers; Spring Boot on platform or virtual
threads; Laravel on PHP-FPM or Octane. The evaluation showed that most fixes live here. The tool
shows the variants of the current stack first, and suggests another stack only when no variant
meets the objective.

**Numbers carry their configuration.** Laravel answered 681 requests a second on plaintext but
149 on one database row, mostly because PHP-FPM opens a database connection per request by
default. Every number the tool cites says how the server was configured, so the agent can tell a
property of the stack from a property of the setup.

**Who maintains the project** changes what weighs most:

| Maintained by        | Weighs most                                                          |
| -------------------- | -------------------------------------------------------------------- |
| a human team         | the team's skills and existing code, then the objectives             |
| an agent with review | the objectives, agent proficiency, code reviewers can follow         |
| mostly an agent      | agent proficiency, simple operations, the handover policy            |

For an agent-maintained project at an early stage, switching stacks is far cheaper than for a
human team, so a mismatch flag is more often worth acting on. Agent proficiency cuts the other
way too: agents reaching for popular stacks is partly rational, because they work more reliably
in them, and the tool must say so when the best fit is a stack agents handle poorly.

**No stack yet.** With an empty `stack`, performance is mostly a sanity check (a JVM won't fit a
free tier with 512 MB). Agent proficiency, ecosystem facts, operational simplicity and the
handover policy decide. The skill also has the agent ask whether an existing product would do
before building; that is guidance, not data.

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

A variant names the server it varies and what differs, so the tool can show in-stack options
together:

```json
{ "id": "python-flask-gevent", "variant": { "of": "python-flask", "differs": "gunicorn gevent workers" } }
```

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
request shape, which oha does not do on its own; see decision 1.

A task earns its place by what it reveals that changes decisions. The first ones come from what
agents in the evaluation reasoned about without data:

| Task              | What it reveals                                                      |
| ----------------- | -------------------------------------------------------------------- |
| `core` (existing) | Framework overhead, raw compute, concurrency model, driver basics    |
| `websocket`       | Connections held and memory per connection, connection rate, broadcast latency, behaviour at the limit |
| `cpu-beside-io`   | Whether CPU-heavy requests slow down the fast ones beside them       |
| `cold-start`      | Time from start to first answer, and how slow the first requests are |
| `memory-limit`    | Throughput, pauses and kills as a hard memory limit gets close       |
| `upstream-fanout` | Calling several slow HTTP services per request (the real I/O case)   |

Later, as scenarios need them: `crud` (writes and transactions), `large-json`, `sustained` (memory
and pauses over minutes) and `crypto`.

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
| `describe_coverage`  | Lists the stacks, variants, databases and tasks with data, and their provenance |
| `check_project`      | Reads the profile and decision log and compares the current stack with the objectives; returns new or newly critical flags only |
| `assess`             | Takes the profile and candidates; returns per candidate the disqualifiers, trade-offs with numbers and configuration, variants of the current stack first, confidence and what is not measured |
| `record_decision`    | Adds the team's answer to a flag to the decision log                           |
| `explain`            | Explains one trade-off (say, why gunicorn sync collapses on I/O) with the runs behind it |
| `run_shortlist`      | Runs a few candidates on the workloads that matter, with reference servers; long-running, reports progress |
| `add_guide`          | Returns the guide for adding a server, database or task, for agents without the skill |

`assess` and `check_project` take the project profile above, plus a workload shape when the
question is about one service:

```json
{
  "shape": "io-heavy",
  "requests": { "peakPerSecond": 2000, "p99BudgetMs": 200 },
  "candidates": ["python-fastapi", "python-flask", "node-fastify", "go-gin"]
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

- **First use:** ask the team the profile questions, save `.langbench/profile.json`.
- **When to consult:** at any point a stack and the objectives may not match: a new project or
  service, a changed objective or load, or a mismatch the agent notices while working. Read the
  decision log first; raise only new or newly critical flags; record the team's answer.
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

**Teams.** Imaginary teams spanning the people who ask agents for help: from someone with no
technical knowledge, through hobbyists, small teams and agencies, to enterprises and scientific
groups. Each has a size, a stack it already knows (or none), its skills, how it deploys, and what
it cares about.

**Scenarios.** Project briefs, each set in one team, asked directly or given as a task in a mock
repository. They include:

- cases where a constraint rules out the obvious choice (I/O-heavy on gunicorn sync, cold
  starts on the JVM, 256 MB on the edge);
- cases where the team's existing stack is right and the tool should say so;
- teams with no stack;
- stacks that don't fit the project's objectives, at each stage;
- the same project under each maintainer setting, to check that the advice changes as it should;
- a flag the team declined, before and after it becomes critical;
- cases where the evidence doesn't cover the question.

**Scope.** Every scenario is tagged `in`, `partial` or `out` of what lang-bench measures. The
tool's main score counts `in` and `partial` scenarios. `out` scenarios are scored on one thing:
whether the tool said it had no data instead of adding confident noise. They stay, because real
projects come wrapped in things the tool doesn't measure.

**Reference judgements.** For each scenario, a separate judge agent that never sees the tool or
lang-bench's data writes which choices are acceptable, which are ruled out, and why. You
spot-check them. Keeping the judge apart means the evaluation doesn't measure agreement with the
tool's own author.

**Method.** The same agent and model answer each scenario with and without the tool. A judge agent
grades each answer against the reference judgement and a fixed rubric, without knowing which
condition produced it; you spot-check the grades.

**Success.**

- Fewer ruled-out choices with the tool.
- No needless rewrites: in "stay with the existing stack" scenarios the tool does not push the
  agent elsewhere.
- Rationales cite the constraint and the evidence.
- Gaps are stated, not papered over.
- Declined flags are not raised again unless they became critical.

Results are kept in `eval/` and the evaluation reruns after every phase that changes answers.

## Phases

Each phase is a branch and a pull request, merged when CI is green and the exit criteria hold.

**Phase 3: evaluation first.** Done: teams, scenarios, mock repositories, reference judgements, a
runner, blind grading and claim checking. Baseline in `eval/README.md`.

**Phase 4: the new scenarios.** Teams with no stack, stack-objective mismatches at each stage,
each maintainer setting, declined and critical flags; scope tags on every scenario; their
reference judgements; a baseline without the tool. *Exit:* a graded baseline on the new
scenarios, which you have reviewed.

**Phase 5: our load generator and the new tasks.** The Go load generator, matching oha on today's
workloads; declarative tasks with `core` rewritten to identical results; `websocket`,
`cpu-beside-io` and `cold-start` on the reference servers. *Exit:* `core` results match before and
after; the new tasks run on every server that implements them.

**Phase 6: the tool.** Profile and decision log; the query layer with variants and configuration;
`check_project`, `assess`, `record_decision`, `explain`, `describe_coverage`; the MCP server and
the consulting half of the skill; result schema 2 and a `reference/` dataset. *Exit:* with the
tool, the evaluation beats the baseline on `in` and `partial` scenarios, states gaps on `out`
ones, and doesn't raise declined flags again.

**Phase 7: agent proficiency and ecosystem facts.** The proficiency harness, on demand with three
attempts per stack; the facts format and research guide. *Exit:* the evaluation improves on
no-stack and agent-maintained scenarios.

**Phase 8: trust.** `langbench validate`, provenance levels, reference servers in every run, base
images pinned across all servers. *Exit:* every reference server passes `validate`; a deliberately
unfair server fails it.

**Phase 9: extending.** Database components (MongoDB, then Neo4j), the extending half of the skill
and `langbench add`. *Exit:* an agent with no help adds a stack and a database we don't have, gets
them `validated`, and uses them in a `run_shortlist`.

## Decisions

Settled on 27 October 2026, from the open questions of the first draft.

1. **Mixed request loads: our own load generator.** A Go load generator in the orchestrator, with
   weighted request mixes, an exact HDR latency histogram and live results without one-second
   slices, and WebSockets. Before it replaces oha it must match oha on today's single-URL
   workloads. Built in phase 5.
2. **Disqualifying: the requirement plus a safety margin.** `assess` rules a candidate out only
   when its measured value misses the stated requirement even with headroom (1.5× to start),
   and always shows the numbers. The margin is tuned with the evaluation.
3. **Reference hardware: the maintainer's machine for now.** An Intel Core Ultra 9 185H with 22
   CPUs under Docker Desktop. Every run records the hardware; the dataset is renewed when servers
   change. A dedicated machine can come later.
4. **Databases: MongoDB next, then Neo4j.** A document database first, then a graph database,
   rather than a second relational one.
5. **Proficiency: on demand, three attempts.** Run only when asked, one stack at a time, with
   three independent attempts so the result is a pass rate. Runs use the user's own agent account
   and record the agent and model.
6. **Judging: a separate agent, spot-checked.** Reference judgements and grades come from judge
   agents kept apart from the tool; the maintainer spot-checks them.
7. **Policies come from the team or company.** Who maintains a project, whether a hired person must
   be able to take it over, and which technologies are allowed are asked once and stored in the
   project profile. The tool doesn't decide them.
8. **Flags at any point, remembered.** A mismatch is flagged as soon as an agent sees it. The
   team's answer goes into the decision log, and a declined flag returns only when it becomes
   critical: a requirement at risk, materially changed evidence, or a production problem traced to
   it.
9. **Who maintains a project changes the weights.** For agent-maintained projects, agent
   proficiency and simple operations replace the team's familiarity as the leading criteria.
10. **Scenarios are tagged by scope.** The tool is scored on what lang-bench measures, and on
    saying "not measured" for the rest.

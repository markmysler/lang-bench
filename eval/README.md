# Evaluation

Does lang-bench help coding agents choose better? See [docs/DESIGN.md](../docs/DESIGN.md),
"Evaluation".

- `teams.md`: imaginary teams, from someone who has never coded to a bank and a research lab.
- `scenarios/`: project briefs, each set in one team and ending with the team's request.
- `index.json`: what each scenario tests. Only analysis reads it; agents never see it.
- `prompts/`: what the agent under test, the reference judge and the grader are asked.
- `repos/<scenario>/`: a mock repository for the scenario and a `TASK.md` that asks for work
  without asking which technology to use. The constraints are in the repository's documents.
- `judgements/`: reference answers from a separate judge agent that never sees lang-bench.
- `measurements.md`: lang-bench's reference measurements, for checking agents' claims.
- `runs/<name>/`: one condition's answers or work, grades, claim checks and summary.

## Two ways of asking

- **Asked** (`answer`): the agent is asked which technology to use and to weigh alternatives.
- **Implicit** (`act`): the agent is given a task in a mock repository with file tools only, and
  nobody mentions a choice. Agents mostly go wrong here: they reach for a default without noticing
  the constraint. The grader judges the stack the agent actually set up.

## Running it

```sh
node eval/run.mjs judge --require-api-key                       # reference judgements, once
node eval/run.mjs answer <run> [--model sonnet] --require-api-key
node eval/run.mjs act <run> [--model sonnet] --require-api-key
node eval/run.mjs grade <run> --require-api-key                 # against the judgements
node eval/run.mjs check <run> --require-api-key                 # claims against measurements.md
node eval/run.mjs summary <run>
node eval/run.mjs measurements results/<run>.json               # rebuild measurements.md
```

Each call goes to a fresh Claude Code, headless, in a temporary folder (inside WSL on Windows), so
it sees nothing of this repository. `--model` changes only the agent under test; judges and graders
always use Claude Code's default model, so grades stay comparable. Calls are billed to `ANTHROPIC_API_KEY` or
`CLAUDE_API_KEY`; on Windows a saved user variable is read directly. `--require-api-key` refuses
to fall back to the signed-in account. A key that isn't scoped to a workspace also needs
`CLAUDE_WORKSPACE_ID`. Every reply records its cost, model and duration.

## Baseline, 27 October 2026

`runs/baseline-no-tool`: Claude Code with claude-opus-5-5, no tool; judged and graded by the same
model. 48 calls, 6.82 USD in total (about 0.14 USD each).

| | Result |
| --- | --- |
| Acceptable choice | 16 of 16 |
| Needless rewrites | 0 |
| Ruled-out choices recommended | 0 |
| Constraints cited, team fit, unknowns stated | 2.0 of 2 each |
| Overall | 4.94 of 5 |
| Must-mention points covered | 128 of 141 |
| Claims the grader flagged as unsupported | 19, several of them guessed performance figures |

**What it means.** Asked directly which stack to use, and told to weigh alternatives, the agent
already chooses well: these scenarios can't show the tool improving choices. That led to the
second round below.

## Second round, 27 October 2026

Three changes: implicit tasks in mock repositories (`act`), cheaper models as the agent under test,
and every performance claim checked against `measurements.md` (a sequential full-length run of all
25 servers at 1 CPU / 512 MB). Judges and graders stayed on claude-opus-5-5. The whole evaluation,
both rounds, cost 30.32 USD.

| Run | Model | Acceptable | Ruled out | Overall | Claims | Off | Not covered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Asked (`baseline-no-tool`) | Opus | 16/16 | 0 | 4.94 | 92 | 6 | 48 |
| Asked (`answer-sonnet`) | Sonnet | 16/16 | 0 | 4.69 | 81 | 3 | 40 |
| Asked (`answer-haiku`) | Haiku | 15/16 | 0, 1 unclear | 4.25 | 64 | 2 | 26 |
| Implicit (`act-opus`) | Opus | 8/8 | 0 | 4.13 | 19 | 0 | 10 |
| Implicit (`act-sonnet`) | Sonnet | 7/8 | 1 | 3.75 | 18 | 0 | 15 |
| Implicit (`act-haiku`) | Haiku | 6/8 | 1, 1 unclear | 3.13 | 9 | 0 | 8 |

No run made a needless rewrite: every agent, in every mode, stayed with the team's stack.

### Findings

1. **Implicit tasks are harder, and harder still for cheaper models.** Overall falls from 4.13 to
   3.75 to 3.13 from Opus to Haiku, against 4.94 to 4.25 when asked.
2. **The failures were architecture, not language.** Sonnet and Haiku both put 50,000 WebSockets
   inside the REST process with in-memory state (15-matchmaking). Haiku throttled CPU-heavy PDF
   rendering inside the Express process instead of moving it to a worker (04-pdf-reports), and
   served three-hop graph queries live with no caching (16). No agent chose a wrong language;
   choosing where work runs, and how it scales, is where they went wrong.
3. **Half the performance claims are about things lang-bench doesn't measure.** 147 of 283 claims
   were "not covered": WebSockets and long-lived connections, CPU work beside requests, serverless
   cold starts, numerical code, ARM. These are exactly the questions the agents were reasoning
   about.
4. **Few claims are wrong, but those few matter.** 11 of 283 were off by more than 2x, and they
   cluster where they change advice:
   - "A Go or Node rewrite might be 5 to 10 times faster" than Laravel (05-tv-campaign). Measured
     on one database row: Laravel on PHP-FPM 149 requests/s per CPU, Go 22,138, Express 9,034.
     Caveat: Laravel's plaintext rate is 681, so most of the drop comes from opening a new database
     connection per request, Laravel's default under FPM; a connection pooler would close part of
     the gap. The configuration is part of the evidence.
   - "Go and Spring Boot are similar in raw speed" (08): measured 1.7 times apart on JSON, 2.9 on
     one database row and 4 on plaintext.
   - Go "50 to 150 MB per pod" (08), ".NET is heavy for 512 MB" (02), "Drogon is heavy" (13):
     measured idle memory is 2 MB, 20 MB and 4 MB.

### What this means for the design

- Ruling stacks out by language matters less than expected: agents already keep the team's
  language. The evidence agents lack is about how a stack behaves under a shape of load, and it
  matters most for cheaper models and when nobody asks.
- The tasks to add first are the ones the agents reasoned about without data: long-lived
  connections (WebSockets), CPU work beside I/O, start-up under serverless-like conditions, and
  memory under a hard limit.
- Measured numbers must travel with their configuration, as the Laravel case shows.

### Limits

- Eight implicit tasks per model: differences of one task are not significant. The direction is
  consistent across the three models, but treat it as a signal, not a measurement.
- Grades come from the same model family as the Opus agent, so self-preference is possible.
- The claim checker is also a model; its central finding (Laravel) was checked by hand against
  `measurements.md`, the rest were not.

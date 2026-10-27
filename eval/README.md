# Evaluation

Does lang-bench help coding agents choose better? See [docs/DESIGN.md](../docs/DESIGN.md),
"Evaluation".

- `teams.md`: imaginary teams, from someone who has never coded to a bank and a research lab.
- `scenarios/`: project briefs, each set in one team and ending with the team's request.
- `index.json`: what each scenario tests. Only analysis reads it; agents never see it.
- `prompts/`: what the agent under test, the reference judge and the grader are asked.
- `judgements/`: reference answers from a separate judge agent that never sees lang-bench.
- `runs/<name>/`: one condition's answers, grades and summary.

## Running it

```sh
node eval/run.mjs judge --require-api-key              # reference judgements, once
node eval/run.mjs answer <run> --require-api-key       # the agent under test answers
node eval/run.mjs grade <run> --require-api-key        # a judge grades the answers
node eval/run.mjs summary <run>
```

Each prompt goes to a fresh Claude Code, headless, in an empty temporary folder (inside WSL on
Windows), so it sees nothing of this repository. Calls are billed to `ANTHROPIC_API_KEY` or
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
already chooses well. This set of scenarios cannot show the tool improving choices: the baseline
is at the ceiling. Where it falls short is evidence. It guesses numbers ("a Go rewrite might be
5 to 10 times faster", "Laravel handles 100 to 200 requests a second on 2 vCPUs"; lang-bench
measured about 360 per core at 1 CPU) and the guesses can be several times off, though the advice
survived them here.

Before the evaluation can judge the tool, it needs scenarios where agents actually go wrong; see
the pull request for the options.

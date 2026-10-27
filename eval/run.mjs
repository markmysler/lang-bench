#!/usr/bin/env node
// Runs the evaluation (docs/DESIGN.md, "Evaluation"; eval/README.md).
//
//   node eval/run.mjs judge                  reference judgements (skips existing ones)
//   node eval/run.mjs answer <run>           the agent answers each scenario's question
//   node eval/run.mjs act <run>              the agent does each repos/<id>/TASK.md in a mock repo
//   node eval/run.mjs grade <run>            a judge grades the run against the reference
//   node eval/run.mjs check <run>            performance claims checked against measurements.md
//   node eval/run.mjs summary <run>          totals for the run
//   node eval/run.mjs measurements <file>    writes measurements.md from a lang-bench result
//
// Options: --model <name> (answer, act)   --only <id,id>   --jobs 4   --require-api-key
//
// Every call is a fresh Claude Code run by agent.sh in a temporary folder (inside WSL on
// Windows), so it sees nothing of this repository. Judges and graders use Claude Code's default
// model; --model changes only the agent under test.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkTotals,
  describeAct,
  extractJSON,
  fill,
  measurementsTable,
  parseScenario,
  parseTeams,
  replyText,
  summarise,
  summariseByScope,
  toWsl,
} from './lib.mjs';

const EVAL = dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
const DISTRO = process.env.LANGBENCH_WSL ?? 'Ubuntu-24.04';

/**
 * A setting from this process's environment or, on Windows, from the user's or machine's saved
 * variables, so that one added after the app started still counts.
 */
function setting(names) {
  for (const name of names) {
    if (process.env[name]) return { name, value: process.env[name] };
  }
  if (!WIN) return null;
  for (const scope of ['User', 'Machine']) {
    for (const name of names) {
      const value = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', '${scope}')`],
        { encoding: 'utf8' },
      ).trim();
      if (value) return { name: `${name} (Windows ${scope.toLowerCase()} variable)`, value };
    }
  }
  return null;
}

// Calls are billed to this API key if there is one; otherwise to the account Claude Code is signed
// in with. The key is never printed.
const KEY = setting(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
// A key that isn't scoped to a workspace must name one on every request.
const WORKSPACE = KEY && setting(['ANTHROPIC_WORKSPACE_ID', 'CLAUDE_WORKSPACE_ID']);
const BILLING = KEY ? 'api-key' : 'signed-in account';

function agentEnv(model) {
  const env = { ...process.env };
  const pass = [];
  if (KEY) {
    env.ANTHROPIC_API_KEY = KEY.value;
    pass.push('ANTHROPIC_API_KEY');
  }
  if (WORKSPACE) {
    env.ANTHROPIC_CUSTOM_HEADERS = `anthropic-workspace-id: ${WORKSPACE.value}`;
    pass.push('ANTHROPIC_CUSTOM_HEADERS');
  }
  if (model) {
    env.LANGBENCH_MODEL = model;
    pass.push('LANGBENCH_MODEL');
  }
  // WSLENV carries these variables into WSL.
  env.WSLENV = [process.env.WSLENV, ...pass].filter(Boolean).join(':');
  return env;
}

const read = (...p) => readFileSync(join(EVAL, ...p), 'utf8');
const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};

function load() {
  const teams = parseTeams(read('teams.md'));
  return readdirSync(join(EVAL, 'scenarios'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseScenario(f.replace(/\.md$/, ''), read('scenarios', f)))
    .map((s) => ({ ...s, teamText: teams.get(s.team) }));
}

/**
 * Runs agent.sh with a prompt on stdin. mode is ['answer'] or ['act', repoPath]. Returns the parsed
 * stdout, or rejects if the agent or the API failed.
 */
function agent(prompt, mode, model) {
  const script = join(EVAL, 'agent.sh');
  const args = mode[0] === 'act' ? ['act', WIN ? toWsl(mode[1]) : mode[1]] : ['answer'];
  const [cmd, argv] = WIN
    ? ['wsl.exe', ['-d', DISTRO, '-e', 'bash', '-l', toWsl(script), ...args]]
    : ['bash', ['-l', script, ...args]];
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(cmd, argv, { env: agentEnv(model), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new Error(`agent exited with ${code}: ${(err || out).slice(0, 400)}`));
      }
      const claude = mode[0] === 'act' ? parsed.claude : parsed;
      // Claude Code can exit 0 even when the API refuses the request.
      if (claude?.is_error) return reject(new Error(`agent error: ${String(claude.result).slice(0, 300)}`));
      const meta = {
        costUSD: claude?.total_cost_usd,
        models: Object.keys(claude?.modelUsage ?? {}),
        turns: claude?.num_turns,
        billing: BILLING,
        seconds: (Date.now() - started) / 1000,
      };
      resolve({ parsed, text: replyText(JSON.stringify(claude ?? {})), meta });
    });
    child.stdin.end(prompt);
  });
}

/** Asks for JSON from a judge, retrying once if the reply has none. */
async function askJSON(prompt) {
  for (let attempt = 1; ; attempt++) {
    const reply = await agent(prompt, ['answer']);
    try {
      return { json: extractJSON(reply.text), meta: reply.meta };
    } catch (e) {
      if (attempt >= 2) throw new Error(`${e.message}: ${reply.text.slice(0, 200)}`);
    }
  }
}

async function eachLimited(items, jobs, fn) {
  let next = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await fn(item);
        } catch (e) {
          failures.push(item.id);
          console.error(`FAIL ${item.id}: ${e.message}`);
        }
      }
    }),
  );
  if (failures.length) throw new Error(`${failures.length} failed: ${failures.join(', ')}`);
}

const values = (s) => ({ team: s.teamText, situation: s.situation, request: s.request });
const runDir = (run, ...p) => join(EVAL, 'runs', run, ...p);

/** Records what produced a run, once, so its results can be read later. */
function recordRun(run, kind, model) {
  const path = runDir(run, 'run.json');
  if (existsSync(path)) {
    const prev = JSON.parse(readFileSync(path, 'utf8'));
    if (prev.kind !== kind || (prev.model ?? null) !== (model ?? null)) {
      throw new Error(`run ${run} was made as ${prev.kind} with ${prev.model ?? 'the default model'}`);
    }
    return;
  }
  write(path, { kind, model: model ?? null, billing: BILLING, started: new Date().toISOString() });
}

async function judge(scenarios, jobs) {
  const template = read('prompts', 'judge.md');
  const todo = scenarios.filter((s) => !existsSync(join(EVAL, 'judgements', `${s.id}.json`)));
  await eachLimited(todo, jobs, async (s) => {
    const r = await askJSON(fill(template, values(s)));
    write(join(EVAL, 'judgements', `${s.id}.json`), { scenario: s.id, judgement: r.json, meta: r.meta });
    console.log(`judged ${s.id}`);
  });
}

async function answer(run, scenarios, jobs, model) {
  recordRun(run, 'answer', model);
  const template = read('prompts', 'answer.md');
  await eachLimited(scenarios, jobs, async (s) => {
    const r = await agent(fill(template, values(s)), ['answer'], model);
    write(runDir(run, 'answers', `${s.id}.md`), r.text.trim() + '\n');
    write(runDir(run, 'answers', `${s.id}.meta.json`), r.meta);
    console.log(`answered ${s.id} (${r.meta.seconds.toFixed(0)} s)`);
  });
}

async function act(run, scenarios, jobs, model) {
  recordRun(run, 'act', model);
  const withRepo = scenarios.filter((s) => existsSync(join(EVAL, 'repos', s.id, 'TASK.md')));
  await eachLimited(withRepo, jobs, async (s) => {
    const task = read('repos', s.id, 'TASK.md');
    const r = await agent(task, ['act', join(EVAL, 'repos', s.id, 'repo')], model);
    write(runDir(run, 'acts', `${s.id}.json`), { ...r.parsed, meta: r.meta });
    write(runDir(run, 'answers', `${s.id}.md`), describeAct(r.parsed));
    console.log(`acted ${s.id}: ${r.parsed.changed.length} files changed (${r.meta.seconds.toFixed(0)} s)`);
  });
}

async function grade(run, scenarios, jobs) {
  const kind = JSON.parse(read('runs', run, 'run.json')).kind;
  const template = read('prompts', kind === 'act' ? 'grade-act.md' : 'grade.md');
  const done = scenarios.filter((s) => existsSync(runDir(run, 'answers', `${s.id}.md`)));
  await eachLimited(done, jobs, async (s) => {
    const judgement = JSON.parse(read('judgements', `${s.id}.json`)).judgement;
    const extra = kind === 'act' ? { task: read('repos', s.id, 'TASK.md').trim() } : {};
    const r = await askJSON(
      fill(template, {
        ...values(s),
        ...extra,
        judgement: JSON.stringify(judgement, null, 2),
        answer: read('runs', run, 'answers', `${s.id}.md`),
      }),
    );
    write(runDir(run, 'grades', `${s.id}.json`), { scenario: s.id, grade: r.json, meta: r.meta });
    console.log(`graded ${s.id}: ${r.json.choice}, overall ${r.json.overall}`);
  });
}

async function check(run, scenarios, jobs) {
  const template = read('prompts', 'check.md');
  const measurements = read('measurements.md');
  const done = scenarios.filter((s) => existsSync(runDir(run, 'answers', `${s.id}.md`)));
  await eachLimited(done, jobs, async (s) => {
    const r = await askJSON(
      fill(template, { ...values(s), measurements, answer: read('runs', run, 'answers', `${s.id}.md`) }),
    );
    write(runDir(run, 'checks', `${s.id}.json`), { scenario: s.id, ...r.json, meta: r.meta });
    const t = checkTotals([r.json]);
    console.log(`checked ${s.id}: ${t.claims} claims, ${t.off} off, ${t.not_covered} not covered`);
  });
}

const readAll = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
    : [];

function summary(run) {
  const graded = readAll(runDir(run, 'grades'));
  const checks = readAll(runDir(run, 'checks'));
  const costs = [
    ...readAll(runDir(run, 'grades')).map((g) => g.meta?.costUSD ?? 0),
    ...readAll(runDir(run, 'checks')).map((c) => c.meta?.costUSD ?? 0),
    ...(existsSync(runDir(run, 'answers'))
      ? readdirSync(runDir(run, 'answers'))
          .filter((f) => f.endsWith('.meta.json'))
          .map((f) => JSON.parse(read('runs', run, 'answers', f)).costUSD ?? 0)
      : []),
    ...readAll(runDir(run, 'acts')).map((a) => a.meta?.costUSD ?? 0),
  ];
  const s = {
    run: existsSync(runDir(run, 'run.json')) ? JSON.parse(read('runs', run, 'run.json')) : null,
    ...summarise(graded),
    byScope: summariseByScope(graded, JSON.parse(read('index.json')).scenarios),
    claims: checkTotals(checks),
    costUSD: Math.round(costs.reduce((a, b) => a + b, 0) * 100) / 100,
  };
  write(runDir(run, 'summary.json'), s);
  console.log(JSON.stringify(s, null, 2));
  for (const g of graded) {
    const x = g.grade;
    const c = checks.find((k) => k.id === g.id);
    const ct = c ? checkTotals([c]) : null;
    console.log(
      `${g.id.padEnd(28)} ${String(x.choice).padEnd(11)} overall ${x.overall}  constraints ${x.constraints_cited}  ` +
        `team ${x.team_fit}  unknowns ${x.unknowns_stated}${x.needless_rewrite ? '  REWRITE' : ''}` +
        (x.stack_chosen ? `  [${x.stack_chosen}]` : '') +
        (ct ? `  claims ${ct.claims} off ${ct.off}` : ''),
    );
  }
}

const [command, arg] = process.argv.slice(2);
const opt = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (command === 'measurements' && arg) {
  write(join(EVAL, 'measurements.md'), measurementsTable(JSON.parse(readFileSync(arg, 'utf8'))));
  console.log(`wrote eval/measurements.md from ${arg}`);
  process.exit(0);
}

if (process.argv.includes('--require-api-key') && !KEY) {
  console.error('No ANTHROPIC_API_KEY or CLAUDE_API_KEY found; refusing to bill the signed-in account.');
  process.exit(1);
}
const only = opt('only')?.split(',');
const jobs = Number(opt('jobs') ?? 4);
const model = opt('model');
const scenarios = load().filter((s) => !only || only.includes(s.id));
if (command !== 'summary') {
  const workspace = WORKSPACE ? `, workspace from ${WORKSPACE.name}` : '';
  console.error(`billing: ${KEY ? `API key from ${KEY.name}${workspace}` : BILLING}`);
}

if (command === 'judge') await judge(scenarios, jobs);
else if (command === 'answer' && arg) await answer(arg, scenarios, jobs, model);
else if (command === 'act' && arg) await act(arg, scenarios, jobs, model);
else if (command === 'grade' && arg) await grade(arg, scenarios, jobs);
else if (command === 'check' && arg) await check(arg, scenarios, jobs);
else if (command === 'summary' && arg) summary(arg);
else {
  console.error(
    'usage: node eval/run.mjs judge | answer <run> | act <run> | grade <run> | check <run> | summary <run> | measurements <result.json>',
  );
  process.exit(2);
}

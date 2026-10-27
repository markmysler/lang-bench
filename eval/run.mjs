#!/usr/bin/env node
// Runs the evaluation (docs/DESIGN.md, "Evaluation").
//
//   node eval/run.mjs judge                write reference judgements (skips existing ones)
//   node eval/run.mjs answer <run>         the agent under test answers every scenario
//   node eval/run.mjs grade <run>          a judge grades the run's answers
//   node eval/run.mjs summary <run>        totals for a graded run
//
// Options: --only 03-webhook-fanout,09-partner-callbacks   --jobs 4   --require-api-key
//
// Every prompt goes to a fresh agent through LANGBENCH_AGENT, a shell command that reads the
// prompt on stdin. The default runs Claude Code headless in an empty temporary folder, inside WSL
// on Windows, so the agent sees nothing of this repository.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJSON, fill, parseScenario, parseTeams, replyText, summarise } from './lib.mjs';

const EVAL = dirname(fileURLToPath(import.meta.url));
const INSIDE_EMPTY_DIR =
  'd=$(mktemp -d) && cd "$d" && claude -p --output-format json; rc=$?; cd / && rm -rf "$d"; exit $rc';
// A command and its arguments, started without a shell so that quoting survives Windows.
const AGENT = process.env.LANGBENCH_AGENT
  ? { cmd: process.env.LANGBENCH_AGENT, args: [], shell: true }
  : process.platform === 'win32'
    ? {
        cmd: 'wsl.exe',
        args: ['-d', process.env.LANGBENCH_WSL ?? 'Ubuntu-24.04', '-e', 'bash', '-lc', INSIDE_EMPTY_DIR],
        shell: false,
      }
    : { cmd: 'bash', args: ['-lc', INSIDE_EMPTY_DIR], shell: false };

/**
 * The API key to bill calls to, if any: ANTHROPIC_API_KEY or CLAUDE_API_KEY, from this process or,
 * on Windows, from the user's saved variables (so a key added after the app started still counts).
 * Without one, Claude Code uses whatever account it is signed in with.
 */
function setting(names) {
  for (const name of names) {
    if (process.env[name]) return { name, value: process.env[name] };
  }
  if (process.platform !== 'win32') return null;
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

const KEY = setting(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
// A key that isn't scoped to a workspace must name one on every request.
const WORKSPACE = KEY && setting(['ANTHROPIC_WORKSPACE_ID', 'CLAUDE_WORKSPACE_ID']);
if (process.argv.includes('--require-api-key') && !KEY) {
  console.error('No ANTHROPIC_API_KEY or CLAUDE_API_KEY found; refusing to bill the signed-in account.');
  process.exit(1);
}
// Claude Code reads ANTHROPIC_API_KEY; WSLENV carries it into WSL. The key is never printed.
const AGENT_ENV = KEY
  ? {
      ...process.env,
      ANTHROPIC_API_KEY: KEY.value,
      ...(WORKSPACE && { ANTHROPIC_CUSTOM_HEADERS: `anthropic-workspace-id: ${WORKSPACE.value}` }),
      WSLENV: [process.env.WSLENV, 'ANTHROPIC_API_KEY', WORKSPACE && 'ANTHROPIC_CUSTOM_HEADERS']
        .filter(Boolean)
        .join(':'),
    }
  : process.env;
const BILLING = KEY ? 'api-key' : 'signed-in account';

const read = (...p) => readFileSync(join(EVAL, ...p), 'utf8');
const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};

function load() {
  const teams = parseTeams(read('teams.md'));
  const scenarios = readdirSync(join(EVAL, 'scenarios'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseScenario(f.replace(/\.md$/, ''), read('scenarios', f)));
  return scenarios.map((s) => ({ ...s, teamText: teams.get(s.team) }));
}

/** Sends a prompt to a fresh agent; returns its reply and what the CLI reports about the call. */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(AGENT.cmd, AGENT.args, {
      shell: AGENT.shell,
      env: AGENT_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`agent exited with ${code}: ${err.slice(0, 500)}`));
      let meta = {};
      let j;
      try {
        j = JSON.parse(out);
      } catch {
        // plain-text agent: no metadata
      }
      if (j) {
        // Claude Code exits 0 even when the API refuses the request.
        if (j.is_error) return reject(new Error(`agent error: ${String(j.result).slice(0, 300)}`));
        meta = { costUSD: j.total_cost_usd, models: Object.keys(j.modelUsage ?? {}), turns: j.num_turns };
      }
      resolve({
        text: replyText(out),
        meta: { ...meta, billing: BILLING, seconds: (Date.now() - started) / 1000 },
      });
    });
    child.stdin.end(prompt);
  });
}

/** Asks for JSON, retrying once if the reply has none. */
async function askJSON(prompt) {
  for (let attempt = 1; ; attempt++) {
    const reply = await ask(prompt);
    try {
      return { json: extractJSON(reply.text), raw: reply.text, meta: reply.meta };
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

async function judge(scenarios, jobs) {
  const template = read('prompts', 'judge.md');
  const todo = scenarios.filter((s) => !existsSync(join(EVAL, 'judgements', `${s.id}.json`)));
  await eachLimited(todo, jobs, async (s) => {
    const r = await askJSON(fill(template, values(s)));
    write(join(EVAL, 'judgements', `${s.id}.json`), { scenario: s.id, judgement: r.json, meta: r.meta });
    console.log(`judged ${s.id}`);
  });
}

async function answer(run, scenarios, jobs) {
  const template = read('prompts', 'answer.md');
  await eachLimited(scenarios, jobs, async (s) => {
    const r = await ask(fill(template, values(s)));
    write(join(EVAL, 'runs', run, 'answers', `${s.id}.md`), r.text.trim() + '\n');
    write(join(EVAL, 'runs', run, 'answers', `${s.id}.meta.json`), r.meta);
    console.log(`answered ${s.id} (${r.meta.seconds.toFixed(0)} s)`);
  });
}

async function grade(run, scenarios, jobs) {
  const template = read('prompts', 'grade.md');
  await eachLimited(scenarios, jobs, async (s) => {
    const judgement = JSON.parse(read('judgements', `${s.id}.json`)).judgement;
    const answerText = read('runs', run, 'answers', `${s.id}.md`);
    const r = await askJSON(
      fill(template, { ...values(s), judgement: JSON.stringify(judgement, null, 2), answer: answerText }),
    );
    write(join(EVAL, 'runs', run, 'grades', `${s.id}.json`), { scenario: s.id, grade: r.json, meta: r.meta });
    console.log(`graded ${s.id}: ${r.json.choice}, overall ${r.json.overall}`);
  });
}

function summary(run) {
  const dir = join(EVAL, 'runs', run, 'grades');
  const graded = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
  const s = summarise(graded);
  write(join(EVAL, 'runs', run, 'summary.json'), s);
  console.log(JSON.stringify(s, null, 2));
  for (const g of graded) {
    const x = g.grade;
    console.log(
      `${g.id.padEnd(28)} ${String(x.choice).padEnd(11)} overall ${x.overall}  constraints ${x.constraints_cited}  team ${x.team_fit}  unknowns ${x.unknowns_stated}${x.needless_rewrite ? '  REWRITE' : ''}`,
    );
  }
}

const [command, run] = process.argv.slice(2);
const opt = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = opt('only')?.split(',');
const jobs = Number(opt('jobs') ?? 4);
const scenarios = load().filter((s) => !only || only.includes(s.id));
if (command !== 'summary') {
  const workspace = WORKSPACE ? `, workspace from ${WORKSPACE.name}` : '';
  console.error(`billing: ${KEY ? `API key from ${KEY.name}${workspace}` : BILLING}`);
}

if (command === 'judge') await judge(scenarios, jobs);
else if (command === 'answer' && run) await answer(run, scenarios, jobs);
else if (command === 'grade' && run) await grade(run, scenarios, jobs);
else if (command === 'summary' && run) summary(run);
else {
  console.error('usage: node eval/run.mjs judge | answer <run> | grade <run> | summary <run>');
  process.exit(2);
}

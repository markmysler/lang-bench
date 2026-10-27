// Pure helpers for the evaluation runner (run.mjs): reading teams and scenarios, filling prompts,
// reading agent replies and summarising grades.

/** Splits teams.md into a map from team id (a `## ` heading) to its description. */
export function parseTeams(markdown) {
  const teams = new Map();
  const parts = markdown.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    teams.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }
  return teams;
}

/** Reads a scenario file: its team, situation and the user's request. */
export function parseScenario(id, markdown) {
  const team = /^\*\*Team:\*\*\s*(\S+)/m.exec(markdown)?.[1];
  const situation = /^## Situation\s*\n([\s\S]*?)(?=^## )/m.exec(markdown)?.[1].trim();
  const request = /^## The request\s*\n([\s\S]*)$/m
    .exec(markdown)?.[1]
    .trim()
    .replace(/^>\s?/gm, '');
  if (!team || !situation || !request) throw new Error(`${id}: missing team, situation or request`);
  return { id, team, situation, request };
}

/** Replaces each {{name}} in a template. A placeholder without a value is an error. */
export function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`no value for {{${name}}}`);
    return values[name];
  });
}

/** The text of a reply: the `result` of Claude Code's JSON output, or the output itself. */
export function replyText(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === 'string') return parsed.result;
  } catch {
    // not JSON: plain text output
  }
  return stdout;
}

/** The first complete JSON object in a reply, ignoring prose and code fences around it. */
export function extractJSON(text) {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('no JSON object in the reply');
}

/** A Windows path as WSL sees it; other paths unchanged. */
export function toWsl(path) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : path;
}

const MB = 1024 * 1024;
const num = (n) => Math.round(n).toLocaleString('en-US');
const WORKLOADS = {
  plaintext: () => 'Plaintext',
  json: () => 'JSON',
  cpu: (w) => `CPU: recursive fib(${w.param}) per request`,
  io: (w) => `I/O wait: each request waits ${w.param} ms, as for a slow upstream`,
  db: () => 'Database: one random row from Postgres',
  queries: (w) => `Database: ${w.param} separate queries per request`,
};

/**
 * A lang-bench result as tables a model can check claims against: one per workload, then the
 * servers' start-up time, idle memory and image size.
 */
export function measurementsTable(r) {
  const [cpus, mem] = /^(\d+)cpu-(\d+)(mb|gb)$/.exec(r.config.preset)?.slice(1) ?? [];
  const size = r.config.preset.endsWith('gb') ? `${mem} GB` : `${mem} MB`;
  const out = [
    `Measured by lang-bench on ${r.host.cpuModel ?? 'unknown CPU'} under Docker (run ${r.id}, ${r.startedAt?.slice(0, 10)}).`,
    'Every server ran alone in',
    `a container with ${cpus} CPU, ${size}, tuned for production; load came from a separate container with`,
    `its own cores. ${r.config.warmupSlices} s warm-up, then ${r.config.measureSlices} s measured. Throughput is per container,`,
    'so on N cores expect up to about N times as much for servers that use all their cores.',
    '',
  ];
  const workloads = r.config.workloads ?? [];
  const order = workloads.length ? workloads : (r.servers[0]?.workloads ?? []).map((w) => w.workload);
  for (const wl of order) {
    out.push(`## ${WORKLOADS[wl.name]?.(wl) ?? wl.name}, ${wl.connections} connections`, '');
    out.push('| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of r.servers) {
      const w = s.workloads?.find((x) => x.workload.name === wl.name);
      if (!w || w.error) continue;
      out.push(
        `| ${s.server.id} | ${s.server.language} | ${s.server.framework} | ${num(w.summary.rps)} | ` +
          `${w.summary.latency.p50.toFixed(2)} | ${w.summary.latency.p99.toFixed(2)} | ` +
          `${Math.round(w.cpu.mean)}% | ${Math.round(w.memory.peak / MB)} MB |`,
      );
    }
    out.push('');
  }
  out.push('## Servers', '', '| Server | Start-up | Idle memory | Image size |', '| --- | --- | --- | --- |');
  const failed = [];
  for (const s of r.servers) {
    if (s.error && !s.workloads?.length) {
      failed.push(`${s.server.id}: ${s.error}`);
      continue;
    }
    out.push(
      `| ${s.server.id} | ${num(s.startupMs)} ms | ${Math.round(s.idleMemoryBytes / MB)} MB | ` +
        `${Math.round(s.image.sizeBytes / MB)} MB |`,
    );
  }
  if (failed.length) out.push('', 'Not measured: ' + failed.join('; '));
  return out.join('\n') + '\n';
}

const MAX_FILE = 6000;
const MAX_TOTAL = 40000;

/** What an agent did in a mock repository: its final message, the files it changed and their contents. */
export function describeAct(bundle) {
  const out = ['## Its final message', '', String(bundle.claude?.result ?? '(none)').trim(), ''];
  out.push('## Files it changed', '', ...(bundle.changed?.length ? bundle.changed : ['(none)']), '');
  let total = 0;
  for (const [path, content] of Object.entries(bundle.files ?? {})) {
    if (total > MAX_TOTAL) {
      out.push(`### ${path}`, '(not shown: too much output)', '');
      continue;
    }
    const text = content.length > MAX_FILE ? content.slice(0, MAX_FILE) + '\n…(cut)' : content;
    total += text.length;
    out.push(`### ${path}`, '```', text, '```', '');
  }
  return out.join('\n');
}

/** Totals of checked claims across answers: [{ claims: [{ verdict }] }]. */
export function checkTotals(checks) {
  const t = { claims: 0, consistent: 0, off: 0, not_covered: 0 };
  for (const c of checks) {
    for (const claim of c.claims ?? []) {
      t.claims++;
      if (claim.verdict in t) t[claim.verdict]++;
    }
  }
  return t;
}

const SCORES = ['constraints_cited', 'team_fit', 'unknowns_stated', 'overall'];

/** Totals for one run's grades: [{ id, grade }]. */
export function summarise(graded) {
  const choice = { acceptable: 0, ruled_out: 0, unclear: 0 };
  const sums = Object.fromEntries(SCORES.map((k) => [k, 0]));
  let needlessRewrites = 0;
  let ruledOutRecommended = 0;
  for (const { grade } of graded) {
    choice[grade.choice in choice ? grade.choice : 'unclear']++;
    if (grade.needless_rewrite) needlessRewrites++;
    if (grade.ruled_out_recommended?.length) ruledOutRecommended++;
    for (const k of SCORES) sums[k] += Number(grade[k]) || 0;
  }
  const n = graded.length || 1;
  return {
    scenarios: graded.length,
    choice,
    needlessRewrites,
    ruledOutRecommended,
    mean: Object.fromEntries(SCORES.map((k) => [k, Math.round((sums[k] / n) * 100) / 100])),
  };
}

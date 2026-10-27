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

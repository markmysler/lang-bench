/** The categorical palette has eight validated slots (styles/tokens.css). */
export const MAX_SERIES = 8;

/**
 * Colours for the servers of one run, in the run's own order, so a server keeps its colour on
 * every chart of that run. With more than eight servers there is no ninth colour to give, so
 * none are given: charts fall back to small multiples in one neutral colour.
 */
export function seriesColors(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (ids.length > MAX_SERIES) return out;
  ids.forEach((id, i) => out.set(id, `var(--series-${i + 1})`));
  return out;
}

export const NEUTRAL = 'var(--text-2)';

const BADGES: Record<string, string> = {
  Go: 'GO',
  Rust: 'RS',
  JavaScript: 'JS',
  TypeScript: 'TS',
  Python: 'PY',
  Java: 'JV',
  Kotlin: 'KT',
  Scala: 'SC',
  'C#': 'C#',
  'C++': 'C+',
  PHP: 'PH',
  Ruby: 'RB',
  Lua: 'LU',
  Elixir: 'EX',
  Swift: 'SW',
  Zig: 'ZG',
  Dart: 'DT',
};

/** A two-letter text badge, so a server is never identified by colour alone. */
export function badge(language: string): string {
  return BADGES[language] ?? language.slice(0, 2).toUpperCase();
}

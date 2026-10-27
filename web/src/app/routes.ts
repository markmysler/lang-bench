import { useEffect, useState } from 'react';

export type Route =
  { page: 'run' } | { page: 'results'; id?: string } | { page: 'learn'; slug?: string };

/** Routes live in the hash, so the same build works under any path (and on GitHub Pages). */
export function parseRoute(hash: string): Route {
  const [page, rest] = hash.replace(/^#\/?/, '').split(/\/(.*)/s, 2);
  const arg = rest ? decodeURIComponent(rest) : undefined;
  switch (page) {
    case 'results':
      return { page: 'results', id: arg };
    case 'learn':
      return { page: 'learn', slug: arg };
    default:
      return { page: 'run' };
  }
}

export function href(r: Route): string {
  switch (r.page) {
    case 'run':
      return '#/run';
    case 'results':
      return r.id ? `#/results/${encodeURIComponent(r.id)}` : '#/results';
    case 'learn':
      return r.slug ? `#/learn/${r.slug}` : '#/learn';
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

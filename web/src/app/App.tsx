import { LearnPage } from '../learn/LearnPage';
import { ResultsPage } from '../results/ResultsPage';
import { RunPage } from '../run/RunPage';
import { href, useRoute } from './routes';
import { useTheme, type Theme } from './theme';
import css from './App.module.css';

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useTheme();
  const tab = (page: typeof route.page, label: string) => (
    <a href={href({ page })} aria-current={route.page === page ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <>
      <header className={css.top}>
        <a className={css.brand} href={href({ page: 'run' })}>
          lang-bench
        </a>
        <nav className={css.nav} aria-label="Pages">
          {tab('run', 'Run')}
          {tab('results', 'Results')}
          {tab('learn', 'Learn')}
        </nav>
        <label>
          <span className="visually-hidden">Theme</span>
          <select
            className={css.theme}
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>
      <main className={css.main}>
        {route.page === 'run' && <RunPage />}
        {route.page === 'results' && <ResultsPage id={route.id} />}
        {route.page === 'learn' && <LearnPage slug={route.slug} />}
      </main>
    </>
  );
}

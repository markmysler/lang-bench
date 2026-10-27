import { href } from '../app/routes';

/** The Run tab of the read-only viewer: benchmarks need Docker, so they run on your machine. */
export function StaticRunPage() {
  return (
    <div className="panel" style={{ maxWidth: 720, display: 'grid', gap: 12 }}>
      <h1>Run it yourself</h1>
      <p style={{ margin: 0 }}>
        This page shows published results. Benchmarks start Docker containers, so they run on your
        own machine, with the same dashboard plus live charts:
      </p>
      <pre className="mono" style={{ margin: 0, overflowX: 'auto' }}>
        {`git clone https://github.com/markmysler/lang-bench
cd lang-bench
docker compose up --build`}
      </pre>
      <p style={{ margin: 0 }}>
        Then open <span className="mono">http://localhost:7070</span>. Your results record your
        hardware, so they can be compared with these.
      </p>
      <p style={{ margin: 0 }}>
        <a href={href({ page: 'results' })}>See the published results</a> ·{' '}
        <a href={href({ page: 'learn', slug: 'fairness' })}>How runs stay fair</a>
      </p>
    </div>
  );
}

import type { ReactNode } from 'react';
import { href } from '../app/routes';
import css from './Learn.module.css';

interface Article {
  slug: string;
  title: string;
  summary: string;
  body: ReactNode;
}

const ARTICLES: Article[] = [
  {
    slug: 'metrics',
    title: 'Reading the results',
    summary: 'What each number means, and which way is better.',
    body: (
      <>
        <h2>Throughput</h2>
        <p>
          Successful responses (status 2xx) per second, over the measured seconds. Failed requests
          never count towards throughput, so a server can’t look fast by answering with errors.
        </p>
        <h2>Latency: p50, p99 and max</h2>
        <p>
          The time from sending a request to receiving the whole response, as the load generator
          sees it. <strong>p50</strong> (the median) is the typical request: half were faster.{' '}
          <strong>p99</strong> is the slowest 1%: what an unlucky user, or a page that makes a
          hundred calls, actually waits for. Pauses such as garbage collection show up in p99 and
          max long before they move the median.
        </p>
        <p>
          The load generator keeps a fixed number of connections busy and sends the next request on
          a connection as soon as the last one is answered. Under that closed-loop load, throughput
          and latency are two sides of the same thing: with 64 connections, a server answering in 1
          ms serves about 64,000 requests a second.
        </p>
        <h2>CPU and CPU efficiency</h2>
        <p>
          CPU is shown as a percentage of one core: a server pinned to two cores can reach 200%.{' '}
          <strong>Requests per second per core</strong> divides throughput by the cores actually
          used. It answers “how much hardware does this need for my traffic?” and is the fairest
          single number when servers don’t all use their cores fully, as a single-threaded runtime
          might.
        </p>
        <h2>Memory</h2>
        <p>
          Resident memory as Docker reports it, without the page cache the kernel can reclaim.{' '}
          <strong>At idle</strong> is measured once the server is healthy, before any load.{' '}
          <strong>Peak</strong> is the highest reading during a workload. Runtimes with a garbage
          collector often grow towards the memory they are allowed, so a high peak isn’t always a
          leak.
        </p>
        <h2>Start-up time and image size</h2>
        <p>
          Start-up is the time from starting the container to the first successful answer from{' '}
          <code>/health</code>. It matters for scaling up and for serverless platforms. Image size
          is the final image, including the operating system layers every server shares.
        </p>
      </>
    ),
  },
  {
    slug: 'workloads',
    title: 'The workloads',
    summary: 'Six endpoints, each stressing something different.',
    body: (
      <>
        <p>
          Every server implements the same endpoints with byte-for-byte the same answers, checked by
          a conformance test before any server is added. The contract is in{' '}
          <code>docs/SPEC.md</code>.
        </p>
        <h2>Plaintext and JSON</h2>
        <p>
          “Hello, World!” and a one-field JSON object. There is almost no work in the handler, so
          these measure the cost of the HTTP server, the framework’s routing and, for JSON, its
          serialiser. They are the ceiling: no real endpoint will be faster.
        </p>
        <h2>CPU: fib(n)</h2>
        <p>
          The naive recursive Fibonacci function, written in each server’s own language. It does no
          allocation and no I/O, only function calls and arithmetic, so it compares interpreters,
          JIT compilers and ahead-of-time compilers directly. While it runs, a single-threaded event
          loop can’t answer anything else.
        </p>
        <h2>I/O wait</h2>
        <p>
          Each request waits a fixed time, as if calling a slow upstream service, then answers. The
          work is negligible; what is measured is how many waits a server can hold at once. With 256
          connections and a 10 ms wait, the best possible is 25,600 requests a second. An async
          runtime or virtual threads get close; a fixed pool of threads stops at its size.
        </p>
        <h2>Database: one row, and many queries</h2>
        <p>
          Reads random rows from a 10,000-row table in Postgres, one query per row. One row measures
          the database driver and connection pool. Twenty queries per request multiplies the round
          trips, which favours drivers that pipeline well and pools sized to the load. Postgres runs
          on its own cores, the same for every server.
        </p>
      </>
    ),
  },
  {
    slug: 'fairness',
    title: 'How runs stay fair',
    summary: 'Same OS, same cores, same load, and every choice recorded.',
    body: (
      <>
        <h2>Identical containers</h2>
        <p>
          Every server image is built on Debian 13 (trixie). Each server container gets the same
          number of CPU cores and the same memory, and is pinned to its own cores so that no two
          containers share one. Swap is off, so a server that needs more memory than it has is
          stopped, not slowed down.
        </p>
        <h2>Production settings</h2>
        <p>
          Each server is tuned as it would be in production, using all the cores it is given: worker
          processes for Python and Node, worker threads for Rust, the JVM’s own sizing for Java.
          Each server’s README says exactly how and why.
        </p>
        <h2>Simultaneous, batched or sequential</h2>
        <p>
          A run uses a share of the machine that you choose. As many servers as fit in it run at the
          same time, each with its own load generator on its own cores. The rest follow in later
          batches. Every result is tagged with how it ran. Servers that run side by side still share
          memory bandwidth, caches and the database. For the strictest comparison, run one at a
          time.
        </p>
        <h2>One-second slices</h2>
        <p>
          Load is applied by <a href="https://github.com/hatoo/oha">oha</a> in one-second slices so
          that the charts update live. The first seconds are a warm-up, shown but not counted, which
          lets JIT compilers and connection pools settle. Connections are opened again at each
          slice, which costs every server the same. Overall percentiles are combined from the
          slices’ percentiles, weighted by their requests: exact when the slices agree, and a close
          approximation when they don’t.
        </p>
        <h2>Reproducible</h2>
        <p>
          A result records the host’s CPU model, core count, memory, Docker version, the commit the
          run was made from, every setting, and the exact image of every server. Base images and
          dependencies are pinned, so the same commit builds the same servers.
        </p>
      </>
    ),
  },
];

export function LearnPage({ slug }: { slug?: string }) {
  const article = ARTICLES.find((a) => a.slug === slug);
  if (!article) {
    return (
      <div className={css.page}>
        <h1>Learn</h1>
        <ul className={css.index}>
          {ARTICLES.map((a) => (
            <li key={a.slug}>
              <a href={href({ page: 'learn', slug: a.slug })}>{a.title}</a>
              <span className="muted">{a.summary}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <article className={css.page}>
      <a href={href({ page: 'learn' })}>Learn</a>
      <h1>{article.title}</h1>
      {article.body}
    </article>
  );
}

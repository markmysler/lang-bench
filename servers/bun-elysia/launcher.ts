// Starts CPUS server processes that share port 8080 with SO_REUSEPORT (Bun's documented way to use
// several cores), and restarts any that exits. The launcher itself only supervises.
function env(key: string, def: number): number {
  const n = Number.parseInt(process.env[key] ?? '', 10);
  return n > 0 ? n : def;
}

const cpus = env('CPUS', navigator.hardwareConcurrency);
const children = new Set<ReturnType<typeof Bun.spawn>>();
let stopping = false;

function start() {
  const child = Bun.spawn([process.execPath, 'server.ts'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    onExit(proc, code, signal) {
      children.delete(proc);
      if (stopping) return;
      console.error(`server ${proc.pid} exited (${signal ?? code}), restarting`);
      start();
    },
  });
  children.add(child);
}

for (let i = 0; i < cpus; i++) start();

// As PID 1 in the container, stop the servers and exit on the stop signal.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopping = true;
    for (const child of children) child.kill();
    process.exit(0);
  });
}

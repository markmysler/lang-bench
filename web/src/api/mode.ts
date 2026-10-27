/** True in the read-only build for GitHub Pages (vite --mode static), which has no orchestrator. */
export const STATIC = import.meta.env.VITE_STATIC === '1';

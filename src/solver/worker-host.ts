/**
 * Constructing the worker, isolated in its own module.
 *
 * `new Worker(new URL(...))` is rewritten by Vite at transform time whether or
 * not the surrounding branch can ever run, so guarding it with a flag would
 * still emit a worker chunk and still need `import.meta.url` - which a classic
 * script does not have. Keeping it here lets the single-file build alias this
 * module to a stub, so the worker never enters that bundle at all.
 */
export function makeWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

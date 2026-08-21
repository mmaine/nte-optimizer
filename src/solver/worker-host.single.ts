/**
 * The single-file build's stand-in for `worker-host.ts`.
 *
 * A `file://` document has an opaque origin and cannot start a worker at all, so
 * this throws and `createSolverHost` falls through to the inline host - the same
 * path it takes in Node.
 */
export function makeWorker(): Worker {
  throw new Error("workers are unavailable in the single-file build");
}

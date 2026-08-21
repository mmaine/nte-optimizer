/**
 * Where the search runs.
 *
 * `Worker` when the page has one, the same generator on the main thread when it
 * does not - which is always the case in the single-file `file://` build, where
 * Chrome hands the document an opaque origin and workers are simply
 * unavailable.
 *
 * The fallback is nearly free precisely because the solver was written as a
 * chunked generator from the start rather than retrofitted: the inline host
 * pumps it in slices and returns to the event loop between them, so the UI keeps
 * painting and Stop keeps working.
 */
import { runJob, type JobProgress, type JobResult, type SolveJob } from "./job.ts";
import type { WorkerIn, WorkerOut } from "./worker.ts";
import { makeWorker } from "./worker-host.ts";

export interface SolveHandle {
  promise: Promise<JobResult>;
  cancel: () => void;
}

export interface SolverHost {
  readonly kind: "worker" | "inline";
  solve: (job: SolveJob, onProgress?: (progress: JobProgress) => void) => SolveHandle;
  dispose: () => void;
}

/** Milliseconds of work between returns to the event loop. */
export const SLICE_MS = 30;

export class CancelledError extends Error {
  constructor() {
    super("solve cancelled");
    this.name = "CancelledError";
  }
}

export function createInlineHost(): SolverHost {
  return {
    kind: "inline",
    solve(job, onProgress) {
      let cancelled = false;
      const promise = new Promise<JobResult>((resolve, reject) => {
        const run = runJob(job);
        const pump = () => {
          if (cancelled) {
            reject(new CancelledError());
            return;
          }
          const deadline = Date.now() + SLICE_MS;
          try {
            for (;;) {
              const step = run.next();
              if (step.done) {
                resolve(step.value);
                return;
              }
              onProgress?.(step.value);
              if (Date.now() >= deadline) break;
            }
          } catch (error) {
            reject(error);
            return;
          }
          // Yield to the event loop so the page can paint and Stop can land.
          setTimeout(pump, 0);
        };
        setTimeout(pump, 0);
      });
      return {
        promise,
        cancel: () => {
          cancelled = true;
        },
      };
    },
    dispose() {},
  };
}

export function createWorkerHost(worker: Worker): SolverHost {
  let nextId = 1;
  return {
    kind: "worker",
    solve(job, onProgress) {
      const id = nextId;
      nextId += 1;
      let settled = false;

      const promise = new Promise<JobResult>((resolve, reject) => {
        const onMessage = (event: MessageEvent<WorkerOut>) => {
          const message = event.data;
          if (message.id !== id) return;
          if (message.type === "progress") {
            onProgress?.(message.progress);
            return;
          }
          settled = true;
          worker.removeEventListener("message", onMessage);
          if (message.type === "result") resolve(message.result);
          else reject(new Error(message.message));
        };
        worker.addEventListener("message", onMessage);
        const request: WorkerIn = { type: "solve", id, job };
        worker.postMessage(request);
      });

      return {
        promise,
        cancel: () => {
          if (settled) return;
          const request: WorkerIn = { type: "cancel" };
          worker.postMessage(request);
        },
      };
    },
    dispose() {
      worker.terminate();
    },
  };
}

/**
 * A worker host when one can be constructed, an inline host otherwise.
 *
 * Construction is the test, not feature detection: `typeof Worker` is defined
 * on a `file://` page even though building a module worker there throws.
 */
export function createSolverHost(): SolverHost {
  if (typeof Worker !== "undefined") {
    try {
      return createWorkerHost(makeWorker());
    } catch {
      // Fall through to inline. In the single-file build `makeWorker` is aliased
      // to a stub that always throws, so this is the only path there.
    }
  }
  return createInlineHost();
}

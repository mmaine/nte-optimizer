/**
 * The worker entry point.
 *
 * It does nothing but pump `runJob` and post what comes out, so the only
 * difference between running here and running inline is which thread blocks.
 */
import { runJob, type JobProgress, type JobResult, type SolveJob } from "./job.ts";

export type WorkerIn = { type: "solve"; id: number; job: SolveJob } | { type: "cancel" };

export type WorkerOut =
  | { type: "progress"; id: number; progress: JobProgress }
  | { type: "result"; id: number; result: JobResult }
  | { type: "error"; id: number; message: string };

let cancelled = false;

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }

  cancelled = false;
  const { id, job } = message;
  try {
    const run = runJob(job);
    let step = run.next();
    while (!step.done) {
      if (cancelled) return;
      const out: WorkerOut = { type: "progress", id, progress: step.value };
      self.postMessage(out);
      step = run.next();
    }
    if (cancelled) return;
    const out: WorkerOut = { type: "result", id, result: step.value };
    self.postMessage(out);
  } catch (error) {
    const out: WorkerOut = {
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(out);
  }
};

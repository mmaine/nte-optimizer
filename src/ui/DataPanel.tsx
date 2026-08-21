/**
 * Import and export.
 *
 * Two separate things, labelled separately because they are not the same and
 * confusing them loses work:
 *
 * - **Import gear capture** replaces what you own, from the game.
 * - **Import database** replaces your whole workspace, from a file this app
 *   wrote - including everything you configured by hand.
 *
 * A capture import is validated first and shown as a diff before it is applied,
 * because it is deliberate and irreversible. `Restore pre-import state` is the
 * way back, and is deliberately not called undo: it is one snapshot, not a
 * history.
 */
import { useRef, useState } from "react";

import { fileName } from "../db/dbfile.ts";
import type { ImportResult } from "../db/import.ts";
import { useAppState, useStore } from "./useStore.ts";

async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

/**
 * Hand the browser a file.
 *
 * A blob URL and a click, revoked afterwards - the same call works in the
 * hosted build and is the only save path the `file://` build has at all, since
 * it cannot reach IndexedDB.
 */
function download(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DataPanel({ gamedataVersion }: { gamedataVersion: string | null }) {
  const store = useStore();
  const state = useAppState();
  const [pending, setPending] = useState<ImportResult | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const gearInput = useRef<HTMLInputElement>(null);
  const dbInput = useRef<HTMLInputElement>(null);

  const reviewGear = async (file: File) => {
    setProblems([]);
    setNote(null);
    try {
      setPending(store.reviewImport(await readJson(file)));
    } catch (error) {
      setProblems([error instanceof Error ? error.message : String(error)]);
    }
  };

  const apply = async () => {
    if (!pending?.ok) return;
    await store.applyReviewedImport(pending);
    setPending(null);
    setNote("Gear imported.");
  };

  return (
    <section className="data">
      <h2>Data</h2>

      <div className="actions">
        <button onClick={() => gearInput.current?.click()}>Import gear capture</button>
        <input
          ref={gearInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void reviewGear(file);
            event.target.value = "";
          }}
        />

        <button
          onClick={() =>
            download(fileName(), JSON.stringify(store.exportFile(gamedataVersion)))
          }
        >
          Export database
        </button>
        <button onClick={() => dbInput.current?.click()}>Import database</button>
        <input
          ref={dbInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void (async () => {
                setNote(null);
                try {
                  const found = await store.importFile(await readJson(file));
                  setProblems(found);
                  if (found.length === 0) setNote("Database restored.");
                } catch (error) {
                  setProblems([error instanceof Error ? error.message : String(error)]);
                }
              })();
            }
            event.target.value = "";
          }}
        />

        {state.data.snapshot && (
          <button
            onClick={() => {
              void store.restorePreImport().then((done) => {
                setNote(done ? "Restored the state from before the last import." : null);
              });
            }}
          >
            Restore pre-import state
          </button>
        )}
      </div>

      {note && <p className="dim">{note}</p>}
      {problems.length > 0 && (
        <ul className="problem">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {pending && <ImportReview result={pending} onApply={apply} onCancel={() => setPending(null)} />}
    </section>
  );
}

function ImportReview({
  result,
  onApply,
  onCancel,
}: {
  result: ImportResult;
  onApply: () => Promise<void>;
  onCancel: () => void;
}) {
  const { report } = result;
  return (
    <div className="review">
      <p>
        <strong>
          {report.expected ?? "?"} expected, {report.parsed} parsed, {report.rejected} rejected
        </strong>
      </p>

      {result.ok ? (
        <>
          <p className="warning">
            Importing replaces every item and every equipped loadout. Anything you equipped in
            the app but have not applied in game will be lost. Your Arcs, targets, priorities and
            group names are kept.
          </p>
          <div className="actions">
            <button onClick={() => void onApply()}>Import</button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {/* Fail closed: nothing at all is written when anything is wrong. */}
          <p className="problem">Nothing was imported.</p>
          <ul className="problem">
            {report.problems.slice(0, 20).map((problem, index) => (
              <li key={`${problem.code}-${index}`}>
                {problem.code}: {problem.detail}
                {problem.subject ? ` (${problem.subject})` : ""}
              </li>
            ))}
          </ul>
          {report.problems.length > 20 && (
            <p className="dim">…and {report.problems.length - 20} more.</p>
          )}
          <div className="actions">
            <button onClick={onCancel}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}

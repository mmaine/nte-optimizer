/**
 * Hash routing.
 *
 * About forty lines instead of a router dependency, and it is what makes the
 * single-file `file://` build work without a second code path - a history
 * router would need a server rewrite that a local file has no way to provide.
 */
import { useEffect, useState } from "react";

export const TABS = ["cartridges", "modules", "characters", "team"] as const;
export type Tab = (typeof TABS)[number];

export interface Route {
  tab: Tab;
  /** The character a detail view is open on, if any. */
  id: string | null;
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const tab = (TABS as readonly string[]).includes(parts[0] ?? "")
    ? (parts[0] as Tab)
    : "characters";
  return { tab, id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

export function hashFor(tab: Tab, id?: string | null): string {
  return id ? `#/${tab}/${encodeURIComponent(id)}` : `#/${tab}`;
}

export function navigate(tab: Tab, id?: string | null): void {
  window.location.hash = hashFor(tab, id);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

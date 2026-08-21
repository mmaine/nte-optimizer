import { describe, expect, it } from "vitest";

import { hashFor, parseHash, TABS } from "../src/ui/router.ts";

describe("hash routing", () => {
  it("round-trips every tab", () => {
    for (const tab of TABS) {
      expect(parseHash(hashFor(tab))).toEqual({ tab, id: null });
    }
  });

  it("carries a character id, encoded", () => {
    const hash = hashFor("characters", "Chiichan073");
    expect(parseHash(hash)).toEqual({ tab: "characters", id: "Chiichan073" });
    // A name with a slash must not read as a third path segment.
    expect(parseHash(hashFor("characters", "a/b"))).toEqual({ tab: "characters", id: "a/b" });
  });

  it("falls back to characters for anything unrecognised", () => {
    expect(parseHash("").tab).toBe("characters");
    expect(parseHash("#/nonsense").tab).toBe("characters");
    expect(parseHash("#").tab).toBe("characters");
  });

  it("accepts a hash with or without the leading slash", () => {
    expect(parseHash("#team").tab).toBe("team");
    expect(parseHash("#/team").tab).toBe("team");
  });
});

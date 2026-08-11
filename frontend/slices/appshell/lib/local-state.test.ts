import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_STATE_KIND,
  LOCAL_STATE_SCHEMA,
  collectLocalState,
  localStateFilename,
  ownsKey,
  parseLocalState,
  restoreLocalState,
  type LocalStateBlob,
} from "./local-state";

// vitest runs this suite under `environment: "node"`, which has no Web Storage.
// A Map-backed stand-in is enough: the module only uses length/key/getItem/
// setItem/removeItem. `key(i)` re-materialises the key list on every call, which
// is what reproduces Storage's live-collection semantics — delete during an
// indexed walk and the tail shifts down under you. The multi-key REPLACE test
// below depends on that fidelity; a snapshot-once fake would pass either way.
function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(seed));
  const fake: Storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });
  return map;
}

const SEED = {
  "alfa.automations": '[{"id":"nightly"}]',
  "alfa.agents": '[{"id":"ops"}]',
  "mso:layout": '{"windows":[]}',
  "mso:apps": '["files"]',
  "sv:dock": '{"size":"md"}',
  "reel.draft": '{"clips":[]}',
  "mso.device.id": "deadbeefdeadbeefdeadbeefdeadbeef", // denied: second auth factor
  "mso:demo-fs": "{}", // denied: regenerable mock data
  "ext-analytics-consent": "1", // not ours
};

describe("ownsKey", () => {
  it("takes the namespaced prefixes and the legacy allowlist, minus the deny list", () => {
    expect(ownsKey("mso:layout")).toBe(true);
    expect(ownsKey("sv:dock")).toBe(true);
    expect(ownsKey("alfa.skills")).toBe(true);
    expect(ownsKey("reel.settings")).toBe(true);
    expect(ownsKey("mso.device.id")).toBe(false);
    expect(ownsKey("mso:demo-fs")).toBe(false);
    expect(ownsKey("ext-analytics-consent")).toBe(false);
  });
});

describe("round trip", () => {
  beforeEach(() => installStorage(SEED));

  it("exports every owned key and no other, then restores them verbatim", () => {
    const blob = collectLocalState("1.2.3");
    expect(blob.kind).toBe(LOCAL_STATE_KIND);
    expect(blob.schema).toBe(LOCAL_STATE_SCHEMA);
    expect(blob.appVersion).toBe("1.2.3");
    expect(Object.keys(blob.keys).sort()).toEqual([
      "alfa.agents",
      "alfa.automations",
      "mso:apps",
      "mso:layout",
      "reel.draft",
      "sv:dock",
    ]);

    const map = installStorage({ "mso.device.id": "cafebabecafebabecafebabecafebabe" });
    const { restored, skipped } = restoreLocalState(blob);
    expect(skipped).toEqual([]);
    expect(restored.sort()).toEqual(Object.keys(blob.keys).sort());
    expect(map.get("alfa.automations")).toBe('[{"id":"nightly"}]');
    expect(map.get("sv:dock")).toBe('{"size":"md"}');
    // The blob never carried it, so the browser keeps the id it already had —
    // an import must not re-approve the device it is imported into.
    expect(map.get("mso.device.id")).toBe("cafebabecafebabecafebabecafebabe");
  });

  it("REPLACES: an owned key added after the export is gone after the restore", () => {
    const blob = collectLocalState("1.2.3");
    const map = installStorage({ ...SEED, "alfa.skills": '[{"id":"added-later"}]' });
    restoreLocalState(blob);
    expect(map.has("alfa.skills")).toBe(false);
    // Foreign and denied keys are outside the replace, so they survive.
    expect(map.get("ext-analytics-consent")).toBe("1");
    expect(map.get("mso:demo-fs")).toBe("{}");
  });

  // Three consecutive stale keys, not one: an indexed walk that deletes as it
  // goes removes 1st and 3rd and SKIPS the 2nd, so a single-key case passes even
  // when the iteration is wrong. This is the case that pins the array snapshot in
  // ownedKeys — drop it and a restore silently leaves a third of the stale
  // Playbooks behind, which reads as "the backup was incomplete".
  it("REPLACES every stale key, not every other one", () => {
    const blob = collectLocalState("1.2.3");
    const map = installStorage({
      ...SEED,
      "alfa.skills": "[]",
      "mso:desktop-icons": "{}",
      "sv:wallpaper": '"a.png"',
    });
    restoreLocalState(blob);
    expect(map.has("alfa.skills")).toBe(false);
    expect(map.has("mso:desktop-icons")).toBe(false);
    expect(map.has("sv:wallpaper")).toBe(false);
  });

  it("survives a parse of its own serialized output", () => {
    const text = JSON.stringify(collectLocalState("1.2.3"));
    const res = parseLocalState(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.unknown).toEqual([]);
  });
});

describe("parseLocalState rejection", () => {
  it("refuses a schema it does not understand instead of half-restoring it", () => {
    const future = JSON.stringify({ kind: LOCAL_STATE_KIND, schema: LOCAL_STATE_SCHEMA + 1, keys: { "mso:layout": "{}" } });
    const res = parseLocalState(future);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/schema 2/);
  });

  it("refuses non-JSON, a non-object, a foreign file and a non-string value", () => {
    for (const bad of ["not json", "[]", "null", JSON.stringify({ kind: "something.else", schema: 1, keys: {} })]) {
      expect(parseLocalState(bad).ok).toBe(false);
    }
    // Carries valid metadata on purpose: the appVersion/exportedAt guard runs
    // first, so without these the case would pass on the WRONG branch and stop
    // testing the non-string value it is named for.
    const numeric = JSON.stringify({
      kind: LOCAL_STATE_KIND,
      schema: LOCAL_STATE_SCHEMA,
      appVersion: "1.2.3",
      exportedAt: new Date().toISOString(),
      keys: { "mso:layout": 42 },
    });
    const res = parseLocalState(numeric);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/non-string/);
  });

  it("refuses a file whose version or timestamp is not a string", () => {
    // The confirm dialog interpolates both into the sentence the user approves.
    const bad = JSON.stringify({
      kind: LOCAL_STATE_KIND,
      schema: LOCAL_STATE_SCHEMA,
      appVersion: { major: 1 },
      exportedAt: new Date().toISOString(),
      keys: { "mso:layout": "{}" },
    });
    expect(parseLocalState(bad).ok).toBe(false);
  });
});

describe("unrecognised keys", () => {
  const blob: LocalStateBlob = {
    kind: LOCAL_STATE_KIND,
    schema: LOCAL_STATE_SCHEMA,
    appVersion: "9.9.9",
    exportedAt: new Date().toISOString(),
    keys: { "mso:layout": '{"windows":[]}', "future.feature": "x", "mso.device.id": "beef" },
  };

  it("reports them at parse time rather than dropping them behind the user's back", () => {
    const res = parseLocalState(JSON.stringify(blob));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.known).toEqual(["mso:layout"]);
    expect(res.unknown.sort()).toEqual(["future.feature", "mso.device.id"]);
  });

  it("does not write them, and names them in `skipped`", () => {
    const map = installStorage();
    const { restored, skipped } = restoreLocalState(blob);
    expect(restored).toEqual(["mso:layout"]);
    expect(skipped.sort()).toEqual(["future.feature", "mso.device.id"]);
    expect(map.has("future.feature")).toBe(false);
    expect(map.has("mso.device.id")).toBe(false);
  });
});

describe("localStateFilename", () => {
  it("date-stamps so two exports don't collapse onto one download", () => {
    expect(localStateFilename(new Date("2026-08-11T10:00:00Z"))).toBe("mso-backup-2026-08-11.json");
  });
});

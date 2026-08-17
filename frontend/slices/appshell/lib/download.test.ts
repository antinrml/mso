// Two rules, one helper, and both of them shipped WRONG somewhere before it
// existed: an anchor that is never inserted (Firefox ignores `download` on a
// detached element, so Settings → Backup saved nothing there) and a blob: URL
// revoked in the click's own tick (0-byte file in Firefox/Safari).
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveAs } from "./download";

interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  clicked: boolean;
  /** Was the element in the document AT THE MOMENT of the click? */
  inDocumentAtClick: boolean | null;
  removed: boolean;
}

function fakeDoc(): { doc: Document; anchor: () => FakeAnchor } {
  let made: FakeAnchor | null = null;
  const attached = new Set<object>();
  const doc = {
    createElement: () => {
      const a: FakeAnchor & { remove: () => void; click: () => void } = {
        href: "",
        download: "",
        rel: "",
        clicked: false,
        inDocumentAtClick: null,
        removed: false,
        click() {
          a.clicked = true;
          a.inDocumentAtClick = attached.has(a);
        },
        remove() {
          a.removed = true;
          attached.delete(a);
        },
      };
      made = a;
      return a;
    },
    body: { appendChild: (el: object) => attached.add(el) },
  } as unknown as Document;
  return { doc, anchor: () => made as unknown as FakeAnchor };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saveAs", () => {
  it("clicks an anchor that is IN the document, then removes it", () => {
    const { doc, anchor } = fakeDoc();
    saveAs("/api/v1/fs/raw?path=%2Ftmp%2Fa.png", "a.png", doc);
    const a = anchor();
    expect(a.clicked).toBe(true);
    expect(a.inDocumentAtClick).toBe(true); // the whole reason this helper exists
    expect(a.removed).toBe(true);
    expect(a.download).toBe("a.png");
    expect(a.rel).toBe("noopener");
  });

  it("revokes a blob: URL LATER, never in the click's own tick", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    const { doc } = fakeDoc();
    saveAs("blob:http://localhost/abc", "state.json", doc);
    expect(revoke).not.toHaveBeenCalled(); // same tick = 0-byte download
    vi.advanceTimersByTime(5_000);
    expect(revoke).toHaveBeenCalledWith("blob:http://localhost/abc");
  });

  it("does not pretend to revoke a URL it never created", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    const { doc } = fakeDoc();
    saveAs("data:image/png;base64,iVBORw0KGgo=", "shot.png", doc);
    vi.advanceTimersByTime(5_000);
    expect(revoke).not.toHaveBeenCalled();
  });
});

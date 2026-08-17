// Two tables, one contract. Preview decides HOW to render a file from its
// extension (frontend/slices/media-viewer/lib/kinds.ts); /api/v1/fs/raw decides
// what Content-Type those bytes are served with (lib/host/fs.ts). They live in
// different halves of the app and nothing connected them.
//
// The failure that gap produces is silent and looks like a broken app: Preview
// renders <video src=…> for a `.m4v`, the server answers
// application/octet-stream, the element errors, and the operator sees "this
// browser could not decode the file" about a file their browser decodes fine.
//
// The second direction matters more. Adding `html: "text/html"` to that map would
// turn any file on the host into an ACTIVE document on the cockpit's own origin,
// with the session cookie attached — the exact hazard the SVG `sandbox` header
// already exists for. Preview reads text and HTML with fetch() precisely so the
// map never needs an executable type, and this test is what keeps a future
// "helpful" addition from undoing that.
import { describe, expect, it, vi } from "vitest";
import { kindForExt } from "./kinds";

// The server module is server-only and imports nothing else heavy; the shim is
// what every other test of lib/host uses.
vi.mock("server-only", () => ({}));
const { mimeFor } = await import("@/lib/host/fs");

/** Every extension the viewer claims it can render from a URL. */
const STREAMED = [
  "png jpg jpeg jfif gif webp avif bmp ico svg tif tiff heic heif",
  "mp4 m4v mov webm ogv mkv avi wmv mpg mpeg 3gp",
  "mp3 wav m4a aac flac ogg oga opus aiff aif wma",
  "pdf",
]
  .join(" ")
  .split(" ");

/** What the viewer fetches and renders itself — never framed from the raw URL. */
const FETCHED = ["html", "htm", "xhtml", "md", "csv", "tsv", "txt", "log", "json", "xml", "yml"];

describe("Preview kinds ↔ the raw-bytes MIME map", () => {
  it("serves a real type for every format Preview points an element at", () => {
    const missing = STREAMED.filter((ext) => mimeFor(`f.${ext}`) === "application/octet-stream");
    expect(missing, "these render as an element but download as a blob").toEqual([]);
  });

  it("agrees with the viewer about which family each one is", () => {
    const family: Record<string, string> = { image: "image/", video: "video/", audio: "audio/", pdf: "application/pdf" };
    const wrong = STREAMED.filter((ext) => {
      const kind = kindForExt(ext);
      const prefix = family[kind];
      return !prefix || !mimeFor(`f.${ext}`).startsWith(prefix);
    });
    expect(wrong, "the viewer's family and the served Content-Type disagree").toEqual([]);
  });

  it("NEVER serves an executable document type", () => {
    // Not "html is absent" — any type a browser would run as a document on our
    // origin. If one appears here, the fix is to keep reading those bytes with
    // fetch() in the viewer, not to relax this test.
    const active = FETCHED.map((ext) => mimeFor(`f.${ext}`)).filter((m) =>
      /^text\/html|xhtml|^application\/xml|javascript/.test(m),
    );
    expect(active).toEqual([]);
  });

  it("keeps SVG in the map, because the route hardens it explicitly", () => {
    // fs.ts pairs image/svg+xml with `content-security-policy: sandbox` — dropping
    // the MIME would silently drop that pairing too.
    expect(mimeFor("logo.svg")).toBe("image/svg+xml");
    expect(kindForExt("svg")).toBe("image");
  });
});

import { describe, expect, it, vi } from "vitest";
import { apiError } from "./api-error";
import { HostError } from "./host-error";

describe("apiError", () => {
  const errno = (code: string) => Object.assign(new Error(`${code}: nope, realpath '/secret/path'`), { code });

  it("passes a curated HostError through as a 400 — those messages are UX", async () => {
    const r = apiError("fs/read", new HostError("Outside the read roots"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Outside the read roots" });
  });

  it("maps ENOENT to 404 — a missing file is not a broken server", async () => {
    // Caught by the browser e2e as `500 GET /api/v1/fs/read` for a path the code
    // editor had opened out of MOCK data. A 500 sends everyone hunting the server.
    const r = apiError("fs/read", errno("ENOENT"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not found" });
  });

  it("maps ENOTDIR to 404 and EACCES/EPERM to 403", () => {
    expect(apiError("fs/list", errno("ENOTDIR")).status).toBe(404);
    expect(apiError("fs/read", errno("EACCES")).status).toBe(403);
    expect(apiError("fs/read", errno("EPERM")).status).toBe(403);
  });

  it("still 500s anything it does not recognise", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(apiError("fs/read", new Error("boom")).status).toBe(500);
    spy.mockRestore();
  });

  it("never echoes the raw Node message — it carries an absolute path", async () => {
    const body = JSON.stringify(await apiError("fs/read", errno("ENOENT")).json());
    expect(body).not.toContain("/secret/path");
    expect(body).not.toContain("nope");
  });
});

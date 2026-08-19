import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeTempShare, createTempShare, inspectTempShare, tempShareUrl } from "./temp-share";

const ROOT = path.join(os.tmpdir(), `mso-temp-shares-${process.pid}`);

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("authenticated temporary downloads", () => {
  it("keeps bytes outside public/, sanitizes the name and spends download allowances", async () => {
    const created = await createTempShare({
      data: Buffer.from("hello"),
      filename: '../bad/"shot".png',
      mimeType: "image/png",
      maxDownloads: 2,
    });

    expect(created.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.name).toBe("_shot_.png");
    expect(created.bytes).toBe(5);
    expect(created.downloadsLeft).toBe(2);

    const first = await consumeTempShare(created.id);
    expect(first.data.toString()).toBe("hello");
    expect(first.downloadsLeft).toBe(1);
    expect((await inspectTempShare(created.id)).downloadsLeft).toBe(1);

    const second = await consumeTempShare(created.id);
    expect(second.data.toString()).toBe("hello");
    await expect(inspectTempShare(created.id)).rejects.toThrow("unknown or expired");
  });

  it("builds HTTPS production links and refuses an insecure public origin", async () => {
    const created = await createTempShare({ data: Buffer.from("x"), filename: "x.png", mimeType: "image/png" });
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test/some/path");
    expect(tempShareUrl(created.id)).toBe(`https://mso.example.test/api/v1/temp-share/${created.id}`);
    expect(tempShareUrl(created.id, true)).toBe(`https://mso.example.test/api/v1/temp-share/${created.id}?download=1`);

    vi.stubEnv("OS_PUBLIC_ORIGIN", "http://mso.example.test");
    expect(() => tempShareUrl(created.id)).toThrow("must use HTTPS");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const uploadInto = vi.fn(async () => ({ written: 1, failed: [] as string[] }));
vi.mock("@/lib/host", async (orig) => {
  const real = await orig<typeof import("@/lib/host")>();
  return { ...real, uploadInto };
});

const { importOpenAiProvidedFile } = await import("./openai-file-upload");

beforeEach(() => {
  uploadInto.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": "4" },
  })));
});

describe("ChatGPT file host allowlist", () => {
  const importUrl = async (download_url: string, file_id = "file_test") => importOpenAiProvidedFile({
    file: {
      download_url,
      file_id,
      mime_type: "image/png",
      file_name: "file.png",
      size: 4,
    },
    dest: "/home/antinrml/generated-images",
    filename: "file.png",
  });

  it.each([
    "oaisdmntprseasia.blob.core.windows.net",
    "oaisdmntpraustraliaeast.blob.core.windows.net",
    "oaisdmntprnznorth.blob.core.windows.net",
    "oaisdmntprindiasocentral.blob.core.windows.net",
    "oaisdmntprfuture123.blob.core.windows.net",
  ])("accepts OpenAI regional Azure storage account %s", async (host) => {
    const result = await importUrl(`https://${host}/container/file.png?sig=redacted`);
    expect(result.bytes).toBe(4);
    expect(uploadInto).toHaveBeenCalledTimes(1);
  });

  it.each([
    "attacker.blob.core.windows.net",
    "oaisdmntpr.blob.core.windows.net",
    "oaisdmntpr-seasia.blob.core.windows.net",
    "evil.oaisdmntprseasia.blob.core.windows.net",
    "oaisdmntprseasia.blob.core.windows.net.evil.example",
  ])("rejects non-OpenAI/lookalike Azure host %s", async (host) => {
    await expect(importUrl(`https://${host}/container/file.png`)).rejects.toThrow("host is not allowed");
    expect(uploadInto).not.toHaveBeenCalled();
  });

  it("rejects a redirect from an allowed OpenAI host to an unrelated host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.blob.core.windows.net/container/file.png" },
    })));
    await expect(importUrl("https://oaisdmntprseasia.blob.core.windows.net/container/file.png"))
      .rejects.toThrow("host is not allowed: attacker.blob.core.windows.net");
    expect(uploadInto).not.toHaveBeenCalled();
  });

  it("allows redirects only when every hop remains on a trusted OpenAI host", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://oaisdmntprfuture123.blob.core.windows.net/container/file.png?sig=next" },
      }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "4" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await importUrl("https://files.oaiusercontent.com/start/file.png");
    expect(result.bytes).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploadInto).toHaveBeenCalledTimes(1);
  });
});

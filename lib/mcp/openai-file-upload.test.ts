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
  it("accepts the observed OpenAI Southeast Asia blob host", async () => {
    const result = await importOpenAiProvidedFile({
      file: {
        download_url: "https://oaisdmntprseasia.blob.core.windows.net/container/file.png?sig=redacted",
        file_id: "file_test",
        mime_type: "image/png",
        file_name: "file.png",
        size: 4,
      },
      dest: "/home/antinrml/generated-images",
      filename: "file.png",
    });
    expect(result.bytes).toBe(4);
    expect(uploadInto).toHaveBeenCalledTimes(1);
  });

  it("rejects an unrelated Azure blob account", async () => {
    await expect(importOpenAiProvidedFile({
      file: {
        download_url: "https://attacker.blob.core.windows.net/container/file.png",
        file_id: "file_test",
        mime_type: "image/png",
      },
      dest: "/home/antinrml/generated-images",
    })).rejects.toThrow("host is not allowed: attacker.blob.core.windows.net");
  });
});

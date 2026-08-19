import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const state = vi.hoisted(() => ({ key: "sk-test" }));
vi.mock("@/lib/config/store", () => ({
  hostCredentialStore: () => ({ getKey: async () => state.key }),
}));

const {
  generateOpenAiImage,
  imageGenerationStatus,
  shouldReturnDirectImage,
} = await import("./openai");

let root = "";
const realFetch = globalThis.fetch;

function fakePng(width = 1, height = 1, colorType = 6): Buffer {
  const out = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(out, 0);
  out.writeUInt32BE(13, 8);
  out.write("IHDR", 12, "ascii");
  out.writeUInt32BE(width, 16);
  out.writeUInt32BE(height, 20);
  out[24] = 8;
  out[25] = colorType;
  return out;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-image-generation-"));
  process.env.OS_FS_WRITE_ROOTS = root;
  process.env.OS_IMAGE_OUTPUT_ROOT = path.join(root, "images");
  process.env.OS_IMAGE_MODEL = "gpt-image-2";
  state.key = "sk-test";
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.OS_FS_WRITE_ROOTS;
  delete process.env.OS_IMAGE_OUTPUT_ROOT;
  delete process.env.OS_IMAGE_MODEL;
  await fs.rm(root, { recursive: true, force: true });
});

describe("OpenAI image generation bridge", () => {
  it("reports readiness without exposing the key", async () => {
    const status = await imageGenerationStatus();
    expect(status).toMatchObject({ ready: true, provider: "openai", credential: "configured" });
    expect(JSON.stringify(status)).not.toContain("sk-test");
  });

  it("persists one PNG master and prompt-free provenance with provider request id", async () => {
    const png = fakePng();
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        created: 1_787_161_600,
        data: [{ b64_json: png.toString("base64") }],
        usage: { total_tokens: 123 },
      }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test_123" } });
    });

    const result = await generateOpenAiImage({
      prompt: "private studio prompt",
      project: "antinrml-game",
      filenameStem: "zone-house-empty",
      size: "auto",
      quality: "high",
      background: "opaque",
    });

    expect(sent).toMatchObject({ model: "gpt-image-2", output_format: "png", n: 1 });
    expect(result.summary).toMatchObject({
      provider: "openai",
      generationRunId: "req_test_123",
      width: 1,
      height: 1,
      lossless: true,
      candidateEligible: true,
    });
    expect(await fs.readFile(result.summary.masterPath)).toEqual(png);
    const provenance = await fs.readFile(result.summary.provenancePath, "utf8");
    expect(provenance).toContain('"promptSha256"');
    expect(provenance).toContain('"generationRunId": "req_test_123"');
    expect(provenance).not.toContain("private studio prompt");
  });

  it("uses gpt-image-1.5 automatically for transparent output", async () => {
    const png = fakePng();
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
        status: 200,
        headers: { "x-request-id": "req_transparent" },
      });
    });
    await generateOpenAiImage({ prompt: "one prop", size: "auto", background: "transparent" });
    expect(sent).toMatchObject({ model: "gpt-image-1.5", background: "transparent" });
  });

  it("refuses an explicit transparent gpt-image-2 request before spending", async () => {
    globalThis.fetch = vi.fn();
    await expect(generateOpenAiImage({
      prompt: "one prop",
      model: "gpt-image-2",
      background: "transparent",
    })).rejects.toThrow(/does not support transparent/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails clearly when the OpenAI API key is absent", async () => {
    state.key = "";
    await expect(generateOpenAiImage({ prompt: "x" })).rejects.toThrow(/not configured/);
  });

  it("keeps an output sandbox-only when provider request id is missing", async () => {
    const png = fakePng();
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
      { status: 200 },
    ));
    const result = await generateOpenAiImage({ prompt: "x", size: "auto" });
    expect(result.summary.generationRunId).toBeNull();
    expect(result.summary.candidateEligible).toBe(false);
    expect(result.summary.findings).toContain("provider request id missing");
  });

  it("bounds direct image responses", () => {
    expect(shouldReturnDirectImage(1)).toBe(true);
    expect(shouldReturnDirectImage(9 * 1024 * 1024)).toBe(false);
  });
});

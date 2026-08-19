import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { hostCredentialStore } from "@/lib/config/store";
import { createTempShare, tempShareUrl } from "@/lib/host/temp-share";
import { isUnderRoot, resolveWriteRoots, safeWritePath } from "@/lib/host/paths";

const OPENAI_IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";
const DEFAULT_MODEL = "gpt-image-2" as const;
const TRANSPARENT_MODEL = "gpt-image-1.5" as const;
const DEFAULT_OUTPUT_ROOT = path.join(os.homedir(), "generated-images");
const MAX_PROMPT_CHARS = 32_000;
const MAX_PROVIDER_BYTES = 64 * 1024 * 1024;
const TEMP_SHARE_MAX_BYTES = 10 * 1024 * 1024;
const DIRECT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const OPENAI_IMAGE_MODELS = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
] as const;
export type OpenAiImageModel = (typeof OPENAI_IMAGE_MODELS)[number];

export const OPENAI_IMAGE_SIZES = ["auto", "1024x1024", "1024x1536", "1536x1024"] as const;
export type OpenAiImageSize = (typeof OPENAI_IMAGE_SIZES)[number];

export const OPENAI_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type OpenAiImageQuality = (typeof OPENAI_IMAGE_QUALITIES)[number];

export const OPENAI_IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
export type OpenAiImageBackground = (typeof OPENAI_IMAGE_BACKGROUNDS)[number];

export interface GenerateOpenAiImageInput {
  prompt: string;
  project?: string;
  filenameStem?: string;
  model?: OpenAiImageModel;
  size?: OpenAiImageSize;
  quality?: OpenAiImageQuality;
  background?: OpenAiImageBackground;
}

export interface GeneratedImageSummary {
  generationMethod: "image-generation";
  provider: "openai";
  model: OpenAiImageModel;
  generationRunId: string | null;
  generationRunIdKind: "provider-request-id" | null;
  localRunId: string;
  promptSha256: string;
  masterPath: string;
  provenancePath: string;
  width: number;
  height: number;
  format: "png";
  mimeType: "image/png";
  lossless: true;
  alphaStatus: "present" | "absent";
  bytes: number;
  sha256: string;
  candidateEligible: boolean;
  findings: string[];
  previewUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
}

export interface GeneratedImageResult {
  summary: GeneratedImageSummary;
  data: Buffer;
}

function configuredOutputRoot(): string {
  const raw = process.env.OS_IMAGE_OUTPUT_ROOT?.trim();
  if (!raw) return DEFAULT_OUTPUT_ROOT;
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function configuredModel(): OpenAiImageModel {
  const raw = process.env.OS_IMAGE_MODEL?.trim();
  return isOneOf(raw, OPENAI_IMAGE_MODELS) ? raw : DEFAULT_MODEL;
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function assertOneOf<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
  fallback: T[number],
): T[number] {
  if (value == null || value === "") return fallback;
  if (!isOneOf(value, values)) throw new Error(`${field} must be one of: ${values.join(", ")}`);
  return value;
}

function cleanSegment(value: string | undefined, fallback: string, max: number): string {
  const normalized = (value ?? fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, max);
  return normalized || fallback;
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function redactProviderError(raw: string, prompt: string): string {
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string; type?: string } };
    message = parsed.error?.message ?? parsed.error?.code ?? parsed.error?.type ?? raw;
  } catch {
    // Keep the raw provider text when it was not JSON.
  }
  if (prompt) message = message.split(prompt).join("[prompt]");
  return message
    .replace(/\b(?:sk|pk)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(?:sk-proj|sk-live)-[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .slice(0, 500);
}

function parsePngMetadata(data: Buffer): { width: number; height: number; hasAlpha: boolean } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 33 || !data.subarray(0, 8).equals(signature)) {
    throw new Error("OpenAI returned bytes that are not a PNG image");
  }
  if (data.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("OpenAI PNG is missing the IHDR header");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25] ?? 0;
  let hasTransparencyChunk = false;
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const next = offset + 12 + length;
    if (next > data.length) break;
    if (type === "tRNS") hasTransparencyChunk = true;
    if (type === "IEND") break;
    offset = next;
  }
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk };
}

function expectedDimensions(size: OpenAiImageSize): { width: number; height: number } | null {
  if (size === "auto") return null;
  const [width, height] = size.split("x").map(Number);
  return { width, height };
}

async function ensureOutputRoot(): Promise<string> {
  const lexical = await safeWritePath(configuredOutputRoot(), false);
  await fs.mkdir(lexical, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(lexical);
  const roots = await resolveWriteRoots();
  if (!roots.some((root) => isUnderRoot(real, root))) {
    throw new Error("OS_IMAGE_OUTPUT_ROOT resolves outside writable roots");
  }
  await fs.chmod(real, 0o700).catch(() => undefined);
  return real;
}

async function makeJobDirectory(root: string, project: string, day: string): Promise<string> {
  const dir = path.join(root, project, day);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(dir);
  if (!isUnderRoot(real, root)) throw new Error("Image output directory escaped its sandbox root");
  await fs.chmod(real, 0o700).catch(() => undefined);
  return real;
}

async function writeExclusive(file: string, data: Buffer | string): Promise<void> {
  await fs.writeFile(file, data, { flag: "wx", mode: 0o600 });
}

function selectedModel(explicit: OpenAiImageModel | undefined, background: OpenAiImageBackground): OpenAiImageModel {
  const base = explicit ?? configuredModel();
  if (!isOneOf(base, OPENAI_IMAGE_MODELS)) throw new Error(`Unsupported OpenAI image model: ${base}`);
  if (background === "transparent" && base === "gpt-image-2") {
    if (explicit) throw new Error("gpt-image-2 does not support transparent backgrounds; use gpt-image-1.5 or gpt-image-1");
    return TRANSPARENT_MODEL;
  }
  return base;
}

export async function imageGenerationStatus(): Promise<Record<string, unknown>> {
  const key = await hostCredentialStore().getKey(undefined, "openai");
  return {
    ready: Boolean(key),
    provider: "openai",
    endpoint: OPENAI_IMAGES_ENDPOINT,
    defaultModel: configuredModel(),
    transparentModel: TRANSPARENT_MODEL,
    outputRoot: configuredOutputRoot(),
    outputFormat: "png",
    losslessMaster: true,
    supportedModels: [...OPENAI_IMAGE_MODELS],
    supportedSizes: [...OPENAI_IMAGE_SIZES],
    supportedQualities: [...OPENAI_IMAGE_QUALITIES],
    supportedBackgrounds: [...OPENAI_IMAGE_BACKGROUNDS],
    credential: key ? "configured" : "missing",
    setup: key
      ? "ready"
      : "Add an OpenAI API key in MSO Settings → AI (provider OpenAI) or set OPENAI_API_KEY. ChatGPT OAuth/Plus is not an OpenAI API key.",
  };
}

export async function generateOpenAiImage(input: GenerateOpenAiImageInput): Promise<GeneratedImageResult> {
  const prompt = input.prompt?.trim() ?? "";
  if (!prompt) throw new Error("prompt must be a non-empty string");
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error(`prompt exceeds ${MAX_PROMPT_CHARS} characters`);

  const key = await hostCredentialStore().getKey(undefined, "openai");
  if (!key) {
    throw new Error(
      "OpenAI image generation is not configured. Add an OpenAI API key in MSO Settings → AI (provider OpenAI) or set OPENAI_API_KEY. ChatGPT OAuth/Plus is separate from API billing.",
    );
  }

  const size = assertOneOf(input.size, OPENAI_IMAGE_SIZES, "size", "1024x1024");
  const quality = assertOneOf(input.quality, OPENAI_IMAGE_QUALITIES, "quality", "high");
  const background = assertOneOf(input.background, OPENAI_IMAGE_BACKGROUNDS, "background", "auto");
  const model = selectedModel(input.model, background);
  const localRunId = randomUUID();
  const promptSha256 = sha256(prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  timeout.unref?.();
  let response: Response;
  try {
    response = await fetch(OPENAI_IMAGES_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-client-request-id": localRunId,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality,
        background,
        output_format: "png",
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("OpenAI image generation timed out after 300 seconds");
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI Images API HTTP ${response.status}: ${redactProviderError(raw, prompt)}`);

  let payload: {
    created?: number;
    data?: Array<{ b64_json?: string }>;
    usage?: unknown;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    throw new Error("OpenAI Images API returned invalid JSON");
  }
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI Images API returned no base64 image bytes");
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > MAX_PROVIDER_BYTES) {
    throw new Error(`OpenAI image bytes must be between 1 and ${MAX_PROVIDER_BYTES} bytes`);
  }

  const png = parsePngMetadata(data);
  const expected = expectedDimensions(size);
  const findings: string[] = [];
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("openai-request-id");
  if (!requestId) findings.push("provider request id missing");
  if (expected && (expected.width !== png.width || expected.height !== png.height)) {
    findings.push(`provider returned ${png.width}x${png.height}, expected ${expected.width}x${expected.height}`);
  }
  if (background === "transparent" && !png.hasAlpha) findings.push("transparent background requested but PNG has no alpha channel");

  const root = await ensureOutputRoot();
  const project = cleanSegment(input.project, "general", 48);
  const stem = cleanSegment(input.filenameStem, "generated-image", 64);
  const createdAt = new Date().toISOString();
  const day = createdAt.slice(0, 10);
  const stamp = createdAt.replace(/[:.]/g, "-");
  const jobDir = await makeJobDirectory(root, project, day);
  const base = `${stamp}-${localRunId.slice(0, 8)}-${stem}`;
  const masterPath = path.join(jobDir, `${base}.png`);
  const provenancePath = path.join(jobDir, `${base}.provenance.json`);
  const bytesSha256 = sha256(data);
  const candidateEligible = findings.length === 0;

  const provenance = {
    schemaVersion: 1,
    generationMethod: "image-generation",
    provider: "openai",
    model,
    generationRunId: requestId,
    generationRunIdKind: requestId ? "provider-request-id" : null,
    localRunId,
    promptSha256,
    referenceInputs: [],
    request: { size, quality, background, outputFormat: "png", n: 1 },
    providerCreatedAt: payload.created ? new Date(payload.created * 1000).toISOString() : null,
    usage: payload.usage ?? null,
    generatedMaster: {
      sandboxOnly: true,
      path: masterPath,
      width: png.width,
      height: png.height,
      format: "png",
      mimeType: "image/png",
      lossless: true,
      alphaStatus: png.hasAlpha ? "present" : "absent",
      bytes: data.length,
      sha256: bytesSha256,
    },
    convertedFromLegacyAsset: false,
    rasterizedFromSvg: false,
    tracedExistingArtwork: false,
    candidateEligible,
    findings,
    createdAt,
  };

  try {
    await writeExclusive(masterPath, data);
    await writeExclusive(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  } catch (error) {
    await fs.rm(masterPath, { force: true }).catch(() => undefined);
    await fs.rm(provenancePath, { force: true }).catch(() => undefined);
    throw error;
  }

  let previewUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (data.length <= TEMP_SHARE_MAX_BYTES) {
    try {
      const share = await createTempShare({
        data,
        filename: path.basename(masterPath),
        mimeType: "image/png",
        ttlMs: 30 * 60_000,
        maxDownloads: 5,
      });
      previewUrl = tempShareUrl(share.id);
      downloadUrl = tempShareUrl(share.id, true);
    } catch {
      // The durable sandbox path remains the source of truth when preview creation fails.
    }
  }

  return {
    data,
    summary: {
      generationMethod: "image-generation",
      provider: "openai",
      model,
      generationRunId: requestId,
      generationRunIdKind: requestId ? "provider-request-id" : null,
      localRunId,
      promptSha256,
      masterPath,
      provenancePath,
      width: png.width,
      height: png.height,
      format: "png",
      mimeType: "image/png",
      lossless: true,
      alphaStatus: png.hasAlpha ? "present" : "absent",
      bytes: data.length,
      sha256: bytesSha256,
      candidateEligible,
      findings,
      previewUrl,
      downloadUrl,
      createdAt,
    },
  };
}

export function shouldReturnDirectImage(bytes: number): boolean {
  return bytes > 0 && bytes <= DIRECT_IMAGE_MAX_BYTES;
}

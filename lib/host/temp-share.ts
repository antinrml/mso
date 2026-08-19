import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// Authenticated, expiring download links for small generated artifacts such as
// MCP screenshots. The URL contains only an opaque random id; the real bytes live
// under ~/.mso (0700/0600), never in public/, and every GET still has to pass the
// normal approved-device session gate in the route.

const VERSION = 1 as const;
const DEFAULT_TTL_MS = 15 * 60_000;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 60 * 60_000;
const DEFAULT_DOWNLOADS = 5;
const MAX_DOWNLOADS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{32}$/;

type TempShareEntry = {
  id: string;
  file: string;
  name: string;
  mimeType: string;
  createdAt: number;
  expiresAt: number;
  downloadsLeft: number;
};

type TempShareStore = {
  version: typeof VERSION;
  entries: Record<string, TempShareEntry>;
};

export type TempShareInfo = Omit<TempShareEntry, "file"> & { bytes: number };
export type ConsumedTempShare = TempShareInfo & { data: Buffer };

function rootDir(): string {
  // Never let a unit test touch the owner's real ~/.mso state. The process id
  // keeps parallel vitest workers isolated without adding a production knob.
  if (process.env.VITEST) return path.join(os.tmpdir(), `mso-temp-shares-${process.pid}`);
  return path.join(os.homedir(), ".mso", "temp-shares");
}

function storePath(): string {
  return path.join(rootDir(), "index.json");
}

function clamp(n: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n as number), min), max);
}

function cleanFilename(input: string): string {
  const base = path.basename(input || "download.bin");
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "download.bin";
}

function cleanMimeType(input: string): string {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input)
    ? input.toLowerCase()
    : "application/octet-stream";
}

function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new Error("unknown or expired temporary link");
}

async function readStore(): Promise<TempShareStore> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: VERSION, entries: {} };
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<TempShareStore>;
  if (parsed.version !== VERSION || !parsed.entries || typeof parsed.entries !== "object") {
    throw new Error("temporary-link store is invalid");
  }
  return { version: VERSION, entries: parsed.entries };
}

async function writeStore(store: TempShareStore): Promise<void> {
  const dir = rootDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${storePath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, storePath());
}

async function cleanupUnlocked(store: TempShareStore, now = Date.now()): Promise<boolean> {
  let changed = false;
  for (const [id, entry] of Object.entries(store.entries)) {
    if (entry.expiresAt > now && entry.downloadsLeft > 0) continue;
    delete store.entries[id];
    changed = true;
    await fs.rm(path.join(rootDir(), entry.file), { force: true }).catch(() => undefined);
  }
  return changed;
}

// Serialize every read-modify-write so simultaneous browser downloads cannot both
// spend the same final allowance or resurrect an entry another request removed.
let mutationChain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function createTempShare(input: {
  data: Uint8Array | Buffer;
  filename: string;
  mimeType: string;
  ttlMs?: number;
  maxDownloads?: number;
}): Promise<TempShareInfo> {
  const data = Buffer.from(input.data);
  if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
    throw new Error(`temporary download must be between 1 byte and ${MAX_BYTES} bytes`);
  }
  const ttlMs = clamp(input.ttlMs, MIN_TTL_MS, MAX_TTL_MS, DEFAULT_TTL_MS);
  const downloadsLeft = clamp(input.maxDownloads, 1, MAX_DOWNLOADS, DEFAULT_DOWNLOADS);
  const name = cleanFilename(input.filename);
  const mimeType = cleanMimeType(input.mimeType);

  return mutate(async () => {
    const dir = rootDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const store = await readStore();
    await cleanupUnlocked(store);

    const id = crypto.randomBytes(24).toString("base64url");
    const file = `${id}.bin`;
    const createdAt = Date.now();
    const expiresAt = createdAt + ttlMs;
    const entry: TempShareEntry = { id, file, name, mimeType, createdAt, expiresAt, downloadsLeft };

    await fs.writeFile(path.join(dir, file), data, { mode: 0o600 });
    store.entries[id] = entry;
    await writeStore(store);

    const timer = setTimeout(() => void revokeTempShare(id), ttlMs + 1_000);
    timer.unref?.();
    return { ...entry, bytes: data.byteLength };
  });
}

export async function inspectTempShare(id: string): Promise<TempShareInfo> {
  assertId(id);
  return mutate(async () => {
    const store = await readStore();
    const changed = await cleanupUnlocked(store);
    const entry = store.entries[id];
    if (!entry) {
      if (changed) await writeStore(store);
      throw new Error("unknown or expired temporary link");
    }
    let stat;
    try {
      stat = await fs.stat(path.join(rootDir(), entry.file));
    } catch {
      delete store.entries[id];
      await writeStore(store);
      throw new Error("unknown or expired temporary link");
    }
    if (changed) await writeStore(store);
    return { ...entry, bytes: stat.size };
  });
}

export async function consumeTempShare(id: string): Promise<ConsumedTempShare> {
  assertId(id);
  return mutate(async () => {
    const store = await readStore();
    await cleanupUnlocked(store);
    const entry = store.entries[id];
    if (!entry) {
      await writeStore(store);
      throw new Error("unknown or expired temporary link");
    }
    const filePath = path.join(rootDir(), entry.file);
    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      delete store.entries[id];
      await writeStore(store);
      throw new Error("unknown or expired temporary link");
    }

    entry.downloadsLeft -= 1;
    if (entry.downloadsLeft <= 0) {
      delete store.entries[id];
      await fs.rm(filePath, { force: true }).catch(() => undefined);
    }
    await writeStore(store);
    return { ...entry, bytes: data.byteLength, data };
  });
}

export async function revokeTempShare(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  return mutate(async () => {
    const store = await readStore();
    const entry = store.entries[id];
    if (!entry) return false;
    delete store.entries[id];
    await fs.rm(path.join(rootDir(), entry.file), { force: true }).catch(() => undefined);
    await writeStore(store);
    return true;
  });
}

export function tempShareUrl(id: string, download = false): string {
  assertId(id);
  const relative = `/api/v1/temp-share/${id}${download ? "?download=1" : ""}`;
  const explicit = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (!explicit) return relative;
  const url = new URL(explicit);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("OS_PUBLIC_ORIGIN must use HTTPS for temporary download links");
  }
  return `${url.origin}${relative}`;
}

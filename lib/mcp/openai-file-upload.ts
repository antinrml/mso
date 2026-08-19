import { createHash } from "crypto";
import path from "path";
import { HostError, uploadInto } from "@/lib/host";

export interface OpenAiProvidedFile {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
  name?: string;
  size?: number;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/webp", "image/jpeg", "application/octet-stream"]);

function providedFile(value: unknown): OpenAiProvidedFile {
  if (!value || typeof value !== "object") throw new HostError("file must be a ChatGPT-provided file object");
  const row = value as Partial<OpenAiProvidedFile>;
  if (typeof row.download_url !== "string" || !row.download_url) throw new HostError("file.download_url is missing");
  if (typeof row.file_id !== "string" || !row.file_id) throw new HostError("file.file_id is missing");
  return row as OpenAiProvidedFile;
}

function trustedDownloadUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HostError("file.download_url is invalid"); }
  if (url.protocol !== "https:") throw new HostError("file.download_url must use HTTPS");
  const host = url.hostname.toLowerCase();
  if (host !== "files.oaiusercontent.com" && !host.endsWith(".oaiusercontent.com")) {
    throw new HostError(`file.download_url host is not allowed: ${host}`);
  }
  return url;
}

function safeFilename(input: string | undefined, fallback: string): string {
  const value = path.basename((input || fallback).trim());
  if (!value || value === "." || value === ".." || value.length > 200) throw new HostError("filename is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new HostError("filename may contain only letters, digits, dot, dash and underscore");
  return value;
}

export async function importOpenAiProvidedFile(opts: {
  file: unknown;
  dest: string;
  filename?: string;
}): Promise<{
  ok: true;
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}> {
  const file = providedFile(opts.file);
  const url = trustedDownloadUrl(file.download_url);
  const mimeType = (file.mime_type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new HostError(`unsupported file type: ${mimeType}`);
  if (typeof file.size === "number" && (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES)) {
    throw new HostError("file exceeds the 20 MiB MCP import limit");
  }

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    headers: { accept: "image/png,image/webp,image/jpeg,application/octet-stream" },
  });
  if (!response.ok) throw new HostError(`OpenAI file download failed (${response.status})`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_FILE_BYTES) throw new HostError("file exceeds the 20 MiB MCP import limit");
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength === 0) throw new HostError("OpenAI file download was empty");
  if (data.byteLength > MAX_FILE_BYTES) throw new HostError("file exceeds the 20 MiB MCP import limit");

  const fallback = file.file_name || file.name || `${file.file_id}.bin`;
  const filename = safeFilename(opts.filename, fallback);
  const result = await uploadInto(opts.dest, [{ relPath: filename, data }]);
  if (result.written !== 1 || result.failed.length) throw new HostError(`file import failed: ${result.failed.join(", ") || "not written"}`);

  return {
    ok: true,
    fileId: file.file_id,
    path: path.join(opts.dest, filename),
    filename,
    mimeType,
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

import { createHash } from "crypto";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

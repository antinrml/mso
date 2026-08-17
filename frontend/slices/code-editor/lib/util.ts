import type { Lang } from "./highlight";

// Path helpers come from the framework (appshell/lib/paths) — this file had its
// own, subtly different from Files', and both build /api/v1/fs request paths.
import { extOf } from "@/lib/path";
export { baseName, joinPath } from "@/lib/path";
export { extOf };

// Map a file extension to a supported highlight language.
const EXT_LANG: Record<string, Lang> = {
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  py: "py",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  json: "json",
  css: "css",
  scss: "css",
  md: "md",
  markdown: "md",
};

export function langOf(path: string): Lang {
  return EXT_LANG[extOf(path)] ?? "txt";
}

// Compute 1-based line/column from a caret offset into `text`.
export function lineCol(text: string, caret: number): { ln: number; col: number } {
  const upto = text.slice(0, caret);
  const lines = upto.split("\n");
  return { ln: lines.length, col: lines[lines.length - 1].length + 1 };
}

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256b64url, verifyPkce, isAllowedRedirect, randomToken, safeEqualHex } from "./pkce";

const VERIFIER = "a".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("sha256b64url", () => {
  it("is base64URL, never standard base64 — a `+` or `/` here never matches a real client", () => {
    // A payload whose sha256 contains bytes that encode to + and / in std base64.
    for (let i = 0; i < 200; i++) {
      const out = sha256b64url(`probe-${i}`);
      expect(out).not.toMatch(/[+/=]/);
    }
  });
});

describe("verifyPkce", () => {
  it("accepts the verifier that produced the challenge", () => {
    expect(verifyPkce(VERIFIER, CHALLENGE, "S256")).toBe(true);
  });

  it("rejects a different verifier", () => {
    expect(verifyPkce("b".repeat(43), CHALLENGE, "S256")).toBe(false);
  });

  it("refuses the `plain` method — OAuth 2.1 drops it and it defeats the whole point", () => {
    expect(verifyPkce(CHALLENGE, CHALLENGE, "plain")).toBe(false);
    expect(verifyPkce(VERIFIER, CHALLENGE, "")).toBe(false);
  });

  it("enforces RFC 7636 §4.1 length bounds", () => {
    const short = "a".repeat(42);
    const long = "a".repeat(129);
    expect(verifyPkce(short, sha256b64url(short), "S256")).toBe(false);
    expect(verifyPkce(long, sha256b64url(long), "S256")).toBe(false);
  });

  it("rejects characters outside the unreserved set", () => {
    const bad = "a".repeat(42) + "/";
    expect(verifyPkce(bad, sha256b64url(bad), "S256")).toBe(false);
  });
});

describe("isAllowedRedirect", () => {
  it.each([
    ["https://chatgpt.com/connector_platform_oauth_redirect", true],
    ["http://localhost:6274/callback", true],
    ["http://127.0.0.1:9999/cb", true],
    ["http://evil.example/cb", false], // plaintext on the internet leaks the code
    ["javascript:alert(1)", false],
    ["mso://cb", false],
    ["not a url", false],
  ])("%s → %s", (uri, expected) => {
    expect(isAllowedRedirect(uri)).toBe(expected);
  });
});

describe("randomToken", () => {
  it("is prefixed, url-safe and not repeatable", () => {
    const a = randomToken("mso_mcp_");
    const b = randomToken("mso_mcp_");
    expect(a.startsWith("mso_mcp_")).toBe(true);
    expect(a).not.toBe(b);
    expect(a.slice(8)).not.toMatch(/[+/=]/);
    expect(a.length).toBeGreaterThan(40);
  });
});

describe("safeEqualHex", () => {
  it("is false for different lengths instead of throwing", () => {
    expect(safeEqualHex("abc", "abcd")).toBe(false);
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
  });
});

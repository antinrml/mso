import { describe, expect, it, vi } from "vitest";
import { followOAuthRedirect } from "./oauth-navigation";

describe("OAuth browser navigation", () => {
  it("replaces the visible page with the validated ChatGPT callback", () => {
    const replace = vi.fn();
    followOAuthRedirect("https://chatgpt.com/connector/oauth/test?code=one", { replace });
    expect(replace).toHaveBeenCalledWith("https://chatgpt.com/connector/oauth/test?code=one");
  });

  it("refuses plaintext non-loopback destinations even if called incorrectly", () => {
    expect(() => followOAuthRedirect("http://example.com/callback", { replace: vi.fn() })).toThrow(/https or a loopback/);
  });
});

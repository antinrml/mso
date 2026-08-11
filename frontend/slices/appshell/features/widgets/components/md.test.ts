import { describe, expect, it } from "vitest";
import { mdToHtml } from "./md";

describe("mdToHtml", () => {
  it("renders basic markdown", () => {
    expect(mdToHtml("# Hi")).toContain('<div class="text-lg font-bold">Hi</div>');
    expect(mdToHtml("**b**")).toContain("<strong>b</strong>");
    expect(mdToHtml("[t](https://x.com)")).toContain('href="https://x.com"');
  });

  it("escapes raw HTML (no tag injection)", () => {
    expect(mdToHtml("<script>alert(1)</script>")).not.toContain("<script>");
    expect(mdToHtml("<img src=x>")).toContain("&lt;img");
  });

  it("a link URL cannot break out of the href attribute (XSS regression)", () => {
    const out = mdToHtml('[x](https://a"onmouseover=alert//)');
    expect(out).not.toContain('"onmouseover'); // the user's quote must not close href=
    expect(out).toContain("&quot;onmouseover"); // it stays escaped INSIDE the value
  });
});

describe("fenced code blocks", () => {
  it("renders a fence as <pre><code>, not as literal backticks", () => {
    const out = mdToHtml("run this:\n```sh\nls -la ~\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("ls -la ~");
    expect(out).not.toContain("```");
  });

  it("does NOT apply inline markdown inside a fence", () => {
    // `rm -rf **` inside a code block used to render as bold nothing, which is
    // both wrong and dangerous-looking in a VPS assistant.
    const out = mdToHtml("```\nrm -rf ** and `x`\n```");
    expect(out).not.toContain("<strong>");
    expect(out).toContain("rm -rf ** and `x`");
  });

  it("escapes inside a fence — it is model output, i.e. untrusted", () => {
    const out = mdToHtml("```\n<img src=x onerror=alert(1)>\n```");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("still renders inline code and bold OUTSIDE a fence", () => {
    const out = mdToHtml("**bold** and `code`\n```\nraw\n```");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code");
  });
});

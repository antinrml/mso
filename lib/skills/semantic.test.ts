import { describe, expect, it } from "vitest";
import { hybridSemanticScore } from "./semantic";

describe("local skill embeddings", () => {
  it("routes Indonesian screenshot language to screen capture", () => {
    const query = "kirim tangkapan layar macOS dan link download sementara";
    const screenshot = hybridSemanticScore(query, "screen_capture Capture the authenticated MSO desktop and return a temporary preview download link");
    const disk = hybridSemanticScore(query, "fs_usage Show total used and free disk bytes");
    expect(screenshot).toBeGreaterThan(disk + 0.2);
  });

  it("connects workflow/recipe phrasing across Indonesian and English", () => {
    const score = hybridSemanticScore("ingat cara tercepat agar task berikutnya lebih cepat", "workflow recipe skill memory fastest successful path");
    expect(score).toBeGreaterThan(0.25);
  });
});

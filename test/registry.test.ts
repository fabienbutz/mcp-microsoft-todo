import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry";

describe("tool registry", () => {
  it("exposes the expected tool surface", () => {
    expect(allTools).toHaveLength(16);
  });

  it("has unique tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a description, a valid risk class, and an input shape", () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(["read", "write", "destructive"]).toContain(tool.risk);
      expect(typeof tool.inputShape).toBe("object");
    }
  });

  it("warns in the description of every destructive tool", () => {
    const destructive = allTools.filter((t) => t.risk === "destructive");
    expect(destructive.length).toBeGreaterThan(0);
    for (const tool of destructive) {
      expect(tool.description.toLowerCase()).toContain("cannot be undone");
    }
  });
});

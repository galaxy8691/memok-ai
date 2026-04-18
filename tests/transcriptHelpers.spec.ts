import { describe, expect, it } from "vitest";
import {
  clampToLastChars,
  collectLabeledTurns,
  extractTextFromContent,
  INITIAL_TURN_WINDOW,
  MAX_AGENT_END_CHARS,
  oneLineSnippet,
  shortHash,
  stripFencedCodeBlocks,
} from "../src/plugin/transcriptHelpers.js";

describe("transcriptHelpers", () => {
  it("shortHash is stable for a fixed string", () => {
    expect(shortHash("hello")).toBe(shortHash("hello"));
    expect(shortHash("hello")).not.toBe(shortHash("world"));
  });

  it("extractTextFromContent handles string, array, and object parts", () => {
    expect(extractTextFromContent("plain")).toBe("plain");
    expect(extractTextFromContent(["a", "b"])).toBe("ab");
    expect(
      extractTextFromContent([
        { type: "text", text: "x" },
        { type: "text", text: "y" },
      ]),
    ).toBe("xy");
    expect(extractTextFromContent([{ text: "z" }])).toBe("z");
    expect(extractTextFromContent(42)).toBe("42");
    expect(extractTextFromContent(null)).toBe("");
  });

  it("oneLineSnippet collapses whitespace and truncates", () => {
    expect(oneLineSnippet("  a\n\tb  ", 10)).toBe("a b");
    expect(oneLineSnippet("0123456789abc", 10)).toBe("0123456789...");
  });

  it("collectLabeledTurns keeps user/assistant with non-empty text", () => {
    const lines = collectLabeledTurns([
      { role: "system", content: "x" },
      { role: "user", content: " hi " },
      { role: "assistant", content: [{ text: "there" }] },
      { role: "tool", content: "ignored" },
      null,
    ]);
    expect(lines).toEqual(["User: hi", "OpenClaw: there"]);
  });

  it("stripFencedCodeBlocks replaces fenced blocks", () => {
    expect(stripFencedCodeBlocks("a ```x``` b")).toBe(
      "a [code block omitted] b",
    );
  });

  it("clampToLastChars returns suffix when over limit", () => {
    expect(clampToLastChars("abcdef", 10)).toBe("abcdef");
    expect(clampToLastChars("abcdef", 3)).toBe("def");
  });

  it("exports expected constants", () => {
    expect(INITIAL_TURN_WINDOW).toBe(12);
    expect(MAX_AGENT_END_CHARS).toBe(3000);
  });
});

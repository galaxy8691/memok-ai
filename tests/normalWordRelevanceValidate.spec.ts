import { describe, expect, it } from "vitest";
import {
  NormalWordRelevanceInputSchema,
  NormalWordRelevanceOutputSchema,
  repairNormalWordRelevanceOutput,
  validateNormalWordRelevanceOutput,
} from "../src/dreaming-pipeline/story-word-sentence-pipeline/scoreNormalWordRelevance.js";

describe("validateNormalWordRelevanceOutput", () => {
  const input = NormalWordRelevanceInputSchema.parse({
    story: "一个关于海边和灯塔的故事",
    normalWords: [
      { id: 1, word: "灯塔" },
      { id: 2, word: "苹果" },
    ],
  });

  it("passes when count/id-set/score range all valid", () => {
    const output = NormalWordRelevanceOutputSchema.parse({
      normalWords: [
        { id: 2, score: 10 },
        { id: 1, score: 95 },
      ],
    });
    const validated = validateNormalWordRelevanceOutput(input, output);
    expect(validated.normalWords).toHaveLength(2);
  });

  it("throws when count mismatches", () => {
    const output = NormalWordRelevanceOutputSchema.parse({
      normalWords: [{ id: 1, score: 90 }],
    });
    expect(() => validateNormalWordRelevanceOutput(input, output)).toThrow(
      /条数不一致/,
    );
  });

  it("throws when output has unknown id", () => {
    const output = NormalWordRelevanceOutputSchema.parse({
      normalWords: [
        { id: 1, score: 90 },
        { id: 3, score: 20 },
      ],
    });
    expect(() => validateNormalWordRelevanceOutput(input, output)).toThrow(
      /id=/,
    );
  });

  it("strips echoed word field from model output items", () => {
    const parsed = NormalWordRelevanceOutputSchema.parse({
      normalWords: [
        { id: 1, word: "灯塔", score: 90 },
        { id: 2, word: "苹果", score: 10 },
      ],
    });
    expect(parsed.normalWords).toEqual([
      { id: 1, score: 90 },
      { id: 2, score: 10 },
    ]);
  });

  it("repair fills missing ids so validate passes", () => {
    const output = NormalWordRelevanceOutputSchema.parse({
      normalWords: [{ id: 1, score: 80 }],
    });
    const repaired = repairNormalWordRelevanceOutput(input, output);
    expect(() =>
      validateNormalWordRelevanceOutput(input, repaired),
    ).not.toThrow();
    expect(repaired.normalWords).toHaveLength(2);
    expect(repaired.normalWords.find((r) => r.id === 2)?.score).toBe(80);
  });

  it("repair drops extra ids and keeps input order", () => {
    const output = NormalWordRelevanceOutputSchema.parse({
      normalWords: [
        { id: 1, score: 10 },
        { id: 2, score: 20 },
        { id: 99, score: 30 },
      ],
    });
    const repaired = repairNormalWordRelevanceOutput(input, output);
    const v = validateNormalWordRelevanceOutput(input, repaired);
    expect(v.normalWords.map((r) => r.id)).toEqual([1, 2]);
  });

  it("schema rejects non-int/out-of-range scores", () => {
    expect(() =>
      NormalWordRelevanceOutputSchema.parse({
        normalWords: [{ id: 1, score: 88.5 }],
      }),
    ).toThrow();
    expect(() =>
      NormalWordRelevanceOutputSchema.parse({
        normalWords: [{ id: 1, score: 120 }],
      }),
    ).toThrow();
  });
});

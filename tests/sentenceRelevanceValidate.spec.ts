import { describe, expect, it } from "vitest";
import {
  SentenceRelevanceInputSchema,
  SentenceRelevanceOutputSchema,
  validateSentenceRelevanceOutput,
} from "../src/dreaming-pipeline/story-word-sentence-pipeline/scoreSentenceRelevance.js";

describe("validateSentenceRelevanceOutput", () => {
  const input = SentenceRelevanceInputSchema.parse({
    story: "一个关于海边和灯塔的故事",
    sentences: [
      { id: 1, sentence: "海边有一座灯塔。" },
      { id: 2, sentence: "今天我吃了苹果。" },
    ],
  });

  it("passes when count/id-set/score range all valid", () => {
    const output = SentenceRelevanceOutputSchema.parse({
      sentences: [
        { id: 2, score: 10 },
        { id: 1, score: 95 },
      ],
    });
    const validated = validateSentenceRelevanceOutput(input, output);
    expect(validated.sentences).toHaveLength(2);
  });

  it("throws when count mismatches", () => {
    const output = SentenceRelevanceOutputSchema.parse({
      sentences: [{ id: 1, score: 90 }],
    });
    expect(() => validateSentenceRelevanceOutput(input, output)).toThrow(
      /条数不一致/,
    );
  });

  it("throws when output has unknown id", () => {
    const output = SentenceRelevanceOutputSchema.parse({
      sentences: [
        { id: 1, score: 90 },
        { id: 3, score: 20 },
      ],
    });
    expect(() => validateSentenceRelevanceOutput(input, output)).toThrow(/id=/);
  });

  it("schema rejects non-int/out-of-range scores", () => {
    expect(() =>
      SentenceRelevanceOutputSchema.parse({
        sentences: [{ id: 1, score: 88.5 }],
      }),
    ).toThrow();
    expect(() =>
      SentenceRelevanceOutputSchema.parse({
        sentences: [{ id: 1, score: 120 }],
      }),
    ).toThrow();
  });
});

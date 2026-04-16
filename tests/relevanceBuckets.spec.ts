import { describe, expect, it } from "vitest";
import { buildRelevanceBuckets } from "../src/dreaming-pipeline/buildRelevanceBuckets.js";

describe("buildRelevanceBuckets", () => {
  it("splits ids by >=60, 40-59, and <40", () => {
    const out = buildRelevanceBuckets(["梦", "海马体"], {
      sentences: [
        { id: 1, score: 0 },
        { id: 2, score: 39 },
        { id: 3, score: 40 },
        { id: 4, score: 59 },
        { id: 5, score: 60 },
        { id: 6, score: 88 },
      ],
    });
    expect(out.words).toEqual(["梦", "海马体"]);
    expect(out.id_ge_60).toEqual([5, 6]);
    expect(out.id_ge_40_lt_60).toEqual([3, 4]);
    expect(out.id_lt_40).toEqual([1, 2]);
  });
});

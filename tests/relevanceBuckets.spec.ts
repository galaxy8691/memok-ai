import { describe, expect, it } from "vitest";
import { buildRelevanceBuckets } from "../src/dreaming-pipeline/buildRelevanceBuckets.js";

describe("buildRelevanceBuckets", () => {
  it("splits ids by >=50 and <50", () => {
    const out = buildRelevanceBuckets(["梦", "海马体"], {
      sentences: [
        { id: 1, score: 0 },
        { id: 2, score: 49 },
        { id: 3, score: 50 },
        { id: 4, score: 88 },
      ],
    });
    expect(out.words).toEqual(["梦", "海马体"]);
    expect(out.id_ge_50).toEqual([3, 4]);
    expect(out.id_lt_50).toEqual([1, 2]);
  });
});

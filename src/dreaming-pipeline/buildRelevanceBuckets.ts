import { z } from "zod";
import {
  SentenceRelevanceOutputSchema,
  type SentenceRelevanceOutput,
} from "./scoreSentenceRelevance.js";

export const RelevanceBucketsSchema = z
  .object({
    words: z.array(z.string()),
    id_ge_60: z.array(z.number().int()),
    id_ge_40_lt_60: z.array(z.number().int()),
    id_lt_40: z.array(z.number().int()),
  })
  .strict();

export type RelevanceBuckets = z.infer<typeof RelevanceBucketsSchema>;

/**
 * 把相关性结果按阈值分三档：
 * - `id_ge_60`: score >= 60
 * - `id_ge_40_lt_60`: 40 <= score < 60
 * - `id_lt_40`: score < 40
 */
export function buildRelevanceBuckets(
  words: string[],
  relevance: SentenceRelevanceOutput,
): RelevanceBuckets {
  const parsed = SentenceRelevanceOutputSchema.parse(relevance);
  const id_ge_60: number[] = [];
  const id_ge_40_lt_60: number[] = [];
  const id_lt_40: number[] = [];
  for (const row of parsed.sentences) {
    if (row.score >= 60) {
      id_ge_60.push(row.id);
    } else if (row.score >= 40) {
      id_ge_40_lt_60.push(row.id);
    } else {
      id_lt_40.push(row.id);
    }
  }
  return RelevanceBucketsSchema.parse({
    words: [...words],
    id_ge_60,
    id_ge_40_lt_60,
    id_lt_40,
  });
}

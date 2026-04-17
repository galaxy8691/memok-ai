import { z } from "zod";

export const ArticleCoreWordsDataSchema = z
  .object({
    core_words: z.array(z.string()),
  })
  .strict();

export const ArticleCoreWordNomalizePairSchema = z
  .object({
    original_text: z.string(),
    new_text: z.string(),
  })
  .strict();

export const ArticleCoreWordsNomalizedDataSchema = z
  .object({
    nomalized: z.array(ArticleCoreWordNomalizePairSchema),
  })
  .strict();

export const ArticleMemorySentenceItemSchema = z
  .object({
    sentence: z.string(),
  })
  .strict();

export const ArticleMemorySentencesDataSchema = z
  .object({
    sentences: z.array(ArticleMemorySentenceItemSchema),
  })
  .strict();

export const ArticleSentenceCoreItemSchema = z
  .object({
    sentence: z.string(),
    core_words: z.array(z.string()),
  })
  .strict();

export const ArticleSentenceCoreCombinedDataSchema = z
  .object({
    sentence_core: z.array(ArticleSentenceCoreItemSchema),
  })
  .strict();

export const AwpV2TupleSchema = z.tuple([
  ArticleSentenceCoreCombinedDataSchema,
  ArticleCoreWordsNomalizedDataSchema,
]);

export type ArticleCoreWordsData = z.infer<typeof ArticleCoreWordsDataSchema>;
export type ArticleCoreWordNomalizePair = z.infer<
  typeof ArticleCoreWordNomalizePairSchema
>;
export type ArticleCoreWordsNomalizedData = z.infer<
  typeof ArticleCoreWordsNomalizedDataSchema
>;
export type ArticleMemorySentenceItem = z.infer<
  typeof ArticleMemorySentenceItemSchema
>;
export type ArticleMemorySentencesData = z.infer<
  typeof ArticleMemorySentencesDataSchema
>;
export type ArticleSentenceCoreItem = z.infer<
  typeof ArticleSentenceCoreItemSchema
>;
export type ArticleSentenceCoreCombinedData = z.infer<
  typeof ArticleSentenceCoreCombinedDataSchema
>;

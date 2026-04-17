import type OpenAI from "openai";
import { llmMaxWorkers } from "../../llm/openaiCompat.js";
import { scrubHeartbeatInAwpTuple } from "../../utils/scrubOpenclawHeartbeatArtifacts.js";
import { analyzeArticleCoreWords } from "./articleCoreWords.js";
import { normalizeArticleCoreWordsSynonyms } from "./articleCoreWordsNormalize.js";
import { combineArticleSentenceCoreV2 } from "./articleSentenceCoreCombine.js";
import { analyzeArticleMemorySentences } from "./articleSentences.js";
import type {
  ArticleCoreWordsNomalizedData,
  ArticleSentenceCoreCombinedData,
} from "./schemas.js";

export async function articleWordPipelineV2(
  text: string,
  opts?: { client?: OpenAI },
): Promise<[ArticleSentenceCoreCombinedData, ArticleCoreWordsNomalizedData]> {
  const stripped = text.trim();
  if (!stripped) {
    throw new Error("text must be non-empty after stripping whitespace");
  }

  if (opts?.client || llmMaxWorkers() <= 1) {
    const core = await analyzeArticleCoreWords(text, { client: opts?.client });
    const normalized = await normalizeArticleCoreWordsSynonyms(core, {
      client: opts?.client,
    });
    const memorySentences = await analyzeArticleMemorySentences(text, {
      client: opts?.client,
    });
    return scrubHeartbeatInAwpTuple(
      combineArticleSentenceCoreV2(memorySentences, normalized),
    );
  }

  const branchCoreNormalize =
    async (): Promise<ArticleCoreWordsNomalizedData> => {
      const core = await analyzeArticleCoreWords(text);
      return normalizeArticleCoreWordsSynonyms(core);
    };
  const branchMemory = async () => analyzeArticleMemorySentences(text);

  const [normalized, memorySentences] = await Promise.all([
    branchCoreNormalize(),
    branchMemory(),
  ]);
  return scrubHeartbeatInAwpTuple(
    combineArticleSentenceCoreV2(memorySentences, normalized),
  );
}

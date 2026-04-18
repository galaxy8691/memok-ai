import { Type } from "@sinclair/typebox";
import {
  extractMemorySentencesByWordSample,
  type MemoryExtractedSentence,
} from "../read-memory-pipeline/extractMemorySentencesByWordSample.js";
import { scrubOpenclawHeartbeatArtifacts } from "../utils/scrubOpenclawHeartbeatArtifacts.js";
import {
  MEMOK_INJECT_END,
  MEMOK_INJECT_START,
  MEMOK_MEMORY_INJECT_MARKER,
} from "../utils/stripMemokInjectEchoFromTranscript.js";

const MEMORY_CANDIDATE_TTL_MS = 30 * 60 * 1000;
const MEMORY_CANDIDATE_MAP_MAX = 50;

/** sessionKey（或回退键）→ 最近一轮注入的句子 id，供工具校验与日志 */
export const memoryCandidateIdsBySession = new Map<
  string,
  { ids: number[]; at: number }
>();

export const ReportUsedMemoryIdsParams = Type.Object({
  sentenceIds: Type.Array(Type.Integer(), { minItems: 0 }),
});

export const RecallCandidateMemoriesParams = Type.Object({});

function pruneMemoryCandidateMap(): void {
  const now = Date.now();
  for (const [k, v] of memoryCandidateIdsBySession) {
    if (now - v.at > MEMORY_CANDIDATE_TTL_MS) {
      memoryCandidateIdsBySession.delete(k);
    }
  }
  while (memoryCandidateIdsBySession.size > MEMORY_CANDIDATE_MAP_MAX) {
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [k, v] of memoryCandidateIdsBySession) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) {
      memoryCandidateIdsBySession.delete(oldestKey);
    } else {
      break;
    }
  }
}

function formatOneMemoryLine(s: MemoryExtractedSentence): string {
  const mw = s.matched_word;
  const sentence = scrubOpenclawHeartbeatArtifacts(
    s.sentence.replace(/\s+/g, " ").trim(),
  );
  const w = scrubOpenclawHeartbeatArtifacts(mw.word);
  const nw = scrubOpenclawHeartbeatArtifacts(mw.normal_word);
  return `- [id=${s.id}] ${sentence} (词: ${w} → ${nw})`;
}

/**
 * 生成 prependContext；按条累加直至达到 maxChars（至少尽量放入第一条）。
 */
function buildMemoryInjectBlock(
  sentences: MemoryExtractedSentence[],
  maxChars: number,
): { text: string; ids: number[]; truncated: boolean } {
  const header = `${MEMOK_MEMORY_INJECT_MARKER}以下为从本地记忆库抽样得到的句子，**未必与当前问题相关**。
请自行判断是否采用；若采用请在回复中自然使用这些信息。
若确实采用了其中某些条目，请在本轮内调用工具 \`memok_report_used_memory_ids\`，传入对应 \`id\` 数组；若全部未采用则**不要调用**该工具。

`;

  const ids: number[] = [];
  let body = "";
  let truncated = false;
  const wrapOverhead = MEMOK_INJECT_START.length + MEMOK_INJECT_END.length + 2;
  const innerBudget = Math.max(0, maxChars - wrapOverhead);
  const restBudget = Math.max(0, innerBudget - header.length);
  for (const s of sentences) {
    const line = `${formatOneMemoryLine(s)}\n`;
    if (body.length + line.length > restBudget) {
      if (body.length === 0 && line.length > restBudget) {
        body = `${line.slice(0, Math.max(0, restBudget - 1))}…\n`;
        ids.push(s.id);
        truncated = true;
        break;
      }
      truncated = true;
      break;
    }
    body += line;
    ids.push(s.id);
  }
  const inner = scrubOpenclawHeartbeatArtifacts(header + body);
  const text = `${MEMOK_INJECT_START}\n${inner}\n${MEMOK_INJECT_END}`;
  return { text, ids, truncated };
}

export type RecallStoreResult =
  | { kind: "empty" }
  | { kind: "block"; text: string; ids: number[]; truncated: boolean };

/**
 * 抽样并写入本轮 session 的候选 id，供 prepend / 工具 / 反馈校验共用。
 */
export function recallAndStoreCandidates(
  dbPath: string,
  extractFraction: number,
  longTermFraction: number,
  maxInjectChars: number,
  sessionMemKey: string,
): RecallStoreResult {
  const out = extractMemorySentencesByWordSample(dbPath, {
    fraction: extractFraction,
    longTermFraction,
  });
  if (out.sentences.length === 0) {
    pruneMemoryCandidateMap();
    memoryCandidateIdsBySession.set(sessionMemKey, { ids: [], at: Date.now() });
    return { kind: "empty" };
  }
  const built = buildMemoryInjectBlock(out.sentences, maxInjectChars);
  pruneMemoryCandidateMap();
  memoryCandidateIdsBySession.set(sessionMemKey, {
    ids: built.ids,
    at: Date.now(),
  });
  return {
    kind: "block",
    text: built.text,
    ids: built.ids,
    truncated: built.truncated,
  };
}

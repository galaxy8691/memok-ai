const MAX_GIST_CHARS = 200;
const MAX_GIST_WORDS_EN = 200;

function latinToCjkRatio(s: string): {
  letters: number;
  cjk: number;
  ratio: number;
} {
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const denom = letters + cjk;
  const ratio = denom === 0 ? 0 : letters / denom;
  return { letters, cjk, ratio };
}

export function isEnglishDominantText(s: string): boolean {
  const { ratio } = latinToCjkRatio(s);
  return ratio > 0.5;
}

function clampWords(s: string, maxWords: number): string {
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length <= maxWords) {
    return s;
  }
  return parts.slice(0, maxWords).join(" ");
}

export function clampGistText(gist: string): string {
  const s = gist.trim();
  if (!s) {
    return s;
  }
  if (isEnglishDominantText(s)) {
    return clampWords(s, MAX_GIST_WORDS_EN);
  }
  if (s.length <= MAX_GIST_CHARS) {
    return s;
  }
  return s.slice(0, MAX_GIST_CHARS);
}

export function gistLengthOk(text: string): boolean {
  const s = text.trim();
  if (!s) {
    return true;
  }
  if (isEnglishDominantText(s)) {
    return s.split(/\s+/).filter(Boolean).length <= MAX_GIST_WORDS_EN;
  }
  return s.length <= MAX_GIST_CHARS;
}

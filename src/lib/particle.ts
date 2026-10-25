// 한국어 조사 고르기 — 이름 뒤에 붙는 「을/를」 · 「이/가」 · 「으로/로」를 그 이름의 끝소리로 고른다. 대화 흐름 · 카드 · Space 화면이 함께 쓴다
// (엔진의 같은 규칙은 `setting.rs`의 Rust 사본이다 — 03 결정 12).

/**
 * 이름 뒤의 조사 — 마지막 글자가 받침 있는 한글이면 `withFinal`, 아니면 `without`이다. 「으로/로」는 ㄹ 받침도 「로」다. 한글이
 * 아닌 끝 글자(영문 · 숫자)는 읽는 끝소리로 고른다(아래). 끝의 닫는 괄호 · 따옴표 · 문장 부호는 읽지 않는다 — 「환불 버그 (#31)」은
 * 「31」로 끝난다(v1 티켓 39).
 */
export function particle(word: string, withFinal: string, without: string): string {
  const trimmed = word.trim().replace(CLOSING, "");
  const code = trimmed.codePointAt(trimmed.length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) {
    // 영어 · 숫자(Project slug · 「v1」)는 읽는 끝소리로 고른다 — 받침이 분명한 것만(web-app → 「웹앱」, helm → 「헬름」, 3 → 「삼」).
    // 끝소리가 갈리는 글자(t · s · r …)는 받침 없음으로 둔다(Host → 「호스트가」).
    const last = trimmed.slice(-1).toLowerCase();
    if (!LATIN_FINALS.has(last)) return without;
    return withFinal === "으로" && LATIN_RIEUL.has(last) ? without : withFinal;
  }
  const final = (code - 0xac00) % 28;
  if (final === 0) return without;
  if (withFinal === "으로" && final === 8) return without;
  return withFinal;
}

/** 이름 끝에서 건너뛰는 닫는 괄호 · 따옴표 · 문장 부호. */
const CLOSING = /[)\]}」』"'”’.,!?…\s]+$/u;
/** 읽으면 받침이 있는 영어 · 숫자 끝 글자 — b · k · m · n · p · l(ㄹ), 0(영) · 1(일) · 3(삼) · 6(육) · 7(칠) · 8(팔). `ng`는 g로 끝난다. */
const LATIN_FINALS = new Set(["b", "k", "l", "m", "n", "p", "0", "1", "3", "6", "7", "8"]);
/** 그 가운데 받침이 ㄹ인 것 — 「으로」 대신 「로」다. */
const LATIN_RIEUL = new Set(["l", "1", "7", "8"]);

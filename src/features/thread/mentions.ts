import type { Participant } from "./types";

// 멘션 · 받는 이(v1 티켓 14 · 구현 스펙 §14 · S9)의 **순수 함수**다. 화면은 엔진과 같은 규칙으로 받는 이를 읽는다(v1 티켓 13 노트) —
// 보내기 전에 입력칸의 멘션 칠 · 모델 칩이 말하는 받는 이와 엔진이 실제로 고르는 받는 이가 갈리면 안 된다.
//
// - **멘션 문법은 엔진의 `first_mention`과 같다**(`crates/atelier-acp/src/host/thread.rs`): `@`가 말의 처음이거나 이름 글자가 아닌
//   것 뒤에 설 때만, 백틱 밖에서만 멘션이다. 이름 글자는 글자 · 숫자와 `_` `-` `.` `/`이고, 끝의 `.` `-` `/`는 문장 부호로 뗀다.
// - **받는 이는 멘션 이름의 가장 긴 앞부분 가운데 앉은 참여자의 이름이다**(handle, Project에서 온 참여자는 `project/handle`도) —
//   「@reviewer가」의 조사를 뗀다.

/** 이름 글자 — 엔진의 `is_name_char`와 같다. */
const NAME_CHAR = /[\p{L}\p{N}_\-./]/u;
const isNameChar = (char: string | undefined): boolean => char !== undefined && NAME_CHAR.test(char);

/** 앉은 참여자 가운데 받는 이를 가르는 칸. */
export type SeatedAgent = Pick<Participant, "handle" | "from">;

/** 말의 첫 멘션 — 그 이름과 `@`의 자리. 없으면 `null`(받는 이는 Host). */
export function firstMention(text: string): { name: string; start: number } | null {
  let inCode = false;
  const chars = [...text];
  let offset = 0;
  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at];
    if (char === "`") inCode = !inCode;
    else if (char === "@" && !inCode && !isNameChar(chars[at - 1])) {
      let end = at + 1;
      while (end < chars.length && isNameChar(chars[end])) end += 1;
      const name = chars
        .slice(at + 1, end)
        .join("")
        .replace(/[.\-/]+$/u, "");
      if (name !== "") return { name, start: offset };
    }
    offset += char.length;
  }
  return null;
}

/** 그 참여자를 이 이름으로 부르나 — handle 그대로, 또는 Project에서 왔으면 `project/handle`. */
const answersTo = (one: SeatedAgent, call: string): boolean =>
  one.handle === call || (one.from !== null && one.from !== "library" && `${one.from.project}/${one.handle}` === call);

/** 받는 이 — 멘션 이름, 고른 참여자(모르면 `null`), 입력칸에서 그 멘션이 차지한 자리(`@`부터 고른 이름 끝까지). */
export interface Recipient {
  mention: string;
  agent: SeatedAgent | null;
  at: { start: number; end: number };
}

/**
 * 받는 이 — 멘션이 없으면 `null`(Host). 있으면 그 멘션 이름과, 그 이름의 가장 긴 앞부분 가운데 앉은 참여자다. 앉은 이름이 없으면
 * `agent`가 `null`이다.
 */
export function recipientOf(text: string, seated: readonly SeatedAgent[]): Recipient | null {
  const mention = firstMention(text);
  if (!mention) return null;
  const chars = [...mention.name];
  const span = (call: string) => ({ start: mention.start, end: mention.start + 1 + call.length });
  for (let end = chars.length; end > 0; end -= 1) {
    const call = chars.slice(0, end).join("");
    const agent = seated.find((one) => answersTo(one, call));
    if (agent) return { mention: mention.name, agent, at: span(call) };
  }
  return { mention: mention.name, agent: null, at: span(mention.name) };
}

/**
 * 보낸 말에서 칠할 멘션(Messages 보드 「길게 · 멘션」) — 첫 멘션의 `@`부터, 그 이름의 앞부분 가운데 그 턴에 답한 이(`who`, 또는
 * `project/<who>`)의 끝까지다. 그 턴의 받는 이를 엔진이 그 멘션으로 골랐다는 뜻이라 조사는 칠하지 않는다. 답한 이와 닿지 않는
 * 멘션(엔진이 거절했다면 말이 남지 않으므로, 옛 기록뿐이다)은 칠하지 않는다.
 */
export function mentionOf(text: string, who: string): { start: number; end: number } | null {
  const mention = firstMention(text);
  if (!mention) return null;
  const chars = [...mention.name];
  for (let end = chars.length; end > 0; end -= 1) {
    const call = chars.slice(0, end).join("");
    const [project, handle, extra] = call.split("/");
    if (call === who || (handle === who && project !== "" && extra === undefined)) {
      return { start: mention.start, end: mention.start + 1 + call.length };
    }
  }
  return null;
}

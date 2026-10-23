import { finalMessages, foldThread, type Turn } from "./fold";
import type { RecordLine } from "./types";

// 사이드바 Thread 줄의 둘째 줄 — 마지막 말(v1 티켓 07 · 구현 스펙 스토리 128 · 캔버스 「Thread 목록과 아바타」 보드). **순수 함수다**:
// 기록 줄을 접어(`foldThread` — Thread 화면과 같은 접기) 턴마다의 「말」 가운데 **말한 때가 가장 늦은** 것을 고른다 — 함께 도는 턴(멘션 ·
// Agent 부르기의 맡은 턴, v1 티켓 14 · 17)은 선 차례와 끝난 차례가 다르다. 때가 같으면 뒤에 선 턴의 말이다.
//
// - **말은 둘이다** — 사람이 보낸 말, 그리고 끝난 턴의 답(접힌 턴에 남는 턴 끝 메시지 — `finalMessages`). 화면이 접어 보이는 것과 같은
//   말이라, 사이드바와 Thread가 다른 말을 하지 않는다. 엔진의 지난 말(`past.rs`)도 사람의 말과 끝난 턴의 마지막 메시지만 넘긴다.
// - **도는 턴의 반쪽 답은 아직 말이 아니다** — 그동안은 보낸 말이 남는다. 흐르는 낱말마다 줄이 바뀌면 눈이 거기 붙는다. 「작업 중」은
//   상태 칸의 일이다(v1 티켓 41).
// - 상태(내 차례 · 작업 중 · 실패 · 중단)에 따라 다른 것을 보이는 일은 `status.ts`의 몫이다(v1 티켓 41) — 그 상태가 글을 주지 않으면 이 말이 선다.

/** 마지막 말 — 누가(참여자 handle과 화면 이름, 사람이면 둘 다 `null`) · 무엇을(한 줄) · 언제. */
export interface Said {
  who: string | null;
  name: string | null;
  text: string;
  at: string;
}

/**
 * 그 Thread의 마지막 말. 말이 하나도 없으면(첫 말이 아직 기록에 없다) `null`이다. 이름은 접기의 참여자 표(`cast` — 들어옴 줄의 이름,
 * Host는 「Host」)에서 읽는다 — 흐름의 이름 줄과 같은 이름이다.
 */
export function lastSaid(lines: readonly RecordLine[]): Said | null {
  const { turns, cast } = foldThread(lines);
  let latest: Omit<Said, "name"> | null = null;
  for (const turn of turns) {
    const said = saidIn(turn);
    if (said && (latest === null || Date.parse(said.at) >= Date.parse(latest.at))) latest = said;
  }
  return latest && { ...latest, name: latest.who === null ? null : (cast[latest.who]?.name ?? latest.who) };
}

/** 턴 하나의 마지막 말 — 끝난 턴의 답, 없으면 그 턴을 연 사람의 말. 스스로 이어 간 턴에 답도 없으면 없다. */
function saidIn(turn: Turn): Omit<Said, "name"> | null {
  if (turn.end) {
    const answers = finalMessages(turn);
    const answer = answers[answers.length - 1];
    const text = answer?.kind === "message" ? oneLine(answer.text) : "";
    if (text !== "") return { who: turn.who, text, at: turn.end.at };
  }
  const sent = turn.sent === null ? "" : oneLine(turn.sent);
  return sent === "" ? null : { who: null, text: sent, at: turn.startedAt };
}

/**
 * 마크다운 글을 꾸밈 없는 한 줄로 — 줄머리의 제목 · 인용 · 목록 표시와 코드 울타리, 굵게 · 코드 표시를 걷고 빈칸을 하나로 접는다.
 * 목록 줄은 한 줄이라 말줄임이 끝을 자른다 — 여기서 자르지 않는다.
 */
function oneLine(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^\s*(?:```.*$|#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, ""))
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

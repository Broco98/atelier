import { GONE_WITH_APP, particle, spoken, type CallEntry, type ToolEntry } from "./fold";
import { describeTool, phraseText } from "./tool-view";

// 호출 줄의 화면 값(v1 티켓 17 · 구현 스펙 §8 · 캔버스 WorkLog 보드 「Agent 호출 줄」 · 화면 3) — 접은 부르기(`CallEntry`)를 넷 상태의
// 글로 옮기는 **순수 함수**다. 그리는 것은 `CallRow.tsx`다.
//
// - **하는 중** — 「리뷰어가 맡은 일을 하는 중」 아래에 그 Agent의 **지금 도구 한 줄**(「note.md 읽는 중」), 도구가 아직 없으면 맡긴
//   말이다. 보드의 「리뷰어가 diff를 보는 중」은 하는 일을 말로 줄인 것인데, 기록에는 그런 말이 없어 맡은 일 자체를 말한다.
// - **끝** — 「리뷰어에게 맡김」 아래에 맡긴 말 · 걸린 시간(「“…” · 1분 12초 걸림」 — 화면 3의 꼴). 보드의 「리뷰를 맡김」처럼 일의
//   이름은 기록에 없어 「맡김」만 쓴다.
// - **실패** — 「리뷰어가 답하지 못함」 아래에 엔진이 적은 까닭 그대로다. 사람이 멈춘 부르기(「사람이 멈춤」)와 앱이 꺼지며 끊긴
//   부르기도 답하지 못한 것이다 — 「다시 맡기기」가 같은 자리에 선다.
// - **펼침** — 맡긴 것 · 받은 것 · 그 Agent의 도구 줄(맡은 턴의 도구 줄 그대로).

export type CallState = "running" | "answered" | "failed";

export interface CallView {
  state: CallState;
  /** 줄의 첫 줄 — 그 줄의 이름이고 보조 기술이 읽는 글이다. */
  title: string;
  /** 둘째 줄(12/18 `fg-tertiary`). */
  meta: string;
  /** 펼침의 받은 것 — 받은 말. 아직이거나 받지 못했으면 null이다. */
  received: string | null;
  /** 펼침의 도구 줄 — 맡은 턴의 도구 줄들. */
  tools: ToolEntry[];
  /** 「Session 열기」로 볼 줄이 있나 — 맡긴 일이 그 Agent에게 실제로 갔다(맡은 턴이 섰다). */
  session: boolean;
}

/** 부르기 하나의 화면 값 — `name`은 불린 Agent의 이름(들어옴 줄의 이름, 모르면 handle)이다. */
export function describeCall(call: CallEntry, name: string): CallView {
  const task = `“${oneLine(call.text)}”`;
  const tools = (call.work ?? []).filter((entry): entry is ToolEntry => entry.kind === "tool");
  const base = { tools, session: call.work !== null };
  if (call.end?.outcome === "answered") {
    return {
      ...base,
      state: "answered",
      title: `${name}에게 맡김`,
      meta: `${task} · ${spoken(call.end.durationMs)} 걸림`,
      received: call.end.answer,
    };
  }
  if (call.end || call.cut) {
    return {
      ...base,
      state: "failed",
      title: `${name}${particle(name, "이", "가")} 답하지 못함`,
      meta: call.end ? (call.end.reason ?? "까닭을 알 수 없어요") : GONE_WITH_APP,
      received: null,
    };
  }
  const now = tools[tools.length - 1];
  return {
    ...base,
    state: "running",
    title: `${name}${particle(name, "이", "가")} 맡은 일을 하는 중`,
    meta: now ? phraseText(describeTool(now).phrase) : task,
    received: null,
  };
}

/** 하는 중의 경과 — 처음 온 `call` 줄부터 지금까지(「32초」). */
export function callRunningFor(call: CallEntry, now: number): string {
  return spoken(now - Date.parse(call.startedAt));
}

/** 여러 줄 글을 한 줄로 — 둘째 줄은 한 줄로 잘린다. */
const oneLine = (words: string) => words.replace(/\s+/g, " ").trim();

/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { lastSaid } from "./preview";
import type { RecordLine } from "./types";

// 사이드바 Thread 줄의 둘째 줄 — 마지막 말(v1 티켓 07 · 구현 스펙 스토리 128). seam은 순수 함수 `lastSaid` 하나다: 기록 줄을 넣고
// 「누가 · 무엇을 · 언제」만 본다. 바탕은 접기 검사와 같은 축복받은 두 턴짜리 기록이다(`fold.test.ts` 머리말).
const blessed: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

const sent = (seq: number, text: string): RecordLine => ({
  seq,
  at: "2026-10-10T10:01:00.000+09:00",
  kind: "sent",
  payload: { text, to: "host" },
});

const chunk = (seq: number, messageId: string, text: string): RecordLine => ({
  seq,
  at: "2026-10-10T10:01:01.000+09:00",
  kind: "update",
  who: "host",
  payload: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } },
});

const turnEnd = (seq: number, durationMs: number): RecordLine => ({
  seq,
  at: "2026-10-10T10:01:02.000+09:00",
  kind: "turn-end",
  who: "host",
  payload: { stopReason: "end_turn", durationMs, cancelledByUs: false, outOfTurn: false },
});

describe("Thread의 마지막 말", () => {
  it("끝난 턴이면 Agent의 턴 끝 답이고, 시각은 그 턴이 끝난 때다", () => {
    const said = lastSaid(blessed);
    expect(said && { who: said.who, name: said.name, text: said.text }).toEqual({ who: "host", name: "Host", text: "4" });
    expect(said && Date.parse(said.at)).toBe(Date.parse("2026-10-10T10:00:24.000+09:00"));
  });

  it("보내고 아직 답이 없으면 사람의 말이다", () => {
    const said = lastSaid([...blessed, sent(30, "테스트도 돌려 줘")]);
    expect(said).toEqual({ who: null, name: null, text: "테스트도 돌려 줘", at: "2026-10-10T10:01:00.000+09:00" });
  });

  // 도는 턴의 반쪽 답은 아직 말이 아니다 — 엔진의 지난 말(`past.rs`)도 끝난 턴의 것만 넘긴다.
  it("답이 흐르는 동안에는 보낸 말이 그대로 남는다", () => {
    const said = lastSaid([...blessed, sent(30, "테스트도 돌려 줘"), chunk(31, "m9", "돌려 볼게")]);
    expect(said?.who).toBeNull();
    expect(said?.text).toBe("테스트도 돌려 줘");
  });

  it("여러 줄 마크다운 답은 꾸밈을 걷은 한 줄이다", () => {
    const said = lastSaid([
      ...blessed,
      sent(30, "정리해 줘"),
      chunk(31, "m9", "## 정리\n\n**환불**은 `partialRefund`에서\n- 한 번만 뺀다"),
      turnEnd(32, 2000),
    ]);
    expect(said?.text).toBe("정리 환불은 partialRefund에서 한 번만 뺀다");
  });

  // 이름은 기록의 들어옴 줄(`joined`)이 든다 — 줄의 앞에 「리뷰어 · …」로 서는 말(캔버스 보드)이다.
  it("다른 Agent가 마지막에 말했으면 그 이름이 함께 온다", () => {
    const reviewer = (line: RecordLine): RecordLine => ({ ...line, who: "reviewer" });
    const said = lastSaid([
      ...blessed,
      { seq: 30, at: "2026-10-10T10:01:00.000+09:00", kind: "joined", who: "reviewer", payload: { handle: "reviewer", name: "리뷰어", from: "library" } },
      { ...sent(31, "@reviewer 봐 줘"), payload: { text: "@reviewer 봐 줘", to: "reviewer" } },
      reviewer(chunk(32, "r1", "수정 요청 2건")),
      reviewer(turnEnd(33, 1000)),
    ]);
    expect(said && { who: said.who, name: said.name, text: said.text }).toEqual({
      who: "reviewer",
      name: "리뷰어",
      text: "수정 요청 2건",
    });
  });

  it("말이 하나도 없으면 없다", () => {
    expect(lastSaid(blessed.slice(0, 4))).toBeNull();
    expect(lastSaid([])).toBeNull();
  });
});

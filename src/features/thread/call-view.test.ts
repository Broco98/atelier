/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { describeCall } from "./call-view";
import { foldThread, type CallEntry } from "./fold";
import type { RecordLine } from "./types";

// 호출 줄의 문구(v1 티켓 17 · 캔버스 WorkLog 보드 「Agent 호출 줄」) — 접은 부르기(`CallEntry`) → 넷 상태의 글. seam은 순수 함수
// `describeCall` 하나다. 바탕 기록은 엔진 검사(L1)가 가짜 claude로 지어 축복한 「Host가 리뷰어를 불러 결과를 받은」 기록이다
// (`thread-call.jsonl`) — 기록에 없는 갈래(실패 · 멈춤)는 그 끝 줄만 손으로 바꾼다.
const calling: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-call.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

const through = (seq: number) => calling.filter((line) => line.seq <= seq);

/** 그 기록의 첫 호출 줄과 불린 Agent의 이름. */
function firstCall(lines: readonly RecordLine[], goneThrough: number | null = null): { call: CallEntry; name: string } {
  const model = foldThread(lines, goneThrough);
  const call = model.turns.flatMap((turn) => turn.entries).find((entry): entry is CallEntry => entry.kind === "call");
  if (!call) throw new Error("호출 줄이 없다");
  return { call, name: model.cast[call.to]?.name ?? call.to };
}

const view = (lines: readonly RecordLine[], goneThrough: number | null = null) => {
  const { call, name } = firstCall(lines, goneThrough);
  return describeCall(call, name);
};

/** 축복 기록의 끝 줄(seq 22)을 갈아 끼운 기록. */
const endedWith = (payload: Record<string, unknown>): RecordLine[] =>
  calling.map((line) => (line.seq === 22 ? { ...line, payload: { ...(line.payload as object), ...payload } } : line));

describe("호출 줄의 넷 상태", () => {
  it("하는 중 — 「리뷰어가 맡은 일을 하는 중」 아래에 지금 도구 한 줄, 도구가 아직 없으면 맡긴 말이다", () => {
    expect(view(through(12))).toMatchObject({
      state: "running",
      title: "리뷰어가 맡은 일을 하는 중",
      meta: "“방금 고친 장바구니를 봐 줘”",
      received: null,
    });
    expect(view(through(15))).toMatchObject({ state: "running", meta: "note.md 읽는 중" });
    expect(view(through(18)).meta).toBe("note.md 수정함");
  });

  it("끝 — 「리뷰어에게 맡김」 아래에 맡긴 말과 걸린 시간, 펼치면 받은 말과 그 Agent의 도구 줄이다", () => {
    const done = view(calling);
    expect(done).toMatchObject({
      state: "answered",
      title: "리뷰어에게 맡김",
      meta: "“방금 고친 장바구니를 봐 줘” · 10초 걸림",
      received: "edited",
      session: true,
    });
    expect(done.tools.map((tool) => tool.call.title)).toEqual(["Read /tmp/gate/ws/proj/note.md", "Edit /tmp/gate/ws/proj/note.md"]);
  });

  it("실패 — 「리뷰어가 답하지 못함」 아래에 그 까닭이다", () => {
    expect(view(endedWith({ outcome: "failed", reason: "마지막 메시지 없이 턴을 끝냈다", answer: undefined }))).toMatchObject({
      state: "failed",
      title: "리뷰어가 답하지 못함",
      meta: "마지막 메시지 없이 턴을 끝냈다",
      received: null,
      session: true,
    });
    expect(view(endedWith({ outcome: "stopped", reason: "사람이 멈춤", answer: undefined })).meta).toBe("사람이 멈춤");
    // 앱을 다시 켜기 전에 끝 줄을 받지 못했다.
    expect(view(through(17), 17)).toMatchObject({ state: "failed", meta: "앱이 꺼지며 끊겼어요" });
  });

  it("전해지기 전에 막힌 부르기는 맡은 턴이 없어 Session을 열 곳이 없다", () => {
    const blocked: RecordLine[] = [
      ...through(7),
      {
        seq: 8,
        at: "2026-10-10T10:00:08.000+09:00",
        kind: "call",
        who: "host",
        payload: { state: "ended", id: "c2", from: "host", to: "reviewer", text: "봐 줘", durationMs: 3000, outcome: "stopped", reason: "사람이 멈춤" },
      },
    ];
    expect(view(blocked)).toMatchObject({ state: "failed", title: "reviewer가 답하지 못함", session: false, tools: [] });
  });

  it("이름의 받침에 맞춰 조사가 붙고, 여러 줄로 맡긴 말은 한 줄로 줄인다", () => {
    const { call } = firstCall(endedWith({ outcome: "failed", reason: "5분이 지나 멈췄어요", answer: undefined }));
    expect(describeCall(call, "보안 검토관").title).toBe("보안 검토관이 답하지 못함");
    expect(describeCall({ ...call, end: null, work: [], text: "이 diff를\n  봐 줘" }, "테스터")).toMatchObject({
      title: "테스터가 맡은 일을 하는 중",
      meta: "“이 diff를 봐 줘”",
    });
  });
});

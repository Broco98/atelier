/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  answeringLine,
  finalMessages,
  flowOf,
  foldThread,
  headline,
  particle,
  type CallEntry,
  type PendingProject,
  type PendingWork,
  type ThreadModel,
} from "./fold";
import { describeTool, phraseText } from "./tool-view";
import type { RecordLine } from "./types";
import { decisionsDue } from "./work-proposal";

// Thread 접기(v1 티켓 05) — 기록 줄 → 턴 · 말한 이 · 도구 줄 · 시스템 줄. seam은 순수 함수 `foldThread` 하나다: 처음 읽은 기록도
// 흐르는 기록 줄 이벤트도 같은 줄이라, 여기서 기록을 넣고 나온 화면 모델만 본다.
//
// 바탕 기록은 엔진 검사(L1)가 가짜 claude로 지어 **축복한** 두 턴짜리 Thread 기록이다(`thread-two-turns.jsonl`) — 엔진이 실제로 쓰는
// 줄의 꼴이 바뀌면 그 축복을 다시 받는 날 이 검사도 함께 깨진다. 기록에 없는 갈래(이름 바꾸기 · 거절 · 끊김)는 손으로 지은 줄을 덧붙인다.
const record = (name: string): RecordLine[] =>
  readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
const blessed = record("thread-two-turns");

/** Host 한 턴 뒤 `@reviewer`가 들어와 지난 말을 받고 답한 축복 기록(v1 티켓 13). */
const mention = record("thread-mention");

/**
 * Host가 Thread 도구로 리뷰어를 불러 맡기고 답을 받은 축복 기록(v1 티켓 16) — 두 턴 모두 진짜 claude의 녹음이다(v1 티켓 20). 리뷰어는
 * `thread.json`을 읽고 제목을 답한다.
 */
const calling = record("thread-call");
const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);
const TASK = "이 Thread 폴더(~/.atelier/threads/20261010-100000)의 thread.json을 읽고, 이 Thread의 제목이 무엇인지 한 줄로만 답해 줘.";
const ANSWER =
  "thread.json에 적힌 제목은 「리뷰어에게 이 Thread 폴더의 thread.json을 읽고 제목이 무…」입니다. 끝의 「…」까지 파일에 그대로 들어 있습니다.";

/** 그 턴의 호출 줄. */
function callIn(turn: ThreadModel["turns"][number]): CallEntry {
  const found = turn.entries.find((entry): entry is CallEntry => entry.kind === "call");
  if (!found) throw new Error("호출 줄이 없다");
  return found;
}

const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
const update = (seq: number, second: number, body: Record<string, unknown>): RecordLine => ({
  seq,
  at: at(second),
  kind: "update",
  who: "host",
  payload: { sessionId: "s", update: body },
});

describe("Thread 기록을 턴으로 접는다", () => {
  it("보낸 말마다 턴이 서고, 답한 이는 Host이며, 끝난 턴은 「N초 동안 작업함」으로 접힌다", () => {
    const model = foldThread(blessed);
    expect(model.running).toBe(false);
    expect(model.turns.map((turn) => turn.sent)).toEqual([
      "세 낱말로 답해 줘: hello from turn",
      "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘",
    ]);
    expect(model.turns.map((turn) => turn.who)).toEqual(["host", "host"]);
    expect(model.turns.map((turn) => turn.end && headline(turn.end))).toEqual(["4초 동안 작업함", "10초 동안 작업함"]);
    // 턴 끝 메시지(마지막 도구 뒤의 답)만 접힌 턴에 남는다.
    expect(model.turns.map((turn) => finalMessages(turn).map((entry) => entry.kind === "message" && entry.text))).toEqual([
      ["hello from turn"],
      ["5"],
    ]);
  });

  it("Host가 들어온 첫 줄은 흐름에 서지 않는다 — 모든 Thread가 그 줄로 시작한다", () => {
    expect(foldThread(blessed).system).toEqual([]);
  });

  it("도구 줄은 시작한 줄과 끝난 줄의 시각을 든다 — 걸린 시간을 말하려고", () => {
    const tools = foldThread(blessed).turns[1].entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => [tool.call.title, tool.startedAt, tool.endedAt])).toEqual([
      ["Write /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:12.000+09:00", "2026-10-10T10:00:13.000+09:00"],
      ["Read /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:14.000+09:00", "2026-10-10T10:00:15.000+09:00"],
      ["wc -c notes.txt", "2026-10-10T10:00:16.000+09:00", "2026-10-10T10:00:17.000+09:00"],
    ]);
  });

  it("같은 Agent가 사람 말 없이 이어 말하면 이름 줄을 다시 쓰지 않는다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      update(25, 1, { sessionUpdate: "agent_message_chunk", messageId: "m9", content: { type: "text", text: "더 볼게요" } }),
      { seq: 26, at: at(2), kind: "turn-end", who: "host", payload: { stopReason: "end_turn", durationMs: 1000, outOfTurn: true } },
    ];
    const model = foldThread(lines);
    expect(model.turns.map((turn) => [turn.who, turn.namesWho, turn.selfContinued])).toEqual([
      ["host", true, false],
      ["host", true, false],
      ["host", false, true],
    ]);
  });
});

describe("시스템 줄", () => {
  it("이름 바꾸기는 그 자리에 「Thread 이름을 X로 바꿈」으로 선다 — 조사는 이름의 받침을 따른다", () => {
    const lines: RecordLine[] = [
      ...blessed.slice(0, 9),
      { seq: 30, at: at(3), kind: "title", payload: { title: "환불 API 버그", before: "세 낱말로" } },
      ...blessed.slice(9),
      { seq: 31, at: at(4), kind: "title", payload: { title: "결제 흐름", before: "환불 API 버그" } },
    ];
    const { system } = foldThread(lines);
    expect(system.map((line) => [line.before, line.name, line.after, line.turnsBefore])).toEqual([
      ["Thread 이름을 ", "환불 API 버그", "로 바꿈", 1],
      ["Thread 이름을 ", "결제 흐름", "으로 바꿈", 2],
    ]);
  });

  it("Agent가 턴 안에서 Thread 도구로 이름을 바꾸면 그 턴 뒤에 같은 시스템 줄이 서고 턴은 이어진다(v1 티켓 15)", () => {
    // 엔진 검사가 축복한 기록 — Host가 첫 턴에서 `rename_thread`를 불렀다. `title` 줄은 도구 줄과 그 끝 사이에 `who: host`로 있다.
    const model = foldThread(record("thread-rename"));
    expect(model.system.map((line) => [`${line.before}${line.name}${line.after}`, line.turnsBefore])).toEqual([
      ["Thread 이름을 환불 API 버그로 바꿈", 1],
    ]);
    expect(model.turns).toHaveLength(1);
    const [turn] = model.turns;
    expect(turn.end && headline(turn.end)).toBe("9초 동안 작업함");
    // 그 앞의 `ToolSearch`(도구 들이기)는 서지 않는다.
    const tools = turn.entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => phraseText(describeTool(tool).phrase))).toEqual(["atelier-thread.rename_thread 불러옴"]);
    expect(finalMessages(turn).map((entry) => entry.kind === "message" && entry.text)).toEqual([
      "Thread 이름을 「환불 API 버그」로 바꿨습니다.",
    ]);
  });

  it("Host 밖의 참여자가 들고 나면 이름을 굵게 한 줄이 선다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(5), kind: "joined", who: "reviewer", payload: { handle: "reviewer", name: "리뷰어", from: "library" } },
      { seq: 26, at: at(6), kind: "left", who: "tester", payload: { handle: "tester", name: "테스터" } },
    ];
    expect(foldThread(lines).system.map((line) => `${line.before}${line.name}${line.after}`)).toEqual([
      "리뷰어가 참여함",
      "테스터가 나감",
    ]);
  });

  it("Agent가 Library에 Agent를 저장하면 그 이름 · 얼굴로 「Library에 … 저장함」 한 줄이 서고, 그 Agent는 참여자가 아니다(v1 티켓 19)", () => {
    const saved = (seq: number, handle: string, name: string, avatar?: unknown): RecordLine => ({
      seq,
      at: at(5),
      kind: "library",
      who: "host",
      payload: { handle, name, path: `/x/library/agents/${handle}.md`, ...(avatar ? { avatar } : {}) },
    });
    const model = foldThread([
      ...blessed,
      saved(25, "security-reviewer", "보안 리뷰어", { shape: "triangle", color: "purple" }),
      saved(26, "writer", "문서 작성자"),
    ]);
    expect(model.system.map((line) => [line.kind, line.handle, `${line.before}${line.name}${line.after}`, line.turnsBefore])).toEqual([
      ["library", "security-reviewer", "Library에 보안 리뷰어를 저장함", 2],
      ["library", "writer", "Library에 문서 작성자를 저장함", 2],
    ]);
    expect(model.system.map((line) => line.avatar)).toEqual([{ shape: "triangle", color: "purple" }, null]);
    expect(Object.keys(model.cast)).toEqual(["host"]);
  });
});

describe("도구 줄의 끝", () => {
  it("권한을 물은 도구를 사람이 거절하면 그 줄은 「거절함」이다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(1), kind: "sent", payload: { text: "마이그레이션 돌려줘", to: "host" } },
      update(26, 2, {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "pnpm prisma migrate dev",
        kind: "execute",
        status: "pending",
        rawInput: { command: "pnpm prisma migrate dev" },
      }),
      {
        seq: 27,
        at: at(3),
        kind: "permission",
        who: "host",
        payload: {
          state: "asked",
          requestId: "r1",
          request: {
            toolCall: { toolCallId: "t1" },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          },
          toolCall: { toolCallId: "t1", kind: "execute" },
        },
      },
    ];
    const asked = foldThread(lines);
    expect(asked.pending.map((request) => [request.requestId, request.who])).toEqual([["r1", "host"]]);

    const answered = foldThread([
      ...lines,
      { seq: 28, at: at(4), kind: "permission", who: "host", payload: { state: "answered", requestId: "r1", optionId: "reject" } },
      update(29, 5, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" }),
    ]);
    expect(answered.pending).toEqual([]);
    const tool = answered.turns[2].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && tool.denied).toBe(true);
  });

  it("엔진이 판정으로 답한 편집은 승인 카드가 서지 않고, 그 도구 줄은 「내가 거절함」이 아니다", () => {
    const options = [
      { optionId: "allow_once", name: "Yes", kind: "allow_once" },
      { optionId: "reject", name: "No", kind: "reject_once" },
    ];
    const reason = "「장바구니 수량을 고쳐 줘」 Thread의 @host가 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요";
    // v1 티켓 18 — 다른 Session이 쓰기 자리를 쥐었다: 물음 줄 없이 판정 줄 하나다.
    const model = foldThread([
      ...blessed,
      { seq: 25, at: at(1), kind: "sent", payload: { text: "장바구니 문서를 고쳐 줘", to: "host" } },
      update(26, 2, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit src/cart.ts", kind: "edit", status: "pending" }),
      {
        seq: 27,
        at: at(3),
        kind: "permission",
        who: "host",
        payload: {
          state: "decided",
          requestId: "r1",
          optionId: "reject",
          reason,
          request: { toolCall: { toolCallId: "t1" }, options },
          toolCall: { toolCallId: "t1", kind: "edit" },
        },
      },
      update(28, 4, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" }),
    ]);
    expect(model.pending).toEqual([]);
    const tool = model.turns[2].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && tool.toolCallId).toBe("t1");
    expect(tool?.kind === "tool" && tool.denied).toBe(false);
  });

  it("앱을 다시 켜기 전에 열린 채 남은 턴은 끝난 것으로 접히고, 끝을 받지 못한 도구 줄은 끊긴다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(1), kind: "sent", payload: { text: "테스트 돌려줘", to: "host" } },
      update(26, 2, { sessionUpdate: "tool_call", toolCallId: "t2", title: "pnpm test", kind: "execute", status: "in_progress" }),
    ];
    expect(foldThread(lines).running).toBe(true);
    const gone = foldThread(lines, 26);
    expect(gone.running).toBe(false);
    const turn = gone.turns[2];
    expect(turn.end?.error).toBe("앱이 꺼지며 끊겼어요");
    expect(turn.entries.map((entry) => entry.kind === "tool" && entry.cut)).toEqual([true]);
  });
});

describe("승인 카드의 물음과 결정 줄(v1 티켓 24)", () => {
  const options = [
    { optionId: "allow_once", name: "Yes", kind: "allow_once" },
    { optionId: "reject", name: "No, and tell Claude what to do differently", kind: "reject_once" },
  ];
  // Host가 마이그레이션 명령을 물었다 — 판정이 카드 종류 · Policy 이름 · 「다시 묻지 않기」 허락을 함께 달았다(v1 티켓 22 · 24).
  const asking: RecordLine[] = [
    ...blessed,
    { seq: 25, at: at(1), kind: "sent", payload: { text: "환불 API 버그 고쳐줘", to: "host" } },
    update(26, 2, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "pnpm prisma migrate dev --name partial_refund",
      kind: "execute",
      status: "pending",
      rawInput: { command: "pnpm prisma migrate dev --name partial_refund", description: "DB 스키마가 바뀝니다" },
    }),
    {
      seq: 27,
      at: at(3),
      kind: "permission",
      who: "host",
      payload: {
        state: "asked",
        requestId: "r1",
        request: { toolCall: { toolCallId: "t1" }, options },
        toolCall: { toolCallId: "t1", kind: "execute", rawInput: { command: "pnpm prisma migrate dev --name partial_refund" } },
        card: "command",
        policy: "매번 묻기",
        grant: ["Bash(pnpm prisma *)"],
      },
    },
  ];
  const answered = (payload: Record<string, unknown>): RecordLine => ({
    seq: 28,
    at: at(4),
    kind: "permission",
    who: "host",
    payload: { state: "answered", requestId: "r1", ...payload },
  });

  it("물음은 카드 종류 · Policy 이름 · 다시 묻지 않기 허락을 들고, 그 도구 줄은 「승인을 기다리는 중」이다", () => {
    const model = foldThread(asking);
    expect(model.pending.map((request) => [request.card, request.policy, request.grant])).toEqual([
      ["command", "매번 묻기", ["Bash(pnpm prisma *)"]],
    ]);
    const tool = model.pending[0].tool;
    expect(tool && phraseText(describeTool(tool).phrase)).toBe("pnpm prisma migrate dev --name partial_refund 승인을 기다리는 중");
  });

  it("사람이 답하면 카드가 걷히고, 그 턴의 도구 줄 뒤에 고른 것이 결정 줄로 선다", () => {
    const model = foldThread([
      ...asking,
      answered({ optionId: "allow_once", granted: { rules: ["Bash(pnpm prisma *)"], work: "refund-api" } }),
      update(29, 5, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" }),
    ]);
    expect(model.pending).toEqual([]);
    const entries = model.turns[2].entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["tool", "decision"]);
    const decision = entries[1];
    expect(decision.kind === "decision" && [decision.allowed, decision.granted, decision.words, decision.toolCall.kind]).toEqual([
      true,
      { rules: ["Bash(pnpm prisma *)"], work: "refund-api" },
      null,
      "execute",
    ]);
    const tool = entries[0];
    expect(tool.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("pnpm prisma migrate dev --name partial_refund 실행 중");
  });

  it("거절하며 남긴 말은 결정 줄이 든다 — 판정이 닫은 요청에는 결정 줄이 서지 않는다", () => {
    const refused = foldThread([...asking, answered({ optionId: "reject", words: "마이그레이션 없이 할 수는 없어?" })]);
    const decision = refused.turns[2].entries.find((entry) => entry.kind === "decision");
    expect(decision?.kind === "decision" && [decision.allowed, decision.granted, decision.words]).toEqual([
      false,
      null,
      "마이그레이션 없이 할 수는 없어?",
    ]);

    const decided = foldThread([
      ...asking,
      { seq: 28, at: at(4), kind: "permission", who: "host", payload: { state: "decided", requestId: "r1", optionId: "reject", reason: "…" } },
    ]);
    expect(decided.pending).toEqual([]);
    expect(decided.turns[2].entries.map((entry) => entry.kind)).toEqual(["tool"]);
  });
});

describe("첨부(v1 티켓 06)", () => {
  it("보낸 말에 붙인 파일 · 폴더는 그 턴의 첨부로 들고, 첨부 없는 말은 빈 목록이다", () => {
    const attachments = [
      { path: "/Users/me/logs/error.log", size: 12_288, folder: false },
      { path: "/Users/me/재현 화면", size: null, folder: true },
    ];
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(5), kind: "sent", payload: { text: "이 로그 봐 줘", attachments, prompt: [], sendNow: false, to: "host" } },
    ];
    const model = foldThread(lines);
    expect(model.turns.map((turn) => [turn.sent, turn.attachments])).toEqual([
      ["세 낱말로 답해 줘: hello from turn", []],
      ["notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘", []],
      ["이 로그 봐 줘", attachments],
    ]);
  });

  it("꼴이 틀린 첨부 칸은 걸러 낸다 — 경로가 글이 아닌 것", () => {
    const lines: RecordLine[] = [
      { seq: 1, at: at(1), kind: "sent", payload: { text: "봐 줘", attachments: [{ path: 3 }, { path: "/a.txt", size: 2, folder: false }, "x"], to: "host" } },
    ];
    expect(foldThread(lines).turns[0].attachments).toEqual([{ path: "/a.txt", size: 2, folder: false }]);
  });
});

describe("인용(v1 티켓 35 · S41)", () => {
  it("넓힌 카드의 문서에서 고른 글을 붙인 말은 그 턴의 인용으로 들고, 인용 없는 말 · 꼴이 틀린 인용은 없음이다", () => {
    const quote = { file: "design.md", start: 3, end: 4, text: "차감은 한 번만 한다." };
    const lines: RecordLine[] = [
      { seq: 1, at: at(1), kind: "sent", payload: { text: "이 부분 다시 봐 줘", quote, prompt: [], to: "host" } },
      { seq: 2, at: at(2), kind: "sent", payload: { text: "고마워", prompt: [], to: "host" } },
      { seq: 3, at: at(3), kind: "sent", payload: { text: "이것도", quote: { file: "design.md", start: "3" }, to: "host" } },
    ];
    expect(foldThread(lines).turns.map((turn) => turn.quote)).toEqual([quote, null, null]);
  });
});

describe("여럿이 한 Thread에(v1 티켓 14)", () => {
  const said = (seq: number, second: number, who: string, words: string): RecordLine => ({
    seq,
    at: at(second),
    kind: "update",
    who,
    payload: { sessionId: who, update: { sessionUpdate: "agent_message_chunk", messageId: `m-${who}`, content: { type: "text", text: words } } },
  });
  const sent = (seq: number, second: number, to: string, words: string): RecordLine => ({
    seq,
    at: at(second),
    kind: "sent",
    payload: { text: words, to },
  });
  const ended = (seq: number, second: number, who: string): RecordLine => ({
    seq,
    at: at(second),
    kind: "turn-end",
    who,
    payload: { stopReason: "end_turn", durationMs: 1000, cancelledByUs: false, outOfTurn: false },
  });
  const joined = (seq: number, second: number, handle: string, name: string, avatar: unknown = null): RecordLine => ({
    seq,
    at: at(second),
    kind: "joined",
    who: handle,
    payload: { handle, name, avatar, from: "library" },
  });

  it("멘션으로 들어온 리뷰어의 턴은 리뷰어가 답하고, 「리뷰어가 참여함」이 그 턴 앞에 선다", () => {
    const model = foldThread(mention);
    expect(model.turns.map((turn) => [turn.who, turn.namesWho, turn.sent])).toEqual([
      ["host", true, "세 낱말로 답해 줘: hello from turn"],
      ["reviewer", true, "@reviewer 방금 답을 봐 줘"],
    ]);
    expect(model.system.map((line) => [line.handle, `${line.before}${line.name}${line.after}`, line.turnsBefore])).toEqual([
      ["reviewer", "리뷰어가 참여함", 1],
    ]);
    expect(model.cast.reviewer).toEqual({ name: "리뷰어", avatar: { shape: "circle", color: "green" } });
  });

  it("참여자의 이름 · 얼굴은 기록의 들어옴 줄이 정본이다 — Host는 늘 「Host」다", () => {
    const { cast } = foldThread([joined(1, 1, "host", "Host"), joined(2, 2, "reviewer", "리뷰어", { shape: "circle", color: "green" })]);
    expect(cast).toEqual({
      host: { name: "Host", avatar: null },
      reviewer: { name: "리뷰어", avatar: { shape: "circle", color: "green" } },
    });
  });

  it("Host가 도는 동안 리뷰어에게 보낸 말은 리뷰어의 턴이 따로 서고, 각자의 줄은 각자의 턴에 든다", () => {
    const lines: RecordLine[] = [
      joined(1, 1, "host", "Host"),
      sent(2, 2, "host", "고쳐 줘"),
      said(3, 3, "host", "고치는 중"),
      joined(4, 4, "reviewer", "리뷰어"),
      sent(5, 5, "reviewer", "@reviewer 봐 줘"),
      said(6, 6, "reviewer", "보는 중"),
      said(7, 7, "host", " — 반쯤"),
    ];
    const both = foldThread(lines);
    expect(both.running).toBe(true);
    expect(both.answering).toEqual(["host", "reviewer"]);
    expect(both.turns.map((turn) => [turn.who, finalMessages(turn).map((entry) => entry.kind === "message" && entry.text)])).toEqual([
      ["host", ["고치는 중 — 반쯤"]],
      ["reviewer", ["보는 중"]],
    ]);

    // Host가 먼저 끝나도 리뷰어의 턴은 돈다.
    const one = foldThread([...lines, ended(8, 8, "host")]);
    expect(one.turns.map((turn) => turn.end !== null)).toEqual([true, false]);
    expect(one.answering).toEqual(["reviewer"]);
  });

  it("한 참여자의 Session이 죽으면 그의 턴만 끝난다", () => {
    const model = foldThread([
      sent(1, 1, "host", "고쳐 줘"),
      said(2, 2, "host", "고치는 중"),
      sent(3, 3, "reviewer", "@reviewer 봐 줘"),
      { seq: 4, at: at(4), kind: "session", who: "reviewer", payload: { state: "died", reason: "끝났어요" } },
    ]);
    expect(model.turns.map((turn) => [turn.who, turn.end?.error ?? null])).toEqual([
      ["host", null],
      ["reviewer", "Claude Code가 끝났어요"],
    ]);
    expect(model.answering).toEqual(["host"]);
  });

  it("「답하는 중」 줄은 답이 아직 안 보이는 도는 턴의 참여자를 든다 — 흐름 끝에서 답이 흐르는 턴은 제 머리줄이 말한다", () => {
    // 보낸 말에 아직 아무 줄도 오지 않았다 — 「Host가 답하는 중」.
    expect(answeringLine(foldThread([sent(1, 1, "host", "고쳐 줘")]))).toEqual(["host"]);
    const lines: RecordLine[] = [sent(1, 1, "host", "고쳐 줘"), said(2, 2, "host", "고치는 중")];
    expect(answeringLine(foldThread(lines))).toBeNull();
    const both = [...lines, sent(3, 3, "reviewer", "@reviewer 봐 줘")];
    expect(answeringLine(foldThread(both))).toEqual(["host", "reviewer"]);
    // 리뷰어의 답이 흐르기 시작하면 리뷰어는 제 턴이 말하고, 흐름 끝이 아닌 Host만 남는다.
    expect(answeringLine(foldThread([...both, said(4, 4, "reviewer", "보는 중")]))).toEqual(["host"]);
    // 리뷰어가 끝나도 Host의 턴은 흐름 끝이 아니다.
    expect(answeringLine(foldThread([...both, ended(4, 4, "reviewer")]))).toEqual(["host"]);
    expect(answeringLine(foldThread([...both, ended(4, 4, "reviewer"), ended(5, 5, "host")]))).toBeNull();
  });
});

describe("호출 줄(v1 티켓 17)", () => {
  const callOf = (lines: readonly RecordLine[]): CallEntry => {
    const found = foldThread(lines).turns.flatMap((turn) => turn.entries).find((entry) => entry.kind === "call");
    if (!found || found.kind !== "call") throw new Error("호출 줄이 없다");
    return found;
  };

  it("호출 줄은 부른 Agent의 턴에 서고, 그 부르기의 Agent 부르기 도구 줄 자리를 대신한다", () => {
    const model = foldThread(calling);
    const [host, reviewer] = model.turns;
    expect(model.turns.map((turn) => turn.who)).toEqual(["host", "reviewer"]);
    expect(host.entries.map((entry) => entry.kind)).toEqual(["thought", "call", "message"]);
    const call = callIn(host);
    expect([call.id, call.from, call.to, call.text]).toEqual(["fake-call", "host", "reviewer", TASK]);
    expect(call.end).toEqual({ outcome: "answered", answer: ANSWER, reason: null, durationMs: 7000 });
    // 도구의 끝(seq 23)이 와도 도구 줄은 다시 서지 않는다 — 접힌 턴에는 호출 줄 뒤의 답만 펼쳐 둔다.
    expect(finalMessages(host).map((entry) => entry.kind === "message" && entry.text)).toEqual([
      `@reviewer가 보낸 답을 그대로 옮깁니다.\n\n> ${ANSWER}`,
    ]);
    expect(reviewer.entries.some((entry) => entry.kind === "call")).toBe(false);
  });

  it("Thread 도구를 들이는 ToolSearch는 도구 줄로 서지 않고, 그 끝도 붙지 않는다(v1 티켓 20)", () => {
    // 진짜 claude는 `call_agent`를 부르기 전에 `ToolSearch`(seq 8)로 그 도구를 들이고 곧 끝낸다(seq 9).
    expect(calling.filter((line) => line.seq === 8).map((line) => JSON.stringify(line.payload))).toEqual([
      expect.stringContaining('"title":"ToolSearch"'),
    ]);
    const [host] = foldThread(through(calling, 9)).turns;
    expect(host.entries.map((entry) => entry.kind)).toEqual(["thought"]);
    expect(host.answeredAt).toBe(calling.find((line) => line.seq === 7)?.at);
  });

  it("불린 Agent의 맡은 턴은 사람의 말 없이 맡긴 일로 서고, 그 Agent의 줄은 그 턴에 든다", () => {
    const [host, reviewer] = foldThread(calling).turns;
    expect([reviewer.sent, reviewer.selfContinued, reviewer.namesWho, reviewer.assigned?.id]).toEqual([
      null,
      false,
      true,
      "fake-call",
    ]);
    const tools = reviewer.entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => tool.call.title)).toEqual(["Read ~/.atelier/threads/20261010-100000/thread.json"]);
    expect(finalMessages(reviewer).map((entry) => entry.kind === "message" && entry.text)).toEqual([ANSWER]);
    // 호출 줄은 그 맡은 턴의 줄들을 들고 있다 — 하는 중의 지금 도구 · 펼침의 도구 줄.
    const call = callIn(host);
    expect(call.work?.map((entry) => entry.key)).toEqual(reviewer.entries.map((entry) => entry.key));
  });

  it("맡긴 일이 전해지기 전에 막힌 부르기는 끝 줄 하나로 서고 맡은 턴이 없다", () => {
    const lines: RecordLine[] = [
      ...through(calling, 10),
      {
        seq: 11,
        at: at(11),
        kind: "call",
        who: "host",
        payload: { state: "ended", id: "c2", from: "host", to: "reviewer", text: "방금 고친 장바구니를 봐 줘", durationMs: 3000, outcome: "stopped", reason: "사람이 멈춤" },
      },
    ];
    const model = foldThread(lines);
    expect(model.turns.map((turn) => turn.who)).toEqual(["host"]);
    const call = callOf(lines);
    expect([call.work, call.end?.outcome, call.end?.reason]).toEqual([null, "stopped", "사람이 멈춤"]);
  });

  it("앱을 다시 켜기 전에 끝 줄을 받지 못한 부르기는 끊긴다", () => {
    const lines = through(calling, 17);
    expect(callOf(lines).cut).toBe(false);
    const gone = foldThread(lines, 17).turns.flatMap((turn) => turn.entries).find((entry) => entry.kind === "call");
    expect(gone?.kind === "call" && gone.cut).toBe(true);
  });

  it("불린 Agent가 일하는 동안 맡은 턴은 흐름에 서지 않는다 — 호출 줄이 그 일을 말하고 「답하는 중」에도 서지 않는다", () => {
    const working = flowOf(foldThread(through(calling, 17)));
    expect(working.turns.map((turn) => turn.who)).toEqual(["host"]);
    expect(working.answering).toBeNull();
    expect(working.system.map((line) => [line.handle, line.turnsBefore])).toEqual([["reviewer", 1]]);
  });

  it("답을 받으면 맡은 턴이 그 Agent의 말로 흐름에 서고, 답하지 못하면 서지 않는다 — 호출 줄이 까닭을 말한다", () => {
    expect(flowOf(foldThread(calling)).turns.map((turn) => turn.who)).toEqual(["host", "reviewer"]);
    const failed: RecordLine = {
      seq: 22,
      at: at(22),
      kind: "call",
      who: "host",
      payload: { state: "ended", id: "fake-call", from: "host", to: "reviewer", text: "방금 고친 장바구니를 봐 줘", durationMs: 9000, outcome: "failed", reason: "마지막 메시지 없이 턴을 끝냈다" },
    };
    expect(flowOf(foldThread([...through(calling, 21), failed])).turns.map((turn) => turn.who)).toEqual(["host"]);
  });

  it("Session 보기(S37)는 그 Agent의 턴과 들고 남만 남기고, 맡은 턴은 일하는 동안에도 선다", () => {
    const reviewer = flowOf(foldThread(through(calling, 17)), "reviewer");
    expect(reviewer.turns.map((turn) => [turn.who, turn.assigned?.text])).toEqual([["reviewer", TASK]]);
    expect(reviewer.system.map((line) => [line.handle, line.turnsBefore])).toEqual([["reviewer", 0]]);
    expect(reviewer.answering).toBeNull();
    const host = flowOf(foldThread(calling), "host");
    expect(host.turns.map((turn) => turn.who)).toEqual(["host"]);
    expect(host.system).toEqual([]);
  });

  it("부른 Agent의 턴 밖에서 선 부르기(다시 맡기기)는 턴 사이의 호출 줄이다", () => {
    const again: RecordLine[] = [
      ...calling,
      {
        seq: 28,
        at: at(28),
        kind: "call",
        who: "host",
        payload: { state: "started", id: "again", from: "host", to: "reviewer", text: "방금 고친 장바구니를 봐 줘", prompt: [] },
      },
    ];
    const model = foldThread(again);
    expect(model.calls.map((one) => [one.entry.id, one.turnsBefore])).toEqual([["again", 2]]);
    expect(model.turns.map((turn) => [turn.who, turn.assigned?.id ?? null])).toEqual([
      ["host", null],
      ["reviewer", "fake-call"],
      ["reviewer", "again"],
    ]);
    // 리뷰어의 Session 보기에는 Host의 부르기가 서지 않는다 — 맡은 턴이 그 맡긴 말을 든다.
    expect(flowOf(model, "reviewer").calls).toEqual([]);
    expect(flowOf(model).calls.map((one) => [one.entry.id, one.turnsBefore])).toEqual([["again", 2]]);
  });
});

describe("물어보는 정도(v1 티켓 23)", () => {
  /** 「편집은 허용」으로 세운 Thread의 첫 편집을 판정이 묻지 않고 허용한 축복 기록 — 물음 줄 없이 판정 줄(`decided`) 하나다. */
  const auto = record("thread-auto-allow");

  it("바꾼 정도는 「Policy를 X로 바꿈」 시스템 줄이고, Work에 이은 Thread면 「· 이 Work에만」이 붙는다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(5), kind: "mode", payload: { mode: "edits", work: "cart" } },
      { seq: 26, at: at(6), kind: "mode", payload: { mode: "always", work: null } },
      { seq: 27, at: at(7), kind: "mode", payload: { mode: "plan", work: null } },
      { seq: 28, at: at(8), kind: "mode", payload: { mode: "bogus", work: null } },
    ];
    const { system } = foldThread(lines);
    expect(system.map((line) => [line.kind, line.handle, `${line.before}${line.name}${line.after}`, line.turnsBefore])).toEqual([
      ["mode", null, "Policy를 편집은 허용으로 바꿈 · 이 Work에만", 2],
      ["mode", null, "Policy를 매번 묻기로 바꿈", 2],
      ["mode", null, "Policy를 계획만으로 바꿈", 2],
    ]);
    expect(system.map((line) => line.name)).toEqual(["편집은 허용", "매번 묻기", "계획만"]);
  });

  it("판정이 묻지 않고 허용한 도구 줄은 그 까닭을 들고, 승인 카드는 서지 않는다", () => {
    const model = foldThread(auto);
    expect(model.pending).toEqual([]);
    const tools = model.turns[0].entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => [phraseText(describeTool(tool).phrase), tool.allowed, tool.denied])).toEqual([
      ["allowed.txt 작성함", "편집은 허용", false],
    ]);
  });

  it("판정이 거절한 줄과 사람이 허락한 줄은 자동 허용이 아니다", () => {
    const decided = auto.find((line) => line.kind === "permission");
    if (!decided) throw new Error("판정 줄이 있다");
    const payload = decided.payload as Record<string, unknown>;
    const refused = foldThread(
      auto.map((line) => (line === decided ? { ...line, payload: { ...payload, optionId: "reject", reason: "이 Agent의 Policy가 금지한 일이에요" } } : line)),
    );
    const asked = foldThread([
      ...auto.filter((line) => line.seq < decided.seq),
      { ...decided, payload: { ...payload, state: "asked", optionId: undefined, reason: undefined } },
      { seq: decided.seq, at: decided.at, kind: "permission", who: "host", payload: { state: "answered", requestId: "0", optionId: "allow_once" } },
      ...auto.filter((line) => line.seq > decided.seq),
    ]);
    for (const model of [refused, asked]) {
      const tool = model.turns[0].entries.find((entry) => entry.kind === "tool");
      expect(tool?.kind === "tool" && tool.allowed).toBe(null);
    }
  });

  it("허용 줄이 도구 줄보다 먼저 와도 그 도구 줄이 까닭을 든다", () => {
    const decided = auto.find((line) => line.kind === "permission");
    const first = auto.find((line) => line.kind === "update" && (line.payload as { update: { sessionUpdate: string } }).update.sessionUpdate === "tool_call");
    if (!decided || !first) throw new Error("판정 줄과 도구 줄이 있다");
    const swapped = auto.map((line) => (line === first ? { ...decided, seq: first.seq } : line === decided ? { ...first, seq: decided.seq } : line));
    const tool = foldThread(swapped).turns[0].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && tool.allowed).toBe("편집은 허용");
  });
});

describe("Work 만들기 카드(v1 티켓 30)", () => {
  /** Host가 Work 만들기를 제안하고, 사람이 web-app을 넣어 만든 축복 기록 — 8 제안 · 9 답 · 10 work 줄 · 11 도구 끝. */
  const working = record("thread-work");
  /** 걸린 Work 만들기 카드 — 권한 요청과 한 물음 차례(`asks`)에 선다. */
  const cards = (model: ThreadModel) => model.asks.filter((one): one is PendingWork => one.card === "work");

  it("제안 줄이 오면 카드가 서고 — 제목 · 까닭 · 브랜치와 등록된 Project(Host 추천이 먼저) — 그 도구 줄은 「Work 만들기를 묻는 중」이다", () => {
    const model = foldThread(through(working, 8));
    expect(cards(model).map((one) => [one.requestId, one.who, one.title, one.reason, one.slug, one.branch])).toEqual([
      ["fake-request", "host", "환불 API 버그 수정", "고칠 Project와 브랜치를 골라 두었어요", "refund-api", "fix/refund-api"],
    ]);
    expect(cards(model)[0].projects).toEqual([
      {
        slug: "api-server",
        name: "api-server",
        description: "결제 · 환불 API",
        recommended: true,
        reason: "refund.service.ts가 여기 있어요",
        branches: ["main"],
      },
      { slug: "web-app", name: "web-app", description: "환불 버튼 화면", recommended: false, reason: null, branches: ["main"] },
    ]);
    const tool = model.turns[0].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("Work 만들기를 묻는 중");
  });

  it("만들면 카드가 걷히고, 그 도구 줄 자리에 「Work 만들기」 결정 줄이, 턴 뒤에 「Work … 을 만들고 이 Thread에 연결함」 시스템 줄이 선다", () => {
    const model = foldThread(working);
    expect(cards(model)).toEqual([]);
    const entries = model.turns[0].entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["work-choice", "message"]);
    expect(entries[0]).toMatchObject({ created: true, projects: ["api-server", "web-app"], branch: "fix/refund-api" });
    expect(model.system.map((line) => [line.kind, line.before, line.name, line.after, line.turnsBefore])).toEqual([
      ["work", "Work ", "환불 API 버그 수정", "을 만들고 이 Thread에 연결함", 1],
    ]);
    expect(finalMessages(model.turns[0]).map((entry) => entry.kind === "message" && entry.text)).toEqual(["hello from turn"]);
  });

  it("결정 줄은 턴 끝 메시지를 가르지 않는다 — 카드 앞에 물은 말과 결정 뒤의 답이 함께 접힌 턴에 남는다(화면 2 보드)", () => {
    const asked = update(6, 6, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m-ask",
      content: { type: "text", text: "이 일을 Work로 만들어 둘까요?" },
    });
    const model = foldThread(working.map((line) => (line.seq === 6 ? asked : line)));
    expect(finalMessages(model.turns[0]).map((entry) => entry.kind === "message" && entry.text)).toEqual([
      "이 일을 Work로 만들어 둘까요?",
      "hello from turn",
    ]);
  });

  it("「Work 없이 계속」은 시스템 줄 없이 결정 줄만 서고, 멈춤으로 거둔 카드는 결정 줄 없이 걷힌다", () => {
    const answered = (payload: Record<string, unknown>): RecordLine => ({
      seq: 9,
      at: at(9),
      kind: "question",
      who: "host",
      payload: { requestId: "fake-request", card: "work", ...payload },
    });
    const continued = foldThread([...through(working, 8), answered({ state: "answered", choice: "continue" })]);
    expect(cards(continued)).toEqual([]);
    expect(continued.system).toEqual([]);
    expect(continued.turns[0].entries.map((entry) => entry.kind === "work-choice" && entry.created)).toEqual([false]);

    const withdrawn = foldThread([...through(working, 8), answered({ state: "withdrawn", reason: "stopped" })]);
    expect(cards(withdrawn)).toEqual([]);
    expect(withdrawn.turns[0].entries.map((entry) => entry.kind)).toEqual(["tool"]);
  });

  it("Project 목록 · Work 읽기 도구 줄은 사람의 말로 선다 — 「Project 2개 목록 확인함」 · 「Work 읽음」", () => {
    const tool = (seq: number, id: string, name: string, status: string, text?: string) =>
      update(seq, seq, {
        sessionUpdate: seq === 2 || seq === 4 ? "tool_call" : "tool_call_update",
        toolCallId: id,
        title: name,
        kind: "other",
        status,
        _meta: { claudeCode: { toolName: name } },
        ...(text !== undefined && { content: [{ type: "content", content: { type: "text", text } }] }),
      });
    const model = foldThread([
      { seq: 1, at: at(1), kind: "sent", payload: { text: "환불 API 버그 고쳐줘", to: "host" } },
      tool(2, "p", "mcp__atelier-thread__list_projects", "in_progress"),
      tool(3, "p", "mcp__atelier-thread__list_projects", "completed", '[{"slug":"api-server"},{"slug":"web-app"}]'),
      tool(4, "w", "mcp__atelier-thread__get_work", "in_progress"),
    ]);
    const phrases = model.turns[0].entries.map((entry) => entry.kind === "tool" && phraseText(describeTool(entry).phrase));
    expect(phrases).toEqual(["Project 2개 목록 확인함", "Work 읽는 중"]);
  });

  it("제안한 Session이 끝나면 카드도 걷힌다 — 답할 곳이 없다", () => {
    const died: RecordLine = { seq: 9, at: at(9), kind: "session", who: "host", payload: { state: "died", reason: "끝남" } };
    expect(foldThread([...through(working, 8), died]).asks).toEqual([]);
    expect(foldThread(through(working, 8), 8).asks).toEqual([]);
  });
});

describe("질문 카드(v1 티켓 26)", () => {
  /**
   * Host가 물음 둘을 내고 사람이 답한 축복 기록 — 8 도구 줄 · 9 질문 · 10 답 · 11 그 도구 끝 · 12 답 · 14 턴 끝. 사람에게 묻는 claude의
   * 녹음이 없어 가짜 claude가 녹화의 `Write` 물음을 질문으로 바꿔 냈다 — 그래서 도구 줄은 `Write`다.
   */
  const asked = record("thread-question");
  const answer = (payload: Record<string, unknown>): RecordLine => ({
    seq: 10,
    at: at(10),
    kind: "question",
    who: "host",
    payload: { requestId: "0", card: "question", ...payload },
  });

  it("질문 줄이 오면 물음 차례에 질문으로 서고, 그 도구 줄은 질문 줄이 대신한다", () => {
    const model = foldThread(through(asked, 9));
    expect(model.asks.map((one) => [one.card, one.who, one.requestId])).toEqual([["question", "host", "0"]]);
    const question = model.asks[0];
    expect(question.card === "question" && question.questions.map((one) => [one.question, one.multiSelect, one.options.length])).toEqual([
      ["부분 환불 수수료는 어떻게 할까요?", false, 3],
      ["어느 화면에 보일까요?", true, 2],
    ]);
    expect(question.card === "question" && question.questions[0].options[0]).toEqual({
      label: "비율대로 돌려준다",
      description: "환불한 금액만큼 나눠 돌려줘요",
    });
    const entries = model.turns[0].entries;
    expect(entries.filter((entry) => entry.kind === "tool")).toEqual([]);
    expect(entries.filter((entry) => entry.kind === "question").map((entry) => entry.kind === "question" && entry.choice)).toEqual([null]);
  });

  it("답하면 질문이 걷히고 그 자리에 답한 것이 서며, 그 도구의 늦은 줄은 도구 줄을 되살리지 않는다", () => {
    const model = foldThread(asked);
    expect(model.asks).toEqual([]);
    const entries = model.turns[0].entries.filter((entry) => entry.kind !== "thought");
    expect(entries.map((entry) => entry.kind)).toEqual(["question", "message"]);
    const question = entries[0];
    expect(question.kind === "question" && [question.choice, question.answers]).toEqual([
      "answer",
      [
        { question: "부분 환불 수수료는 어떻게 할까요?", answer: "비율대로 돌려준다" },
        { question: "어느 화면에 보일까요?", answer: "주문 상세, 환불 내역" },
      ],
    ]);
    // 답한 줄은 도구 줄처럼 턴 끝 메시지의 앞을 가른다.
    expect(finalMessages(model.turns[0]).map((entry) => entry.kind === "message" && entry.text)).toEqual(["done"]);
  });

  it("나중에는 답 없이 그 자리에 남고, 거둬진 질문은 아무것도 남지 않는다", () => {
    const later = foldThread([...through(asked, 9), answer({ state: "answered", choice: "later" })]);
    expect(later.asks).toEqual([]);
    const entry = later.turns[0].entries.find((one) => one.kind === "question");
    expect(entry?.kind === "question" && [entry.choice, entry.answers]).toEqual(["later", []]);

    const withdrawn = foldThread([...through(asked, 9), answer({ state: "withdrawn", reason: "stopped" })]);
    expect(withdrawn.asks).toEqual([]);
    expect(withdrawn.turns[0].entries.filter((one) => one.kind === "question" || one.kind === "tool")).toEqual([]);
  });

  it("다른 갈래의 질문 줄(Work 만들기 카드 — v1 티켓 30)은 질문 카드가 아니다", () => {
    const work: RecordLine = {
      seq: 9,
      at: at(9),
      kind: "question",
      who: "host",
      payload: { state: "asked", requestId: "w", card: "work", title: "환불 API 버그 수정" },
    };
    const model = foldThread([...through(asked, 8), work]);
    expect(model.asks.map((one) => one.card)).toEqual(["work"]);
    expect(model.turns[0].entries.filter((entry) => entry.kind === "question")).toEqual([]);
  });

  it("승인과 질문이 함께 걸리면 온 차례로 서고, 질문을 기다리는 참여자도 「답하는 중」에 서지 않는다", () => {
    const permission: RecordLine = {
      seq: 10,
      at: at(10),
      kind: "permission",
      who: "tester",
      payload: {
        state: "asked",
        requestId: "0",
        request: { options: [{ optionId: "allow_once", name: "Yes", kind: "allow_once" }] },
        toolCall: { toolCallId: "x", kind: "execute", rawInput: { command: "pnpm test" } },
        card: "command",
        policy: "매번 묻기",
      },
    };
    const model = foldThread([...through(asked, 9), permission]);
    expect(model.asks.map((one) => [one.card, one.who])).toEqual([
      ["question", "host"],
      ["command", "tester"],
    ]);
    expect(answeringLine(model)).toBe(null);
  });
});

describe("Work 밖 Project 카드(v1 티켓 32)", () => {
  /** Host가 Work 밖 web-app을 고치려 하고, 사람이 「붙이고 고치기」를 고른 축복 기록 — 8 카드 · 9 답 · 10 붙임 · 11 worktree · 12 도구 끝. */
  const attaching = record("thread-project");
  const cards = (model: ThreadModel) => model.asks.filter((one): one is PendingProject => one.card === "project");
  const answered = (payload: Record<string, unknown>): RecordLine => ({
    seq: 9,
    at: at(9),
    kind: "question",
    who: "host",
    payload: { requestId: "fake-request", card: "project", project: "web-app", ...payload },
  });

  it("카드 줄이 오면 권한 요청과 같은 물음 차례에 카드가 서고 — 고칠 Project · 까닭 · 이 Work의 Project — 그 도구 줄은 「web-app 고치기 시작하는 중」이다", () => {
    const model = foldThread(through(attaching, 8));
    expect(cards(model)).toEqual([
      {
        card: "project",
        requestId: "fake-request",
        who: "host",
        project: "web-app",
        name: "web-app",
        reason: "환불 버튼이 두 번 눌리는 문제는 web-app에 있어요",
        work: "refund-api",
        workProjects: ["api-server"],
      },
    ]);
    expect(model.pending).toEqual([]);
    const tool = model.turns[0].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("web-app 고치기 시작하는 중");
  });

  it("붙이면 카드가 걷히고, 그 도구 줄 자리에 「web-app을 이 Work에 붙임」 결정 줄이, 턴 안에 「web-app에 worktree를 만듦 · 브랜치」 시스템 줄이 선다", () => {
    const model = foldThread(attaching);
    expect(cards(model)).toEqual([]);
    const entries = model.turns[0].entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["project-choice", "message"]);
    expect(entries[0]).toMatchObject({ choice: "attach", project: "web-app" });
    expect(model.system.map((line) => [line.kind, line.before, line.name, line.after, line.code, line.turnsBefore])).toEqual([
      ["worktree", "", "web-app", "에 worktree를 만듦 ·", "fix/refund-api", 1],
    ]);
    // 턴 사이가 아니라 그 Project를 고치기 시작한 턴의 머리(사람 말 뒤 · Agent 앞)에 선다 — 화면 2 보드.
    expect(model.system[0].turn).toBe(model.turns[0].key);
  });

  it("읽기만 · 아니요도 결정 줄만 서고 시스템 줄은 없다. 멈춤으로 거둔 카드는 결정 줄 없이 걷힌다", () => {
    for (const choice of ["read", "decline"]) {
      const model = foldThread([...through(attaching, 8), answered({ state: "answered", choice })]);
      expect(cards(model)).toEqual([]);
      expect(model.system).toEqual([]);
      expect(model.turns[0].entries.map((entry) => entry.kind === "project-choice" && entry.choice)).toEqual([choice]);
    }
    const withdrawn = foldThread([...through(attaching, 8), answered({ state: "withdrawn", reason: "stopped" })]);
    expect(cards(withdrawn)).toEqual([]);
    expect(withdrawn.turns[0].entries.map((entry) => entry.kind)).toEqual(["tool"]);
  });

  it("Work에 있는 Project를 처음 고치면 카드 없이 「api-server에 worktree를 만듦」 시스템 줄만 선다 — 붙임 줄은 시스템 줄이 아니고, Work를 만든 줄도 아니다", () => {
    const model = foldThread([
      { seq: 1, at: at(1), kind: "sent", payload: { text: "고쳐 줘", to: "host" } },
      { seq: 2, at: at(2), kind: "work", payload: { state: "attached", project: "web-app" } },
      { seq: 3, at: at(3), kind: "work", payload: { state: "worktree", project: "api-server", branch: "fix/refund-api", path: "/w" } },
      { seq: 4, at: at(4), kind: "work", payload: { state: "worktree", project: "docs", branch: null, path: "/d" } },
    ]);
    expect(model.system.map((line) => [line.name, line.after, line.code])).toEqual([
      ["api-server", "에 worktree를 만듦 ·", "fix/refund-api"],
      ["docs", "에 worktree를 만듦", null],
    ]);
    expect(model.system.map((line) => line.turn)).toEqual([model.turns[0].key, model.turns[0].key]);
    // 「결정은 내가 합니다」는 Work를 만든 Thread에서만 선다 — worktree가 생긴 것으로는 서지 않는다.
    expect(decisionsDue(model, false)).toBe(false);
  });

  it("영어 이름의 조사는 끝소리로 고른다 — web-app을 · api-server를 · Host가 · 숫자도 읽는 소리대로", () => {
    expect(particle("web-app", "을", "를")).toBe("을");
    expect(particle("api-server", "을", "를")).toBe("를");
    expect(particle("Host", "이", "가")).toBe("가");
    expect(particle("helm", "으로", "로")).toBe("으로");
    expect(particle("tool", "으로", "로")).toBe("로");
    expect(particle("v1", "을", "를")).toBe("을");
    expect(particle("v2", "을", "를")).toBe("를");
    expect(particle("환불 API 버그 수정", "을", "를")).toBe("을");
  });
});

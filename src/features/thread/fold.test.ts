/// <reference types="node" />
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  answeringLine,
  finalFrom,
  finalMessages,
  foldThread,
  headline,
  keptFolded,
  usageText,
  workLine,
  type Entry,
  type PendingProject,
  type PendingProjectAdd,
  type PendingService,
  type PendingWork,
  type ResultEntry,
  type ThreadModel,
  type ToolEntry,
} from "./fold";
import { createdDocs } from "./expanded";
import { changedFiles } from "./log";
import { describeTool, phraseText, toolFields } from "./tool-view";
import type { RecordLine } from "./types";

// Thread 접기(v1 티켓 05) — 기록 줄 → 턴 · 도구 줄 · 시스템 줄. seam은 순수 함수 `foldThread` 하나다: 처음 읽은 기록도
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

const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);
const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
const update = (seq: number, second: number, body: Record<string, unknown>): RecordLine => ({
  seq,
  at: at(second),
  kind: "update",
  payload: { sessionId: "s", update: body },
});

describe("Thread 기록을 턴으로 접는다", () => {
  it("보낸 말마다 턴이 서고, 끝난 턴은 턴 끝 메시지만 남기고 접힌다", () => {
    const model = foldThread(blessed);
    expect(model.running).toBe(false);
    expect(model.turns.map((turn) => turn.sent)).toEqual([
      "세 낱말로 답해 줘: hello from turn",
      "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘",
    ]);
    expect(model.turns.map((turn) => turn.end && headline(turn.end))).toEqual(["4초 동안 작업", "10초 동안 작업"]);
    // 턴 끝 메시지(마지막 도구 뒤의 답)만 접힌 턴에 남는다.
    expect(model.turns.map((turn) => finalMessages(turn).map((entry) => entry.kind === "message" && entry.text))).toEqual([
      ["hello from turn"],
      ["5"],
    ]);
  });

  it("세션 줄은 흐름에 서지 않는다 — 모든 Thread가 그 줄로 시작한다", () => {
    expect(foldThread(blessed).system).toEqual([]);
  });

  it("도구 줄은 시작한 줄과 끝난 줄의 시각을 든다 — 걸린 시간을 말하려고", () => {
    const tools = foldThread(blessed).turns[1].entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => [tool.call.title, tool.startedAt, tool.endedAt])).toEqual([
      ["Write /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:11.000+09:00", "2026-10-10T10:00:12.000+09:00"],
      ["Read /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:13.000+09:00", "2026-10-10T10:00:14.000+09:00"],
      ["wc -c notes.txt", "2026-10-10T10:00:15.000+09:00", "2026-10-10T10:00:16.000+09:00"],
    ]);
  });

  it("스스로 이어 간 턴도 턴으로 서고, 보낸 말이 없다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      update(25, 1, { sessionUpdate: "agent_message_chunk", messageId: "m9", content: { type: "text", text: "더 볼게요" } }),
      { seq: 26, at: at(2), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 1000, outOfTurn: true } },
    ];
    const { turns } = foldThread(lines);
    expect(turns).toHaveLength(3);
    expect(turns[2].sent).toBeNull();
    expect(finalMessages(turns[2]).map((entry) => entry.kind === "message" && entry.text)).toEqual(["더 볼게요"]);
  });
});

// 작업 구분선(02 구현 스펙 §8 · 스토리 48 · 49) — 끝난 턴의 「N초 동안 작업」은 펼쳐야 보이는 일(도구 줄 · 생각 · 앞선 답)이 있을 때만
// 선다. 말만 한 턴에는 빈 머리가 서지 않는다. 접힌 턴에도 남는 줄(계획 · 질문 · 카드의 결정 줄)만 있는 턴도 펼칠 것이 없다.
describe("작업 구분선", () => {
  it("Runtime이 거절한 턴은 그 까닭을 말하고 Agent를 말하지 않는다", () => {
    const end = { stopReason: "refusal", durationMs: 1000, cancelledByUs: false, error: null, at: at(1) };
    expect(headline(end)).toBe("이 요청에는 답할 수 없어 멈췄어요");
  });

  it("도구 없이 끝난 턴에는 구분선이 없고, 도구를 쓴 턴은 「N초 동안 작업」이다", () => {
    const [first, second] = foldThread(blessed).turns;
    expect(workLine(first)).toBeNull();
    expect(workLine(second)).toEqual({ text: "10초 동안 작업", unfolds: true });
  });

  it("도는 턴은 구분선이 아니다 — 「N초 동안 작업 중입니다」가 따로 선다", () => {
    const running = foldThread(blessed.filter((line) => line.kind !== "turn-end"));
    expect(running.turns.map(workLine)).toEqual([null, null]);
  });

  it("끝 까닭이 있는 턴은 도구가 없어도 그 까닭이 선다 — 펼칠 것은 없다", () => {
    const lines = blessed.map((line, index) =>
      line.kind === "turn-end" && blessed.findIndex((one) => one.kind === "turn-end") === index
        ? { ...line, payload: { ...(line.payload as Record<string, unknown>), stopReason: "max_tokens" } }
        : line,
    );
    const [first] = foldThread(lines).turns;
    expect(workLine(first)).toEqual({ text: "답이 길이 한도에 닿아 멈췄어요", unfolds: false });
  });
});

describe("시스템 줄", () => {
  it("이름 바꾸기는 그 자리에 「채팅 이름을 X로 바꿈」으로 선다 — 조사는 이름의 받침을 따른다", () => {
    const lines: RecordLine[] = [
      ...blessed.slice(0, 8),
      { seq: 30, at: at(3), kind: "title", payload: { title: "환불 API 버그", before: "세 낱말로" } },
      ...blessed.slice(8),
      { seq: 31, at: at(4), kind: "title", payload: { title: "결제 흐름", before: "환불 API 버그" } },
    ];
    const { system } = foldThread(lines);
    expect(system.map((line) => [line.before, line.name, line.after, line.turnsBefore])).toEqual([
      ["채팅 이름을 ", "환불 API 버그", "로 바꿈", 1],
      ["채팅 이름을 ", "결제 흐름", "으로 바꿈", 2],
    ]);
  });

  it("Agent가 턴 안에서 Thread 도구로 이름을 바꾸면 그 턴 뒤에 같은 시스템 줄이 서고 턴은 이어진다(v1 티켓 15)", () => {
    // 엔진 검사가 축복한 기록 — Host가 첫 턴에서 `rename_thread`를 불렀다. `title` 줄은 도구 줄과 그 끝 사이에 있다.
    const model = foldThread(record("thread-rename"));
    expect(model.system.map((line) => [`${line.before}${line.name}${line.after}`, line.turnsBefore])).toEqual([
      ["채팅 이름을 환불 API 버그로 바꿈", 1],
    ]);
    expect(model.turns).toHaveLength(1);
    const [turn] = model.turns;
    expect(turn.end && headline(turn.end)).toBe("9초 동안 작업");
    // 그 앞의 `ToolSearch`(도구 들이기)는 서지 않는다.
    const tools = turn.entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => phraseText(describeTool(tool).phrase))).toEqual(["atelier-thread.rename_thread 불러옴"]);
    expect(finalMessages(turn).map((entry) => entry.kind === "message" && entry.text)).toEqual([
      "Thread 이름을 「환불 API 버그」로 바꿨습니다.",
    ]);
  });

  // 바탕은 엔진이 축복한 기록이다(`thread-service.jsonl`) — Work 없는 Thread에 「결제 서비스」(web-app · api-server)를 붙이고 한 턴 뒤 뺐다.
  it("Service를 바꾸거나 빼면 다음 차례부터 읽는 Project를 말하는 한 줄이 서고, 굵은 것은 Service 이름뿐이다(03 티켓 05)", () => {
    const model = foldThread(record("thread-service"));
    expect(model.system.map((line) => [line.kind, line.name, `${line.before}${line.name}${line.after}`])).toEqual([
      ["service", "결제 서비스", "Service를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요"],
      ["service", "", "Service를 뺐어요 — 다음 차례부터 등록된 Project 3개를 읽어요"],
    ]);
  });

  // 바탕은 엔진이 축복한 기록이다(`thread-service-deleted.jsonl`) — Work 없는 Thread에 붙인 「결제 서비스」를 지우고, 한 턴 뒤 되돌렸다.
  it("이은 Service를 지우면 Service 없이 이어간다는 한 줄이, 되돌리면 다시 읽는 Project를 말하는 한 줄이 선다(03 티켓 07)", () => {
    const model = foldThread(record("thread-service-deleted"));
    expect(model.system.map((line) => [line.kind, line.name, `${line.before}${line.name}${line.after}`])).toEqual([
      ["service", "결제 서비스", "Service를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요"],
      ["service", "", "결제 서비스 Service가 지워져 Service 없이 이어가요 — 대화는 그대로예요"],
      ["service", "결제 서비스", "결제 서비스 Service를 되돌렸어요 — 다시 web-app · api-server를 읽어요"],
    ]);
  });

  it("되돌린 Service에 읽을 Project가 없으면 그렇다고 말하고, 이름을 모르는 줄은 서지 않는다", () => {
    const service = (seq: number, payload: Record<string, unknown>): RecordLine => ({ seq, at: at(5), kind: "service", payload });
    const model = foldThread([
      ...blessed,
      service(25, { change: "restored", service: "빈-곳", name: "빈 곳", projects: [], registered: 4 }),
      service(26, { change: "deleted", service: "사라진", name: null, projects: [], registered: 4 }),
    ]);
    expect(model.system.map((line) => `${line.before}${line.name}${line.after}`)).toEqual([
      "빈 곳 Service를 되돌렸어요 — 읽는 Project가 없어요",
    ]);
  });

  // 03 코드 리뷰 P3 — 엔진은 worktree에서 일하는 Project를 `worked`에 따로 싣는다(있을 때만). 그 Project도 읽는다 — 고치는 것이 먼저다.
  it("Service 줄은 worktree에서 일하는 Project도 읽는 Project로 말한다 — worktree가 Service를 다 덮어도 「없어요」가 아니다", () => {
    const service = (seq: number, payload: Record<string, unknown>): RecordLine => ({ seq, at: at(5), kind: "service", payload });
    const model = foldThread([
      ...blessed,
      service(25, { change: "changed", service: "결제-서비스", name: "결제 서비스", projects: [], worked: ["web-app", "api-server"], registered: 3 }),
      service(26, { change: "attached", service: "결제-서비스", name: "결제 서비스", projects: ["web-app"], worked: ["api-server"], registered: 3 }),
      service(27, { change: "restored", service: "결제-서비스", name: "결제 서비스", projects: [], worked: ["api-server"], registered: 3 }),
    ]);
    expect(model.system.map((line) => `${line.before}${line.name}${line.after}`)).toEqual([
      "Service를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요",
      "결제 서비스 Service에 넣었어요 — api-server · web-app을 읽어요",
      "결제 서비스 Service를 되돌렸어요 — 다시 api-server를 읽어요",
    ]);
  });

  it("Service 줄은 읽는 Project가 셋을 넘으면 둘과 「외 N개」, 빈 Service면 없다고, 등록된 Project가 없으면 그렇다고 말한다", () => {
    const service = (seq: number, payload: Record<string, unknown>): RecordLine => ({ seq, at: at(5), kind: "service", payload });
    const model = foldThread([
      ...blessed,
      service(25, { change: "changed", service: "사내-도구", name: "사내 도구", projects: ["a", "b", "c", "d"], registered: 4 }),
      service(26, { change: "changed", service: "빈-곳", name: "빈 곳", projects: [], registered: 4 }),
      service(27, { change: "removed", service: null, name: null, projects: [], registered: 0 }),
      service(28, { change: "attached", service: "빈-곳", name: "빈 곳", projects: [], registered: 4 }),
    ]);
    expect(model.system.map((line) => `${line.before}${line.name}${line.after}`)).toEqual([
      "Service를 사내 도구로 바꿨어요 — 다음 차례부터 a · b 외 2개를 읽어요",
      "Service를 빈 곳으로 바꿨어요 — 다음 차례부터 읽는 Project가 없어요",
      "Service를 뺐어요 — 다음 차례부터 등록된 Project가 없어요",
      "빈 곳 Service에 넣었어요 — 읽는 Project가 없어요",
    ]);
  });
});

describe("도구 줄의 끝", () => {
  it("권한을 물은 도구를 사람이 거절하면 그 줄은 「거절함」이다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(1), kind: "sent", payload: { text: "마이그레이션 돌려줘" } },
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
    expect(asked.pending.map((request) => request.requestId)).toEqual(["r1"]);

    const answered = foldThread([
      ...lines,
      { seq: 28, at: at(4), kind: "permission", payload: { state: "answered", requestId: "r1", optionId: "reject" } },
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
    const reason = "「장바구니 수량을 고쳐 줘」 채팅이 이 작업공간을 고치는 중이에요 — 끝난 뒤 다시 하세요";
    // v1 티켓 18 — 다른 Session이 쓰기 자리를 쥐었다: 물음 줄 없이 판정 줄 하나다.
    const model = foldThread([
      ...blessed,
      { seq: 25, at: at(1), kind: "sent", payload: { text: "장바구니 문서를 고쳐 줘" } },
      update(26, 2, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit src/cart.ts", kind: "edit", status: "pending" }),
      {
        seq: 27,
        at: at(3),
        kind: "permission",
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
      { seq: 25, at: at(1), kind: "sent", payload: { text: "테스트 돌려줘" } },
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
    { seq: 25, at: at(1), kind: "sent", payload: { text: "환불 API 버그 고쳐줘" } },
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
      { seq: 28, at: at(4), kind: "permission", payload: { state: "decided", requestId: "r1", optionId: "reject", reason: "…" } },
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
      { seq: 25, at: at(5), kind: "sent", payload: { text: "이 로그 봐 줘", attachments, prompt: [], sendNow: false } },
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
      { seq: 1, at: at(1), kind: "sent", payload: { text: "봐 줘", attachments: [{ path: 3 }, { path: "/a.txt", size: 2, folder: false }, "x"] } },
    ];
    expect(foldThread(lines).turns[0].attachments).toEqual([{ path: "/a.txt", size: 2, folder: false }]);
  });
});

describe("인용(v1 티켓 35 · S41)", () => {
  it("넓힌 카드의 문서에서 고른 글을 붙인 말은 그 턴의 인용으로 들고, 인용 없는 말 · 꼴이 틀린 인용은 없음이다", () => {
    const quote = { file: "design.md", start: 3, end: 4, text: "차감은 한 번만 한다." };
    const lines: RecordLine[] = [
      { seq: 1, at: at(1), kind: "sent", payload: { text: "이 부분 다시 봐 줘", quote, prompt: [] } },
      { seq: 2, at: at(2), kind: "sent", payload: { text: "고마워", prompt: [] } },
      { seq: 3, at: at(3), kind: "sent", payload: { text: "이것도", quote: { file: "design.md", start: "3" } } },
    ];
    expect(foldThread(lines).turns.map((turn) => turn.quote)).toEqual([quote, null, null]);
  });
});

describe("한 세션의 턴", () => {
  const said = (seq: number, second: number, words: string): RecordLine =>
    update(seq, second, { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: words } });
  const sent = (seq: number, second: number, words: string): RecordLine => ({
    seq,
    at: at(second),
    kind: "sent",
    payload: { text: words },
  });
  const ended = (seq: number, second: number): RecordLine => ({
    seq,
    at: at(second),
    kind: "turn-end",
    payload: { stopReason: "end_turn", durationMs: 1000, cancelledByUs: false, outOfTurn: false },
  });

  it("줄은 열린 턴에 들고, 턴 끝 줄이 그 턴을 닫는다", () => {
    const lines = [sent(1, 1, "고쳐 줘"), said(2, 2, "고치는 중")];
    expect(foldThread(lines).running).toBe(true);
    const model = foldThread([...lines, ended(3, 3)]);
    expect(model.running).toBe(false);
    expect(model.turns.map((turn) => [turn.sent, finalMessages(turn).map((entry) => entry.kind === "message" && entry.text)])).toEqual([
      ["고쳐 줘", ["고치는 중"]],
    ]);
  });

  it("Session이 죽으면 열린 턴이 끝나고 다음 말은 새 턴이다", () => {
    const died: RecordLine = { seq: 3, at: at(3), kind: "session", payload: { state: "died", reason: "끝났어요" } };
    const lines = [sent(1, 1, "고쳐 줘"), said(2, 2, "고치는 중"), died];
    const model = foldThread(lines);
    expect(model.running).toBe(false);
    expect(model.turns.map((turn) => turn.end?.error ?? null)).toEqual(["Claude Code가 끝났어요"]);
    expect(foldThread([...lines, sent(4, 4, "다시 해 줘")]).running).toBe(true);
  });

  it("「답하는 중」 줄은 도는 턴에 아직 아무 줄도 오지 않았을 때만 선다 — 답이 흐르면 그 턴의 머리줄이 말한다", () => {
    const lines = [sent(1, 1, "고쳐 줘")];
    expect(answeringLine(foldThread(lines))).toBe(true);
    expect(answeringLine(foldThread([...lines, said(2, 2, "고치는 중")]))).toBe(false);
    expect(answeringLine(foldThread([...lines, said(2, 2, "고치는 중"), ended(3, 3)]))).toBe(false);
    expect(answeringLine(foldThread([]))).toBe(false);
  });
});

describe("앞 판의 기록", () => {
  it("앞 판이 적은 `call` · `joined` · `left` 줄은 아무것도 세우지 않는다", () => {
    const old = (seq: number, kind: string, payload: object) => ({ seq, at: at(9), kind, payload }) as unknown as RecordLine;
    const lines = [
      ...blessed,
      old(90, "call", { state: "started", id: "c1", from: "host", to: "reviewer", text: "봐 줘", prompt: [] }),
      old(91, "call", { state: "ended", id: "c1", from: "host", to: "reviewer", text: "봐 줘", outcome: "answered", answer: "봤어요", durationMs: 9000 }),
      old(92, "joined", { handle: "reviewer", name: "리뷰어", from: "library" }),
      old(93, "left", { handle: "reviewer", name: "리뷰어" }),
    ];
    expect(foldThread(lines)).toEqual(foldThread(blessed));
  });
});

describe("Thread 도구 들이기(v1 티켓 20)", () => {
  it("Thread 도구를 들이는 ToolSearch는 도구 줄로 서지 않고, 그 끝도 붙지 않는다", () => {
    // 진짜 claude는 Thread 도구를 부르기 전에 `ToolSearch`(seq 6)로 그 도구를 들이고 곧 끝낸다(seq 7).
    const renaming = record("thread-rename");
    expect(renaming.filter((line) => line.seq === 6).map((line) => JSON.stringify(line.payload))).toEqual([
      expect.stringContaining('"title":"ToolSearch"'),
    ]);
    const [turn] = foldThread(through(renaming, 7)).turns;
    expect(turn.entries).toEqual([]);
    expect(turn.answeredAt).toBeNull();
  });
});

describe("물어보는 정도(v1 티켓 23)", () => {
  /** 「편집 자동」으로 세운 Thread의 첫 편집을 판정이 묻지 않고 허용한 축복 기록 — 물음 줄 없이 판정 줄(`decided`) 하나다. */
  const auto = record("thread-auto-allow");

  it("바꾼 정도는 「Policy를 X로 바꿈」 시스템 줄이고, Work에 이은 Thread면 「· 이 작업공간에만」이 붙는다", () => {
    const lines: RecordLine[] = [
      ...blessed,
      { seq: 25, at: at(5), kind: "mode", payload: { mode: "edits", work: "cart" } },
      { seq: 26, at: at(6), kind: "mode", payload: { mode: "always", work: null } },
      { seq: 27, at: at(7), kind: "mode", payload: { mode: "plan", work: null } },
      { seq: 28, at: at(8), kind: "mode", payload: { mode: "bogus", work: null } },
    ];
    const { system } = foldThread(lines);
    expect(system.map((line) => [line.kind, `${line.before}${line.name}${line.after}`, line.turnsBefore])).toEqual([
      ["mode", "Policy를 편집 자동으로 바꿈 · 이 작업공간에만", 2],
      ["mode", "Policy를 매번 묻기로 바꿈", 2],
      ["mode", "Policy를 계획으로 바꿈", 2],
    ]);
    expect(system.map((line) => line.name)).toEqual(["편집 자동", "매번 묻기", "계획"]);
  });

  it("판정이 묻지 않고 허용한 도구 줄은 그 까닭을 들고, 승인 카드는 서지 않는다", () => {
    const model = foldThread(auto);
    expect(model.pending).toEqual([]);
    const tools = model.turns[0].entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => [phraseText(describeTool(tool).phrase), tool.allowed, tool.denied])).toEqual([
      ["allowed.txt 작성함", "편집 자동", false],
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
      { seq: decided.seq, at: decided.at, kind: "permission", payload: { state: "answered", requestId: "0", optionId: "allow_once" } },
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
    expect(tool?.kind === "tool" && tool.allowed).toBe("편집 자동");
  });

  it("계획 모드의 claude가 제 계획 파일(~/.claude/plans/…md)에 쓴 줄은 작업 로그 · 바뀐 파일에 서지 않는다(v1 티켓 27)", () => {
    // 진짜 claude 2.1.309는 계획 모드에서 계획을 그 파일에 묻지 않고 쓴 뒤 ExitPlanMode로 묻는다 — 계획은 계획 넘어가기 카드가 보인다.
    const write = (seq: number, id: string, path: string) =>
      update(seq, seq, {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: `Write ${path}`,
        kind: "edit",
        status: "in_progress",
        rawInput: { file_path: path, content: "hi\n" },
        content: [{ type: "diff", path, oldText: null, newText: "hi\n" }],
        locations: [{ path }],
        _meta: { claudeCode: { toolName: "Write" } },
      });
    const done = (seq: number, id: string) => update(seq, seq, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" });
    const real = "/tmp/gate/home/threads/20261024-003416/e.txt";
    const lines: RecordLine[] = [
      { seq: 1, at: at(1), kind: "sent", payload: { text: "d.txt에 hi를 쓰는 계획을 세워" } },
      write(2, "plan", "/Users/USER/.claude/plans/d-txt-hi-playful-sketch.md"),
      done(3, "plan"),
      write(4, "real", real),
      done(5, "real"),
    ];
    const [turn] = foldThread(lines).turns;
    expect(turn.entries.filter((entry) => entry.kind === "tool").map((tool) => tool.kind === "tool" && tool.call.title)).toEqual([`Write ${real}`]);
    expect(changedFiles(turn)?.files.map((file) => file.path)).toEqual([real]);
  });
});

describe("Work 만들기 카드(v1 티켓 30)", () => {
  /**
   * 진짜 claude의 Host가 「백엔드 환불 API 버그 고쳐줘」를 받은 첫 턴의 축복 기록(v1 티켓 39 끝 점검의 녹음) — 저장소를 읽는 물음 여덟을
   * 넘긴 뒤 54 제안 도구 · 55 카드 · 56 답(api-server만) · 57 work 줄 · 58 도구 끝, 이어 spec 문서 쓰기 둘(61 · 65)과 마지막 답(70).
   */
  const working = record("thread-work");
  /** 걸린 Work 만들기 카드 — 권한 요청과 한 물음 차례(`asks`)에 선다. */
  const cards = (model: ThreadModel) => model.asks.filter((one): one is PendingWork => one.card === "work");
  const PROPOSE = "mcp__atelier-thread__propose_work";
  const toolTitles = (model: ThreadModel) =>
    model.turns[0].entries.flatMap((entry) => (entry.kind === "tool" ? [String(entry.call.title)] : []));
  const firstLines = (model: ThreadModel) =>
    finalMessages(model.turns[0]).map((entry) => (entry.kind === "message" ? entry.text.split("\n")[0] : null));

  it("제안 줄이 오면 카드가 서고 — 제목 · 까닭 · 브랜치와 등록된 Project(Host 추천이 먼저) — 그 도구 줄은 「작업공간 만들기를 묻는 중」이다", () => {
    const model = foldThread(through(working, 55));
    expect(cards(model).map((one) => [one.requestId, one.title, one.reason, one.slug, one.branch])).toEqual([
      [
        "fake-request",
        "환불 API 부분 환불 버그 수정 (#31)",
        "부분 환불 요청이 전액 환불되는 #31 — api-server를 고치려면 worktree가 필요해요",
        "refund-partial-amount",
        "fix/refund-partial-amount",
      ],
    ]);
    expect(cards(model)[0].projects).toEqual([
      {
        slug: "api-server",
        name: "api-server",
        description: "백엔드 — 결제 · 환불 API",
        recommended: true,
        reason: "버그가 있는 refund/service.py와 테스트가 여기 있어요",
        branches: ["main"],
      },
      {
        slug: "web-app",
        name: "web-app",
        description: "프런트엔드 — 주문 상세의 환불 버튼 화면",
        recommended: false,
        reason: null,
        branches: ["main"],
      },
    ]);
    const tool = model.turns[0].entries.find((entry) => entry.kind === "tool" && entry.call.title === PROPOSE);
    expect(tool?.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("작업공간 만들기를 묻는 중");
  });

  it("Service에 이은 Thread의 카드는 새 Work로 옮겨 갈 Service를 싣고, Service가 없으면 그 칸이 비었다(03 S8)", () => {
    expect(cards(foldThread(through(working, 55)))[0].service).toBeNull();
    const serviced = through(working, 55).map((line) =>
      line.seq === 55 ? { ...line, payload: { ...(line.payload as object), service: { slug: "결제-서비스", name: "결제 서비스" } } } : line,
    );
    expect(cards(foldThread(serviced))[0].service).toEqual({ slug: "결제-서비스", name: "결제 서비스" });
  });

  it("만들면 카드가 걷히고, 그 도구 줄 자리에 「작업공간 만들기」 결정 줄이, 턴 뒤에 「작업공간 … 을 만들고 이 채팅에 연결함」 시스템 줄이 선다", () => {
    const model = foldThread(working);
    expect(cards(model)).toEqual([]);
    const entries = model.turns[0].entries;
    expect(entries.filter((entry) => entry.kind === "work-choice")).toMatchObject([
      { created: true, projects: ["api-server"], branch: "fix/refund-partial-amount" },
    ]);
    expect(toolTitles(model)).not.toContain(PROPOSE);
    // 제안 앞에 Host가 바꾼 이름 줄이 먼저 선다(진짜 Host는 Thread 이름을 바꾸고 제안한다).
    expect(model.system.map((line) => [line.kind, line.before, line.name, line.after, line.turnsBefore])).toEqual([
      ["title", "채팅 이름을 ", "환불 API 부분 환불 버그 (#31)", "로 바꿈", 1],
      ["work", "작업공간 ", "환불 API 부분 환불 버그 수정 (#31)", "을 만들고 이 채팅에 연결함", 1],
    ]);
    expect(firstLines(model)).toEqual(["버그는 찾았고, 재현도 해 봤어요. 코드는 아직 고치지 않았습니다. 고치기 전에 아래 설계를 확인받고 싶어요."]);
  });

  it("만든 턴에 Host가 spec 폴더에 새로 쓴 설계 문서 둘이 답 아래 문서 카드로 선다(v1 티켓 35 · 39)", () => {
    const turn = foldThread(working).turns[0];
    expect(createdDocs(turn, "~/.atelier/works/refund-partial-amount/spec")).toEqual([
      { path: "overview.md", lines: 27 },
      { path: "01-fix/plan.md", lines: 52 },
    ]);
  });

  it("결정 줄은 턴 끝 메시지를 가르지 않는다 — 카드 앞에 물은 말과 결정 뒤의 답이 함께 접힌 턴에 남는다(화면 2 보드)", () => {
    const asked = update(53, 53, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m-ask",
      content: { type: "text", text: "이 일을 Work로 만들어 둘까요?" },
    });
    const done = update(60, 0, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m-done",
      content: { type: "text", text: "Work를 만들었어요." },
    });
    const end = { ...working[working.length - 1], seq: 61, at: "2026-10-10T10:01:01.000+09:00" };
    const lines = [...through(working, 58).map((line) => (line.seq === 53 ? asked : line)), done, end];
    expect(firstLines(foldThread(lines))).toEqual(["이 일을 Work로 만들어 둘까요?", "Work를 만들었어요."]);
  });

  it("「작업공간 없이 계속」은 시스템 줄 없이 결정 줄만 서고, 멈춤으로 거둔 카드는 결정 줄 없이 걷힌다", () => {
    const answered = (payload: Record<string, unknown>): RecordLine => ({
      seq: 56,
      at: "2026-10-10T10:00:56.000+09:00",
      kind: "question",
      payload: { requestId: "fake-request", card: "work", ...payload },
    });
    const continued = foldThread([...through(working, 55), answered({ state: "answered", choice: "continue" })]);
    expect(cards(continued)).toEqual([]);
    expect(continued.system.map((line) => line.kind)).toEqual(["title"]);
    expect(continued.turns[0].entries.flatMap((entry) => (entry.kind === "work-choice" ? [entry.created] : []))).toEqual([false]);

    const withdrawn = foldThread([...through(working, 55), answered({ state: "withdrawn", reason: "stopped" })]);
    expect(cards(withdrawn)).toEqual([]);
    expect(withdrawn.turns[0].entries.filter((entry) => entry.kind === "work-choice")).toEqual([]);
    expect(toolTitles(withdrawn)).toContain(PROPOSE);
  });

  it("Project 목록 · Work 읽기 도구 줄은 사람의 말로 선다 — 「Project 2개 목록 확인함」 · 「작업공간 읽음」", () => {
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
      { seq: 1, at: at(1), kind: "sent", payload: { text: "환불 API 버그 고쳐줘" } },
      tool(2, "p", "mcp__atelier-thread__list_projects", "in_progress"),
      tool(3, "p", "mcp__atelier-thread__list_projects", "completed", '[{"slug":"api-server"},{"slug":"web-app"}]'),
      tool(4, "w", "mcp__atelier-thread__get_work", "in_progress"),
    ]);
    const phrases = model.turns[0].entries.map((entry) => entry.kind === "tool" && phraseText(describeTool(entry).phrase));
    expect(phrases).toEqual(["Project 2개 목록 확인함", "작업공간 읽는 중"]);
  });

  it("제안한 Session이 끝나면 카드도 걷힌다 — 답할 곳이 없다", () => {
    const died: RecordLine = { seq: 9, at: at(9), kind: "session", payload: { state: "died", reason: "끝남" } };
    expect(foldThread([...through(working, 8), died]).asks).toEqual([]);
    expect(foldThread(through(working, 8), 8).asks).toEqual([]);
  });
});

describe("질문 카드(v1 티켓 26)", () => {
  /**
   * Host가 물음 둘을 내고 사람이 답한 축복 기록 — 6 도구 줄(`AskUserQuestion`) · 7 질문 · 8 답 · 9 그 도구 끝 · 10 답 · 12 턴 끝.
   * 진짜 claude가 사람에게 물은 녹음(v1 티켓 27 끝 점검)을 되감았다.
   */
  const asked = record("thread-question");
  const answer = (payload: Record<string, unknown>): RecordLine => ({
    seq: 8,
    at: at(8),
    kind: "question",
    payload: { requestId: "0", card: "question", ...payload },
  });

  it("질문 줄이 오면 물음 차례에 질문으로 서고, 그 도구 줄은 질문 줄이 대신한다", () => {
    const model = foldThread(through(asked, 7));
    expect(model.asks.map((one) => [one.card, one.requestId])).toEqual([["question", "0"]]);
    const question = model.asks[0];
    expect(question.card === "question" && question.questions.map((one) => [one.question, one.multiSelect, one.options.length])).toEqual([
      ["부분 환불 수수료는 어떻게 할까요?", false, 3],
      ["어느 화면에 보일까요?", true, 2],
    ]);
    expect(question.card === "question" && question.questions[0].options[0]).toEqual({
      label: "비율대로 돌려준다",
      description: "부분 환불 금액의 비율만큼 수수료도 함께 돌려준다.",
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
    const later = foldThread([...through(asked, 7), answer({ state: "answered", choice: "later" })]);
    expect(later.asks).toEqual([]);
    const entry = later.turns[0].entries.find((one) => one.kind === "question");
    expect(entry?.kind === "question" && [entry.choice, entry.answers]).toEqual(["later", []]);

    const withdrawn = foldThread([...through(asked, 7), answer({ state: "withdrawn", reason: "stopped" })]);
    expect(withdrawn.asks).toEqual([]);
    expect(withdrawn.turns[0].entries.filter((one) => one.kind === "question" || one.kind === "tool")).toEqual([]);
  });

  it("다른 갈래의 질문 줄(Work 만들기 카드 — v1 티켓 30)은 질문 카드가 아니다", () => {
    const work: RecordLine = {
      seq: 7,
      at: at(7),
      kind: "question",
      payload: { state: "asked", requestId: "w", card: "work", title: "환불 API 버그 수정" },
    };
    const model = foldThread([...through(asked, 6), work]);
    expect(model.asks.map((one) => one.card)).toEqual(["work"]);
    expect(model.turns[0].entries.filter((entry) => entry.kind === "question")).toEqual([]);
  });

  it("승인과 질문이 함께 걸리면 온 차례로 서고, 질문을 기다리는 세션도 「답하는 중」에 서지 않는다", () => {
    const permission: RecordLine = {
      seq: 8,
      at: at(8),
      kind: "permission",
      payload: {
        state: "asked",
        requestId: "1",
        request: { options: [{ optionId: "allow_once", name: "Yes", kind: "allow_once" }] },
        toolCall: { toolCallId: "x", kind: "execute", rawInput: { command: "pnpm test" } },
        card: "command",
        policy: "매번 묻기",
      },
    };
    const model = foldThread([...through(asked, 7), permission]);
    expect(model.asks.map((one) => one.card)).toEqual(["question", "command"]);
    expect(answeringLine(model)).toBe(false);
  });
});

describe("Work 밖 Project 카드(v1 티켓 32)", () => {
  /** Host가 Work 밖 web-app을 고치려 하고, 사람이 「붙이고 고치기」를 고른 축복 기록 — 7 카드 · 8 답 · 9 붙임 · 10 worktree · 11 도구 끝. */
  const attaching = record("thread-project");
  const cards = (model: ThreadModel) => model.asks.filter((one): one is PendingProject => one.card === "project");
  const answered = (payload: Record<string, unknown>): RecordLine => ({
    seq: 8,
    at: at(8),
    kind: "question",
    payload: { requestId: "fake-request", card: "project", project: "web-app", ...payload },
  });

  it("카드 줄이 오면 권한 요청과 같은 물음 차례에 카드가 서고 — 고칠 Project · 까닭 · 이 Work의 Project — 그 도구 줄은 「web-app 고치기 시작하는 중」이다", () => {
    const model = foldThread(through(attaching, 7));
    expect(cards(model)).toEqual([
      {
        card: "project",
        requestId: "fake-request",
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

  it("붙이면 카드가 걷히고, 그 도구 줄 자리에 「web-app을 이 작업공간에 붙임」 결정 줄이, 턴 안에 「web-app에 worktree를 만듦 · 브랜치」 시스템 줄이 선다", () => {
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
      const model = foldThread([...through(attaching, 7), answered({ state: "answered", choice })]);
      expect(cards(model)).toEqual([]);
      expect(model.system).toEqual([]);
      expect(model.turns[0].entries.map((entry) => entry.kind === "project-choice" && entry.choice)).toEqual([choice]);
    }
    const withdrawn = foldThread([...through(attaching, 7), answered({ state: "withdrawn", reason: "stopped" })]);
    expect(cards(withdrawn)).toEqual([]);
    expect(withdrawn.turns[0].entries.map((entry) => entry.kind)).toEqual(["tool"]);
  });

  it("Work에 있는 Project를 처음 고치면 카드 없이 「api-server에 worktree를 만듦」 시스템 줄만 선다 — 붙임 줄은 시스템 줄이 아니고, Work를 만든 줄도 아니다", () => {
    const model = foldThread([
      { seq: 1, at: at(1), kind: "sent", payload: { text: "고쳐 줘" } },
      { seq: 2, at: at(2), kind: "work", payload: { state: "attached", project: "web-app" } },
      { seq: 3, at: at(3), kind: "work", payload: { state: "worktree", project: "api-server", branch: "fix/refund-api", path: "/w" } },
      { seq: 4, at: at(4), kind: "work", payload: { state: "worktree", project: "docs", branch: null, path: "/d" } },
    ]);
    expect(model.system.map((line) => [line.name, line.after, line.code])).toEqual([
      ["api-server", "에 worktree를 만듦 ·", "fix/refund-api"],
      ["docs", "에 worktree를 만듦", null],
    ]);
    expect(model.system.map((line) => line.turn)).toEqual([model.turns[0].key, model.turns[0].key]);
  });
});

describe("PR 카드(v1 티켓 36)", () => {
  const pr = (seq: number, second: number, over: Record<string, unknown> = {}): RecordLine => ({
    seq,
    at: at(second),
    kind: "pr",
    payload: {
      work: "refund-api",
      project: "api-server",
      first: true,
      number: 142,
      title: "부분 환불 이중 차감 수정",
      url: "https://github.com/acme/api/pull/142",
      state: "open",
      headBranch: "fix/refund-api",
      baseBranch: "main",
      additions: 48,
      deletions: 12,
      changedFiles: 3,
      ci: { kind: "pending" },
      approvals: 1,
      changesRequested: 0,
      mergedAt: null,
      ...over,
    },
  });

  it("엔진의 `pr` 줄은 그 자리(앞 턴들 뒤)에 PR 카드로 서고, 같은 PR의 마지막 줄만 지금의 카드다", () => {
    const model = foldThread([
      ...through(blessed, 8),
      pr(30, 5),
      ...blessed.slice(8),
      pr(31, 50, { first: false, ci: { kind: "failing", failed: ["e2e"] } }),
      pr(32, 51, { project: "web", number: 7, title: "환불 버튼" }),
    ]);
    expect(model.prs.map((card) => [card.key, card.pr.number, card.pr.ci.kind, card.latest, card.turnsBefore])).toEqual([
      ["p30", 142, "pending", false, 1],
      ["p31", 142, "failing", true, 2],
      ["p32", 7, "pending", true, 2],
    ]);
    expect(model.turns).toHaveLength(2);
    expect(model.system).toEqual([]);
  });

  it("그릴 수 없는 `pr` 줄은 서지 않는다", () => {
    const model = foldThread([...blessed, pr(30, 50), pr(31, 51, { url: null })]);
    expect(model.prs.map((card) => card.key)).toEqual(["p30"]);
  });
});

describe("Service 질문 카드(03 티켓 08)", () => {
  /** 매번 묻기 Thread에서 Host가 「Service 붙이기」로 묻고 사람이 결제 서비스를 고른 축복 기록 — 6 도구 줄 · 7 카드 · 8 답 · 9 도구 끝. */
  const asking = record("thread-service-ask");
  const cards = (model: ThreadModel) => model.asks.filter((one): one is PendingService => one.card === "service");
  const answered = (payload: Record<string, unknown>): RecordLine => ({
    seq: 8,
    at: at(8),
    kind: "question",
    payload: { state: "answered", requestId: "fake-request", card: "service", ...payload },
  });

  it("카드 줄이 오면 물음 차례에 카드가 서고 — 추천 · 후보 · 등록된 Project 수 — 그 도구 줄은 「Service 고르는 중」이다", () => {
    const model = foldThread(through(asking, 7));
    expect(cards(model)).toEqual([
      {
        card: "service",
        requestId: "fake-request",
        recommended: "결제-서비스",
        services: [
          { slug: "결제-서비스", name: "결제 서비스", projects: ["web-app", "api-server"] },
          { slug: "사내-도구", name: "사내 도구", projects: ["api-server", "backoffice"] },
        ],
        registered: 3,
      },
    ]);
    expect(model.pending).toEqual([]);
    const tool = model.turns[0].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("Service 고르는 중");
  });

  it("고르면 카드가 걷히고 그 도구 줄 자리에 「어느 Service에서 할까요? · 결제 서비스」 한 줄이 서며, Service 줄은 따로 서지 않는다", () => {
    const model = foldThread(asking);
    expect(cards(model)).toEqual([]);
    const entries = model.turns[0].entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["service-choice", "message"]);
    expect(entries[0]).toMatchObject({ choice: "service", name: "결제 서비스" });
    expect(model.system).toEqual([]);
  });

  it("Service 없이 · 나중에도 한 줄로 접히고, 거둔 카드는 줄 없이 걷힌다", () => {
    const fold = (payload: Record<string, unknown>) => foldThread([...through(asking, 7), answered(payload)]);
    expect(fold({ choice: "none", service: null, name: null }).turns[0].entries[0]).toMatchObject({ kind: "service-choice", choice: "none" });
    expect(fold({ choice: "later", service: null, name: null }).turns[0].entries[0]).toMatchObject({ kind: "service-choice", choice: "later" });
    const withdrawn = fold({ state: "withdrawn", reason: "stopped" });
    expect(cards(withdrawn)).toEqual([]);
    expect(withdrawn.turns[0].entries.map((entry) => entry.kind)).toEqual(["tool"]);
  });

  // 바탕은 엔진이 축복한 기록이다(`thread-service-attached.jsonl`) — 「묻지 않음」 Thread에서 Host가 묻지 않고 결제 서비스를 붙였다.
  it("Host가 묻지 않고 붙이면 「결제 서비스 Service에 넣었어요 — web-app · api-server를 읽어요」 한 줄이 서고, 굵은 것은 Service 이름뿐이다", () => {
    const model = foldThread(record("thread-service-attached"));
    expect(model.asks).toEqual([]);
    expect(model.system.map((line) => [line.kind, line.name, `${line.before}${line.name}${line.after}`])).toEqual([
      ["service", "결제 서비스", "결제 서비스 Service에 넣었어요 — web-app · api-server를 읽어요"],
    ]);
    const tool = model.turns[0].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("Service 고름");
  });
});

// 대화로 하는 설정(03 티켓 12 · 구현 스펙 §12) — 바탕은 엔진이 축복한 기록이다. `thread-setting`은 한 턴에 Host가 Project를 추가하고 · 기준 브랜치를
// 고치고 · Service에 Project를 넣고 · Service를 만든 것, `thread-project-add`는 git이 아닌 폴더를 묻고 사람이 「git init 하고 추가」를 고른 것이다.
describe("대화로 하는 설정 — 결과 카드와 Project 추가 카드", () => {
  const results = (model: ThreadModel) =>
    model.turns.flatMap((turn) => turn.entries.filter((entry): entry is ResultEntry => entry.kind === "result"));
  it("결과 카드 줄마다 카드 한 장이 그 턴 안 도구 줄 뒤에 서고 — 무엇을 했나 · 대상 · 두 줄 — 접힌 턴에도 남는다", () => {
    const model = foldThread(record("thread-setting"));
    const entries = model.turns[0].entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["tool", "result", "tool", "result", "tool", "result", "tool", "result", "message"]);
    expect(results(model)).toEqual([
      {
        kind: "result",
        key: "r7",
        action: "project-added",
        slug: "landing-page",
        name: "landing-page",
        title: "Project를 추가했어요 — landing-page",
        detail: "~/MyProjects/landing-page · git 레포 · 기준 브랜치 main",
      },
      expect.objectContaining({ action: "project-edited", slug: "web-app", title: "web-app의 기준 브랜치를 main으로 바꿨어요" }),
      expect.objectContaining({ action: "service-edited", slug: "결제-서비스", detail: "Project 3 · 함께 쓰는 Service 1" }),
      expect.objectContaining({ action: "service-created", slug: "정산", detail: "api-server · ~/.atelier/services/정산.md" }),
    ]);
    expect(entries.filter(keptFolded).map((entry) => entry.kind)).toEqual(["result", "result", "result", "result"]);
    expect(model.system).toEqual([]);
    const phrases = entries.flatMap((entry) => (entry.kind === "tool" ? [phraseText(describeTool(entry).phrase)] : []));
    expect(phrases).toEqual(["landing-page 추가함", "web-app 고침", "결제-서비스 Service 고침", "정산 Service 만듦"]);
  });

  it("모르는 갈래 · 글이 빈 결과 카드 줄은 서지 않는다", () => {
    const line = (payload: Record<string, unknown>): RecordLine => ({ seq: 99, at: at(59), kind: "setting", payload });
    const model = foldThread([
      ...blessed,
      line({ action: "project-removed", slug: "web-app", name: "web-app", title: "t", detail: "d" }),
      line({ action: "service-edited", slug: "결제-서비스", name: "결제 서비스", title: "", detail: "d" }),
    ]);
    expect(results(model)).toEqual([]);
  });

  const adding = record("thread-project-add");
  const cards = (model: ThreadModel) => model.asks.filter((one): one is PendingProjectAdd => one.card === "project-add");

  it("git이 아닌 폴더의 카드 줄이 오면 물음 차례에 카드가 서고 그 도구 줄은 「notes 추가하는 중」이다", () => {
    const model = foldThread(through(adding, 7));
    expect(cards(model)).toEqual([
      { card: "project-add", requestId: "fake-request", look: "notGit", path: "~/MyProjects/notes", folder: "notes", root: null },
    ]);
    expect(model.pending).toEqual([]);
    const tool = model.turns[0].entries.find((entry) => entry.kind === "tool");
    expect(tool?.kind === "tool" && phraseText(describeTool(tool).phrase)).toBe("notes 추가하는 중");
  });

  it("고르면 카드가 걷히고 그 도구 줄 자리에 접힌 줄이 서며, 결과 카드가 그 뒤에 선다", () => {
    const model = foldThread(adding);
    expect(cards(model)).toEqual([]);
    const entries = model.turns[0].entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["project-add-choice", "result", "message"]);
    expect(entries[0]).toMatchObject({ choice: "init", look: "notGit", folder: "notes", root: null });
    expect(results(model).map((card) => card.title)).toEqual(["Project를 추가했어요 — notes"]);
    // 결과 카드는 그 일의 자리다 — 접힌 턴에서 답한 줄 · 결과 카드 · 턴 끝 답 차례로 선다(턴 끝 답이 결과 카드 뒤에서 시작한다).
    expect(finalFrom(model.turns[0])).toBe(2);
    expect(workLine(model.turns[0])).toBeNull();
  });

  it("하위 폴더 카드는 뿌리를 싣고, 거둔 카드는 줄 없이 걷힌다", () => {
    const asked = through(adding, 7).map((line) =>
      line.seq === 7 ? { ...line, payload: { ...(line.payload as object), look: "subfolder", folder: "docs", root: "~/MyProjects/api-server" } } : line,
    );
    expect(cards(foldThread(asked))[0]).toMatchObject({ look: "subfolder", folder: "docs", root: "~/MyProjects/api-server" });
    const withdrawn = foldThread([
      ...asked,
      { seq: 8, at: at(8), kind: "question", payload: { state: "withdrawn", requestId: "fake-request", card: "project-add", reason: "stopped" } },
    ]);
    expect(cards(withdrawn)).toEqual([]);
    expect(withdrawn.turns[0].entries.map((entry) => entry.kind)).toEqual(["tool"]);
  });
});

// 서브에이전트의 안쪽 도구(01b-7 · 스토리 63) — 변환기는 안쪽 줄을 그 `Agent` 도구 줄의 update `_meta.claudeCode.event`에 원문으로 싣는다. 바탕은
// 엔진이 `edit-subagent` 녹음으로 쓴 기록이다(`thread-subagent.jsonl`).
describe("서브에이전트의 안쪽 도구", () => {
  const subagent = record("thread-subagent");
  const AGENT = "toolu_01V4oWzxBXP9BvCAGBTg4ocB";
  const agentOf = (model: ThreadModel) => {
    for (const turn of model.turns) {
      for (const entry of turn.entries) if (entry.kind === "tool" && entry.toolCallId === AGENT) return entry;
    }
    throw new Error("Agent 도구 줄이 없다");
  };
  const said = (tool: ToolEntry) => tool.inner.map((one) => phraseText(describeTool(one).phrase));

  it("기록된 안쪽 도구를 바깥 줄처럼 말한다 — 대화의 도구 줄로는 서지 않는다", () => {
    const model = foldThread(subagent);
    expect(said(agentOf(model))).toEqual(["note.md 읽음"]);
    expect(model.turns[1].entries.filter((entry) => entry.kind === "tool")).toHaveLength(1);
  });

  /** 변환기가 `Agent` 도구 줄에 싣는 안쪽 줄 하나 — 원문(`event`)이 그 줄의 update `_meta`에 든다. */
  const relay = (seq: number, event: Record<string, unknown>) =>
    update(seq, seq, {
      sessionUpdate: "tool_call_update",
      toolCallId: AGENT,
      _meta: { claudeCode: { toolName: "Agent", event: { parent_tool_use_id: AGENT, ...event } } },
    });
  const called = (seq: number, id: string, name: string, input: unknown) =>
    relay(seq, { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
  const returned = (seq: number, id: string, content: unknown, failed = false) =>
    relay(seq, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, ...(failed && { is_error: true }) }] } });
  const agentLines = (first: number): RecordLine[] => [
    { seq: first, at: at(first), kind: "sent", payload: { text: "맡겨" } },
    update(first + 1, first + 1, { sessionUpdate: "tool_call", toolCallId: AGENT, title: "조사", kind: "think", status: "in_progress" }),
  ];

  it("안쪽 줄은 같은 도구의 바깥 줄과 똑같이 그려진다 — 엔진이 쓴 기록의 도구 줄마다 원문으로 되돌려 재면 변환기와 어긋나지 않는다", () => {
    const records = readdirSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/", import.meta.url)))
      .filter((name) => name.startsWith("thread-"))
      .map((name) => record(name.replace(/\.jsonl$/, "")));
    const finished = records.flatMap((lines) =>
      foldThread(lines).turns.flatMap((turn) =>
        turn.entries.filter((entry): entry is ToolEntry => entry.kind === "tool" && entry.call.status === "completed" && !entry.denied),
      ),
    );
    const names = new Set(finished.map((tool) => toolFields(tool.call).toolName));
    expect([...names]).toEqual(expect.arrayContaining(["Write", "Edit", "Read", "Bash", "Agent"]));
    for (const outer of finished) {
      const { toolName, rawInput } = toolFields(outer.call);
      const pieces = Array.isArray(outer.call.content) ? outer.call.content : [];
      const said = pieces.flatMap((piece: { type: string; content: unknown }) => (piece.type === "content" ? [piece.content] : []));
      const inner = agentOf(
        foldThread([
          ...agentLines(1),
          called(3, "안쪽", toolName ?? "", rawInput),
          // 편집 도구도 결과 글을 준다 — 변환기는 그 글을 버려 diff를 지킨다.
          returned(4, "안쪽", said.length > 0 ? said : "The file has been updated."),
        ]),
      ).inner[0];
      const { startedAt, endedAt } = outer;
      expect(describeTool({ ...inner, startedAt, endedAt }), `${toolName} ${JSON.stringify(rawInput)}`).toEqual(describeTool(outer));
    }
  });

  it("녹음에 없는 도구도 변환기의 표대로 말한다", () => {
    const worded = (name: string, input: Record<string, unknown>) => {
      const agent = agentOf(foldThread([...agentLines(1), called(3, "a", name, input), returned(4, "a", "결과")]));
      return said(agent)[0];
    };
    expect(worded("Grep", { pattern: "retry" })).toBe("retry 찾음");
    expect(worded("Glob", { pattern: "**/*.rs" })).toBe("**/*.rs 찾음");
    expect(worded("WebFetch", { url: "https://example.com" })).toBe("https://example.com 가져옴");
    expect(worded("WebSearch", { query: "retry" })).toBe("웹에서 retry 찾아봄");
    expect(worded("NotebookEdit", { notebook_path: "/w/a.ipynb" })).toBe("a.ipynb 수정함");
    expect(worded("Skill", { skill: "tdd" })).toBe("tdd 스킬 읽음");
    expect(worded("TodoWrite", { todos: [] })).toBe("TodoWrite 씀");
    expect(worded("Agent", { subagent_type: "explorer", description: "조사" })).toBe("explorer에게 맡김");

    const edits = { file_path: "/w/a.rs", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] };
    const [multi] = agentOf(foldThread([...agentLines(1), called(3, "a", "MultiEdit", edits), returned(4, "a", "고쳤어요")])).inner;
    expect(describeTool(multi).diffs.map((piece) => [piece.added, piece.deleted])).toEqual([[1, 1], [1, 1]]);
    expect(phraseText(describeTool(multi).phrase)).toBe("a.rs 수정함");
  });

  it("마지막 하나가 아니라 모두, 온 차례로 쥔다 — 끝난 줄 · 실패한 줄 · 도는 줄이 제 때를 말한다", () => {
    const agent = agentOf(
      foldThread([
        ...agentLines(1),
        called(3, "a", "Read", { file_path: "/w/watcher.rs" }),
        returned(4, "a", [{ type: "text", text: "본문" }]),
        called(5, "b", "Grep", { pattern: "retry" }),
        returned(6, "b", "파일을 찾을 수 없어요", true),
        relay(7, { type: "assistant", message: { content: [{ type: "text", text: "둘러봤어요" }] } }),
        called(8, "c", "Bash", { command: "cargo test" }),
      ]),
    );
    expect(said(agent)).toEqual(["watcher.rs 읽음", "retry 찾지 못함", "cargo test 실행 중"]);
    expect(agent.inner.map((tool) => [tool.startedAt, tool.endedAt])).toEqual([
      [at(3), at(4)],
      [at(5), at(6)],
      [at(8), null],
    ]);
  });

  it("같은 호출이 다시 와도 안쪽 줄은 하나다", () => {
    const again = called(3, "a", "Read", { file_path: "/w/watcher.rs" });
    expect(said(agentOf(foldThread([...agentLines(1), again, { ...again, seq: 4 }])))).toEqual(["watcher.rs 읽는 중"]);
  });

  it("안쪽 줄이 기록되지 않았으면 비어 있다 — 도구 줄 하나로 내려간다", () => {
    expect(agentOf(foldThread(agentLines(1))).inner).toEqual([]);
    // 백그라운드 명령의 `task_*`도 같은 `_meta` 길로 오지만 안쪽 줄이 아니다.
    const tools = foldThread(record("thread-self-turn")).turns.flatMap((turn) => turn.entries.filter((entry) => entry.kind === "tool"));
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.flatMap((tool) => tool.inner)).toEqual([]);
  });

  it("끝을 받지 못한 안쪽 줄은 바깥 줄을 따라 끊기고 멈춘다 — 끝난 턴에 반짝이는 줄이 남지 않는다", () => {
    const running = [...agentLines(1), called(3, "a", "Bash", { command: "cargo test" })];
    const stateOf = (lines: RecordLine[]) => describeTool(agentOf(foldThread(lines)).inner[0]).state;
    expect(stateOf(running)).toBe("running");
    // 세션이 죽었다 — 바깥 줄도 안쪽 줄도 더 올 update가 없다.
    expect(stateOf([...running, { seq: 4, at: at(4), kind: "session", payload: { state: "died" } }])).toBe("cut");
    // 바깥 줄은 끝났는데 안쪽 줄의 결과가 오지 않은 채 턴이 끝났다.
    const closed = update(4, 4, { sessionUpdate: "tool_call_update", toolCallId: AGENT, status: "completed" });
    expect(stateOf([...running, closed])).toBe("running");
    const ended: RecordLine = { seq: 5, at: at(5), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 4000 } };
    expect(stateOf([...running, closed, ended])).toBe("cut");
    // 우리가 멈췄다 — 바깥 줄이 멈춤으로 닫히면 안쪽 줄도 「중단함」이다.
    const failed = update(4, 4, { sessionUpdate: "tool_call_update", toolCallId: AGENT, status: "failed" });
    const stopped: RecordLine = { seq: 5, at: at(5), kind: "turn-end", payload: { stopReason: "cancelled", cancelledByUs: true, durationMs: 4000 } };
    expect(said(agentOf(foldThread([...running, failed, stopped])))).toEqual(["cargo test 중단함"]);
  });
});

// 사용량(01b-7 · 스토리 66) — `usage_update`가 그 턴의 사용량이다. 일이 아니라 턴의 표라 줄이 서지 않고 턴의 상태도 건드리지 않는다.
describe("사용량", () => {
  const usage = (seq: number, used: unknown, size: unknown) => update(seq, seq, { sessionUpdate: "usage_update", used, size });
  const sent: RecordLine = { seq: 1, at: at(1), kind: "sent", payload: { text: "말" } };
  const ended = (seq: number): RecordLine => ({ seq, at: at(seq), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 1000 } });

  it("턴마다 그 턴의 사용량을 든다 — 축복한 기록의 두 턴", () => {
    expect(foldThread(blessed).turns.map((turn) => turn.usage)).toEqual([
      { used: 30512, size: 1000000 },
      { used: 38508, size: 1000000 },
    ]);
  });

  it("한 턴에 여러 번 오면 마지막 값이다", () => {
    const [turn] = foldThread([sent, usage(2, 1000, 200000), usage(3, 2000, 200000), ended(4)]).turns;
    expect(turn.usage).toEqual({ used: 2000, size: 200000 });
  });

  it("턴 끝 뒤에 와도 마지막 턴의 것이다 — 기록에 턴이 없으면 어디에도 서지 않는다", () => {
    expect(foldThread([sent, ended(2), usage(3, 1000, 200000)]).turns[0].usage).toEqual({ used: 1000, size: 200000 });
    expect(foldThread([usage(1, 1000, 200000)]).turns).toEqual([]);
  });

  it("줄이 서지 않고 답한 것으로 치지 않는다 — 말을 보낸 뒤 사용량만 왔으면 아직 답을 기다린다", () => {
    const model = foldThread([sent, usage(2, 1000, 200000)]);
    expect(model.turns[0].entries).toEqual([]);
    expect(model.turns[0].answeredAt).toBeNull();
    expect(answeringLine(model)).toBe(true);
  });

  it("모델을 부르지 않은 턴이나 값이 어긋난 줄은 사용량이 없다", () => {
    expect(foldThread([sent, ended(2)]).turns[0].usage).toBeNull();
    expect(foldThread([sent, usage(2, "많이", 200000), usage(3, 1000, 0), ended(4)]).turns[0].usage).toBeNull();
  });

  it("답 아래 줄의 글 — 토큰은 어림수, 컨텍스트는 창에서 차지한 몫이다", () => {
    expect(usageText({ used: 18400, size: 48400 })).toBe("토큰 18.4k · 컨텍스트 38%");
    expect(usageText({ used: 30512, size: 1000000 })).toBe("토큰 30.5k · 컨텍스트 3%");
    expect(usageText({ used: 950, size: 200000 })).toBe("토큰 950 · 컨텍스트 0%");
    expect(usageText({ used: 999960, size: 1000000 })).toBe("토큰 1.0M · 컨텍스트 100%");
    expect(usageText({ used: 1250000, size: 1000000 })).toBe("토큰 1.3M · 컨텍스트 125%");
  });
});

// 계획 체크리스트(01b-7 · 스토리 64) — ACP `plan` 하나가 입구다. 앱이 할 일 도구를 켜지 않으므로 Claude의 할 일 도구 줄은 도구 줄 그대로이고,
// 계획 카드(`plan_update` · `ExitPlanMode`)는 체크리스트가 아니다.
describe("계획 체크리스트", () => {
  const sent: RecordLine = { seq: 1, at: at(1), kind: "sent", payload: { text: "말" } };
  const plan = (seq: number, entries: unknown[]) => update(seq, seq, { sessionUpdate: "plan", entries });
  const ended = (seq: number): RecordLine => ({ seq, at: at(seq), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 1000 } });
  const checklists = (model: ThreadModel) =>
    model.turns.flatMap((turn) => turn.entries.flatMap((entry) => (entry.kind === "checklist" ? [entry.items] : [])));

  it("ACP `plan`이 오면 그 항목들로 서고, 다음 `plan`이 같은 체크리스트를 바꾼다", () => {
    const first = [
      { content: "워처 오류 올리기", status: "in_progress", priority: "high" },
      { content: "시험 돌리기", status: "pending", priority: "medium" },
    ];
    const next = [
      { content: "워처 오류 올리기", status: "completed", priority: "high" },
      { content: "시험 돌리기", status: "in_progress", priority: "medium" },
    ];
    expect(checklists(foldThread([sent, plan(2, first)]))).toEqual([
      [
        { content: "워처 오류 올리기", status: "in_progress" },
        { content: "시험 돌리기", status: "pending" },
      ],
    ]);
    expect(checklists(foldThread([sent, plan(2, first), plan(3, next), ended(4)]))).toEqual([
      [
        { content: "워처 오류 올리기", status: "completed" },
        { content: "시험 돌리기", status: "in_progress" },
      ],
    ]);
  });

  it("빈 `plan`이 오면 걷힌다", () => {
    expect(checklists(foldThread([sent, plan(2, [{ content: "일", status: "pending" }]), plan(3, [])]))).toEqual([]);
  });

  it("`plan` 없이는 서지 않는다 — 할 일 도구 줄도, 계획 카드도, 평범한 턴도 체크리스트가 아니다", () => {
    const todo = update(2, 2, {
      sessionUpdate: "tool_call",
      toolCallId: "todo",
      title: "TodoWrite",
      kind: "other",
      status: "completed",
      rawInput: { todos: [{ content: "일", status: "pending" }] },
      _meta: { claudeCode: { toolName: "TodoWrite" } },
    });
    const card = update(3, 3, { sessionUpdate: "plan_update", plan: { type: "markdown", content: "# 계획" } });
    const model = foldThread([sent, todo, card, ended(4)]);
    expect(checklists(model)).toEqual([]);
    expect(model.turns[0].entries.map((entry) => entry.kind)).toEqual(["tool", "plan"]);
    expect(checklists(foldThread(blessed))).toEqual([]);
  });
});

// Runtime 경고(01b-8 · 구현 스펙 「01b — 그 밖의 Runtime 신호」) — 기록만 되던 `stderr` 줄을 화면에 세운다. 이어진 줄은 안내 하나다. 일이 아니라서 턴의
// 흐름(도는가 · 답했나 · 무엇이 마지막 줄인가)을 바꾸지 않는다.
describe("Runtime 경고", () => {
  const sent = (seq: number): RecordLine => ({ seq, at: at(seq), kind: "sent", payload: { text: "고쳐 줘" } });
  const said = (seq: number, words = "고치는 중"): RecordLine =>
    update(seq, seq, { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: words } });
  const warned = (seq: number, line: string): RecordLine => ({ seq, at: at(seq), kind: "stderr", payload: { line } });
  const ran = (seq: number): RecordLine =>
    update(seq, seq, { sessionUpdate: "tool_call", toolCallId: `t${seq}`, title: "Read a.rs", kind: "read", status: "completed" });
  const ended = (seq: number): RecordLine => ({ seq, at: at(seq), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 1000 } });
  const warnings = (entries: readonly Entry[]) => entries.flatMap((entry) => (entry.kind === "warning" ? [entry.lines] : []));
  const kinds = (entries: readonly Entry[]) => entries.map((entry) => entry.kind);

  it("턴 안의 이어진 줄은 그 자리에 안내 하나로 묶인다", () => {
    const [turn] = foldThread([sent(1), said(2), warned(3, "첫 줄"), warned(4, "둘째 줄"), ran(5)]).turns;
    expect(kinds(turn.entries)).toEqual(["message", "warning", "tool"]);
    expect(warnings(turn.entries)).toEqual([["첫 줄", "둘째 줄"]]);
  });

  it("사이에 일이 낀 줄은 이어진 줄이 아니라 안내가 따로 선다", () => {
    const [turn] = foldThread([sent(1), warned(2, "앞"), ran(3), warned(4, "뒤")]).turns;
    expect(kinds(turn.entries)).toEqual(["warning", "tool", "warning"]);
    expect(warnings(turn.entries)).toEqual([["앞"], ["뒤"]]);
  });

  it("화면에 서지 않는 줄이 끼어도 이어진 줄이다", () => {
    const usage = update(3, 3, { sessionUpdate: "usage_update", used: 10, size: 100 });
    const [turn] = foldThread([sent(1), warned(2, "앞"), usage, warned(4, "뒤")]).turns;
    expect(warnings(turn.entries)).toEqual([["앞", "뒤"]]);
  });

  it("줄을 가려 고르지 않는다 — 묶음 안의 빈 줄도 그대로 든다", () => {
    const [turn] = foldThread([sent(1), warned(2, "앞"), warned(3, ""), warned(4, "뒤")]).turns;
    expect(warnings(turn.entries)).toEqual([["앞", "", "뒤"]]);
  });

  it("안내 글은 첫 줄이므로 빈 줄은 묶음을 열지 않는다", () => {
    const [turn] = foldThread([sent(1), warned(2, "  "), warned(3, "Error: boom")]).turns;
    expect(warnings(turn.entries)).toEqual([["Error: boom"]]);
    expect(foldThread([warned(1, "")]).notices).toEqual([]);
  });

  it("턴 밖의 줄은 턴을 열지 않고 턴 사이에 안내 하나로 묶인다", () => {
    const model = foldThread([sent(1), ended(2), warned(3, "첫 줄"), warned(4, "둘째 줄")]);
    expect(model.running).toBe(false);
    expect(model.turns).toHaveLength(1);
    expect(model.notices.map(({ kind, text, lines, turnsBefore }) => ({ kind, text, lines, turnsBefore }))).toEqual([
      { kind: "warning", text: "첫 줄", lines: ["첫 줄", "둘째 줄"], turnsBefore: 1 },
    ]);
  });

  it("턴 사이의 다른 안내가 끼면 따로 묶는다", () => {
    const died: RecordLine = { seq: 2, at: at(2), kind: "session", payload: { state: "died", reason: "끝났어요" } };
    const model = foldThread([warned(1, "앞"), died, warned(3, "뒤")]);
    expect(model.notices.map((notice) => [notice.kind, notice.text])).toEqual([
      ["warning", "앞"],
      ["died", "끝났어요 · 다음 말에서 다시 띄워요"],
      ["warning", "뒤"],
    ]);
  });

  it("경고가 있어도 대화는 막히지 않는다 — 턴이 돌지도, 물음이 걸리지도 않고 다음 말이 그대로 턴이 된다", () => {
    const lines = [warned(1, "경고"), sent(2), ended(3), warned(4, "경고")];
    const model = foldThread(lines);
    expect(model.running).toBe(false);
    expect(model.asks).toEqual([]);
    expect(model.connecting).toBe(false);
    expect(foldThread([...lines, sent(5)]).running).toBe(true);
    expect(foldThread([...lines, sent(5)]).turns).toHaveLength(2);
  });

  it("경고는 답이 아니다 — 「답하는 중」이 그대로 서고 답한 때가 적히지 않는다", () => {
    const lines = [sent(1), warned(2, "경고")];
    const model = foldThread(lines);
    expect(answeringLine(model)).toBe(true);
    expect(model.turns[0].answeredAt).toBeNull();
    expect(answeringLine(foldThread([...lines, said(3)]))).toBe(false);
  });

  it("답 글 도중에 온 경고가 답을 둘로 끊지 않는다", () => {
    const [turn] = foldThread([sent(1), said(2, "안녕"), warned(3, "경고"), said(4, "하세요"), ended(5)]).turns;
    expect(turn.entries.flatMap((entry) => (entry.kind === "message" ? [entry.text] : []))).toEqual(["안녕하세요"]);
    expect(kinds(turn.entries)).toEqual(["message", "warning"]);
  });

  it("접힌 턴에도 남고, 말만 한 턴에 작업 구분선을 세우지 않는다", () => {
    const [turn] = foldThread([sent(1), warned(2, "경고"), said(3), ended(4)]).turns;
    expect(turn.entries.filter(keptFolded).map((entry) => entry.kind)).toEqual(["warning"]);
    expect(workLine(turn)).toBeNull();
    expect(finalMessages(turn).map((entry) => entry.kind)).toEqual(["message"]);
  });
});

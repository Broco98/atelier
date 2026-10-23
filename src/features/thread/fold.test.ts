/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { answeringLine, finalMessages, flowOf, foldThread, headline, type CallEntry } from "./fold";
import { describeTool, phraseText } from "./tool-view";
import type { RecordLine } from "./types";

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

/** Host가 Thread 도구로 리뷰어를 불러 맡기고 「edited」를 받은 축복 기록(v1 티켓 16). */
const calling = record("thread-call");
const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);

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
    expect(turn.end && headline(turn.end)).toBe("7초 동안 작업함");
    const tools = turn.entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => phraseText(describeTool(tool).phrase))).toEqual(["atelier-thread.rename_thread 불러옴"]);
    expect(finalMessages(turn).map((entry) => entry.kind === "message" && entry.text)).toEqual(["hello from turn"]);
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
    expect(host.entries.map((entry) => entry.kind)).toEqual(["call", "message"]);
    const call = host.entries[0] as CallEntry;
    expect([call.id, call.from, call.to, call.text]).toEqual(["fake-call", "host", "reviewer", "방금 고친 장바구니를 봐 줘"]);
    expect(call.end).toEqual({ outcome: "answered", answer: "edited", reason: null, durationMs: 10000 });
    // 도구의 끝(seq 23)이 와도 도구 줄은 다시 서지 않는다 — 접힌 턴에는 호출 줄 뒤의 답만 펼쳐 둔다.
    expect(finalMessages(host).map((entry) => entry.kind === "message" && entry.text)).toEqual(["hello from turn"]);
    expect(reviewer.entries.some((entry) => entry.kind === "call")).toBe(false);
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
    expect(tools.map((tool) => tool.call.title)).toEqual(["Read /tmp/gate/ws/proj/note.md", "Edit /tmp/gate/ws/proj/note.md"]);
    expect(finalMessages(reviewer).map((entry) => entry.kind === "message" && entry.text)).toEqual(["edited"]);
    // 호출 줄은 그 맡은 턴의 줄들을 들고 있다 — 하는 중의 지금 도구 · 펼침의 도구 줄.
    const call = host.entries[0] as CallEntry;
    expect(call.work?.map((entry) => entry.key)).toEqual(reviewer.entries.map((entry) => entry.key));
  });

  it("맡긴 일이 전해지기 전에 막힌 부르기는 끝 줄 하나로 서고 맡은 턴이 없다", () => {
    const lines: RecordLine[] = [
      ...through(calling, 7),
      {
        seq: 8,
        at: at(8),
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
    expect(reviewer.turns.map((turn) => [turn.who, turn.assigned?.text])).toEqual([["reviewer", "방금 고친 장바구니를 봐 줘"]]);
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

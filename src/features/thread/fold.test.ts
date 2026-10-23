/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { answeringLine, finalMessages, foldThread, headline } from "./fold";
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
    expect(model.turns.map((turn) => turn.end && headline(turn.end))).toEqual(["5초 동안 작업함", "13초 동안 작업함"]);
    // 턴 끝 메시지(마지막 도구 뒤의 답)만 접힌 턴에 남는다.
    expect(model.turns.map((turn) => finalMessages(turn).map((entry) => entry.kind === "message" && entry.text))).toEqual([
      ["Hello from turn"],
      ["4"],
    ]);
  });

  it("Host가 들어온 첫 줄은 흐름에 서지 않는다 — 모든 Thread가 그 줄로 시작한다", () => {
    expect(foldThread(blessed).system).toEqual([]);
  });

  it("도구 줄은 시작한 줄과 끝난 줄의 시각을 든다 — 걸린 시간을 말하려고", () => {
    const tools = foldThread(blessed).turns[1].entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => [tool.call.title, tool.startedAt, tool.endedAt])).toEqual([
      ["Write /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:13.000+09:00", "2026-10-10T10:00:14.000+09:00"],
      ["Read /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:16.000+09:00", "2026-10-10T10:00:17.000+09:00"],
      ["wc -c /tmp/gate/ws/g3/wt/notes.txt", "2026-10-10T10:00:19.000+09:00", "2026-10-10T10:00:20.000+09:00"],
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
      ...blessed.slice(0, 10),
      { seq: 30, at: at(3), kind: "title", payload: { title: "환불 API 버그", before: "세 낱말로" } },
      ...blessed.slice(10),
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
    expect(turn.end && headline(turn.end)).toBe("8초 동안 작업함");
    const tools = turn.entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => phraseText(describeTool(tool).phrase))).toEqual(["atelier-thread.rename_thread 불러옴"]);
    expect(finalMessages(turn).map((entry) => entry.kind === "message" && entry.text)).toEqual(["Hello from turn"]);
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

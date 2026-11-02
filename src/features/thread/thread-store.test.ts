import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadApi } from "./api";
import { foldOf } from "./fold";
import { receiveChunk, receiveRecordLine, threadQuery } from "./hooks";
import { linesOf, mergeLines, threadFlowStore, threadRecordStore } from "./thread-store";
import type { FlowChunk, RecordLine, ThreadView } from "./types";

// 흐르는 글(스펙 「01b — 스트리밍」) — 엔진의 조각 이벤트와 Thread를 열 때 읽은 진행 글이 합쳐지는 자리, 같은 흐름의 기록 줄이 오면 지워지는
// 자리다. 스토어는 모듈에 하나라 시험마다 Thread 열쇠를 따로 쓴다.

let serial = 0;
const fresh = () => `thread-${(serial += 1)}`;

const view = (id: string, over: Partial<ThreadView> = {}): ThreadView => ({
  id,
  title: id,
  createdAt: "2026-11-02T10:00:00.000+09:00",
  work: null,
  mode: null,
  runtime: "claude-code",
  sessionId: "세션",
  cwd: null,
  additionalDirectories: [],
  model: null,
  effort: null,
  lastRead: 0,
  lastSeq: 2,
  askLevel: "always",
  live: true,
  queue: [],
  readOnly: null,
  flowing: null,
  ...over,
});

const chunk = (offset: number, text: string, stream = 7): FlowChunk => ({ stream, kind: "message", offset, text });

const at = (seq: number) => `2026-11-02T10:00:${String(seq).padStart(2, "0")}.000+09:00`;
const sent: RecordLine = { seq: 1, at: at(1), kind: "sent", payload: { text: "말" } };
const opened: RecordLine = { seq: 2, at: at(2), kind: "stderr", payload: { line: "경고" } };
const answered = (seq: number, text: string, stream: number | null = 7): RecordLine => ({
  seq,
  at: at(seq),
  kind: "update",
  payload: {
    sessionId: "s",
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text },
      ...(stream === null ? {} : { _meta: { atelier: { stream } } }),
    },
  },
});

const flowing = (thread: string) => threadFlowStore.state[thread]?.text;

/** Thread를 연다 — 화면이 여는 그 읽기다. */
function opens(client: QueryClient, one: ThreadView, lines: readonly RecordLine[] = []) {
  vi.spyOn(threadApi, "get").mockResolvedValue(one);
  vi.spyOn(threadApi, "readRecord").mockResolvedValue([...lines]);
  return client.fetchQuery(threadQuery(one.id));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("조각이 오는 동안", () => {
  it("글이 오프셋 자리에 이어 붙는다", () => {
    const thread = fresh();
    const client = new QueryClient();
    receiveChunk(client, { thread, chunk: chunk(0, "흐르던 ") });
    receiveChunk(client, { thread, chunk: chunk(4, "답") });
    expect(flowing(thread)).toBe("흐르던 답");
  });

  it("글이 빈 조각도 흐름을 연다 — 생각은 빈 글로 온다", () => {
    const thread = fresh();
    receiveChunk(new QueryClient(), { thread, chunk: { stream: 1, kind: "thought", offset: 0, text: "" } });
    expect(threadFlowStore.state[thread]).toEqual({ stream: 1, kind: "thought", text: "" });
  });

  it("기록 줄은 그대로라 접기를 다시 돌리지 않는다", () => {
    const thread = fresh();
    mergeLines(thread, [sent, opened]);
    const lines = linesOf(threadRecordStore.state, thread);
    const model = foldOf(lines, null);
    const told = vi.fn();
    const { unsubscribe } = threadRecordStore.subscribe(told);

    receiveChunk(new QueryClient(), { thread, chunk: chunk(0, "흐르던 ") });
    receiveChunk(new QueryClient(), { thread, chunk: chunk(4, "답") });
    unsubscribe();

    expect(told).not.toHaveBeenCalled();
    expect(linesOf(threadRecordStore.state, thread)).toBe(lines);
    expect(foldOf(linesOf(threadRecordStore.state, thread), null)).toBe(model);
  });
});

describe("같은 흐름의 기록 줄이 오면", () => {
  it("조각이 지워지고 글은 기록 줄 하나로만 남는다", () => {
    const thread = fresh();
    const client = new QueryClient();
    mergeLines(thread, [sent]);
    receiveChunk(client, { thread, chunk: chunk(0, "흐르던 답") });

    receiveRecordLine(client, thread, answered(3, "흐르던 답"));

    expect(flowing(thread)).toBeUndefined();
    const { entries } = foldOf(linesOf(threadRecordStore.state, thread), null).turns[0];
    expect(entries.map((entry) => (entry.kind === "message" ? entry.text : entry.kind))).toEqual(["흐르던 답"]);
  });

  it("다른 흐름의 줄이나 흐름이 아닌 줄은 조각을 지우지 않는다", () => {
    const thread = fresh();
    const client = new QueryClient();
    receiveChunk(client, { thread, chunk: chunk(0, "흐르던") });

    receiveRecordLine(client, thread, answered(3, "앞선 글", 6));
    receiveRecordLine(client, thread, answered(4, "턴 밖의 글", null));
    receiveRecordLine(client, thread, { seq: 5, at: at(5), kind: "stderr", payload: { line: "경고" } });

    expect(flowing(thread)).toBe("흐르던");
  });
});

describe("화면을 새로 그리면", () => {
  it("열 때 읽은 진행 글에 다음 조각이 이어 붙는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던 ") });
    await opens(client, one);
    expect(flowing(one.id)).toBe("흐르던 ");

    receiveChunk(client, { thread: one.id, chunk: chunk(4, "답") });

    expect(flowing(one.id)).toBe("흐르던 답");
  });

  it("읽은 글이 다음 조각과 겹쳐도 글이 두 번 서지 않는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던 답") });
    await opens(client, one);

    receiveChunk(client, { thread: one.id, chunk: chunk(4, "답을 이어") });

    expect(flowing(one.id)).toBe("흐르던 답을 이어");
  });

  it("읽은 글 안에 다 든 늦은 조각은 글을 줄이지 않는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던 답") });
    await opens(client, one);

    receiveChunk(client, { thread: one.id, chunk: chunk(0, "흐르던") });

    expect(flowing(one.id)).toBe("흐르던 답");
  });

  it("앞서 받은 조각이 읽은 글보다 길면 그 글이 남는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던") });
    receiveChunk(client, { thread: one.id, chunk: chunk(0, "흐르던 답") });

    await opens(client, one);

    expect(flowing(one.id)).toBe("흐르던 답");
  });

  it("앞 글이 빠진 조각은 잇지 않고 Thread를 한 번 다시 읽어 잇는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던 ") });
    const get = vi.spyOn(threadApi, "get").mockResolvedValue(one);
    vi.spyOn(threadApi, "readRecord").mockResolvedValue([]);
    const observer = new QueryObserver(client, threadQuery(one.id));
    const stop = observer.subscribe(() => {});
    await vi.waitFor(() => expect(flowing(one.id)).toBe("흐르던 "));
    get.mockResolvedValue({ ...one, flowing: chunk(0, "흐르던 답을 ") });

    receiveChunk(client, { thread: one.id, chunk: chunk(6, "이어") });
    receiveChunk(client, { thread: one.id, chunk: chunk(8, "간다") });

    expect(flowing(one.id)).toBe("흐르던 ");
    await vi.waitFor(() => expect(flowing(one.id)).toBe("흐르던 답을 "));
    expect(get).toHaveBeenCalledTimes(2);
    stop();
  });

  it("읽는 사이 그 흐름의 기록 줄이 섰으면 진행 글을 버린다 — 글이 겹치지 않는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던 답") });

    await opens(client, one, [sent, opened, answered(3, "흐르던 답")]);

    expect(flowing(one.id)).toBeUndefined();
  });

  it("기록 줄 이벤트가 읽기의 답보다 먼저 왔어도 진행 글을 버린다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { flowing: chunk(0, "흐르던 답") });
    receiveRecordLine(client, one.id, answered(3, "흐르던 답"));

    await opens(client, one, [sent, opened]);

    expect(flowing(one.id)).toBeUndefined();
  });

  it("앱을 다시 켜기 전의 줄이 같은 번호를 달아도 진행 글을 지우지 않는다", async () => {
    const client = new QueryClient();
    const one = view(fresh(), { lastSeq: 3, flowing: chunk(0, "흐르던 답") });

    await opens(client, one, [sent, opened, answered(3, "지난 앱의 글")]);

    expect(flowing(one.id)).toBe("흐르던 답");
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CHAT_QUEUE_EVENT, CHAT_RECORD_EVENT } from "@/features/chat/events";
import type { ChatQueueEvent, ChatRecordEvent, Conversation, QueuedMessage, RecordLine } from "@/features/chat/types";
import { REPO_ROOT } from "./dev-server";
import type { Page } from "./evidence";
import { fireEvent } from "./harness";

// 대화창 L3의 자료(three-axes 구현 스펙 S26). **L1이 남긴 기록 파일을 그대로 쏜다** — 대화 호스트 검사(L1)가 시나리오를
// 돌려 남긴 `agents/<id>.jsonl`의 고정값 사본이 `crates/atelier-acp/tests/records/`에 있고, 이 층의 목업 백엔드는 그 줄을
// 기록 읽기의 답과 기록 줄 이벤트로 흘린다. 그래서 두 지점이 같은 기록 모양을 본다 — 호스트가 줄 모양을 바꾸면 L1이 그
// 파일을 다시 쓰고, 화면이 그 모양을 못 읽으면 여기서 빨개진다.
//
// **`fixtures.ts`에서 읽지 않는다.** 그 모듈은 L2의 `tauri-commands.test`가 임포트하므로 파일을 읽게 만들면 L2도 그 파일에
// 묶인다. 대화 spec이 이 모듈을 불러 제 답을 덮어쓴다.

const RECORDS = join(REPO_ROOT, "crates/atelier-acp/tests/records");

/** L1이 남긴 기록 하나 — 줄마다 `{seq, at, kind, payload}`다. 끝의 빈 줄은 버린다. */
export function record(name: string): RecordLine[] {
  return readFileSync(join(RECORDS, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
}

/**
 * 그 기록이 남긴 spec 폴더의 사본 — `<이름>.spec/` 아래 파일들(three-axes 티켓 06 · 26). L1의 「고친 곳」 시나리오는 턴이 끝난 뒤의
 * spec 폴더를 함께 남긴다: `changes` 줄의 바뀐 줄 범위가 **새 글 기준**이라, 화면이 읽는 본문이 L1의 그 글과 같아야 표시가 맞는
 * 자리에 선다. 이 층은 그 파일들을 `read_spec_file`의 답과 work의 `specFiles`로 쓴다. 경로는 spec 폴더 기준이고 `/`로 잇는다.
 */
export function specCopy(name: string): { files: string[]; bodies: Record<string, string> } {
  const root = join(RECORDS, `${name}.spec`);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
  return { files, bodies: Object.fromEntries(files.map((path) => [path, readFileSync(join(root, path), "utf8")])) };
}

/** 대화 목록의 한 줄(호스트의 `Conversation`). 고르지 않은 값은 엔진 기본값(`null`)이고, 대기 줄은 비어 있다. */
export function conversationRow(row: Pick<Conversation, "id" | "agent" | "name"> & Partial<Conversation>): Conversation {
  return { model: null, mode: null, plan: null, lastSeq: 0, queue: [], ...row };
}

/**
 * 기록 줄을 차례로 쏜다 — 호스트가 줄을 적을 때마다 내보내는 기록 줄 이벤트 그대로다(`{work, conversation, seq, line}`).
 * 구독은 앱 층에 하나라(`AppShell`) 마지막 구독 하나에 쏘는 `fireEvent`로 실물과 같다.
 */
export async function streamLines(
  page: Page,
  work: string,
  conversation: string,
  lines: readonly RecordLine[],
): Promise<void> {
  for (const line of lines) {
    const event: ChatRecordEvent = { work, conversation, seq: line.seq, line };
    await fireEvent(page, CHAT_RECORD_EVENT, event);
  }
}

/** 기록에서 그 seq의 줄들 — 「여기까지는 기록 읽기로, 그 뒤는 이벤트로」를 가르는 데 쓴다. */
export const linesThrough = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);
export const linesAfter = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq > seq);

/** 손 자료의 시각 — 11시 정각부터 n초. */
const handAt = (n: number) => `2026-10-10T11:00:${String(n).padStart(2, "0")}.000+09:00`;

/** 손 자료의 `update` 줄 — ACP `session/update` params 원문 꼴(`{sessionId, update}`)이다. */
const handUpdate = (seq: number, n: number, update: Record<string, unknown>): RecordLine => ({
  seq,
  at: handAt(n),
  kind: "update",
  payload: { sessionId: "hand-session", update },
});

/** 손 자료의 `sent` 줄 — 둘째 말부터라 머리말 블록이 없다. */
const handSent = (seq: number, text: string, sendNow = false): RecordLine => ({
  seq,
  at: handAt(0),
  kind: "sent",
  payload: { text, prompt: [{ type: "text", text }], sendNow },
});

/**
 * 손으로 짓는 한 턴 — L1 자료에 없는 모양(코드 블록이 든 답)을 잴 때 쓴다. 꼴은 L1 기록과 같다: 보낸 말(머리말 블록은 없다
 * — 둘째 말부터는 붙지 않는다) → 답 조각 → 턴 끝. seq는 `from`부터 1씩 오른다.
 */
export function handTurn(from: number, text: string, answer: string, durationMs: number): RecordLine[] {
  return [
    handSent(from, text),
    handUpdate(from + 1, 1, {
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_hand",
      content: { type: "text", text: answer },
    }),
    {
      seq: from + 2,
      at: handAt(2),
      kind: "turn-end",
      payload: { stopReason: "end_turn", durationMs, cancelledByUs: false, outOfTurn: false },
    },
  ];
}

/**
 * 손으로 짓는 **Claude 꼴의 멈춘 턴**(three-axes 티켓 20) — S26 목록 밖이라 여기서 짓는다. Claude는 interrupt가 돌던 도구까지
 * 멈춘다(결정 28 · 워크플로 실측 2.1.282 `interrupt-sigint`): 열린 `tool_use`에 `is_error` `tool_result`가 오고 나서 `result`가
 * 온다. 변환기가 옮긴 ACP 꼴로는 보낸 말 → 도구 호출(`in_progress`) → 그 도구의 `failed` update → 턴 끝(`cancelled`, 우리가
 * 멈춤)이다. seq는 `from`부터 1씩 오른다.
 */
export function claudeStoppedTurn(from: number, text: string, command: string, durationMs: number): RecordLine[] {
  const toolCallId = "toolu_hand_stopped";
  return [
    handSent(from, text),
    handUpdate(from + 1, 1, {
      sessionUpdate: "tool_call",
      toolCallId,
      kind: "execute",
      title: command,
      status: "in_progress",
      rawInput: { command },
    }),
    handUpdate(from + 2, 2, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "failed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "The user doesn't want to proceed with this tool use. The tool use was rejected." },
        },
      ],
    }),
    {
      seq: from + 3,
      at: handAt(3),
      kind: "turn-end",
      payload: { stopReason: "cancelled", durationMs, cancelledByUs: true, outOfTurn: false },
    },
  ];
}

/**
 * 손으로 짓는 **스스로 이어 간 턴**(S4, three-axes 티켓 20) — 보낸 말 없이 턴 밖 update로 시작해 턴 밖 끝(`outOfTurn: true`)으로
 * 끝난다. Claude가 백그라운드 작업 알림으로 스스로 시작한 턴을 변환기 · 호스트가 적는 꼴이다(티켓 16). S26 목록 밖이라 여기서
 * 짓는다. `end`가 거짓이면 턴 밖 끝 줄을 빼고 돌려준다(도는 중).
 */
export function selfContinuedTurn(from: number, answer: string, durationMs: number, end = true): RecordLine[] {
  const lines: RecordLine[] = [
    handUpdate(from, 0, {
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_hand_self",
      content: { type: "text", text: answer },
    }),
  ];
  if (end) {
    lines.push({
      seq: from + 1,
      at: handAt(1),
      kind: "turn-end",
      payload: { stopReason: "end_turn", durationMs, cancelledByUs: false, outOfTurn: true },
    });
  }
  return lines;
}

/**
 * 손으로 짓는 **도구 턴**(three-axes 티켓 18) — L1 자료에 없는 도구 모양(실패 · MCP 호출 · 제목이 빈 명령)을 잴 때 쓴다. 꼴은 L1
 * 기록과 같다: 보낸 말 → `updates`(ACP `session/update`의 `update` 몸, 차례대로) → 답 → 턴 끝(`end_turn`). 도구 모양은 그 엔진이
 * 내는 것 그대로 부르는 쪽이 짓는다 — Claude는 변환기(`translator/stream.rs`), Codex는 codex-acp 2.2.2다. seq는 `from`부터 오른다.
 */
export function handToolTurn(
  from: number,
  text: string,
  updates: readonly Record<string, unknown>[],
  answer: string,
  durationMs: number,
): RecordLine[] {
  const steps = updates.map((update, at) => handUpdate(from + 1 + at, 1 + at, update));
  const next = from + 1 + updates.length;
  return [
    handSent(from, text),
    ...steps,
    handUpdate(next, 1 + updates.length, {
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_hand_tools",
      content: { type: "text", text: answer },
    }),
    {
      seq: next + 1,
      at: handAt(2 + updates.length),
      kind: "turn-end",
      payload: { stopReason: "end_turn", durationMs, cancelledByUs: false, outOfTurn: false },
    },
  ];
}

/** 손으로 짓는 `sent` 줄 하나 — 대기 줄의 말이 「지금 보내기」로 간 것(`sendNow`)을 잴 때 쓴다. */
export const sentLine = (seq: number, text: string, sendNow = false): RecordLine => handSent(seq, text, sendNow);

/**
 * 대기 줄 바뀜 이벤트를 쏜다 — 호스트가 대기 줄이 바뀔 때마다 그 대화의 대기 줄 전체를 내보내는 것 그대로다
 * (`{work, conversation, queue}`). 구독은 앱 층에 하나다(`AppShell`).
 */
export async function fireQueue(page: Page, work: string, conversation: string, queue: QueuedMessage[]): Promise<void> {
  const event: ChatQueueEvent = { work, conversation, queue };
  await fireEvent(page, CHAT_QUEUE_EVENT, event);
}

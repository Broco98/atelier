import { changedFiles, type ChangedFile } from "./changes";
import type { Quote, RecordLine } from "./types";

// 대화 접기(three-axes 티켓 17) — 기록 줄을 받아 화면 모델(턴 · 메시지 · 생각 · 머리줄 · 도는가)로 접는 **순수 함수**다.
// 대화창은 대화를 이것 하나로 그린다: 처음 그릴 때 읽은 기록도, 흐르는 기록 줄 이벤트도 같은 줄이라(구현 스펙 「기록」) 이
// 함수는 어디서 온 줄인지 모른다.
//
// **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16). Codex의 줄도 Claude 변환기가 옮긴 줄도 `session/update`의
// `sessionUpdate` 갈래로만 읽는다 — 엔진마다 다른 것은 칩의 목록뿐이다. 뒤의 화면 장들이 여기에 갈래를 더한다: 도구 줄의
// 문구 · 출력 · diff(18), 대기와 멈춤(20), 승인 · 계획 카드(21), 상태 · 상태 줄(23).
//
// **멈춘 뒤의 도구 줄**(three-axes 티켓 20 · 결정 28)도 ACP 모양으로 가른다. 우리가 멈춘 `cancelled` 턴 끝에서:
// - 그때까지 끝나지 않은(`completed` · `failed`가 아닌) 도구 줄은 **멈춘 뒤에도 돈다**(`ran-on`) — Codex `session/cancel`은 턴만
//   멈추고 돌던 명령은 끝까지 돌아, 그 update가 턴 밖에서 늦게 온다(실측 A2). 늦은 update는 그 줄에 붙는다.
// - 턴 끝 바로 앞에서 `failed`로 닫힌 도구 줄은 **멈춤**(`stopped`)이다 — Claude interrupt는 돌던 도구까지 멈추고, 열린
//   `tool_use`마다 `is_error` `tool_result`(변환기가 옮기면 `failed` update)를 낸 뒤 `result`를 낸다(워크플로 실측 2.1.282).
//   「바로 앞」은 그 `failed` 뒤로 답 · 생각 조각이나 새 도구 호출이 없었다는 뜻이다 — 턴 앞쪽에서 실패하고 에이전트가 이어
//   간 도구(명령 실패)는 멈춤이 아니다.
// - 권한을 기다리다 멈추기로 요청이 거둬진(`permission` `withdrawn` · `stopped`, 티켓 08) 도구 줄도 **멈춤**이다 — 돌지 않았다.
//   codex-acp는 그 도구를 `in_progress`로 두고 닫는 update를 보내지 않는다(실측 G2 cancel).
//
// 모르는 줄은 버리지 않고 지나간다 — 기록은 원문 그대로라(워크플로 S34) 스키마에 없는 `sessionUpdate`도 오고, 그것이 화면을
// 멈추면 안 된다.

/** 턴이 끝난 모양 — `turn-end` 줄, 또는 그 줄 없이 에이전트가 사라진 것(죽음 · 닫힘). */
export interface TurnEnd {
  /** 에이전트가 준 끝 까닭(`end_turn` · `cancelled` · `max_tokens` …). 말을 받지 않았거나 사라졌으면 null이다. */
  stopReason: string | null;
  /** 말을 보낸 때부터 끝날 때까지. */
  durationMs: number;
  /** 우리가 멈췄나 — `cancelled`가 사람의 멈춤인지 엔진의 거부인지를 가른다(S24). */
  cancelledByUs: boolean;
  /** 말을 받지 않은 오류나 사라진 까닭. */
  error: string | null;
}

/** 턴 안의 한 줄. 같은 메시지의 조각들은 한 줄로 이어 붙는다. */
export type Entry =
  | { kind: "message"; key: string; messageId: string | null; text: string }
  | { kind: "thought"; key: string; messageId: string | null; text: string }
  /** 도구 호출 — 처음 온 `tool_call`에 뒤의 `tool_call_update`를 덮어 합친 값. 문구 · diff는 18이 그린다. */
  | ToolEntry;

/**
 * 우리가 멈춘 턴에서 그 도구 줄이 어떻게 됐나(three-axes 티켓 20) — `ran-on`은 멈춘 뒤에도 돈다(돌았다), `stopped`는 멈춤과 함께
 * 닫혔다. 멈춘 턴의 줄이 아니면 null이다.
 */
export type ToolStop = "ran-on" | "stopped";

export interface ToolEntry {
  kind: "tool";
  key: string;
  toolCallId: string;
  call: Record<string, unknown>;
  /**
   * 명령이 낸 출력 — update마다 조각(`_meta.terminal_output_delta.data`, codex-acp)으로 오는 것을 이어 붙인 것. 합친 `call`에서는
   * 뒤의 `_meta`가 앞의 것을 덮어 조각이 사라지므로 따로 모은다. 멈춘 뒤 늦게 온 조각도 여기 붙는다(결정 28).
   */
  output: string;
  stop: ToolStop | null;
}

export interface Turn {
  /** 턴의 정체 — 접고 펴기를 기억하는 열쇠다. 보낸 말의 seq에서 나온다. */
  key: string;
  /** 사람이 보낸 말의 화면 글(기록의 `sent`). 머리말 · 인용 블록은 기록에만 있다. 턴 밖 update로 시작한 턴은 null이다. */
  sent: string | null;
  /**
   * 에이전트가 스스로 이어 간 턴인가(S4) — 보낸 말 없이 턴 밖 update로 시작했거나 턴 밖 끝(`outOfTurn`)만 온 턴이다. 머리줄에
   * 「스스로 이어 감」 표지가 선다(three-axes 티켓 20).
   */
  selfContinued: boolean;
  /** 그 말에 붙은 인용(기록의 `sent`) — 보낸 말 위에 선다(three-axes 티켓 27). 인용 없이 보냈으면 null이다. */
  quote: Quote | null;
  startedAt: string;
  entries: Entry[];
  /** 끝났으면 그 모양, 도는 중이면 null. */
  end: TurnEnd | null;
  /**
   * 이 턴의 고친 곳 — 호스트가 턴 끝에 적은 `changes` 줄의 파일들(three-axes 결정 22). 바뀐 것이 없었거나 아직 도는 턴이면 null이다.
   * 입력창 위 알약이 그 대화의 마지막 턴의 이것을 센다(티켓 26).
   */
  changes: ChangedFile[] | null;
}

export interface ChatModel {
  turns: Turn[];
  /** 마지막 턴이 도는 중인가. */
  running: boolean;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function foldConversation(lines: readonly RecordLine[]): ChatModel {
  const turns: Turn[] = [];
  let open: Turn | null = null;
  // 도는 턴에서 `failed`로 닫힌 뒤 아무 일도 이어지지 않은 도구 줄들 — 그 턴이 우리의 멈춤으로 끝나면 멈춤이다(머리말).
  let closedLast: ToolEntry[] = [];
  // 권한 요청 id → 그 요청의 도구 줄 id, 그리고 멈추기로 요청이 거둬진 도구 줄 id들(머리말).
  const askedFor = new Map<string, string>();
  const withdrawnByStop = new Set<string>();
  const start = (key: string, sent: string | null, at: string, quote: Quote | null = null): Turn => {
    const turn: Turn = { key, sent, selfContinued: sent === null, quote, startedAt: at, entries: [], end: null, changes: null };
    turns.push(turn);
    closedLast = [];
    return turn;
  };

  for (const line of lines) {
    const payload = isObject(line.payload) ? line.payload : {};
    switch (line.kind) {
      case "sent":
        open = start(`t${line.seq}`, text(payload.text) ?? "", line.at, quoteOf(payload.quote));
        break;
      case "update": {
        const update = isObject(payload.update) ? payload.update : null;
        const kind = update && text(update.sessionUpdate);
        if (!update || !kind) break;
        if (kind === "tool_call_update") {
          // 늦게 온 update는 그 도구 줄을 찾아 붙는다(three-axes 결정 28) — 턴이 이미 끝났어도 같다.
          const id = text(update.toolCallId);
          let tool = id ? findTool(turns, id) : null;
          if (tool) tool.call = { ...tool.call, ...update };
          else if (id && open) {
            tool = { kind: "tool", key: `u${line.seq}`, toolCallId: id, call: update, output: "", stop: null };
            open.entries.push(tool);
          }
          if (!tool) break;
          tool.output += outputOf(update);
          if (open && update.status === "failed" && open.entries.includes(tool)) closedLast.push(tool);
          break;
        }
        if (kind !== "agent_message_chunk" && kind !== "agent_thought_chunk" && kind !== "tool_call") break;
        // 보낸 말 없이 온 update는 에이전트가 스스로 이어 간 턴이다(S4) — 턴 하나를 연다.
        const turn: Turn = open ?? (open = start(`o${line.seq}`, null, line.at));
        closedLast = [];
        if (kind === "tool_call") {
          const id = text(update.toolCallId) ?? `seq-${line.seq}`;
          turn.entries.push({ kind: "tool", key: `c${line.seq}`, toolCallId: id, call: update, output: outputOf(update), stop: null });
          break;
        }
        const content = isObject(update.content) ? update.content : {};
        const chunk = content.type === "text" ? text(content.text) : null;
        if (chunk === null) break;
        appendChunk(turn, kind === "agent_message_chunk" ? "message" : "thought", text(update.messageId), chunk, line.seq);
        break;
      }
      case "changes": {
        // `turn-end` 바로 앞에 선다 — 그 턴의 것이다. 턴 없이 오면(있을 수 없는 순서) 마지막 턴에 붙인다.
        const turn = open ?? turns[turns.length - 1];
        if (turn) turn.changes = [...(turn.changes ?? []), ...changedFiles(line.payload)];
        break;
      }
      case "turn-end": {
        // 턴 밖 끝만 오고 그 턴의 줄이 하나도 없었다(조각 없이 끝난 스스로 이어 간 턴) — 그래도 턴이 돌았으니 머리줄은 선다.
        if (!open && payload.outOfTurn === true) open = start(`o${line.seq}`, null, line.at);
        if (!open) break;
        const error = isObject(payload.error) ? text(payload.error.message) : null;
        open.end = {
          stopReason: text(payload.stopReason),
          durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
          cancelledByUs: payload.cancelledByUs === true,
          error,
        };
        if (open.end.stopReason === "cancelled" && open.end.cancelledByUs) markStopped(open, closedLast, withdrawnByStop);
        if (payload.outOfTurn === true) open.selfContinued = true;
        open = null;
        closedLast = [];
        break;
      }
      case "permission": {
        // 권한 줄은 승인 카드(21)가 그린다. 여기서는 멈추기로 거둬진 요청의 도구 줄만 기억한다 — 그 줄은 멈춤이다(머리말).
        const requestId = text(payload.requestId);
        if (!requestId) break;
        if (payload.state === "asked") {
          const id = askedToolId(payload);
          if (id) askedFor.set(requestId, id);
        } else if (payload.state === "withdrawn" && payload.reason === "stopped") {
          const id = askedFor.get(requestId);
          if (!id) break;
          withdrawnByStop.add(id);
          // 거둬짐이 멈춘 턴의 끝보다 늦게 와도 같다.
          const tool = findTool(turns, id);
          if (tool?.stop === "ran-on") tool.stop = "stopped";
        }
        break;
      }
      case "session": {
        // 답 없이 사라진 턴에는 턴 끝 줄이 없다 — 죽음 · 닫힘 줄이 그 자리를 맡는다(호스트가 그 턴을 쉬는 것으로 돌린다).
        if (!open || (payload.state !== "died" && payload.state !== "closed")) break;
        open.end = {
          stopReason: null,
          durationMs: Math.max(0, Date.parse(line.at) - Date.parse(open.startedAt)) || 0,
          cancelledByUs: false,
          error: text(payload.reason) ?? (payload.state === "closed" ? "대화가 닫혔어요" : "에이전트가 끝났어요"),
        };
        open = null;
        break;
      }
      default:
        break;
    }
  }
  return { turns, running: open !== null };
}

/** `sent`의 인용 — 모양이 어긋나면(기록은 원문이라 무엇이든 올 수 있다) 없는 것으로 읽는다. */
function quoteOf(value: unknown): Quote | null {
  if (!isObject(value)) return null;
  const { file, start, end, text: quoted } = value;
  if (typeof file !== "string" || typeof start !== "number" || typeof end !== "number" || typeof quoted !== "string") return null;
  return { file, start, end, text: quoted };
}

/** 도구 줄이 끝났나 — ACP 도구 상태 넷 가운데 `completed` · `failed`가 끝이다. 상태가 없으면 `pending`이다. */
export const toolDone = (tool: ToolEntry): boolean => tool.call.status === "completed" || tool.call.status === "failed";

/** update가 실어 온 명령 출력 조각(`_meta.terminal_output_delta.data`). 없으면 빈 글이다. */
function outputOf(update: Json): string {
  const meta = isObject(update._meta) ? update._meta : null;
  const delta = meta && isObject(meta.terminal_output_delta) ? meta.terminal_output_delta : null;
  return (delta && text(delta.data)) ?? "";
}

/**
 * 우리가 멈춘 턴의 도구 줄을 가른다(머리말) — 끝나지 않은 줄은 멈춘 뒤에도 돌고, 끝 바로 앞에서 실패로 닫힌 줄과 권한 요청이
 * 거둬진 줄은 멈춤이다.
 */
function markStopped(turn: Turn, closedLast: readonly ToolEntry[], withdrawn: ReadonlySet<string>): void {
  for (const entry of turn.entries) {
    if (entry.kind !== "tool") continue;
    if (!toolDone(entry)) entry.stop = withdrawn.has(entry.toolCallId) ? "stopped" : "ran-on";
    else if (closedLast.includes(entry)) entry.stop = "stopped";
  }
}

/** 권한 물음의 도구 줄 id — 호스트가 채운 도구 요지(`toolCall`), 없으면 요청 원문의 `toolCall`에서. */
function askedToolId(payload: Json): string | null {
  const summary = isObject(payload.toolCall) ? text(payload.toolCall.toolCallId) : null;
  if (summary) return summary;
  const request = isObject(payload.request) ? payload.request : null;
  return request && isObject(request.toolCall) ? text(request.toolCall.toolCallId) : null;
}

function findTool(turns: readonly Turn[], id: string): ToolEntry | null {
  for (let t = turns.length - 1; t >= 0; t -= 1) {
    for (const entry of turns[t].entries) {
      if (entry.kind === "tool" && entry.toolCallId === id) return entry;
    }
  }
  return null;
}

/** 조각을 이어 붙인다 — 바로 앞 줄이 같은 갈래 · 같은 메시지면 그 줄에, 아니면 새 줄로. */
function appendChunk(turn: Turn, kind: "message" | "thought", messageId: string | null, chunk: string, seq: number): void {
  const last = turn.entries[turn.entries.length - 1];
  if (last && last.kind === kind && last.messageId === messageId) {
    last.text += chunk;
    return;
  }
  turn.entries.push({ kind, key: `${kind === "message" ? "m" : "r"}${seq}`, messageId, text: chunk });
}

/**
 * 턴 끝 메시지가 시작하는 자리 — **마지막 도구 호출 뒤의 답**(워크플로 S12)이다. 접힌 턴은 이 자리부터의 메시지만 펼쳐 두고,
 * 생각과 도구 줄과 그 앞의 메시지는 머리줄 아래로 접는다.
 */
export function finalFrom(turn: Turn): number {
  let lastTool = -1;
  turn.entries.forEach((entry, index) => {
    if (entry.kind === "tool") lastTool = index;
  });
  return lastTool + 1;
}

/** 접힌 턴에도 펼쳐 두는 줄들 — 턴 끝 메시지. */
export function finalMessages(turn: Turn): Entry[] {
  return turn.entries.slice(finalFrom(turn)).filter((entry) => entry.kind === "message");
}

/** 걸린 시간 — 「8초」 · 「3분 41초」 · 「1시간 5분」. 1초보다 짧아도 1초로 말한다(「0초 동안」은 말이 안 된다). */
export function spoken(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}분` : `${minutes}분 ${seconds % 60}초`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`;
}

/** 끝 까닭 중 사람에게 말로 옮길 것들 — 그 밖은 엔진이 준 글자 그대로 보인다. */
const STOPPED: Record<string, string> = {
  max_tokens: "답이 길이 한도에 닿아 멈췄어요",
  max_turn_requests: "한 턴의 요청 한도에 닿아 멈췄어요",
  refusal: "에이전트가 거절해서 멈췄어요",
};

/**
 * 턴 머리줄(S24). `end_turn`이면 「N초 동안 작업함」, 우리가 멈춘 `cancelled`면 「N초 후에 중단했습니다」, 우리가 멈추지 않은
 * `cancelled`(Codex 거부)면 「거부해서 멈췄어요」, 그 밖은 까닭을 보인다.
 */
export function headline(end: TurnEnd): string {
  const took = spoken(end.durationMs);
  if (end.stopReason === "end_turn") return `${took} 동안 작업함`;
  if (end.stopReason === "cancelled") return end.cancelledByUs ? `${took} 후에 중단했습니다` : "거부해서 멈췄어요";
  if (end.stopReason !== null) return STOPPED[end.stopReason] ?? `멈췄어요 — ${end.stopReason}`;
  return end.error ? `멈췄어요 — ${end.error}` : "멈췄어요";
}

/** 도는 턴의 머리줄 — 보낸 때부터 지금까지. */
export function runningHeadline(turn: Turn, now: number): string {
  return `${spoken(now - Date.parse(turn.startedAt))} 동안 작업 중입니다`;
}

import { changedFiles, type ChangedFile } from "./changes";
import type { Quote, RecordLine } from "./types";

// 대화 접기(three-axes 티켓 17) — 기록 줄을 받아 화면 모델(턴 · 메시지 · 생각 · 머리줄 · 도는가)로 접는 **순수 함수**다.
// 대화창은 대화를 이것 하나로 그린다: 처음 그릴 때 읽은 기록도, 흐르는 기록 줄 이벤트도 같은 줄이라(구현 스펙 「기록」) 이
// 함수는 어디서 온 줄인지 모른다.
//
// **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16). Codex의 줄도 Claude 변환기가 옮긴 줄도 `session/update`의
// `sessionUpdate` 갈래로만 읽는다 — 엔진마다 다른 것은 칩의 목록뿐이다. 뒤의 화면 장들이 여기에 갈래를 더한다: 대기와 멈춤(20),
// 승인 · 계획 카드(21), 상태 · 상태 줄(23 — 아래 「상태」). 도구 줄의 문구 · 출력 · diff · MCP(18)는 접은 도구 호출을 `tool-view.ts`가 읽는다.
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
// **스스로 이어 간 턴**(S4, three-axes 티켓 16)은 보낸 말 없이 시작 표지(`session_info_update`의 `_meta.atelier.outOfTurn`)나 턴 밖
// update로 열리고 턴 밖 끝(`turn-end{outOfTurn: true}`)으로 닫힌다.
//
// **상태와 상태 줄**(three-axes 티켓 23 · S23)도 기록에서 나온다. `session` 줄이 띄우는 중이면 이어 붙이는 중(`connecting`)이고 열림 ·
// 죽음 · 닫힘 · 로그인 필요가 오면 걷힌다. 되살리기가 새 세션으로 끝난 열림(`how: fresh`) · 프로세스 죽음 · 판 경고는 흐름 안의 한
// 줄(`notices`)이다. 앱을 다시 켜면 그 기록을 적던 프로세스가 없다 — 앱을 끄면 턴 끝도 죽음 줄도 없이 끝나므로, 대화 목록이 「떠
// 있지 않다」고 말한 대화(`goneThrough`)는 그 seq까지 열린 채 남은 턴과 물음을 끝난 것으로 접는다.
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
  /** 도구 호출 — 처음 온 `tool_call`에 뒤의 `tool_call_update`를 덮어 합친 값. 문구 · 안의 것은 `tool-view.ts`가 짓는다(티켓 18). */
  | ToolEntry
  | PlanEntry
  | ChecklistEntry;

/**
 * 계획 카드(three-axes 티켓 21 · 결정 29) — Codex `plan_update`(markdown)의 글, 또는 계획 승인 요청(kind `switch_mode`)의 계획
 * 본문(`rawInput.plan` — Claude 변환기가 `ExitPlanMode`를 같은 모양으로 옮긴다). **대화에 하나다**: 다음 계획이 오면 같은 카드가
 * 새 계획으로 바뀐다(스토리 65) — `plan_update`는 올 때마다 전문이다(실측 A2). 같은 턴이면 그 자리에서 글만 바뀌고, 고쳐 온 계획이
 * 다음 턴에 오면 카드가 그 턴으로 옮겨 간다.
 */
export interface PlanEntry {
  kind: "plan";
  key: string;
  text: string;
}

/** 계획 체크리스트의 항목 하나 — ACP `PlanEntry`(`status`는 `pending` · `in_progress` · `completed`). */
export interface ChecklistItem {
  content: string;
  status: string;
}

/**
 * 계획 체크리스트(three-axes 결정 29) — ACP `plan`의 항목들. **엔진이 보낼 때만 선다**(스토리 67): 두 엔진 모두 저절로 보내지
 * 않으니(실측 A2 · A6) 빈 칸을 미리 세우지 않는다. ACP `plan`은 올 때마다 목록 전체라 계획 카드처럼 대화에 하나이고 같은 칸이
 * 바뀐다. 빈 목록이 오면 걷힌다.
 */
export interface ChecklistEntry {
  kind: "checklist";
  key: string;
  items: ChecklistItem[];
}

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
  /**
   * 그 줄을 적던 에이전트가 끝을 알리기 전에 사라졌나(죽음 · 닫힘 · 앱을 다시 켬) — 프로세스 그룹과 함께 도구도 끝나 더 올 update가
   * 없다(three-axes 결정 19). 그런 줄은 도는 것으로 보이지 않는다: 진행형 문구 · 스피너 · 「명령은 끝까지 돌아요」가 걷힌다.
   */
  cut: boolean;
}

export interface Turn {
  /** 턴의 정체 — 접고 펴기를 기억하는 열쇠다. 보낸 말의 seq에서 나온다. */
  key: string;
  /** 사람이 보낸 말의 화면 글(기록의 `sent`). 머리말 · 인용 블록은 기록에만 있다. 턴 밖 update로 시작한 턴은 null이다. */
  sent: string | null;
  /**
   * 에이전트가 스스로 이어 간 턴인가(S4) — 보낸 말 없이 시작 표지나 턴 밖 update로 시작했거나 턴 밖 끝(`outOfTurn`)만 온 턴이다. 머리줄에
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
  /** 에이전트를 띄우거나 되살리는 중인가 — 띄우는 중 줄 뒤로 열림 · 죽음 · 닫힘 · 로그인 필요가 아직 오지 않았다(S23 「이어 붙이는 중」). */
  connecting: boolean;
  /** 흐름 안의 상태 줄들 — 온 차례대로(three-axes 티켓 23). */
  notices: Notice[];
  /**
   * 답하지 않은 권한 요청 — 물은 차례다(three-axes 티켓 21). 맨 앞의 것이 입력창 자리에 승인 카드(계획 승인이면 「이 계획대로
   * 할까요?」)로 선다. 같은 `requestId`의 답(`answered`)이나 거둬짐(`withdrawn`)이 적히면, 또는 에이전트가 사라지면(죽음 ·
   * 닫힘 — 걸린 요청에 답할 곳이 없다) 빠진다.
   */
  pending: PendingPermission[];
}

/**
 * 흐름 안의 상태 줄 하나(three-axes 티켓 23) — 되살리기가 새 세션으로 끝남(`fresh`, 스토리 86) · 프로세스 죽음(`died`, 까닭과 함께 —
 * 스토리 88) · 판 경고(`version`, S6). 턴에 들지 않고 턴 사이에 선다.
 */
export interface Notice {
  key: string;
  kind: "fresh" | "died" | "version";
  text: string;
  /** 이 줄보다 먼저 선 턴의 수 — 흐름에서 그 턴들 뒤, 다음 턴 앞에 선다. */
  after: number;
}

/** 권한 요청의 선택지 하나 — 엔진이 준 그대로(ACP `PermissionOption`). */
export interface PermissionOption {
  optionId: string;
  name: string;
  /** `allow_once` · `allow_always` · `reject_once` · `reject_always`. */
  kind: string;
}

/** 답하지 않은 권한 요청 하나(기록의 `permission` `asked`). */
export interface PendingPermission {
  /** 권한 답 명령이 싣는 요청 id. */
  requestId: string;
  /** 엔진이 준 선택지 그대로 — 차례도 그대로다(스토리 59). */
  options: PermissionOption[];
  /** 호스트가 채운 도구 요지(`toolCall`) — 없으면 요청 원문의 `toolCall`이다. */
  toolCall: Record<string, unknown>;
  /** 그 요청의 도구 줄 — 흐름에 있으면(물음보다 먼저 온 `tool_call`) 그것이다. 명령 · 경로를 그 줄의 원문에서 읽는다. */
  tool: ToolEntry | null;
  /** 계획 승인 요청인가 — ACP 도구 kind `switch_mode`(「Implement this plan?」, three-axes 결정 29). */
  planReview: boolean;
}

type Json = Record<string, unknown>;

/** 턴 안의 줄이 되는 `session/update` 갈래 — 답 · 생각 조각, 도구 호출, 계획(markdown) · 체크리스트(three-axes 티켓 21). */
const TURN_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "plan_update", "plan"]);

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * 기록 줄을 화면 모델로 접는다. `goneThrough`는 대화 목록이 「에이전트가 이 앱에 떠 있지 않다」고 말할 때의 마지막 seq다(티켓 23) —
 * 그 seq까지의 줄을 적던 프로세스는 이미 없다(앱을 다시 켬). 그 뒤의 줄(되살린 뒤)은 여느 때처럼 접는다. 떠 있으면 `null`이다.
 */
export function foldConversation(lines: readonly RecordLine[], goneThrough: number | null = null): ChatModel {
  const turns: Turn[] = [];
  let open: Turn | null = null;
  // 도는 턴에서 `failed`로 닫힌 뒤 아무 일도 이어지지 않은 도구 줄들 — 그 턴이 우리의 멈춤으로 끝나면 멈춤이다(머리말).
  let closedLast: ToolEntry[] = [];
  // 권한 요청 id → 그 요청의 도구 줄 id, 그리고 멈추기로 요청이 거둬진 도구 줄 id들(머리말).
  const askedFor = new Map<string, string>();
  const withdrawnByStop = new Set<string>();
  // 답하지 않은 권한 요청 — 물은 차례로 든다(Map은 넣은 차례를 지킨다).
  const pending = new Map<string, Omit<PendingPermission, "tool">>();
  // 대화에 하나뿐인 계획 카드와 체크리스트 — 어느 턴의 어느 줄인가(머리말 `PlanEntry`).
  let planCard: Held<PlanEntry> | null = null;
  let checklist: Held<ChecklistEntry> | null = null;
  // 계획 승인 요청의 도구 id들 — 그 「도구」는 계획 카드와 「이 계획대로 할까요?」 카드가 맡으므로 도구 줄로 세우지 않는다. codex-acp는
  // 답한 뒤 그 id(`plan-review:…`)로 `completed` update 하나만 보내고(실측 A2), Claude 변환기는 `ExitPlanMode` 도구 호출을 먼저 낸다.
  const planReviews = new Set<string>();
  const start = (key: string, sent: string | null, at: string, quote: Quote | null = null): Turn => {
    const turn: Turn = { key, sent, selfContinued: sent === null, quote, startedAt: at, entries: [], end: null, changes: null };
    turns.push(turn);
    closedLast = [];
    return turn;
  };
  // 띄우는 중인가와 상태 줄(three-axes 티켓 23 — 머리말 「상태」).
  let connecting = false;
  const notices: Notice[] = [];
  const notice = (seq: number, kind: Notice["kind"], words: string) =>
    notices.push({ key: `n${seq}`, kind, text: words, after: turns.length });
  // 그 프로세스가 사라졌다 — 열린 턴은 끝났고(답 없이), 걸린 권한 요청에는 답할 곳이 없고, 띄우던 것도 끝났고, 끝을 받지 못한
  // 도구 줄(멈춘 뒤에도 돌던 줄 포함)은 끊겼다.
  const vanish = (at: string, error: string) => {
    pending.clear();
    connecting = false;
    for (const turn of turns) {
      for (const entry of turn.entries) if (entry.kind === "tool" && !toolDone(entry)) entry.cut = true;
    }
    if (!open) return;
    open.end = {
      stopReason: null,
      durationMs: Math.max(0, Date.parse(at) - Date.parse(open.startedAt)) || 0,
      cancelledByUs: false,
      error,
    };
    open = null;
  };
  // 앱을 다시 켜기 전의 줄이 끝났나 — `goneThrough`가 있을 때 그 seq 뒤의 첫 줄(또는 기록 끝)에서 한 번 접는다.
  let gone = goneThrough === null;
  let lastAt = "";

  for (const line of lines) {
    if (!gone && line.seq > (goneThrough ?? 0)) {
      vanish(lastAt || line.at, GONE_WITH_APP);
      gone = true;
    }
    lastAt = line.at;
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
          if (id && planReviews.has(id)) break;
          let tool = id ? findTool(turns, id) : null;
          if (tool) tool.call = mergeCall(tool.call, update);
          else if (id && open) {
            tool = { kind: "tool", key: `u${line.seq}`, toolCallId: id, call: update, output: "", stop: null, cut: false };
            open.entries.push(tool);
          }
          if (!tool) break;
          tool.output += outputOf(update);
          if (open && update.status === "failed" && open.entries.includes(tool)) closedLast.push(tool);
          break;
        }
        if (kind === "session_info_update" && outOfTurnStarted(update)) {
          // 스스로 이어 간 턴의 시작 표지(S4, three-axes 티켓 16) — 첫 조각 전부터 턴이 돈다(「일하는 중」 · 멈추기 · 닫기 확인).
          // 호스트의 종료 셈도 이때부터 그 턴을 센다.
          if (!open) open = start(`o${line.seq}`, null, line.at);
          break;
        }
        if (!TURN_UPDATES.has(kind)) break;
        if (kind === "tool_call" && planReviews.has(text(update.toolCallId) ?? "")) break;
        // 보낸 말 없이 온 update는 에이전트가 스스로 이어 간 턴이다(S4) — 턴 하나를 연다.
        const turn: Turn = open ?? (open = start(`o${line.seq}`, null, line.at));
        closedLast = [];
        if (kind === "plan_update") {
          // 계획(markdown) — 대화의 계획 카드가 이 글로 바뀐다(머리말 `PlanEntry`). 마크다운이 아닌 계획 모양은 아직 없다.
          const body = isObject(update.plan) && update.plan.type === "markdown" ? text(update.plan.content) : null;
          if (body === null) break;
          planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), null);
          planCard.entry.text = body;
          break;
        }
        if (kind === "plan") {
          // 체크리스트(ACP `plan`) — 올 때마다 목록 전체다. 빈 목록이면 걷힌다.
          const items = checklistOf(update.entries);
          if (items.length === 0) {
            if (checklist) drop(checklist.turn, checklist.entry);
            checklist = null;
            break;
          }
          checklist = settle(checklist, turn, () => ({ kind: "checklist", key: `k${line.seq}`, items }), null);
          checklist.entry.items = items;
          break;
        }
        if (kind === "tool_call") {
          const id = text(update.toolCallId) ?? `seq-${line.seq}`;
          turn.entries.push({
            kind: "tool",
            key: `c${line.seq}`,
            toolCallId: id,
            call: update,
            output: outputOf(update),
            stop: null,
            cut: false,
          });
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
        // 뒤따르는 답 · 거둬짐이 없는 물음이 답할 요청이다 — 입력창 자리의 승인 카드(three-axes 티켓 21). 멈추기로 거둬진 요청의
        // 도구 줄은 따로 기억한다 — 그 줄은 멈춤이다(머리말).
        const requestId = text(payload.requestId);
        if (!requestId) break;
        if (payload.state === "asked") {
          const id = askedToolId(payload);
          if (id) askedFor.set(requestId, id);
          const request = askedOf(requestId, payload);
          pending.set(requestId, request);
          // 계획 승인 요청 — 그 계획 본문이 계획 카드가 된다(Claude는 `plan_update` 없이 여기서 처음 온다). 앞서 그 id로 선 도구 줄
          // (Claude `ExitPlanMode`)은 계획 카드가 그 자리를 맡는다.
          if (request.planReview && id) {
            planReviews.add(id);
            const home = toolHome(turns, id);
            const turn = home?.turn ?? open ?? turns[turns.length - 1];
            const rawInput = isObject(request.toolCall.rawInput) ? request.toolCall.rawInput : {};
            const body = text(rawInput.plan);
            if (turn && body !== null) {
              planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), home?.tool ?? null);
              planCard.entry.text = body;
            } else if (home) drop(home.turn, home.tool);
          }
          break;
        }
        // 답 · 거둬짐 — 그 요청은 닫혔다. 카드가 걷힌다.
        pending.delete(requestId);
        if (payload.state === "withdrawn" && payload.reason === "stopped") {
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
        switch (payload.state) {
          case "spawning":
            // 띄우는 중 — 새 대화와 되살리기가 이 줄로 시작한다(티켓 10). 열림 · 죽음 · 닫힘 · 로그인 필요가 걷는다.
            connecting = true;
            break;
          case "opened":
            connecting = false;
            // 되살리려 했지만 맥락을 잇지 못해 새 세션으로 열렸다 — 에이전트가 기억한다고 잘못 믿지 않게 한 줄 선다(스토리 86).
            if (payload.how === "fresh") notice(line.seq, "fresh", FRESH_NOTICE);
            break;
          case "login-required":
            connecting = false;
            break;
          case "version-warning":
            notice(line.seq, "version", versionNotice(text(payload.agentVersion), payload.supportedMajor));
            break;
          case "died":
          case "closed":
            // 에이전트가 사라졌다 — 걸린 권한 요청에는 답할 곳이 없으니 카드가 걷힌다. 답 없이 사라진 턴에는 턴 끝 줄이 없다 —
            // 죽음 · 닫힘 줄이 그 자리를 맡는다(호스트가 그 턴을 쉬는 것으로 돌린다). 죽음의 까닭은 턴 머리줄이 아니라 그 뒤의
            // 상태 줄이 말한다(스토리 88).
            vanish(line.at, payload.state === "closed" ? "대화가 닫혔어요" : "에이전트가 끝났어요");
            if (payload.state === "died") notice(line.seq, "died", diedNotice(text(payload.reason)));
            break;
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
  }
  if (!gone) vanish(lastAt, GONE_WITH_APP);
  return {
    turns,
    running: open !== null,
    connecting,
    notices,
    // 도구 줄은 접기가 끝난 뒤에 찾는다 — 물음보다 늦게 온 update까지 합친 값이다.
    pending: [...pending.values()].map((one) => {
      const id = text(one.toolCall.toolCallId);
      return { ...one, tool: id ? findTool(turns, id) : null };
    }),
  };
}

/** 앱을 다시 켜기 전에 끊긴 턴의 끝 까닭 — 앱이 꺼지면 에이전트도 함께 꺼진다(three-axes 결정 19). */
const GONE_WITH_APP = "앱이 꺼지며 끊겼어요";

/** 「새로 시작함」 상태 줄(스토리 86). */
const FRESH_NOTICE = "새로 시작함 — 앞의 맥락을 잇지 못해 새 세션으로 열었어요";

/** 프로세스 죽음의 상태 줄 — 호스트가 적은 까닭(「에이전트 프로세스가 끝났습니다 (종료 코드 N)」)과 다음에 일어날 일(스토리 88). */
function diedNotice(reason: string | null): string {
  return `${reason ?? "에이전트가 끝났어요"} · 다음 말에서 다시 띄워요`;
}

/** 판 경고의 상태 줄(S6) — 잰 적 없는 메이저 판이라도 대화는 그대로 연다. */
function versionNotice(version: string | null, major: unknown): string {
  const supported = typeof major === "number" ? ` — 확인한 판은 ${major}.x` : "";
  return `확인하지 않은 에이전트 판이에요(${version ?? "판 모름"}${supported}). 그대로 이어 가요`;
}

/**
 * 같은 기록 줄을 한 번만 접는다(three-axes 티켓 23) — 대화 몸(흐름 · 입력창) · 대화 탭의 상태 점 · 레일 `chat`의 점이 같은 줄을 읽는다.
 * 기록 줄 배열은 바뀔 때마다 새 배열이라(`chat-store.ts`) 그 정체가 열쇠다. 접은 값은 읽기만 한다.
 */
const folded = new WeakMap<readonly RecordLine[], { goneThrough: number | null; model: ChatModel }>();
export function foldOf(lines: readonly RecordLine[], goneThrough: number | null): ChatModel {
  const hit = folded.get(lines);
  if (hit && hit.goneThrough === goneThrough) return hit.model;
  const model = foldConversation(lines, goneThrough);
  folded.set(lines, { goneThrough, model });
  return model;
}

/**
 * 에이전트가 스스로 이어 간 턴의 시작 표지인가 — 변환기가 걸린 말 없이 시작한 턴을 `session_info_update`의
 * `_meta.atelier.outOfTurn.state: "started"`로 알린다(three-axes 티켓 16). 끝 표지는 update가 아니라 턴 밖 `turn-end`로 온다.
 */
function outOfTurnStarted(update: Json): boolean {
  const meta = isObject(update._meta) ? update._meta : null;
  const atelier = meta && isObject(meta.atelier) ? meta.atelier : null;
  const mark = atelier && isObject(atelier.outOfTurn) ? atelier.outOfTurn : null;
  return mark?.state === "started";
}

/** 권한 물음 줄을 답할 요청으로 — 선택지는 요청 원문 그대로, 도구 요지는 호스트가 채운 것(없으면 요청 원문의 것)이다. */
function askedOf(requestId: string, payload: Json): Omit<PendingPermission, "tool"> {
  const request = isObject(payload.request) ? payload.request : {};
  const toolCall = isObject(payload.toolCall) ? payload.toolCall : isObject(request.toolCall) ? request.toolCall : {};
  const options = (Array.isArray(request.options) ? request.options : []).filter(isObject).flatMap((option) => {
    const optionId = text(option.optionId);
    return optionId === null ? [] : [{ optionId, name: text(option.name) ?? optionId, kind: text(option.kind) ?? "" }];
  });
  return { requestId, options, toolCall, planReview: toolCall.kind === "switch_mode" };
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

/**
 * 도구 호출에 update를 덮어 합친다 — 칸은 뒤의 것이 이기고, `_meta`만 한 겹 안쪽까지 합친다(three-axes 티켓 18). update의 `_meta`가
 * 앞의 것을 통째로 덮으면 앞서 온 표지가 사라진다: codex-acp의 MCP 표지(`is_mcp_tool_call`)는 시작에만 오고, 종료 코드
 * (`terminal_exit`)는 출력 조각과 다른 update로 온다(실측 A2).
 */
function mergeCall(call: Json, update: Json): Json {
  const merged = { ...call, ...update };
  if (isObject(call._meta) && isObject(update._meta)) merged._meta = { ...call._meta, ...update._meta };
  return merged;
}

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

/** 대화에 하나뿐인 카드(계획 · 체크리스트)가 선 자리. */
interface Held<T extends Entry> {
  turn: Turn;
  entry: T;
}

/**
 * 대화에 하나뿐인 카드를 그 턴에 둔다 — 이미 그 턴에 있으면 그대로(글은 부르는 쪽이 바꾼다), 다른 턴에 있으면 거기서 빼고 이 턴에
 * 새로 넣는다. `replacing`(그 카드가 맡는 도구 줄)이 있으면 그 줄의 자리에 선다.
 */
function settle<T extends Entry>(held: Held<T> | null, turn: Turn, fresh: () => T, replacing: ToolEntry | null): Held<T> {
  if (held && held.turn === turn) {
    if (replacing) drop(turn, replacing);
    return held;
  }
  if (held) drop(held.turn, held.entry);
  const entry = fresh();
  const at = replacing ? turn.entries.indexOf(replacing) : -1;
  if (at >= 0) turn.entries.splice(at, 1, entry);
  else turn.entries.push(entry);
  return { turn, entry };
}

function drop(turn: Turn, entry: Entry): void {
  const at = turn.entries.indexOf(entry);
  if (at >= 0) turn.entries.splice(at, 1);
}

/** ACP `plan`의 항목들 — 글이 없는 항목은 버린다. */
function checklistOf(entries: unknown): ChecklistItem[] {
  return (Array.isArray(entries) ? entries : []).filter(isObject).flatMap((entry) => {
    const content = text(entry.content);
    return content === null || content.trim() === "" ? [] : [{ content, status: text(entry.status) ?? "pending" }];
  });
}

/** 그 id의 도구 줄과 그 줄이 든 턴. */
function toolHome(turns: readonly Turn[], id: string): { turn: Turn; tool: ToolEntry } | null {
  for (let t = turns.length - 1; t >= 0; t -= 1) {
    for (const entry of turns[t].entries) {
      if (entry.kind === "tool" && entry.toolCallId === id) return { turn: turns[t], tool: entry };
    }
  }
  return null;
}

function findTool(turns: readonly Turn[], id: string): ToolEntry | null {
  return toolHome(turns, id)?.tool ?? null;
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

import type { Avatar } from "./faces";
import { isObject, nonEmpty, text, type Json } from "./json";
import type { Attachment, RecordLine } from "./types";

// Thread 접기(v1 티켓 05 · 구현 스펙 §14) — Thread 기록 줄을 받아 화면 모델(턴 · 말한 이 · 메시지 · 생각 · 도구 줄 · 시스템 줄 ·
// 도는가)로 접는 **순수 함수**다. Thread 화면은 Thread를 이것 하나로 그린다: 처음 그릴 때 읽은 기록도, 흐르는 기록 줄 이벤트도 같은
// 줄이라 이 함수는 어디서 온 줄인지 모른다.
//
// three-axes 대화 접기(`chat/fold.ts`)를 옮겨 왔다 — 턴 · 멈춘 뒤의 도구 줄 · 스스로 이어 간 턴 · 계획 카드 · 상태 줄의 규칙은 그대로이고
// (그쪽 머리말이 근거를 든다), Thread에서 달라진 것은 셋이다.
// - **줄의 `who`로 말한 이를 가른다.** 턴은 그 턴에 답한 참여자의 handle을 들고, 같은 Agent가 사람 말 없이 이어 말하면 이름 줄을 다시
//   쓰지 않는다(`namesWho`). 사람의 말(`sent`)은 `who`가 없고 받는 이를 `to`에 싣는다.
//   **열린 턴은 참여자마다 하나다**(v1 티켓 14) — 참여자마다 Session이 따로라(§5) Host가 도는 동안 리뷰어에게 보낸 말은 리뷰어의 턴으로
//   함께 돈다. 줄은 그 `who`의 열린 턴에 들고, 한 Session이 죽거나 닫히면 그 참여자의 턴 · 물음만 끝난다. 앱을 다시 켠 것(`goneThrough`)은
//   모두의 끝이다. 참여자의 이름 · 얼굴은 들어옴 줄(`joined`)이 정본이다(`cast`) — 처음 불린 정의 그대로다(S4).
// - **Thread의 일은 흐름 가운데의 시스템 줄이다**(캔버스 Messages 보드 「시스템 줄」) — 이름 바꾸기(`title`), 참여자가 들고 남(`joined` ·
//   `left`). 모든 Thread가 Host의 `joined`로 시작하므로 Host가 들어온 줄은 세우지 않는다. Work · 물어보는 정도 · 호출 · PR 줄은 그
//   장(23 · 30 · 31 · 15 · 40)이 더한다.
// - **도구 줄은 시작과 끝의 시각을 든다** — 작업 로그가 마우스를 올린 줄에 걸린 시간을 말한다(캔버스 WorkLog 보드). 사람이 거절한
//   물음의 도구 줄은 「실행하지 않음 · 내가 거절함」이라 거절을 든다(`denied`).
// Thread Session에는 고친 곳(`changes`) 줄이 없다 — 바뀐 파일 알약은 마지막 턴의 편집 도구가 낸 diff에서 센다(`log.ts`).
//
// 모르는 줄은 버리지 않고 지나간다 — 기록은 원문 그대로라 스키마에 없는 갈래도 오고, 그것이 화면을 멈추면 안 된다.

/** 턴이 끝난 모양 — `turn-end` 줄, 또는 그 줄 없이 Session이 사라진 것(죽음 · 닫힘 · 앱을 다시 켬). */
export interface TurnEnd {
  /** Runtime이 준 끝 까닭(`end_turn` · `cancelled` · `max_tokens` …). 말을 받지 않았거나 사라졌으면 null이다. */
  stopReason: string | null;
  /** 말을 보낸 때부터 끝날 때까지. */
  durationMs: number;
  /** 우리가 멈췄나 — `cancelled`가 사람의 멈춤인지 Runtime의 거부인지를 가른다. */
  cancelledByUs: boolean;
  /** 말을 받지 않은 오류나 사라진 까닭. */
  error: string | null;
}

/** 턴 안의 한 줄. 같은 메시지의 조각들은 한 줄로 이어 붙는다. */
export type Entry =
  | { kind: "message"; key: string; messageId: string | null; text: string }
  | { kind: "thought"; key: string; messageId: string | null; text: string }
  | ToolEntry
  | PlanEntry
  | ChecklistEntry;

/** 계획 카드 — Runtime의 마크다운 계획, 또는 계획 승인 요청의 계획 본문. Thread에 하나라 다음 계획이 오면 같은 카드가 바뀐다. */
export interface PlanEntry {
  kind: "plan";
  key: string;
  text: string;
}

/** 계획 체크리스트의 항목 하나 — ACP `PlanEntry`. */
export interface ChecklistItem {
  content: string;
  status: string;
}

/** 계획 체크리스트 — ACP `plan`의 항목들. Runtime이 보낼 때만 서고, Thread에 하나다. 빈 목록이 오면 걷힌다. */
export interface ChecklistEntry {
  kind: "checklist";
  key: string;
  items: ChecklistItem[];
}

/** 우리가 멈춘 턴에서 그 도구 줄이 어떻게 됐나 — 멈춘 뒤에도 돈다(돌았다) · 멈춤과 함께 닫혔다. 멈춘 턴의 줄이 아니면 null이다. */
export type ToolStop = "ran-on" | "stopped";

export interface ToolEntry {
  kind: "tool";
  key: string;
  toolCallId: string;
  /** 처음 온 `tool_call`에 뒤의 `tool_call_update`를 덮어 합친 값. 문구 · 안의 것은 `tool-view.ts`가 짓는다. */
  call: Json;
  /** 명령이 낸 출력 조각(`_meta.terminal_output_delta.data`)을 이어 붙인 것. */
  output: string;
  stop: ToolStop | null;
  /** 끝을 알리기 전에 그 Session이 사라졌나 — 더 올 update가 없다. 도는 것으로 보이지 않는다. */
  cut: boolean;
  /** 이 도구가 물은 권한을 사람이 거절했나(거절 갈래의 선택지로 답했다). */
  denied: boolean;
  /** `tool_call` 줄의 시각. */
  startedAt: string;
  /** 끝(`completed` · `failed`)을 알린 줄의 시각. 끝나지 않았으면 null이다. */
  endedAt: string | null;
}

export interface Turn {
  /** 턴의 정체 — 접고 펴기를 기억하는 열쇠다. 보낸 말의 seq에서 나온다. */
  key: string;
  /** 그 턴에 답한 참여자의 handle — 보낸 말의 받는 이(`to`), 그 뒤 답한 줄의 `who`. 모르면 null이다. */
  who: string | null;
  /**
   * 이름 줄(얼굴 · 이름 · 시각)을 쓰나 — 같은 Agent가 사람 말 없이 이어 말하면 쓰지 않는다(구현 스펙 §14). 사람이 말한 턴과 말한 이가
   * 바뀐 턴은 쓴다.
   */
  namesWho: boolean;
  /** 사람이 보낸 말의 화면 글(기록의 `sent`). 머리말은 기록의 `prompt`에만 있다. 스스로 이어 간 턴은 null이다. */
  sent: string | null;
  /** 그 말에 붙인 파일 · 폴더(`sent`의 `attachments`, v1 티켓 06) — 말풍선 위 칩이다. 없으면 빈 목록이다. */
  attachments: Attachment[];
  /** Agent가 스스로 이어 간 턴인가 — 보낸 말 없이 시작했거나 턴 밖 끝만 온 턴이다. */
  selfContinued: boolean;
  /** 턴이 선 시각(보낸 말 · 처음 온 줄). */
  startedAt: string;
  /** 답한 이의 첫 줄 시각 — 이름 줄의 시각이다. 아직 답이 없으면 null이다. */
  answeredAt: string | null;
  entries: Entry[];
  /** 끝났으면 그 모양, 도는 중이면 null. */
  end: TurnEnd | null;
}

/**
 * 흐름 안의 상태 줄(three-axes 티켓 23) — 되살리기가 새 Session으로 끝남 · 프로세스 죽음 · 판 경고. 턴에 들지 않고 턴 사이에 선다.
 */
export interface Notice {
  key: string;
  kind: "fresh" | "died" | "version";
  text: string;
  /** 이 줄보다 먼저 선 턴의 수 — 흐름에서 그 턴들 뒤, 다음 턴 앞에 선다. */
  turnsBefore: number;
}

/**
 * 시스템 줄(캔버스 Messages 보드) — 가운데에 회색 한 줄, 굵게 쓰는 것은 이름(`name`)뿐이다. 문장은 `before` · `name` · `after`를 잇는다
 * (「Thread 이름을 」 · 「환불 API 버그」 · 「로 바꿈」).
 */
export interface SystemLine {
  key: string;
  kind: "title" | "joined" | "left";
  /** 들고 난 참여자의 handle — 그 얼굴이 이름 앞에 선다. Thread의 일(이름 바꾸기)은 `null`이다. */
  handle: string | null;
  before: string;
  name: string;
  after: string;
  turnsBefore: number;
}

/** 참여자 한 사람의 이름 · 얼굴 — 들어옴 줄(`joined`)의 `name` · `avatar`. */
export interface CastMember {
  name: string;
  avatar: Avatar | null;
}

export interface ThreadModel {
  turns: Turn[];
  /** 도는 턴이 하나라도 있나 — 참여자마다 하나씩 돌 수 있다. */
  running: boolean;
  /** 도는 턴의 참여자 handle — 턴이 선 차례다. */
  answering: string[];
  /** Session을 띄우거나 되살리는 중인가 — 띄우는 중 줄 뒤로 열림 · 죽음 · 닫힘 · 로그인 필요가 아직 오지 않았다. */
  connecting: boolean;
  /** 참여자 handle → 이름 · 얼굴(들어옴 줄). Host는 줄이 없어도 「Host」다. */
  cast: Record<string, CastMember>;
  notices: Notice[];
  system: SystemLine[];
  /** 답하지 않은 권한 요청 — 물은 차례다. 맨 앞의 것이 입력창 자리에 승인 카드로 선다. */
  pending: PendingPermission[];
}

/** 권한 요청의 선택지 하나 — Runtime이 준 그대로(ACP `PermissionOption`). */
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
  /** 물은 참여자의 handle — 권한 답 명령이 함께 싣는다. */
  who: string;
  options: PermissionOption[];
  /** 엔진이 채운 도구 요지(`toolCall`) — 없으면 요청 원문의 `toolCall`이다. */
  toolCall: Json;
  /** 그 요청의 도구 줄 — 흐름에 있으면(물음보다 먼저 온 `tool_call`) 그것이다. */
  tool: ToolEntry | null;
  /** 계획 승인 요청인가 — ACP 도구 kind `switch_mode`. */
  planReview: boolean;
}

/** 턴 안의 줄이 되는 `session/update` 갈래. */
const TURN_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "plan_update", "plan"]);

/** Thread를 만드는 Agent — 모든 Thread가 이 참여자의 `joined`로 시작한다. */
const HOST = "host";

/**
 * 기록 줄을 화면 모델로 접는다. `goneThrough`는 Thread가 「떠 있는 Session이 없다」고 말할 때의 마지막 seq다 — 그 seq까지의 줄을
 * 적던 프로세스는 이미 없다(앱을 다시 켬). 그 뒤의 줄(되살린 뒤)은 여느 때처럼 접는다. 떠 있으면 `null`이다.
 */
export function foldThread(lines: readonly RecordLine[], goneThrough: number | null = null): ThreadModel {
  const turns: Turn[] = [];
  // 참여자마다 열린 턴 — 열쇠는 `who`(받는 이를 모르는 옛 `sent`는 빈 글자다, `openFor`).
  const open = new Map<string, Turn>();
  // 도는 턴에서 `failed`로 닫힌 뒤 아무 일도 이어지지 않은 도구 줄들(턴마다) — 그 턴이 우리의 멈춤으로 끝나면 멈춤이다.
  const closedLast = new Map<Turn, ToolEntry[]>();
  // 권한 요청 id → 그 요청의 도구 줄 id · 선택지 갈래, 그리고 멈추기로 요청이 거둬진 도구 줄 id들.
  const askedFor = new Map<string, { tool: string | null; options: PermissionOption[] }>();
  const withdrawnByStop = new Set<string>();
  const deniedTools = new Set<string>();
  const pending = new Map<string, Omit<PendingPermission, "tool">>();
  let planCard: Held<PlanEntry> | null = null;
  let checklist: Held<ChecklistEntry> | null = null;
  const planReviews = new Set<string>();
  const cast: Record<string, CastMember> = { [HOST]: { name: "Host", avatar: null } };
  const start = (key: string, sent: string | null, at: string, who: string | null, attachments: Attachment[] = []): Turn => {
    const previous = turns[turns.length - 1];
    const turn: Turn = {
      key,
      who,
      namesWho: true,
      sent,
      attachments,
      selfContinued: sent === null,
      startedAt: at,
      answeredAt: null,
      entries: [],
      end: null,
    };
    // 사람 말 없이 이어진 턴 — 앞 턴과 같은 이면 이름 줄을 다시 쓰지 않는다.
    if (sent === null && previous && previous.who === who) turn.namesWho = false;
    turns.push(turn);
    open.set(who ?? "", turn);
    return turn;
  };
  // 그 참여자의 열린 턴 — 없고 받는 이를 모르는 열린 턴이 있으면 그 턴이 이 참여자의 것이다(`to` 없는 옛 `sent`).
  const openFor = (who: string | null): Turn | null => {
    const own = open.get(who ?? "");
    if (own || who === null) return own ?? null;
    const anonymous = open.get("");
    if (!anonymous) return null;
    open.delete("");
    open.set(who, anonymous);
    return anonymous;
  };
  const close = (turn: Turn) => {
    for (const [key, one] of open) if (one === turn) open.delete(key);
    closedLast.delete(turn);
  };
  // 답한 이를 턴에 적는다 — 보낸 말의 받는 이보다 실제로 답한 줄이 이긴다.
  const answer = (turn: Turn, line: RecordLine) => {
    if (line.who) turn.who = line.who;
    if (turn.answeredAt === null) turn.answeredAt = line.at;
  };
  const connecting = new Set<string>();
  const notices: Notice[] = [];
  const system: SystemLine[] = [];
  const notice = (seq: number, kind: Notice["kind"], words: string) =>
    notices.push({ key: `n${seq}`, kind, text: words, turnsBefore: turns.length });
  const say = (seq: number, kind: SystemLine["kind"], handle: string | null, before: string, name: string, after: string) =>
    system.push({ key: `s${seq}`, kind, handle, before, name, after, turnsBefore: turns.length });
  // 그 참여자의 프로세스가 사라졌다(`who`가 `undefined`면 모두 — 앱을 다시 켬) — 열린 턴은 끝났고, 걸린 권한 요청에는 답할 곳이 없고,
  // 끝을 받지 못한 도구 줄은 끊겼다.
  const vanish = (at: string, error: string, who?: string | null) => {
    const mine = (one: string | null) => who === undefined || one === (who ?? HOST);
    for (const [id, request] of pending) if (mine(request.who)) pending.delete(id);
    if (who === undefined) connecting.clear();
    else connecting.delete(who ?? HOST);
    for (const turn of turns) {
      if (!mine(turn.who ?? HOST)) continue;
      for (const entry of turn.entries) if (entry.kind === "tool" && !toolDone(entry)) entry.cut = true;
    }
    const ending = who === undefined ? [...open.values()] : [openFor(who ?? HOST)].filter((turn) => turn !== null);
    for (const turn of ending) {
      turn.end = {
        stopReason: null,
        durationMs: Math.max(0, Date.parse(at) - Date.parse(turn.startedAt)) || 0,
        cancelledByUs: false,
        error,
      };
      close(turn);
    }
  };
  let gone = goneThrough === null;
  let lastAt = "";

  for (const line of lines) {
    const previousAt = lastAt || line.at;
    if (!gone && line.seq > (goneThrough ?? 0)) {
      vanish(previousAt, GONE_WITH_APP);
      gone = true;
    }
    lastAt = line.at;
    const payload = isObject(line.payload) ? line.payload : {};
    switch (line.kind) {
      case "sent":
        start(`t${line.seq}`, text(payload.text) ?? "", line.at, text(payload.to), attachmentsOf(payload.attachments));
        break;
      case "update": {
        const update = isObject(payload.update) ? payload.update : null;
        const kind = update && text(update.sessionUpdate);
        if (!update || !kind) break;
        if (kind === "tool_call_update") {
          // 늦게 온 update는 그 도구 줄을 찾아 붙는다 — 턴이 이미 끝났어도 같다.
          const id = text(update.toolCallId);
          if (id && planReviews.has(id)) break;
          const mine = openFor(line.who ?? null);
          let tool = id ? findTool(turns, id) : null;
          if (tool) tool.call = mergeCall(tool.call, update);
          else if (id && mine) {
            tool = newTool(`u${line.seq}`, id, update, line.at);
            mine.entries.push(tool);
          }
          if (!tool) break;
          tool.output += outputOf(update);
          if (tool.endedAt === null && toolDone(tool)) tool.endedAt = line.at;
          if (deniedTools.has(tool.toolCallId)) tool.denied = true;
          if (mine && update.status === "failed" && mine.entries.includes(tool)) {
            closedLast.set(mine, [...(closedLast.get(mine) ?? []), tool]);
          }
          break;
        }
        if (kind === "session_info_update" && outOfTurnStarted(update)) {
          if (!openFor(line.who ?? null)) start(`o${line.seq}`, null, line.at, line.who ?? null);
          break;
        }
        if (!TURN_UPDATES.has(kind)) break;
        if (kind === "tool_call" && planReviews.has(text(update.toolCallId) ?? "")) break;
        const turn: Turn = openFor(line.who ?? null) ?? start(`o${line.seq}`, null, line.at, line.who ?? null);
        answer(turn, line);
        closedLast.delete(turn);
        if (kind === "plan_update") {
          const body = isObject(update.plan) && update.plan.type === "markdown" ? text(update.plan.content) : null;
          if (body === null) break;
          planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), null);
          planCard.entry.text = body;
          break;
        }
        if (kind === "plan") {
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
          const tool = newTool(`c${line.seq}`, text(update.toolCallId) ?? `seq-${line.seq}`, update, line.at);
          if (toolDone(tool)) tool.endedAt = line.at;
          turn.entries.push(tool);
          break;
        }
        const content = isObject(update.content) ? update.content : {};
        const chunk = content.type === "text" ? text(content.text) : null;
        if (chunk === null) break;
        appendChunk(turn, kind === "agent_message_chunk" ? "message" : "thought", text(update.messageId), chunk, line.seq);
        break;
      }
      case "turn-end": {
        let turn = openFor(line.who ?? null);
        if (!turn && payload.outOfTurn === true) turn = start(`o${line.seq}`, null, line.at, line.who ?? null);
        if (!turn) break;
        const error = isObject(payload.error) ? text(payload.error.message) : null;
        turn.end = {
          stopReason: text(payload.stopReason),
          durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
          cancelledByUs: payload.cancelledByUs === true,
          error,
        };
        if (turn.end.stopReason === "cancelled" && turn.end.cancelledByUs) {
          markStopped(turn, closedLast.get(turn) ?? [], withdrawnByStop);
        }
        if (payload.outOfTurn === true) turn.selfContinued = true;
        close(turn);
        break;
      }
      case "permission": {
        const requestId = text(payload.requestId);
        if (!requestId) break;
        if (payload.state === "asked") {
          const id = askedToolId(payload);
          const request = askedOf(requestId, line.who ?? HOST, payload);
          askedFor.set(requestId, { tool: id, options: request.options });
          pending.set(requestId, request);
          if (request.planReview && id) {
            planReviews.add(id);
            const home = toolHome(turns, id);
            const turn = home?.turn ?? openFor(line.who ?? null) ?? turns[turns.length - 1];
            const rawInput = isObject(request.toolCall.rawInput) ? request.toolCall.rawInput : {};
            const body = text(rawInput.plan);
            if (turn && body !== null) {
              planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), home?.tool ?? null);
              planCard.entry.text = body;
            } else if (home) drop(home.turn, home.tool);
          }
          break;
        }
        pending.delete(requestId);
        const asked = askedFor.get(requestId);
        if (payload.state === "answered" && asked?.tool) {
          // 거절 갈래로 답했다 — 그 도구는 돌지 않는다(「실행하지 않음 · 내가 거절함」).
          const chosen = asked.options.find((option) => option.optionId === payload.optionId);
          if (chosen?.kind.startsWith("reject")) {
            deniedTools.add(asked.tool);
            const tool = findTool(turns, asked.tool);
            if (tool) tool.denied = true;
          }
        }
        if (payload.state === "withdrawn" && payload.reason === "stopped" && asked?.tool) {
          withdrawnByStop.add(asked.tool);
          const tool = findTool(turns, asked.tool);
          if (tool?.stop === "ran-on") tool.stop = "stopped";
        }
        break;
      }
      case "session": {
        switch (payload.state) {
          case "spawning":
            vanish(previousAt, GONE_WITH_APP, line.who ?? null);
            connecting.add(line.who ?? HOST);
            break;
          case "opened":
            connecting.delete(line.who ?? HOST);
            if (payload.how === "fresh") notice(line.seq, "fresh", FRESH_NOTICE);
            break;
          case "login-required":
            connecting.delete(line.who ?? HOST);
            break;
          case "version-warning":
            notice(line.seq, "version", versionNotice(text(payload.agentVersion), payload.supportedMajor));
            break;
          case "died":
          case "closed":
            vanish(line.at, payload.state === "closed" ? "Session이 닫혔어요" : "Claude Code가 끝났어요", line.who ?? null);
            if (payload.state === "died") notice(line.seq, "died", diedNotice(text(payload.reason)));
            break;
          default:
            break;
        }
        break;
      }
      case "title": {
        const title = nonEmpty(payload.title);
        if (title) say(line.seq, "title", null, "Thread 이름을 ", title, `${particle(title, "으로", "로")} 바꿈`);
        break;
      }
      case "joined":
      case "left": {
        const handle = text(payload.handle) ?? line.who ?? null;
        if (line.kind === "joined" && handle && handle !== HOST) {
          cast[handle] = { name: nonEmpty(payload.name) ?? handle, avatar: avatarOf(payload.avatar) };
        }
        // 모든 Thread가 Host의 들어옴으로 시작한다 — 세우지 않는다(머리말).
        if (line.kind === "joined" && handle === HOST) break;
        const name = nonEmpty(payload.name) ?? (handle ? cast[handle]?.name : null) ?? handle;
        if (!name) break;
        const verb = line.kind === "joined" ? "참여함" : "나감";
        say(line.seq, line.kind, handle, "", name, `${particle(name, "이", "가")} ${verb}`);
        break;
      }
      default:
        break;
    }
  }
  if (!gone) vanish(lastAt, GONE_WITH_APP);
  const answering = turns.filter((turn) => [...open.values()].includes(turn)).map((turn) => turn.who ?? HOST);
  return {
    turns,
    running: open.size > 0,
    answering: [...new Set(answering)],
    connecting: connecting.size > 0,
    cast,
    notices,
    system,
    pending: [...pending.values()].map((one) => {
      const id = text(one.toolCall.toolCallId);
      return { ...one, tool: id ? findTool(turns, id) : null };
    }),
  };
}

/**
 * 「답하는 중」 줄(캔버스 Messages 보드 「답하는 중」 · Motion 보드 「Agent 참여」)에 설 참여자 — 도는 턴 가운데 **흐름 끝에서 답이
 * 보이지 않는** 이들이다: 아직 아무 줄도 오지 않은 턴(보낸 말 · 참여 줄 바로 뒤)과 흐름 끝이 아닌 자리에서 도는 턴. 흐름 끝의 턴이
 * 답 · 생각 · 도구 줄을 흘리고 있으면 그 턴의 이름 줄 · 머리줄이 이미 말하므로 뺀다. 아무도 없으면 `null`이다. 여럿이면 턴이 선
 * 차례로 모두 든다(「리뷰어와 테스터가 답하는 중」).
 */
export function answeringLine(model: ThreadModel): string[] | null {
  const last = model.turns[model.turns.length - 1];
  const speaking = last && last.end === null && last.entries.length > 0 ? (last.who ?? HOST) : null;
  const shown = model.answering.filter((who) => who !== speaking);
  return shown.length > 0 ? shown : null;
}

/** 들어옴 줄의 `avatar` — 모양 · 색 글자만 좁힌다(푸는 일은 `faces.ts`). */
function avatarOf(value: unknown): Avatar | null {
  if (!isObject(value)) return null;
  return { shape: text(value.shape), color: text(value.color) };
}

/** 앱을 다시 켜기 전에 끊긴 턴의 끝 까닭 — 앱이 꺼지면 Session도 함께 꺼진다. */
const GONE_WITH_APP = "앱이 꺼지며 끊겼어요";

/** 「새로 시작함」 상태 줄. */
const FRESH_NOTICE = "새로 시작함 — 앞의 맥락을 잇지 못해 새 Session으로 열었어요";

function diedNotice(reason: string | null): string {
  return `${reason ?? "Claude Code가 끝났어요"} · 다음 말에서 다시 띄워요`;
}

function versionNotice(version: string | null, major: unknown): string {
  const supported = typeof major === "number" ? ` — 확인한 판은 ${major}.x` : "";
  return `확인하지 않은 Claude Code 판이에요(${version ?? "판 모름"}${supported}). 그대로 이어 가요`;
}

/**
 * 이름 뒤의 조사 — 마지막 글자가 받침 있는 한글이면 `withFinal`, 아니면 `without`이다. 「으로/로」는 ㄹ 받침도 「로」다. 한글이
 * 아닌 끝 글자(영문 · 숫자)는 받침이 없는 것으로 읽는다.
 */
export function particle(word: string, withFinal: string, without: string): string {
  const code = word.trim().codePointAt(word.trim().length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return without;
  const final = (code - 0xac00) % 28;
  if (final === 0) return without;
  if (withFinal === "으로" && final === 8) return without;
  return withFinal;
}

/**
 * 같은 기록 줄을 한 번만 접는다 — Thread 몸(흐름 · 입력창 · 알약)과 사이드바가 같은 줄을 읽는다. 기록 줄 배열은 바뀔 때마다 새
 * 배열이라(`thread-store.ts`) 그 정체가 열쇠다. 접은 값은 읽기만 한다.
 */
const folded = new WeakMap<readonly RecordLine[], { goneThrough: number | null; model: ThreadModel }>();
export function foldOf(lines: readonly RecordLine[], goneThrough: number | null): ThreadModel {
  const hit = folded.get(lines);
  if (hit && hit.goneThrough === goneThrough) return hit.model;
  const model = foldThread(lines, goneThrough);
  folded.set(lines, { goneThrough, model });
  return model;
}

/** `sent`의 `attachments` 칸 → 첨부들. 경로가 글이 아닌 칸은 버린다 — 칩이 그릴 수 없다. */
function attachmentsOf(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Attachment[] => {
    if (!isObject(item)) return [];
    const path = text(item.path);
    if (path === null) return [];
    return [{ path, size: typeof item.size === "number" ? item.size : null, folder: item.folder === true }];
  });
}

function newTool(key: string, toolCallId: string, call: Json, at: string): ToolEntry {
  return {
    kind: "tool",
    key,
    toolCallId,
    call,
    output: outputOf(call),
    stop: null,
    cut: false,
    denied: false,
    startedAt: at,
    endedAt: null,
  };
}

/** 스스로 이어 간 턴의 시작 표지(`session_info_update`의 `_meta.atelier.outOfTurn.state: "started"`). */
function outOfTurnStarted(update: Json): boolean {
  const meta = isObject(update._meta) ? update._meta : null;
  const atelier = meta && isObject(meta.atelier) ? meta.atelier : null;
  const mark = atelier && isObject(atelier.outOfTurn) ? atelier.outOfTurn : null;
  return mark?.state === "started";
}

function askedOf(requestId: string, who: string, payload: Json): Omit<PendingPermission, "tool"> {
  const request = isObject(payload.request) ? payload.request : {};
  const toolCall = isObject(payload.toolCall) ? payload.toolCall : isObject(request.toolCall) ? request.toolCall : {};
  const options = (Array.isArray(request.options) ? request.options : []).filter(isObject).flatMap((option) => {
    const optionId = text(option.optionId);
    return optionId === null ? [] : [{ optionId, name: text(option.name) ?? optionId, kind: text(option.kind) ?? "" }];
  });
  return { requestId, who, options, toolCall, planReview: toolCall.kind === "switch_mode" };
}

/** 도구 줄이 끝났나 — ACP 도구 상태 넷 가운데 `completed` · `failed`가 끝이다. */
export const toolDone = (tool: ToolEntry): boolean => tool.call.status === "completed" || tool.call.status === "failed";

/** 도구 호출에 update를 덮어 합친다 — 칸은 뒤의 것이 이기고, `_meta`만 한 겹 안쪽까지 합친다. */
function mergeCall(call: Json, update: Json): Json {
  const merged = { ...call, ...update };
  if (isObject(call._meta) && isObject(update._meta)) merged._meta = { ...call._meta, ...update._meta };
  return merged;
}

function outputOf(update: Json): string {
  const meta = isObject(update._meta) ? update._meta : null;
  const delta = meta && isObject(meta.terminal_output_delta) ? meta.terminal_output_delta : null;
  return (delta && text(delta.data)) ?? "";
}

function markStopped(turn: Turn, closedLast: readonly ToolEntry[], withdrawn: ReadonlySet<string>): void {
  for (const entry of turn.entries) {
    if (entry.kind !== "tool") continue;
    if (!toolDone(entry)) entry.stop = withdrawn.has(entry.toolCallId) ? "stopped" : "ran-on";
    else if (closedLast.includes(entry)) entry.stop = "stopped";
  }
}

function askedToolId(payload: Json): string | null {
  const summary = isObject(payload.toolCall) ? text(payload.toolCall.toolCallId) : null;
  if (summary) return summary;
  const request = isObject(payload.request) ? payload.request : null;
  return request && isObject(request.toolCall) ? text(request.toolCall.toolCallId) : null;
}

interface Held<T extends Entry> {
  turn: Turn;
  entry: T;
}

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

function checklistOf(entries: unknown): ChecklistItem[] {
  return (Array.isArray(entries) ? entries : []).filter(isObject).flatMap((entry) => {
    const content = text(entry.content);
    return content === null || content.trim() === "" ? [] : [{ content, status: text(entry.status) ?? "pending" }];
  });
}

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

function appendChunk(turn: Turn, kind: "message" | "thought", messageId: string | null, chunk: string, seq: number): void {
  const last = turn.entries[turn.entries.length - 1];
  if (last && last.kind === kind && last.messageId === messageId) {
    last.text += chunk;
    return;
  }
  turn.entries.push({ kind, key: `${kind === "message" ? "m" : "r"}${seq}`, messageId, text: chunk });
}

/** 턴 끝 메시지가 시작하는 자리 — 마지막 도구 호출 뒤의 답이다. 접힌 턴은 이 자리부터의 메시지만 펼쳐 둔다. */
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

/** 걸린 시간 — 「8초」 · 「3분 41초」 · 「1시간 5분」. 1초보다 짧아도 1초로 말한다. */
export function spoken(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}분` : `${minutes}분 ${seconds % 60}초`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`;
}

const STOPPED: Record<string, string> = {
  max_tokens: "답이 길이 한도에 닿아 멈췄어요",
  max_turn_requests: "한 턴의 요청 한도에 닿아 멈췄어요",
  refusal: "Agent가 거절해서 멈췄어요",
};

/**
 * 작업 머리줄(캔버스 WorkLog 보드). `end_turn`이면 「N초 동안 작업함」, 우리가 멈춘 `cancelled`면 「N초 후에 중단했습니다」, 그 밖은
 * 까닭을 보인다.
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

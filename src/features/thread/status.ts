import { describeApproval } from "./approval";
import { describeCall } from "./call-view";
import { awaitingLogin } from "./engine-store";
import {
  finalMessages,
  foldOf,
  type CallEntry,
  type CastMember,
  type PendingPermission,
  type ThreadModel,
  type ToolEntry,
  type Turn,
} from "./fold";
import { isObject, text } from "./json";
import { baseName, describeTool, phraseText } from "./tool-view";
import type { RecordLine } from "./types";

// Thread 목록 상태(v1 티켓 41 · 구현 스펙 §17 · S38 · 캔버스 Sidebar 보드 「상태는 다섯 가지」) — Thread 하나의 기록 줄과 엔진이 준 두 값
// (떠 있는 Session이 없을 때의 마지막 seq · 사람이 마지막으로 본 seq)에서 사이드바 줄의 상태 **하나**를 고르는 **순수 함수**다. 그리는
// 것은 `SidebarThreads`의 `ThreadRow`다. 기록은 Thread 화면과 같은 접기(`foldOf`)로 읽어, 사이드바와 Thread가 다른 말을 하지 않는다.
//
// | 우선 | 상태 | 언제 |
// |---|---|---|
// | 1 | 내 차례 | 답을 기다리는 승인이 있다(`model.pending` — 앱을 다시 켜 답할 곳이 없는 물음은 접기가 걷는다) |
// | 2 | 작업 중 | 어느 참여자의 턴이든 돈다 — 로그인을 기다리며 멈춘 턴은 돌지 않는 것이다 |
// | 3 | 실패 | 로그인 필요 · 마지막 턴이 답 없이 끝났다(오류 · 프로세스 죽음 · 앱이 꺼지며 끊김) · 마지막 부르기가 답하지 못했다 |
// | 4 | 중단 | 마지막 턴을 사람이 멈췄다 |
// | 5 | 새 결과 | 마지막 턴 끝 줄이 읽은 자리 뒤에 있다 |
//
// - **「마지막 턴」은 끝난 때가 가장 늦은 턴이다** — 함께 도는 턴(멘션 · 맡은 턴, v1 티켓 14 · 17)은 선 차례와 끝난 차례가 다르다. 답 없이
//   끝난 턴의 판정은 흐름의 「답하지 못했습니다」(`ThreadFlow`)와 같다: 끝 까닭이 없고 턴 끝 메시지가 없다.
// - **부르기의 실패는 사람이 다시 말할 때까지 남는다** — 불린 Agent가 답하지 못해도 부른 Host의 턴은 그 결과를 받고 끝나므로, 마지막
//   턴만 보면 실패가 묻힌다. 사람이 보낸 말이 그 부르기 뒤에 서면 지난 일이다. 사람이 멈춘 부르기는 실패가 아니라 중단의 몫이다.
// - **미리보기**는 상태가 정한다 — 내 차례면 기다리는 것(「승인 · pnpm prisma migrate dev」), 작업 중이면 지금 도는 도구의 문구(보드 「pnpm
//   test auth 실행 중」 — 도구가 없으면 마지막 말이 남는다), 실패면 그 까닭(「실패」는 그리는 쪽이 앞에 단다), 중단이면 「중단했습니다」다.
// - 실패 · 중단은 읽어도 남는다 — 읽은 자리가 가르는 것은 새 결과뿐이다. 다음 턴이 끝나면 걷힌다.

/** 사이드바 Thread 줄의 상태 하나. `text`는 둘째 줄을 대신하는 글이고, `null`이면 마지막 말이 그대로 선다. */
export type ThreadStatus =
  | { kind: "mine"; since: string; text: string }
  | { kind: "working"; text: string | null }
  | { kind: "failed"; at: string; text: string }
  | { kind: "stopped"; at: string; text: string }
  | { kind: "new" };

/**
 * 엔진이 준 두 값 — 떠 있는 Session이 없을 때의 마지막 seq(`fold.ts`의 `goneThrough`, `ThreadView`의 `live` · `lastSeq`)와 사람이
 * 마지막으로 본 seq(목록 요약의 `lastRead`, S38).
 */
export interface Seen {
  goneThrough: number | null;
  lastRead: number;
}

/**
 * 그 Thread의 상태 — 위 표의 차례로 처음 맞는 것 하나다. 아무 상태도 아니면(끝났고 읽었다 · 아직 아무 턴도 없다) `null`이다. 내 차례의
 * `since`는 기다리기 시작한 때(그 물음 줄의 시각 — 「내 차례」 거르기의 차례, v1 티켓 42), 실패 · 중단의 `at`은 그 일이 끝난 때다.
 */
export function statusOf(lines: readonly RecordLine[], seen: Seen): ThreadStatus | null {
  const model = foldOf(lines, seen.goneThrough);
  const waiting = model.pending[0];
  if (waiting) return { kind: "mine", since: askedAt(lines, waiting), text: `승인 · ${waitingFor(waiting)}` };
  const login = loginLine(lines);
  if (model.running && !login) {
    const tool = runningTool(model.turns.filter((turn) => turn.end === null));
    return { kind: "working", text: tool && said(tool.who, phraseText(describeTool(tool.entry).phrase), model.cast) };
  }
  if (login) return { kind: "failed", at: login.at, text: "로그인이 필요해요" };
  const last = lastEnded(model.turns);
  if (last?.end && last.end.stopReason === null && finalMessages(last).length === 0) {
    return { kind: "failed", at: last.end.at, text: last.end.error ?? "Claude Code와 연결이 끊겼어요" };
  }
  const call = lastCall(model);
  const spokenAfter = (at: string) => model.turns.some((turn) => turn.sent !== null && Date.parse(turn.startedAt) > Date.parse(at));
  if (last?.end && call?.end?.outcome === "failed" && !spokenAfter(call.startedAt)) {
    return { kind: "failed", at: last.end.at, text: describeCall(call, model.cast[call.to]?.name ?? call.to).title };
  }
  if (last?.end?.stopReason === "cancelled" && last.end.cancelledByUs) {
    return { kind: "stopped", at: last.end.at, text: "중단했습니다" };
  }
  if (lastEnd(lines) > seen.lastRead) return { kind: "new" };
  return null;
}

/**
 * 맨 아래가 보일 때 적을 읽은 자리(S38) — 읽은 자리 뒤에 턴 끝이 있으면 지금 끝 줄의 seq, 없으면 적지 않는다(`null`). 「새 결과」를
 * 가르는 것은 턴 끝뿐이라, 턴이 도는 동안 흐르는 줄마다 `thread.json`을 다시 쓰지 않는다.
 */
export function readMark(lines: readonly RecordLine[], lastRead: number): number | null {
  return lastEnd(lines) > lastRead ? lines[lines.length - 1].seq : null;
}

/** 로그인을 기다리게 한 줄 — 마지막 Session 줄이 로그인 필요일 때만(`engine-store.ts`의 `awaitingLogin`). */
function loginLine(lines: readonly RecordLine[]): RecordLine | null {
  if (!awaitingLogin(lines)) return null;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at];
    if (line.kind === "session" && isObject(line.payload) && line.payload.state === "login-required") return line;
  }
  return null;
}

/** 마지막으로 끝난 턴 — 끝난 때가 가장 늦은 것, 같으면 뒤에 선 것이다. 함께 도는 턴들은 선 차례와 끝난 차례가 다르다. */
function lastEnded(turns: readonly Turn[]): Turn | null {
  let found: Turn | null = null;
  for (const turn of turns) {
    if (turn.end && (found?.end == null || Date.parse(turn.end.at) >= Date.parse(found.end.at))) found = turn;
  }
  return found;
}

/** 마지막 부르기 — 턴 안의 호출 줄과 턴 밖의 것(다시 맡기기) 가운데 가장 늦게 선 것. */
function lastCall(model: ThreadModel): CallEntry | null {
  const calls = [
    ...model.turns.flatMap((turn) => turn.entries.filter((entry): entry is CallEntry => entry.kind === "call")),
    ...model.calls.map((loose) => loose.entry),
  ];
  let found: CallEntry | null = null;
  for (const call of calls) if (found === null || Date.parse(call.startedAt) >= Date.parse(found.startedAt)) found = call;
  return found;
}

/** 승인이 기다리는 것 — 명령, 파일 이름, 그 밖의 대상(주소 · MCP 도구), 계획이면 물음이다. 승인 카드와 같은 값에서 읽는다. */
function waitingFor(request: PendingPermission): string {
  const view = describeApproval(request, "", null);
  if (view.command) return view.command;
  if (view.kind === "edit") return baseName(view.diff?.path ?? view.subject ?? "");
  return view.subject ?? view.title;
}

/** 그 물음이 선 때 — 기록의 물음 줄 시각이다. 요청 id는 Session마다 0부터 세므로 물은 참여자와 함께 찾는다(v1 티켓 25). */
function askedAt(lines: readonly RecordLine[], request: PendingPermission): string {
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at];
    const payload = isObject(line.payload) ? line.payload : {};
    const asked = line.kind === "permission" && payload.state === "asked";
    if (asked && text(payload.requestId) === request.requestId && (line.who ?? "host") === request.who) return line.at;
  }
  return "";
}

/** 도는 턴들에서 가장 늦게 시작한 도는 도구 — 그 턴의 참여자와 함께. 없으면 `null`이다. */
function runningTool(turns: readonly Turn[]) {
  let found: { who: string | null; entry: ToolEntry } | null = null;
  for (const turn of turns) {
    for (const entry of turn.entries) {
      if (entry.kind !== "tool" || describeTool(entry).state !== "running") continue;
      if (found === null || Date.parse(entry.startedAt) >= Date.parse(found.entry.startedAt)) found = { who: turn.who, entry };
    }
  }
  return found;
}

/** 줄의 글 — Host가 아닌 Agent의 일은 이름을 앞에 단다(보드 「리뷰어 · 수정 요청 2건」, `SidebarThreads`의 마지막 말과 같은 꼴). */
function said(who: string | null, words: string, cast: Record<string, CastMember>): string {
  return who && who !== "host" ? `${cast[who]?.name ?? who} · ${words}` : words;
}

/** 마지막 턴 끝 줄의 seq — 끝난 턴이 없으면 0이다. */
function lastEnd(lines: readonly RecordLine[]): number {
  let seq = 0;
  for (const line of lines) if (line.kind === "turn-end") seq = Math.max(seq, line.seq);
  return seq;
}

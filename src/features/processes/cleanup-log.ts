import { processCount } from "./process-tree";
import type { CleanupEvent, CleanupOutcome, CleanupReason, CleanupTarget } from "./types";

// **정리 기록을 사람 말로**(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32). 앱이 무엇을 언제 왜 끝냈는지가 `Processes`의 맨 끝 묶음에
// 선다 — 사건마다 까닭과 대상 수(와 때), 펼치면 대상마다 이름 · 명령줄 · 결과. 이 모듈은 기록 한 줄을 화면의 말로 옮긴다. 순수하다.

/**
 * 까닭의 말 — 프로세스 결정 6 · 스펙 S5의 낱말이다. 「손으로」는 [끝내기] · [정리]의 까닭이라 「손으로 끝냄」으로 풀어 적는다: 줄의 머리에
 * 「손으로」만 서면 무엇을 손으로 했는지가 빈다.
 */
export const REASON_LABEL: Readonly<Record<CleanupReason, string>> = {
  shellClose: "셸 닫기",
  shellExit: "셸 스스로 끝남",
  appExit: "앱 종료",
  reload: "새로고침",
  archive: "아카이브",
  mcpArchive: "MCP 아카이브",
  startupCleanup: "시작 정리",
  manual: "손으로 끝냄",
};

/** 결과의 말 — 「못 끝냄」은 판 04의 `●`를 켜는 결과다(프로세스 스펙 S41). */
export const OUTCOME_LABEL: Readonly<Record<CleanupOutcome, string>> = {
  ended: "끝남",
  forced: "강제로 끝남",
  survived: "못 끝냄",
  gone: "이미 없음",
};

/**
 * 까닭의 말. **모르는 까닭은 그 글자 그대로다** — 뒤 판의 앱이 쓴 기록을 앞 판이 읽는 날(두 빌드가 같은 데이터 루트를 쓴다) 모르는
 * 까닭이 온다. 빈 머리보다 그 글자가 낫다.
 */
export function reasonLabel(reason: CleanupReason): string {
  return (REASON_LABEL as Readonly<Record<string, string>>)[reason] ?? reason;
}

/** 결과의 말 — 모르는 결과는 그 글자 그대로다(`reasonLabel`과 같은 까닭). */
export function outcomeLabel(outcome: CleanupOutcome): string {
  return (OUTCOME_LABEL as Readonly<Record<string, string>>)[outcome] ?? outcome;
}

/**
 * 사건의 때 — 오늘이면 시계의 시각 「14:02:33」(머리의 잰 시각과 같은 꼴), 어제면 「어제 23:12」, 그보다 앞이면 「9월 27일 14:03」(시안
 * Processes의 정리 기록 — restart 03-12c). 끝내기가 **끝난** 때다(Rust `Event.at`). 이 화면의 다른 경과(「조용함 2h」)와 달리 「언제」를 묻는
 * 자리라 시계의 시각으로 적는다 — 박자마다 늙는 경과는 기록의 말이 아니다. 「어제」는 달력의 날이라 자정에만 바뀐다. 시각은 이 맥의
 * 시간대다. 지금(`now`)은 부르는 쪽이 줄 수 있다(시험).
 */
export function loggedAt(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  const clock = `${two(date.getHours())}:${two(date.getMinutes())}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (at >= today.getTime()) return `${clock}:${two(date.getSeconds())}`;
  if (at >= yesterday.getTime()) return `어제 ${clock}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${clock}`;
}

/** 사건 한 줄 — 「까닭, 프로세스 N개, 때」. 눈에 보이는 줄과 접근성 이름이 같은 이것을 읽는다. */
export function eventLabel(event: CleanupEvent): string {
  return `${reasonLabel(event.reason)}, ${processCount(event.targets.length)}, ${loggedAt(event.at)}`;
}

/**
 * 사건 줄의 열쇠 — 번호와 때다. 번호는 파일 안에서 오르기만 하지만(티켓 29) 번호가 없던 판의 줄은 모두 0이라 때와 함께 짓는다. 둘 다
 * 같은 줄(번호 없는 옛 줄이 같은 ms에 둘)은 목록이 겹침 차례로 가른다(`eventKeys`).
 */
export function eventKey(event: CleanupEvent): string {
  return `${event.id}@${event.at}`;
}

/**
 * 목록의 사건마다 열쇠 — 펼침과 줄을 든다. `eventKey`이고, **같은 열쇠가 앞에 이미 섰을 때만** 그 겹침 차례를 붙인다(`#1`, `#2` …).
 *
 * 목록 안 자리를 붙이지 않는다: 기록은 새 사건을 맨 앞에 넣으므로(Rust `cleanup_log::add`) 자리를 붙이면 새 사건 하나에 모든 열쇠가
 * 밀려, 펼쳐 읽던 사건이 다음 박자에 접힌다. 겹치는 것은 번호가 없던 판의 옛 줄이 같은 ms에 둘일 때뿐이고, 그 줄들은 목록 끝에서 제
 * 차례를 지키므로 겹침 차례도 안 바뀐다.
 */
export function eventKeys(events: ReadonlyArray<CleanupEvent>): string[] {
  const taken = new Map<string, number>();
  return events.map((event) => {
    const key = eventKey(event);
    const before = taken.get(key) ?? 0;
    taken.set(key, before + 1);
    return before === 0 ? key : `${key}#${before}`;
  });
}

/** 펼친 대상 한 줄 — 「이름, 결과」. 명령줄은 그 밑에 따로 선다(길어서 한 줄에 못 싣는다). */
export function targetLabel(target: CleanupTarget): string {
  return `${target.name}, ${outcomeLabel(target.outcome)}`;
}

/**
 * 사건 줄의 대상 칸(restart 03-11 · 시안 Processes 「정리 기록」의 `때 · 까닭 · 대상 · 결과` 한 줄) — 첫 대상의 이름이고, 여럿이면 남은 수를
 * 붙인다(「node 외 2개」). 이름 전부는 펼친 줄이 보인다.
 */
export function eventWhat(event: CleanupEvent): string {
  const [first, ...rest] = event.targets;
  if (first === undefined) return "";
  return rest.length === 0 ? first.name : `${first.name} 외 ${rest.length}개`;
}

/** 결과의 무게 — 앞선 것이 더 손볼 결과다. */
const OUTCOME_WEIGHT: ReadonlyArray<CleanupOutcome> = ["survived", "forced", "ended", "gone"];

/**
 * 사건 줄의 결과 칸 — **가장 손볼 결과**다: 못 끝냄이 하나라도 있으면 못 끝냄(`bad` — 경고 잉크, 시안 `data-bad`), 그다음 강제로 끝남 · 끝남 ·
 * 이미 없음 차례다. 섞인 사건의 결과마다의 수는 펼친 줄이 보인다. 모르는 결과(뒤 판의 기록)만 있으면 그 글자다.
 */
export function eventOutcome(event: CleanupEvent): { text: string; bad: boolean } {
  const outcomes = event.targets.map((target) => target.outcome);
  const top = OUTCOME_WEIGHT.find((outcome) => outcomes.includes(outcome)) ?? outcomes[0];
  return top === undefined ? { text: "", bad: false } : { text: outcomeLabel(top), bad: top === "survived" };
}

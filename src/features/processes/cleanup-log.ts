import type { CleanupEvent, CleanupOutcome, CleanupReason } from "./types";

// **정리 기록을 사람 말로**(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32). 앱이 무엇을 언제 왜 끝냈는지가 `Processes`의 맨 끝 묶음에
// 선다 — **대상마다 한 줄**(때 · 까닭 · 대상 · 결과, restart 03-15d · 시안 Processes). 기록은 사건 단위로 오고 화면이 편다(`cleanupRows`).
// 이 모듈은 기록을 화면의 줄과 말로 옮긴다. 순수하다.

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

/** 결과의 말 — 「못 끝냄」은 줄의 결과 칸이 경고 잉크로 선다(시안 Processes `data-bad`). */
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

/**
 * 사건 줄의 열쇠 — 번호와 때다. 번호는 파일 안에서 오르기만 하지만(티켓 29) 번호가 없던 판의 줄은 모두 0이라 때와 함께 짓는다. 둘 다
 * 같은 줄(번호 없는 옛 줄이 같은 ms에 둘)은 목록이 겹침 차례로 가른다(`eventKeys`).
 */
export function eventKey(event: CleanupEvent): string {
  return `${event.id}@${event.at}`;
}

/**
 * 목록의 사건마다 열쇠 — 그 사건의 줄들을 든다(`cleanupRows`). `eventKey`이고, **같은 열쇠가 앞에 이미 섰을 때만** 그 겹침 차례를
 * 붙인다(`#1`, `#2` …).
 *
 * 목록 안 자리를 붙이지 않는다: 기록은 새 사건을 맨 앞에 넣으므로(Rust `cleanup_log::add`) 자리를 붙이면 새 사건 하나에 모든 열쇠가
 * 밀려, 박자마다 옛 줄이 모두 새 줄로 다시 선다. 겹치는 것은 번호가 없던 판의 옛 줄이 같은 ms에 둘일 때뿐이고, 그 줄들은 목록 끝에서
 * 제 차례를 지키므로 겹침 차례도 안 바뀐다.
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

/** 화면의 정리 기록 한 줄 — 시안 Processes `.pr-logrow`의 칸이다. */
export interface CleanupRow {
  /** 줄의 열쇠 — 사건의 열쇠(`eventKeys`)와 그 사건 안 대상의 차례. */
  key: string;
  /** 사건의 때(`loggedAt`). */
  when: string;
  /** 사건의 까닭(`reasonLabel`). */
  why: string;
  /** 대상의 이름. */
  what: string;
  /** 대상의 결과(`outcomeLabel`). */
  outcome: string;
  /** 못 끝냄 — 경고 잉크(시안 `data-bad`). */
  bad: boolean;
}

/**
 * **사건을 대상마다 한 줄로 편다**(restart 03-15d · 시안 Processes 「정리 기록」) — 사건의 차례(새것부터) 안에서 대상의 차례다. 줄마다
 * 그 사건의 때 · 까닭과 그 대상의 이름 · 결과가 선다. 대상 없는 사건은 줄이 없다. 기록(Rust `cleanup_log`)은 사건 단위 그대로다 — 셸
 * 하나를 닫은 일이 한 사건이다(티켓 32).
 *
 * 열쇠는 사건의 열쇠에 대상의 차례를 붙인다 — 새 사건이 맨 위에 서도 옛 줄의 열쇠가 그대로다(`eventKeys`). 지금(`now`)은 때의 꼴을
 * 가른다(`loggedAt`).
 */
export function cleanupRows(events: ReadonlyArray<CleanupEvent>, now: number = Date.now()): CleanupRow[] {
  const keys = eventKeys(events);
  return events.flatMap((event, at) =>
    event.targets.map((target, index) => ({
      key: `${keys[at]}/${index}`,
      when: loggedAt(event.at, now),
      why: reasonLabel(event.reason),
      what: target.name,
      outcome: outcomeLabel(target.outcome),
      bad: target.outcome === "survived",
    })),
  );
}

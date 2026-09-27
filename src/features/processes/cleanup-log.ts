import { processCount } from "./process-tree";
import type { CleanupEvent, CleanupOutcome, CleanupReason, CleanupTarget } from "./types";

// **정리 기록을 사람 말로**(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32). 앱이 무엇을 언제 왜 끝냈는지가 `Processes`의 맨 끝 묶음에
// 선다 — 사건마다 까닭과 대상 수(와 때), 펼치면 대상마다 이름 · 명령줄 · 결과. 이 모듈은 기록 한 줄을 화면의 말로 옮긴다. 순수하다.

/**
 * 까닭의 말 — 결정 6 · 스펙 S5의 낱말이다. 「손으로」는 [끝내기] · [정리]의 까닭이라 「손으로 끝냄」으로 풀어 적는다: 줄의 머리에
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
 * 사건의 때 — 「9월 27일 14:03」. 끝내기가 **끝난** 때다(Rust `Event.at`). 이 화면의 다른 경과(「조용함 2h」)와 달리 「언제」를 묻는
 * 자리라 시계의 시각으로 적는다 — 새로 읽을 때마다 늙는 상대 시간은 기록의 말이 아니다. 시각은 이 맥의 시간대다.
 */
export function loggedAt(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${hh}:${mm}`;
}

/** 사건 한 줄 — 「까닭, 프로세스 N개, 때」. 눈에 보이는 줄과 접근성 이름이 같은 이것을 읽는다. */
export function eventLabel(event: CleanupEvent): string {
  return `${reasonLabel(event.reason)}, ${processCount(event.targets.length)}, ${loggedAt(event.at)}`;
}

/**
 * 사건 줄의 열쇠 — 번호와 때다. 번호는 파일 안에서 1부터 오르지만(티켓 29) 번호가 없던 판의 줄은 모두 0이라 때와 함께 짓는다. 둘 다
 * 같은 줄(번호 없는 옛 줄이 같은 ms에 둘)은 기록이 차례로 준 자리로 가른다 — 화면이 목록 안 차례를 덧붙인다.
 */
export function eventKey(event: CleanupEvent): string {
  return `${event.id}@${event.at}`;
}

/** 펼친 대상 한 줄 — 「이름, 결과」. 명령줄은 그 밑에 따로 선다(길어서 한 줄에 못 싣는다). */
export function targetLabel(target: CleanupTarget): string {
  return `${target.name}, ${outcomeLabel(target.outcome)}`;
}

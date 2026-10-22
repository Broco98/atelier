import { formatCreated } from "@/features/works/status";

/** 달력의 하루 — `YYYY-MM-DD`. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * 치운 날(`ArchiveEntry.archivedAt`)의 하루 — 코어가 아카이브할 때 적는 지역 날짜(`YYYY-MM-DD`, `archive_work`)다. 앞의 날짜만 읽어 뒤에
 * 시각이 붙은 값도 같은 날로 읽는다. 날짜가 없거나(손으로 옮긴 폴더) 날짜로 읽히지 않으면 `null`이다 — 없는 날을 지어내지 않는다.
 */
export function archivedDay(archivedAt: string | null): string | null {
  return archivedAt?.match(DAY)?.[0] ?? null;
}

/** 치운 날을 사람이 읽는 글자로 — 작업이 만들어진 날과 같은 꼴이다(「8월 10일」, `formatCreated`). 날이 없으면 `null`이다. */
export function archivedDayText(archivedAt: string | null): string | null {
  const day = archivedDay(archivedAt);
  return day && formatCreated(day);
}

/**
 * 목록의 날짜 소제목(codex-ds 스펙 S11 — 「이번 주 · 8월 …」). 같은 소제목의 행이 한 묶음이다.
 * - **이번 주** — 오늘이 든 주(월요일부터)의 날. 앞날(시계가 어긋난 기계에서 적힌 날)도 여기 든다.
 * - **N월** — 올해의 그 밖의 날. 이번 달이어도 이번 주가 아니면 달 이름이다.
 * - **YYYY년 N월** — 지난해까지.
 * - **날짜 없음** — 치운 날이 없는 폴더(손으로 옮긴 것). 날짜순 목록의 한쪽 끝에 모인다.
 *
 * `today`는 화면이 그리는 순간의 지금이다 — 날짜는 그 기계의 지역 달력으로 읽는다(코어가 적는 날도 지역 날짜다).
 */
export function dayHeading(day: string | null, today: Date): string {
  const parts = day?.match(DAY);
  if (!parts) return "날짜 없음";
  const [, y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  if (date >= weekStart) return "이번 주";
  return y === today.getFullYear() ? `${m}월` : `${y}년 ${m}월`;
}

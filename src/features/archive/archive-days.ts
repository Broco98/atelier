/** 달력의 하루 — `YYYY-MM-DD`. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * 치운 날(`ArchiveEntry.archivedAt`)의 하루 — 코어가 아카이브할 때 적는 지역 날짜(`YYYY-MM-DD`, `archive_work`)다. 앞의 날짜만 읽어 뒤에
 * 시각이 붙은 값도 같은 날로 읽는다. 날짜가 없거나(손으로 옮긴 폴더) 날짜로 읽히지 않으면 `null`이다 — 없는 날을 지어내지 않는다.
 * 목록의 「보관한 날」 칸 · 차례(`placeDate` · `sortPlaces`)와 상세의 위 카드(`archiveFacts`)가 이것으로 읽는다(restart 03-4). 한때 목록 칸의
 * 날짜 소제목(「이번 주 · 8월 …」 — `dayHeading`)과 행의 날 글(`archivedDayText`)도 여기 있었다 — 목록 틀에는 소제목이 없다.
 */
export function archivedDay(archivedAt: string | null): string | null {
  return archivedAt?.match(DAY)?.[0] ?? null;
}

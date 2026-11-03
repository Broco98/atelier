// **공용 목록 틀의 갈래**(restart 03-1 · 스펙 「03 — 목록과 상세」 · 보드 PlaceSheet 「규격」 · 「움직임과 조작」 · Places) — Projects · Services ·
// Archive가 한 틀을 쓴다(`PlaceList.tsx`). 여기는 줄의 차례 · 열 머리를 누른 뒤의 정렬 · 시각 칸의 글을 고른다 — 렌더 없이 L2가 잰다.

/** 정렬 — 칸(이름 · 시각)과 방향. 시각 칸은 화면마다 이름이 다르다(「최근 활동」 · 「보관한 날」). */
export interface PlaceSort {
  key: "name" | "when";
  dir: "asc" | "desc";
}

/** 처음 정렬 — 시각이 새것부터다(스토리 113 「최근 활동 순」). */
export const FIRST_SORT: PlaceSort = { key: "when", dir: "desc" };

/** 열 머리를 눌렀다 — 같은 칸이면 방향이 뒤집히고, 다른 칸이면 이름은 가나다순 · 시각은 새것부터로 선다(보드 `sortBy`). */
export function nextSort(sort: PlaceSort, key: PlaceSort["key"]): PlaceSort {
  if (sort.key === key) return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

const byName = (a: string, b: string) => a.localeCompare(b, "ko");

/**
 * 줄의 차례 — 이름은 한국어 차례(보드 `localeCompare(…, 'ko')`)다. 시각 순이면 시각이 없는 줄(활동이 없음)은 방향과 상관없이 끝에 이름 순으로
 * 선다 — 「없음」은 가장 옛것도 가장 새것도 아니다. 시각이 같으면 이름 순이다. 받은 목록은 고치지 않는다.
 */
export function sortPlaces<T>(rows: readonly T[], sort: PlaceSort, nameOf: (row: T) => string, whenOf: (row: T) => string | null): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const time = (row: T) => {
    const at = whenOf(row);
    const ms = at === null ? NaN : Date.parse(at);
    return Number.isNaN(ms) ? null : ms;
  };
  return [...rows].sort((a, b) => {
    if (sort.key === "name") return byName(nameOf(a), nameOf(b)) * sign;
    const [ta, tb] = [time(a), time(b)];
    if (ta === null || tb === null) return ta === tb ? byName(nameOf(a), nameOf(b)) : ta === null ? 1 : -1;
    return ta === tb ? byName(nameOf(a), nameOf(b)) : (ta - tb) * sign;
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 시각 칸의 글(보드 Places 「12분」 · 「3시간」 · 「어제」 · 「3일」 · 「2주」 · 「4주」) — 지금과의 거리를 짧게 말한다. 한 시간 안은 분, 하루 안은
 * 시간, 이틀 안은 「어제」, 일주일 안은 일, 다섯 주 안은 주이고 그 앞은 날짜(올해가 아니면 해까지)다. 「어제」도 거리다(24 – 48시간) — 달력의 어제가
 * 아니다. 활동이 없거나 읽지 못한 시각은 「—」다(보드 Archive의 빈 칸). 사이드바 채팅 줄의 시각(`since` — 「어제」 · 요일)과 다른 눈금이다: 목록은
 * 오래된 것을 견주어 고르는 자리라 거리를 같은 단위로 센다. 한때(restart 03-1 – 03-4) 하루는 「1일」이었다.
 */
export function placeWhen(at: string | null, now: number): string {
  const then = at === null ? NaN : Date.parse(at);
  if (Number.isNaN(then)) return "—";
  const ms = Math.max(0, now - then);
  if (ms < MINUTE) return "방금";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}분`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}시간`;
  const days = Math.floor(ms / DAY);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일`;
  if (days < 35) return `${Math.floor(days / 7)}주`;
  const date = new Date(then);
  const day = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${date.getFullYear()}년 ${day}`;
}

/**
 * 상세 위 카드의 날(보드 Places 「추가한 날 — 2026년 3월 2일」) — 저장된 날(`YYYY-MM-DD` — 시각 없는 날이라 시간대를 타지 않게 글에서 읽는다)을 해까지
 * 적는다. 거리가 아니라 그날이다 — 카드는 견주어 고르는 자리가 아니다. 읽지 못한 날은 「—」다.
 */
export function placeDay(day: string): string {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!hit) return "—";
  return `${Number(hit[1])}년 ${Number(hit[2])}월 ${Number(hit[3])}일`;
}

/**
 * 시각 칸이 날일 때의 글(restart 03-4 · 보드 Places Archive 「10월 28일」 · 「—」) — Archive의 「보관한 날」이다. 거리(`placeWhen`)가 아니라 그날이다:
 * 보관함은 언제 치웠는지를 날로 기억하는 자리라 「6일」보다 「10월 28일」이 읽힌다. 올해면 「M월 D일」, 아니면 해까지다(`placeWhen`의 날짜 갈래와
 * 같은 꼴). 저장된 날(`YYYY-MM-DD`)을 글에서 읽어 시간대를 타지 않는다. 없거나 읽지 못하면 「—」다.
 */
export function placeDate(day: string | null, now: number): string {
  const hit = day === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!hit) return "—";
  const [year, month, date] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const short = `${month}월 ${date}일`;
  return year === new Date(now).getFullYear() ? short : `${year}년 ${short}`;
}

// 사이드바 Thread 줄의 시각(v1 티켓 05 · 캔버스 Screen-Home 보드 `.trow .tm`) — 「방금 · 2분 · 1시간 · 어제 · 월 · 10월 3일」. 지금과의 거리를
// 짧게 말한다. 하루가 넘으면 날짜로 센다(어제 · 이번 주의 요일 · 그 앞은 월일).
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function since(at: string, now: number): string {
  const then = new Date(at);
  const ms = now - then.getTime();
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(then);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days <= 1) return "어제";
  if (days < 7) return WEEKDAYS[then.getDay()];
  return `${then.getMonth() + 1}월 ${then.getDate()}일`;
}

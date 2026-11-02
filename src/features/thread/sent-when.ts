// 내 말의 말 머리 시각(restart 02b-6 · Cards 보드 「내 말 — 호버」 `.ra-msg-meta .time`). 보드는 「오후 2:14」 하나다. 다시 연 채팅의 지난 말이
// 오늘의 시각으로 읽히지 않게 어제는 「어제」를, 그 앞은 월일을 앞에 붙인다(PR 카드의 병합한 때 `mergedWhen`과 같은 날 셈).

/** 보낸 때 — 오늘이면 「오후 2:14」, 어제면 「어제 오후 6:12」, 그 앞은 「10월 20일 오후 2:14」. 읽지 못하면 빈 글이다. */
export function sentWhen(at: string, now: number): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const day = (time: number) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((day(now) - day(then.getTime())) / 86_400_000);
  const clock = then.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return clock;
  if (days === 1) return `어제 ${clock}`;
  return `${then.getMonth() + 1}월 ${then.getDate()}일 ${clock}`;
}

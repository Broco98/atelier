import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// **움직임은 상태가 바뀐 그 자리에서만 일어난다**(v1 티켓 43 · 캔버스 Motion 보드 머리말 「움직임은 상태가 바뀐 그 자리에서만 짧게
// 일어납니다」). 들어서는 움직임(`index.css` 「Thread의 움직임」의 `chip-in` · `card-rise` · `pop-in` · `row-in` …)은 마운트에 걸리는데,
// 그대로 두면 Thread를 열 때 이미 있던 줄 · 칩 · 얼굴이 한꺼번에 들어선다. 그래서 「화면이 선 뒤에 새로 섰나」를 여기서 가린다.
// - 화면(Thread 본문 · 머리 줄의 참여자 · 새 Thread)은 `ArrivalScope`로 감싼다. 처음 그린 한 번이 지나면 그 자리가 「섰다」가 된다.
// - 부품은 처음 설 때 그 답을 붙든다(`useArrival`) — 처음 그림에 선 부품은 끝까지 움직이지 않고, 선 뒤에 새로 선 부품(새 결정 줄 · 다음
//   승인 카드 · 새 참여자 얼굴)만 그 움직임으로 선다. 자리를 주지 않은 곳(사이드바 · 정적 렌더)은 늘 「처음」이다.
// - **같은 것이 자리를 옮겨 다시 서면 움직이지 않는다** — 턴이 끝나 결정 줄이 접힌 턴으로 옮겨 서거나, Session 보기가 같은 턴을 다시
//   그리거나, 카드가 걷혀 입력창의 칩이 다시 설 때다. 이름(`id` — 기록 줄의 열쇠 같은)을 준 부품은 그 자리에서 한 번 선 이름이면 다시
//   움직이지 않는다.
// - 마운트가 아니라 **값이 바뀌어** 움직이는 자리(도구 줄의 끝남 · 목록 줄의 상태 · 보내기 원)는 `useChanged`다.

interface ArrivalPlace {
  /** 처음 그린 한 번이 지났나. */
  settled: boolean;
  /** 이 자리에서 한 번 선 이름들 — 커밋 뒤에 적는다(그리는 중에는 적지 않는다). */
  seen: Set<string>;
}

const FIRST: ArrivalPlace = { settled: false, seen: new Set() };

/** 이 자리의 화면이 섰나 — `ArrivalScope`가 처음 그림 뒤에 켠다. 시험은 「선 뒤」(`{ settled: true, seen }`)를 바로 준다. */
export const Arrival = createContext<ArrivalPlace>(FIRST);

/** 화면이 선 뒤의 자리 하나 — 시험이 「선 뒤에 새로 섰다」를 줄 때 쓴다. */
export const settledPlace = (): ArrivalPlace => ({ settled: true, seen: new Set() });

/** 화면 하나 — 처음 그린 한 번이 지나면 그 안에 새로 서는 부품이 들어서는 움직임을 단다. */
export function ArrivalScope({ children }: { children: ReactNode }) {
  const [seen] = useState(() => new Set<string>());
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const place = useMemo(() => ({ settled, seen }), [settled, seen]);
  return <Arrival.Provider value={place}>{children}</Arrival.Provider>;
}

/** 들어서는 움직임의 유틸리티 이름(`index.css` 「Thread의 움직임」). */
export type Motion = "word-in" | "chip-in" | "card-rise" | "pop-in" | "row-in" | "button-in" | "jump-in" | "log-open" | "view-in";

/**
 * 이 부품이 화면이 선 뒤에 새로 섰으면 그 움직임, 아니면 `undefined` — 처음 설 때의 답을 붙든다(다시 그려도 바뀌지 않는다). `id`를 주면
 * 그 이름으로 이 자리에서 이미 섰던 부품(자리를 옮겨 다시 선 것)은 움직이지 않는다.
 */
export function useArrival(motion: Motion, id?: string): Motion | undefined {
  const place = useContext(Arrival);
  const [arrived] = useState(() => place.settled && (id === undefined || !place.seen.has(id)));
  useEffect(() => {
    if (id !== undefined) place.seen.add(id);
  }, [id, place.seen]);
  return arrived ? motion : undefined;
}

/** 들어서는 움직임을 단 상자 하나 — 줄 · 칩을 따로 부품으로 빼지 않고 그 자리에서 감싼다. `arrival`은 `useArrival`의 이름이다. */
export function Arriving({
  as = "div",
  motion,
  arrival,
  className,
  ...rest
}: { as?: "div" | "span" | "li"; motion: Motion; arrival?: string } & HTMLAttributes<HTMLElement>) {
  return createElement(as, { ...rest, className: cn(useArrival(motion, arrival), className) || undefined });
}

/**
 * 값이 바뀌었나 — 처음 본 값(`ready`가 된 뒤의 첫 값)은 바뀐 것이 아니다. 한 번 바뀌면 그 뒤로 늘 `true`다 — 바뀐 칸을 그 값을 열쇠로
 * 새로 세우면(`key`) 바뀔 때마다 다시 움직인다. 바뀐 그 그림에서 곧바로 답한다(이전 값을 상태로 들고 그리는 중에 고친다) — 효과에서
 * 고치면 새 값이 움직임 없이 한 번 그려진 뒤에야 움직임이 걸려, 한 장면 동안 보였다가 옅음에서 다시 선다.
 */
export function useChanged(value: unknown, ready = true): boolean {
  const [seen, setSeen] = useState<{ value: unknown } | null>(ready ? { value } : null);
  const [changed, setChanged] = useState(false);
  if (ready && (seen === null || !Object.is(seen.value, value))) {
    setSeen({ value });
    if (seen !== null) setChanged(true);
  }
  return changed;
}

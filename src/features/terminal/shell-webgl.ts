/**
 * 어느 셸이 WebGL 렌더러를 쥐나(티켓 17 · 프로세스 결정 18 ③ · 프로세스 스펙 S23 · S24). 순수 함수 넷이다 — addon을
 * 싣고 놓는 자리와 다음 프레임을 기다리는 자리는 스토어에 남는다(`terminal-store`의 `holdWebgl` · `loadWebgl`).
 *
 * **왜 우리가 먼저 놓나.** WebKit은 WebContent 프로세스 하나에 WebGL 컨텍스트를 열여섯 개까지 준다. 넘으면 가장 오래 안
 * 그린 컨텍스트를 스스로 잃힌다(콘솔: 「There are too many active WebGL contexts on this page, the oldest context will be
 * lost」). 한때 셸마다 컨텍스트를 쥐고 놓지 않아, 셸이 열여섯을 넘으면 붙일 때마다 숨은 셸 하나가 밀려났고 밀려난 셸로
 * 돌아가면 xterm이 복구를 기다리는 동안 잃은 캔버스에 그려 화면이 비었다. 그래서 **최근에 붙인 셸 N개만** 쥐고,
 * N+1번째가 붙으면 가장 오래 안 붙은 셸의 addon을 WebKit보다 먼저 놓는다 — 놓인 셸은 DOM 렌더러로 그려진다. 최근에 본
 * 셸은 곧바로 그려지고, 오래 안 본 셸로 돌아갈 때 한 번 다시 싣는 값을 받아들인다.
 *
 * **왜 N이 열여섯보다 한참 작나.** 놓은 컨텍스트의 슬롯은 dispose가 아니라 GC 때 풀린다(`loseContext()`도 안 푼다 —
 * 구현 기록 17절에서 Playwright WebKit으로 쟀다). 그 사이 WebKit이 한도에 닿으면 가장 오래 안 그린 것을 잃히는데, 놓은
 * 컨텍스트는 쥔 셸보다 늘 먼저 그리기를 멈췄으니 그것이 먼저 간다 — N 밖의 슬롯이 그 몫이다. 쥔 셸이 다시 붙을 때 한 번
 * 그리게 하는 것(`hold`)도 이 순서를 지키려는 것이다.
 *
 * 이 모듈은 시간을 모른다. 「언제」는 부르는 자리가 정하고, 여기는 사건의 순서만 본다.
 */

/**
 * 동시에 WebGL을 쥐는 셸 수 N(프로세스 스펙 S23). 6~8을 재서 시작값 6 그대로 골랐다(구현 기록 17절): 오래 안 본 셸로
 * 돌아가 다시 싣는 값은 프레임 하나에 10ms 남짓이고, 쥔 셸 하나는 GPU 메모리를 20MB 안팎(창이 크면 더) 든다. N이 작을수록
 * GC를 기다리는 놓은 컨텍스트의 몫(16 - N)도 크다.
 */
export const WEBGL_HOLDERS = 6;

/**
 * 보이는 셸이 컨텍스트를 잃었을 때 다시 싣는 횟수(프로세스 스펙 S24 · Tabby 방식) — 셸마다다. 넘으면 그 셸은 앱이
 * 다시 뜰 때까지 DOM 렌더러에 머문다: 거듭 잃는 GPU에서 잃고 싣기를 끝없이 되풀이하지 않는다.
 */
export const WEBGL_RELOADS = 3;

/** WebGL 자리의 상태 전부. 스토어가 모듈 값으로 들고 있다. */
export interface WebglSeats {
  /** WebGL을 쥔 셸의 레지스트리 id — **가장 최근에 붙은 셸이 맨 앞이다.** */
  holders: readonly number[];
  /** 셸마다 **보이는 채** 컨텍스트를 잃은 수. 숨은 채 잃은 것은 안 센다. 없으면 0이다. */
  losses: ReadonlyMap<number, number>;
}

export const NO_WEBGL_SEATS: WebglSeats = { holders: [], losses: new Map() };

/** 셸이 붙는 순간 할 일. */
export type AttachPlan =
  /**
   * 이미 쥐고 있다 — 맨 앞으로 올리기만 한다. 부르는 쪽은 한 번 그린다: 숨었다 돌아온 셸은 바뀐 것이 없으면 xterm이 다시
   * 안 그려, WebKit이 보는 순서(가장 오래 안 그림)가 우리 순서(가장 오래 안 붙음)와 갈린다.
   */
  | { kind: "hold"; seats: WebglSeats }
  /** 새로 싣는다. `release`의 셸들은 **싣기 전에** addon을 놓는다 — 가장 오래 안 붙은 셸부터다. */
  | { kind: "load"; seats: WebglSeats; release: readonly number[] }
  /** 예산을 다 썼다 — 싣지 않고 자리도 안 차지한다. 다른 셸의 addon을 놓지 않는다. */
  | { kind: "dom"; seats: WebglSeats };

/**
 * 셸이 붙었다 — 셸을 열거나 다시 붙이는 함수가 부른다(처음 붙음 · 떼었다 다시 붙음 · 글꼴이 늦게 와 엶 · 다시 싣기).
 *
 * - 쥐고 있으면 맨 앞으로 간다. 놓는 것이 없다.
 * - 안 쥐고 있고 쥔 셸이 `limit`개면 가장 오래 안 붙은 셸을 놓고 싣는다. 적으면 놓지 않고 싣는다.
 * - 예산을 다 쓴 셸은 싣지 않는다.
 */
export function attachWebgl(seats: WebglSeats, id: number, limit: number = WEBGL_HOLDERS): AttachPlan {
  const others = seats.holders.filter((one) => one !== id);
  if (others.length < seats.holders.length) return { kind: "hold", seats: { ...seats, holders: [id, ...others] } };
  if (!mayHold(seats, id)) return { kind: "dom", seats };
  const kept = seats.holders.slice(0, Math.max(limit - 1, 0));
  return {
    kind: "load",
    seats: { ...seats, holders: [id, ...kept] },
    release: seats.holders.slice(kept.length),
  };
}

/** 잃은 뒤 할 일. */
export type AfterLoss =
  /** 보이는 셸이고 예산이 남았다 — 다음 프레임에 다시 싣는다(다시 붙는 것과 같은 길). */
  | "reload"
  /** 숨은 셸이다 — 다시 붙을 때 새로 싣는다. 예산을 안 쓴다. */
  | "onAttach"
  /** 보이는 셸인데 예산을 넘겼다 — 앱이 다시 뜰 때까지 DOM 렌더러에 머문다. */
  | "stayDom";

export interface LossPlan {
  seats: WebglSeats;
  next: AfterLoss;
}

/**
 * 그 셸이 컨텍스트를 잃었다(xterm이 복구를 기다리다 포기했다). 부르는 쪽은 그 자리에서 addon을 놓는다 — 그래서 잃은
 * 셸은 **더는 쥐지 않는다**: 목록에서 빠지고, 그 자리만큼 다음 셸이 남의 addon을 놓지 않고 싣는다.
 *
 * `shown`은 그 셸이 지금 화면에 붙어 있는가다. 보이는 셸의 손실만 예산을 쓴다 — 숨은 셸은 보일 때 새로 실으면 된다.
 */
export function loseWebgl(seats: WebglSeats, id: number, shown: boolean): LossPlan {
  const holders = seats.holders.filter((one) => one !== id);
  if (!shown) return { seats: { ...seats, holders }, next: "onAttach" };
  const losses = new Map(seats.losses);
  losses.set(id, lossesOf(seats, id) + 1);
  const next = { holders, losses };
  return { seats: next, next: mayHold(next, id) ? "reload" : "stayDom" };
}

/**
 * 싣다가 던졌다(WebGL2를 못 얻었다) — 쥐지 않는다. 예산은 안 쓴다: 예산은 컨텍스트를 **잃은** 것만 센다. 다음 붙음에
 * 다시 싣는다(지금처럼).
 */
export function failWebgl(seats: WebglSeats, id: number): WebglSeats {
  return { ...seats, holders: seats.holders.filter((one) => one !== id) };
}

/** 셸이 닫혔다 — 목록에서 빼고 그 셸의 예산도 잊는다. 셸의 addon은 xterm이 함께 거둔다. */
export function closeWebgl(seats: WebglSeats, id: number): WebglSeats {
  if (!seats.holders.includes(id) && !seats.losses.has(id)) return seats;
  const losses = new Map(seats.losses);
  losses.delete(id);
  return { holders: seats.holders.filter((one) => one !== id), losses };
}

function lossesOf(seats: WebglSeats, id: number): number {
  return seats.losses.get(id) ?? 0;
}

/** 이 셸이 아직 WebGL을 실을 수 있나 — 보이는 채 잃은 것이 예산 안이다. */
function mayHold(seats: WebglSeats, id: number): boolean {
  return lossesOf(seats, id) <= WEBGL_RELOADS;
}

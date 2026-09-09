import { foldHookState } from "./agents";
import type { AgentSignal, CanonicalEvent } from "./agents/types";
import type { Shell } from "./shell-registry";
import type { ShellHookState } from "./types";

// 셸 **상태 축**을 아는 순수 모듈. 「에이전트가 말한 사실 · 사람이 본 행동 · 그 값이 어디서
// 왔는가」 셋을 합쳐 화면이 읽는 값 하나를 낸다. import는 어댑터 하나와 타입뿐이라 DOM 없는
// 기본 환경에서 그대로 돈다(shell-registry.ts가 선례다).
//
// **시간 상수도 만료도 타이머도 없다**(결정 2·3). 「몇 초 조용하면 끝난 것」을 여기서 만들면
// 앱이 모르는 것을 아는 척하게 된다 — 상태를 만드는 것은 에이전트가 말한 순간 하나뿐이고,
// 지우는 것은 사람이 본 순간 하나뿐이다. 그 성질은 주석이 아니라 shell-attention.test.ts의
// 소스 스캔이 지킨다.
//
// **레지스트리와 갈라 둔 이유**는 값 import다. `shell-registry.ts`는 값을 하나도 안 들이는
// 것이 검사로 못박혀 있어(그 파일 머리말) 어댑터를 부를 수 없다. 그래서 규칙은 여기 있고
// 레지스트리에는 「그 칸에 앉힌다」는 리듀서만 남는다.

/** 에이전트가 말한 사실. 「아무 주장도 없음」은 `Attention` 자체가 `null`인 것으로 말한다. */
export type AttentionKind = "waiting" | "done" | "working";

/** 그 값이 어디서 왔나. 권위 규칙이 이 값 하나로 갈린다. */
export type AttentionSource = "hook" | "osc" | "bell";

/**
 * 셸 하나에 붙는 상태.
 *
 * **「없음」의 표현이 하나다.** 스펙은 `kind: … | null`이라 적었지만 그러면 「아무것도 안 온
 * 셸」이 `null`인 상태와 `kind`만 `null`인 상태 둘로 갈리고, 「없는가」를 묻는 자리마다
 * 둘 중 하나만 보는 검사가 생긴다. 여기서는 **통째로 `null`**이 「모른다」다.
 */
export interface Attention {
  kind: AttentionKind;
  /** 화면 둘째 줄·띠·알림 본문이 함께 읽는 한 줄. 어댑터가 접어 준 것 그대로다. */
  message: string | null;
  /** 이 사실이 도착한 시각(훅이 적은 `at`). 경과 표시와 띠 정렬이 읽는다. */
  since: number;
  /** 사람이 그 셸을 본 뒤인가(결정 7). **안 본 완료만** 이 값으로 지워진다. */
  seen: boolean;
  source: AttentionSource;
}

/** 화면값 — 행의 레인·탭 채움·띠·알림이 **모두 이 값 하나만** 읽는다. */
export type ShellSignal = AttentionKind;

/**
 * 정규 이벤트 → `kind`. 스펙 전이 표의 셋째 칸이 그대로 이 표다.
 *
 * `waiting`과 `stop`이 둘 다 「나를 기다림」인 것은 인터뷰가 정한 것이다(결정 3의 표 ·
 * 결정 12). 초록을 만드는 것은 턴이 끝난 것이 아니라 **세션이 끝난 것**이다.
 */
const KIND_OF: Readonly<Record<CanonicalEvent, AttentionKind>> = {
  start: "working",
  waiting: "waiting",
  stop: "waiting",
  end: "done",
  clear: "working",
};

/**
 * 정규 이벤트 하나를 앉힌다. **화면값을 만드는 유일한 문**이다 — 훅도 OSC도 벨도 여기로
 * 들어온다(OSC·벨이 신호를 만드는 길은 #208이 붙인다).
 *
 * **권위**(결정 11): 훅이 한 번이라도 말한 셸에서는 그 뒤 OSC·벨·출력을 무시한다. 이 가름이
 * 없으면 「출력이 `waiting`을 푼다」가 훅 셸에도 걸려, claude가 답을 기다리며 찍는 커서
 * 갱신에 앰버가 꺼진다.
 *
 * **`seen`은 늘 풀린다.** 에이전트가 새로 말했으면 그것은 사람이 아직 안 본 사실이다. 같은
 * `kind`가 다시 올 때만 남겨 두는 안은 기각했다 — 끝난 셸을 한 번 보고 나면 그 뒤 진짜 완료가
 * 영영 안 뜨는 모양이 되고, 그것이 Agent Deck 소스에 적힌 「두 번째 진짜 프롬프트가 삼켜짐」이다.
 */
export function applySignal(
  prev: Attention | null,
  signal: AgentSignal,
  at: number,
  source: AttentionSource,
): Attention {
  if (prev !== null && prev.source === "hook" && source !== "hook") return prev;

  return {
    kind: KIND_OF[signal.event],
    // **지우는 것은 `clear` 하나뿐이다.** `/clear`는 세션을 갈아 끼울 뿐 셸은 그대로라,
    // 방금 지워진 대화의 마지막 말을 남겨 두면 화면이 없는 맥락을 말한다. 나머지 이벤트는
    // 어댑터가 준 것이 있으면 그것을, 없으면 직전 것을 그대로 둔다(전이 표의 「직전 유지」).
    message: signal.event === "clear" ? null : (signal.message ?? prev?.message ?? null),
    since: at,
    seen: false,
    source,
  };
}

/** 다섯 칸이 다 같은가. 「같은 값이면 받은 상태를 그대로 돌려준다」의 판정이다. */
function same(a: Attention | null, b: Attention | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind &&
    a.message === b.message &&
    a.since === b.since &&
    a.seen === b.seen &&
    a.source === b.source
  );
}

/**
 * 훅이 놓고 간 상태 파일 한 장을 이 셸의 상태로 접는다. 감시가 실어 온 것이 그대로 들어온다.
 *
 * **안 바뀌면 받은 것을 그대로 돌려준다** — `setRunning`이 지키는 그 계약이고, 레지스트리의
 * 리듀서는 이 항등성만 보고 칸을 갈아 끼울지 정한다. 판정이 여기 하나라 두 벌이 안 된다.
 *
 * 돌아오는 길 셋: 파일이 사라졌으면 `null`(셸이 닫혔다), 모르는 이벤트면 직전 그대로,
 * 아는 이벤트면 새 상태.
 */
export function nextAttention(
  prev: Attention | null,
  hook: ShellHookState | null,
): Attention | null {
  if (hook === null) return null;

  const signal = foldHookState(hook);
  if (signal === null) return prev;

  const next = applySignal(prev, signal, hook.at, "hook");
  return same(prev, next) ? prev : next;
}

/**
 * 그 칸의 상태. **죽은 칸은 아무것도 안 돌린다** — `runningOn`이 죽은 칸의 `running`을
 * 가리는 것과 같은 가름이다(구현 결정 1).
 *
 * 정상 종료는 레지스트리가 칸을 통째로 빼므로 여기 올 일이 없고, 남는 것은 이유가 있는 끝과
 * 못 뜬 칸뿐이다. 그 칸에 앰버가 굳어 있으면 사람을 영영 부른다. **눕히는 대신 가리는 것**은
 * 뒤늦게 도착한 훅 이벤트까지 같은 문에서 막히기 때문이다 — 끝나는 순간에 한 번 지우면
 * 그 뒤에 온 파일 한 장이 죽은 칸을 다시 세운다.
 *
 * **읽는 쪽은 늘 이 함수를 딛는다.** 화면 둘이 각자 `shell.attention`을 읽으면 한쪽이 이
 * 가름을 빠뜨린다.
 */
export function attentionOn(shell: Shell): Attention | null {
  return shell.status.kind === "running" ? shell.attention : null;
}

/**
 * 그 칸의 **화면값**. 행의 레인 · 탭 채움 · 띠 · 알림이 전부 이 값 하나를 읽는다.
 *
 * 「사실」과 「그리는 것」을 가르는 자리가 여기다: `done`인데 **봤으면 아무것도 안 그린다**.
 * 사실을 지우는 게 아니라 안 그리는 것이라, 그 뒤에 온 새 사실이 `seen`을 풀면 되살아난다.
 * 기다림은 「봤다」로 안 꺼진다 — 본 것과 답한 것은 다르다(결정 7).
 */
export function signalOf(shell: Shell): ShellSignal | null {
  const attention = attentionOn(shell);
  if (attention === null) return null;
  return attention.kind === "done" && attention.seen ? null : attention.kind;
}

/**
 * 우선순위(결정 3). 작을수록 위다 — 기다림 › 안 본 완료 › 도는 중.
 *
 * **숫자를 밖으로 내보내지 않는다.** 순서를 아는 자리가 이 표 하나여야 work 행과 띠가 같은
 * 차례를 말한다.
 */
const RANK: Readonly<Record<ShellSignal, number>> = { waiting: 0, done: 1, working: 2 };

/**
 * 이 셸들의 값 **하나**. work 행의 레인이 읽는다 — 셸이 여럿인 work도 점은 하나다(합의 8).
 *
 * 받는 것이 `ShellsState`가 아니라 칸 배열인 것은 부르는 쪽이 이미 `shellsOf`로 자기 화면을
 * 골라 쥐고 있기 때문이다. 여기서 다시 고르면 「어느 화면인가」를 아는 자리가 둘이 된다.
 */
export function topSignal(shells: ReadonlyArray<Shell>): ShellSignal | null {
  let top: ShellSignal | null = null;
  for (const shell of shells) {
    const signal = signalOf(shell);
    if (signal === null) continue;
    if (top === null || RANK[signal] < RANK[top]) top = signal;
  }
  return top;
}

/**
 * 「확인할 것」 띠에 서는 셸들 — **부르는 셸만**이다(결정 8). 도는 중과 본 완료와 조용한
 * 셸은 안 든다.
 *
 * 정렬은 기다림 먼저, 같은 종류 안에서는 **오래된 순**이다. 오래 기다린 것이 위에 서야
 * 사람이 밀린 순서대로 답한다.
 *
 * **상한 3과 `+N 더`는 여기서 안 자른다**(#204). 자르는 것은 그리는 쪽의 일이고, 여기서
 * 자르면 헤더의 `N`이 셀 것이 사라진다.
 */
export function callingShells(shells: ReadonlyArray<Shell>): ReadonlyArray<Shell> {
  // 화면값과 시각을 **한 번에** 뽑아 두고 그것으로 줄 세운다. 비교 함수 안에서 다시
  // 부르면 정렬이 도는 동안 같은 판정이 수십 번 돌고, 무엇보다 그 자리에서 `null`을
  // 단언으로 지워야 한다 — 걸러 낸 뒤라 안전하지만, 단언은 다음 사람이 조건을 넓힐 때
  // 조용히 거짓말이 된다.
  const calling: { shell: Shell; rank: number; since: number }[] = [];
  for (const shell of shells) {
    const signal = signalOf(shell);
    if (signal !== "waiting" && signal !== "done") continue;
    calling.push({ shell, rank: RANK[signal], since: attentionOn(shell)?.since ?? 0 });
  }

  return calling
    .sort((a, b) => (a.rank === b.rank ? a.since - b.since : a.rank - b.rank))
    .map((one) => one.shell);
}

/**
 * 지금 화면에 켜져 있는 것. 「봤다」 판정이 딛는 전부다 — **여기 없는 입력은 「봤다」가
 * 아니다**(사이드바 hover · 클릭 · 호버 카드, 결정 7).
 */
export interface ShellView {
  /** 켜진 탭의 셸 id들. **분할 중이면 둘이다** — 열마다 켜진 탭이 하나씩이다. */
  activeIds: ReadonlyArray<number>;
  /** 앱 창이 포커스를 가졌나. 이 앱은 창이 하나라 어느 창인지 물을 것이 없다. */
  focused: boolean;
}

/**
 * 그 셸을 **지금 사람이 보고 있나**(결정 7). 탭 물들임(#205)과 알림 억제(#206)가 이 함수
 * 하나를 쓴다 — 두 벌이 되면 한쪽에서만 초록이 꺼져, 알림은 안 울리는데 탭은 계속 초록인
 * (또는 그 반대인) 어긋남이 난다.
 *
 * 이 값이 하는 일은 `seen`을 세우는 것뿐이고, `seen`이 지우는 것은 **안 본 완료 하나**다 —
 * 기다림과 도는 중은 봤다고 사라지지 않는다(`signalOf`).
 */
export function isShellSeen(id: number, view: ShellView): boolean {
  return view.focused && view.activeIds.includes(id);
}

/**
 * 셸 ID에서 **pty 번호**를 되뽑는다. 훅이 아는 이름(`<앱 인스턴스 접두사>-<pty id>`,
 * `pty.rs`의 `shell_id`)과 레지스트리가 아는 번호를 잇는 첫 칸이고, 그다음은
 * `terminal-store`의 `shellOfPty`가 잇는다 — 그 두 번호가 다르다는 것은 `PtyRunning`의
 * 머리말이 든다.
 *
 * **모르는 모양은 `null`이다.** 접두사에도 `-`가 있을 수 있어 마지막 것 뒤만 본다. 숫자가
 * 아니면 `NaN`을 흘리지 않고 여기서 끊는다 — 흘려보내면 `shellOfPty`가 아무 칸도 못 찾은
 * 것과 구분이 안 되어, 왜 상태가 안 앉는지 어디서도 안 보인다.
 */
export function ptyIdOf(shellId: string): number | null {
  const cut = shellId.lastIndexOf("-");
  // 접두사가 있어야 한다. `-`가 없으면 `cut`이 -1이라 통째로 번호로 읽히고, 맨 앞이면
  // 접두사가 빈 것이라 앱이 만든 이름이 아니다 — 둘 다 `cut < 1`로 함께 막힌다.
  if (cut < 1) return null;
  const tail = shellId.slice(cut + 1);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

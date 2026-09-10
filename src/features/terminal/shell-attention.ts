import { foldHookState } from "./agents";
import type { AgentSignal, CanonicalEvent } from "./agents/types";
import { markSeen, runningOn, shellRowName } from "./shell-registry";
import type { Shell, ShellsState } from "./shell-registry";
import type { ShellHookState } from "./types";

// 셸 **상태 축**을 아는 순수 모듈. 「에이전트가 말한 사실 · 사람이 본 행동 · 그 값이 어디서
// 왔는가」 셋을 합쳐 화면이 읽는 값 하나를 낸다. 값으로 들이는 것은 어댑터와 레지스트리의
// **가리개 둘**(`runningOn`)뿐이라 DOM 없는 기본 환경에서 그대로 돈다(shell-registry.ts가
// 선례다). 저쪽을 부르는 것이 여기서 갚아지는 순환처럼 보이지만 아니다 — 레지스트리가 이
// 파일에서 가져가는 것은 타입 하나뿐이라 실행 시점에는 한 방향이다.
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
  /**
   * **이 사실을 말한 에이전트**의 이름(`claude`·`codex`). 훅이 준 것 그대로이고, OSC·벨은
   * 누가 말했는지를 모르므로 `null`이다.
   *
   * **둘째 줄의 마크가 이 값에 매달려 있다.** 마크의 재료를 「지금 그 PTY에서 도는 것」에서만
   * 뽑으면 **초록 행에는 마크가 영영 안 선다** — 초록을 만드는 길 둘(세션 종료 · 벨)이 다
   * 그 순간 도는 에이전트가 없는 자리이기 때문이다: 세션이 끝났다는 것은 프로세스가 나갔다는
   * 뜻이라 1초 폴링이 다음 바퀴에 `running`을 눕히고, 벨은 정의상 「아는 마크가 없을 때」만
   * 초록이 된다. 그래서 「누가 말했나」를 상태가 함께 들고 다닌다.
   */
  agent: string | null;
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
  /**
   * 누가 말했나. **넘겨야 하는 자리**라 OSC·벨을 붙이는 쪽(#208)이 「모른다」를 손으로
   * 적게 된다 — 기본값을 `null`로 두면 훅 길에서 이 값을 빠뜨려도 조용히 통과하고,
   * 그 결과는 초록 행에서 마크가 사라지는 것뿐이라 화면에서 티가 안 난다.
   */
  agent: string | null,
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
    // **직전 것을 이어받지 않는다.** 말을 한 것은 이번에 온 그 이벤트이고, 훅 길에서는 늘
    // 값이 실려 온다. 이어받으면 OSC가 말한 상태에 옛 훅의 이름이 남아 「이 말은 claude가
    // 했다」가 거짓이 된다.
    agent,
  };
}

/**
 * **출력이 도착했다**는 사실 하나를 앉힌다 — 스펙 전이 표의 마지막 줄이고, 이 판에서 상태를
 * 만드는 것이 아니라 **푸는** 유일한 이벤트다.
 *
 * **왜 필요한가**: 훅을 안 깐 Codex 셸에서 승인 요청 OSC가 앰버를 세우면, 그것을 풀 OSC가
 * 영영 안 온다 — Codex는 승인 요청이 떠 있는 동안 턴 완료 OSC를 안 보내기 때문이다(구현
 * 스펙 3절). 사람이 승인한 뒤 **다시 흐르기 시작한 출력**이 그 자리에서 유일한 답이다.
 *
 * **문 셋을 다 지난 것만 푼다.** 화면값이 `waiting`이고 · 그것을 세운 것이 OSC이고 ·
 * 그래서 훅 권위에 안 걸릴 때. 하나라도 넓히면 각각 이렇게 무너진다: `done`까지 풀면 벨이
 * 세운 초록이 다음 프롬프트 한 줄에 사라져 아무도 못 보고, `source`를 안 보면 claude가
 * 답을 기다리며 찍는 커서 갱신에 훅이 세운 앰버가 꺼진다(권위 규칙이 막으려는 바로 그것).
 *
 * **부르는 자리가 PTY 프레임마다다.** 그래서 안 바뀌면 **받은 것을 그대로** 돌려주는 것이
 * 성능 얘기가 아니라 계약이다 — 부르는 쪽은 이 항등성만 보고 스토어를 건드릴지 정한다.
 * 한 번 `working`이 되고 나면 첫 문에서 되돌아 나오므로 그다음 프레임들은 공짜다.
 */
export function nextOnOutput(prev: Attention | null, at: number): Attention | null {
  if (prev === null || prev.kind !== "waiting" || prev.source !== "osc") return prev;
  // **`applySignal`을 딛는다 — 여기서 칸을 직접 짜지 않는다.** 권위 규칙도 「봤다」를 푸는
  // 규칙도 저기 하나에 있고, 손으로 짜면 그 둘이 이 자리에서만 조용히 늙는다.
  return applySignal(prev, { event: "start", message: null }, at, "osc", prev.agent);
}

/** 여섯 칸이 다 같은가. 「같은 값이면 받은 상태를 그대로 돌려준다」의 판정이다. */
function same(a: Attention | null, b: Attention | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind &&
    a.message === b.message &&
    a.since === b.since &&
    a.seen === b.seen &&
    a.source === b.source &&
    a.agent === b.agent
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

  const next = applySignal(prev, signal, hook.at, "hook", hook.agent);
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
 * 「확인할 것」에 드는 화면값(결정 8). 띠에 서는 것 · 독 배지가 세는 것 · 알림이 울리는 것이
 * 전부 **이 갈래 하나**이고, 도는 중과 조용한 셸은 여기 못 온다.
 *
 * **이름을 세워 두는 이유는 축이 늘 때다.** 실패(빨강)는 다음 판이고(결정 12), 그날
 * `AttentionKind`에 값을 하나 더하면 `RANK`·`SIGNAL_LABEL`·`TONE`은 컴파일러가 가리켜
 * 반드시 채워지지만, 「부르는가」를 리터럴 둘로 좁힌 자리들은 **아무 오류도 안 낸다** —
 * 새 축이 조용히 걸러져 띠에도 배지에도 알림에도 안 나타난다. 그 셋이 한 목록을 딛고
 * 있으므로(`callingShells`) 갈래의 이름도 하나여야 한다.
 */
export type CallingKind = Extract<ShellSignal, "waiting" | "done">;

/**
 * 그 화면값이 「확인할 것」인가. **이 판정의 유일한 자리다** — 넓히는 날 고칠 곳이 이 한 줄
 * 이어야 띠·배지·알림이 함께 따라온다(위 `CallingKind` 머리말).
 */
export function isCalling(kind: ShellSignal | null): kind is CallingKind {
  return kind === "waiting" || kind === "done";
}

/**
 * 이 셸들의 값 **하나**. work 행의 레인이 읽는다 — 셸이 여럿인 work도 점은 하나다(합의 8).
 *
 * 받는 것이 `ShellsState`가 아니라 칸 배열인 것은 부르는 쪽이 이미 `shellsOf`로 자기 화면을
 * 골라 쥐고 있기 때문이다. 여기서 다시 고르면 「어느 화면인가」를 아는 자리가 둘이 된다.
 */
export function topSignal(shells: ReadonlyArray<Shell>): ShellSignal | null {
  return topSignalView(shells)?.kind ?? null;
}

/**
 * 그 화면이 **한 행에 그리는 것 전부**(#203). 레인의 점·링은 `kind`가 정하고 둘째 줄은
 * 나머지 셋이 정한다 — 셸의 마지막 말 · 그것이 도착한 시각 · 그 셸에서 도는 것(마크).
 *
 * **넷이 한 셸에서 나온다.** 값만 고르는 함수와 말만 고르는 함수를 따로 두면 행이 「A 셸의
 * 색으로 B 셸의 말」을 적을 수 있는데, 그 어긋남은 화면에서 아무 표시도 안 난다 — 스토리
 * 79가 막으려는 것이 그것이라 이기는 셸을 고르는 자리를 여기 하나로 둔다. `topSignal`도
 * 이 함수를 딛는다.
 *
 * **마크의 재료가 원문인 것**은 표를 아는 자리가 `agentMarkOf` 하나이기 때문이다
 * (판 04 결정 15) — 여기서 접으면 그 표가 두 벌이 된다. 죽은 칸을 가리는 것은 `runningOn`이
 * 하므로 끝난 셸의 마지막 로고가 행에 남지 않는다.
 */
export interface SignalView {
  kind: ShellSignal;
  /** 셸이 마지막으로 한 말의 첫 줄. 어댑터가 접어 준 것 그대로이고, 없으면 `null`이다. */
  message: string | null;
  /** 그 사실이 도착한 시각. 둘째 줄의 경과가 이 값을 읽는다. */
  since: number;
  /**
   * **마크의 재료** — 지금 그 셸에서 도는 것의 원문이고, 그것이 없으면 **이 상태를 말한
   * 에이전트**다(`Attention.agent`).
   *
   * 둘째 갈래가 필요한 이유는 초록이다: 세션 종료도 벨도 그 순간 도는 에이전트가 없어
   * (`Attention.agent` 머리말) 앞쪽만 보면 초록 행의 둘째 줄이 늘 말과 경과 둘뿐이 된다.
   * 앞쪽이 이기는 것은 「지금 무엇을 물고 있나」가 더 새로운 사실이기 때문이다 — 훅이
   * claude라고 말한 뒤 사람이 codex를 띄웠으면 행은 codex를 보여야 한다.
   */
  running: string | null;
}

export function topSignalView(shells: ReadonlyArray<Shell>): SignalView | null {
  let top: { shell: Shell; kind: ShellSignal } | null = null;
  for (const shell of shells) {
    const kind = signalOf(shell);
    if (kind === null) continue;
    if (top === null || RANK[kind] < RANK[top.kind]) top = { shell, kind };
  }
  if (top === null) return null;

  // 여기서 `attention`을 다시 묻는 것이 아니라 **가리는 문을 다시 딛는다** — `signalOf`가
  // 이미 죽은 칸을 걸렀으므로 값이 있는 것은 확실하지만, 그 확신을 단언으로 적어 두면
  // 다음 사람이 위 조건을 넓힐 때 조용히 거짓말이 된다.
  //
  // **없으면 줄을 안 그린다.** 한때 여기가 `since: attention?.since ?? 0`이었는데, 그것은
  // 그 「넓히는 날」에 행이 1970년부터의 경과(`497000h` 꼴)를 조용히 그리는 fail-open이다 —
  // 사람이 읽는 글자라 틀린 값이 그대로 뜻이 된다. 단언 없이 문을 닫으면 그때 무너지는
  // 쪽이 「아무것도 안 그린다」가 된다.
  const attention = attentionOn(top.shell);
  if (attention === null) return null;
  return {
    kind: top.kind,
    message: attention.message,
    since: attention.since,
    running: runningOn(top.shell) ?? attention.agent,
  };
}

/**
 * work마다 화면값 하나. **사이드바가 목록 전체를 한 번에 읽는 값**이다(#203).
 *
 * **값이 문자열이라 얕은 비교가 그대로 먹는다** — 그것이 이 Record가 존재하는 이유 전부다.
 * 객체를 담으면 회차마다 새것이라 비교가 늘 어긋나고, 어느 셸에서 명령이 시작될 때마다
 * 목록 열여덟 행이 통째로 다시 그려진다(`runningAgentsOf` 머리말이 든 함정). 둘째 줄이
 * 쓰는 나머지 셋(말·시각·마크)은 그래서 행마다 따로 구독한다.
 *
 * **값이 없는 work은 키 자체가 없다.** `null`을 적어 두면 조용한 work 열여덟이 전부 키를
 * 갖고, 그 Record는 셸이 하나도 없어도 목록만큼 커진다.
 *
 * **최상위 셸은 안 든다** — 어느 work의 것도 아니라 행이 없다(`shellCountsOf`와 같은 가름).
 * 그 셸이 부르는 것은 nav `Terminal`과 띠가 받는다(#204).
 */
export function signalsByOwner(state: ShellsState): Record<string, ShellSignal> {
  const groups = new Map<string, Shell[]>();
  for (const shell of state.shells) {
    if (shell.owner === null) continue;
    const group = groups.get(shell.owner);
    if (group) group.push(shell);
    else groups.set(shell.owner, [shell]);
  }

  const out: Record<string, ShellSignal> = {};
  for (const [owner, group] of groups) {
    const signal = topSignal(group);
    if (signal !== null) out[owner] = signal;
  }
  return out;
}

/**
 * 부르는 셸 하나 — **그 판정까지 함께** 든다. 「누가 부르나」를 정하면서 이미 읽은 것
 * (어떤 부름인가 · 언제부터인가)을 버리지 않는 것이 요점이다.
 */
export interface CallingShell {
  shell: Shell;
  /** 부르는 줄만 서므로 **둘 중 하나**다 — 도는 중은 여기 못 온다(`CallingKind`). */
  kind: CallingKind;
  /**
   * 그 셸이 말한 사실 **통째로**. 정렬의 둘째 키(`since`)도 마크의 재료(`agent`)도 여기
   * 있어서, 읽는 쪽이 문(`attentionOn`)을 다시 딛을 일이 없다 — 그것이 이 필드가 `since`
   * 하나가 아닌 이유다.
   */
  attention: Attention;
}

/**
 * 「확인할 것」 띠에 서는 셸들 — **부르는 셸만**이다(결정 8). 도는 중과 본 완료와 조용한
 * 셸은 안 든다.
 *
 * 정렬은 기다림 먼저, 같은 종류 안에서는 **오래된 순**이다. 오래 기다린 것이 위에 서야
 * 사람이 밀린 순서대로 답한다.
 *
 * **판정하는 자리가 여기 하나다.** 한때 이 함수가 셸만 돌려주고 `kind`·`since`를 버려서,
 * 바로 아래 `bandRows`가 같은 셸에 `attentionOn`·`signalOf`를 **다시** 물었다 — 같은 사실을
 * 두 자리에서 두 번 판정하는 모양이고(`topSignalView` 머리말의 「이기는 셸을 고르는 자리를
 * 여기 하나로 둔다」와 반대다), 실제로 그 둘이 **다르게** 판정했다: 이쪽은 `?? 0`으로
 * fail-open이라 1970년부터의 경과를 만들 수 있었고 저쪽은 줄을 아예 안 그렸다. 세는 자리가
 * 늘면(#206의 독 배지가 「확인할 것의 수」를 여기서 세면) 그 갈림이 화면에 나온다.
 *
 * **상한 3과 `+N 더`는 여기서 안 자른다**(#204). 자르는 것은 그리는 쪽의 일이고, 여기서
 * 자르면 헤더의 `N`이 셀 것이 사라진다.
 */
export function callingShells(shells: ReadonlyArray<Shell>): ReadonlyArray<CallingShell> {
  // 화면값과 시각을 **한 번에** 뽑아 두고 그것으로 줄 세운다. 비교 함수 안에서 다시
  // 부르면 정렬이 도는 동안 같은 판정이 수십 번 돌고, 무엇보다 그 자리에서 `null`을
  // 단언으로 지워야 한다 — 걸러 낸 뒤라 안전하지만, 단언은 다음 사람이 조건을 넓힐 때
  // 조용히 거짓말이 된다.
  const calling: CallingShell[] = [];
  for (const shell of shells) {
    const kind = signalOf(shell);
    // **갈래의 이름을 딛는다.** 리터럴 둘로 좁히면 축이 느는 날 새 값이 조용히 걸러져
    // 띠·독 배지·알림 셋이 함께 침묵한다(`CallingKind` 머리말).
    if (!isCalling(kind)) continue;
    // **없으면 줄을 안 낸다.** `signalOf`가 이미 죽은 칸을 걸렀으므로 값이 있는 것은
    // 확실하지만, 그 확신을 `?? 0`으로 메워 두면 다음 사람이 위 조건을 넓히는 날 이 셸이
    // **1970년부터 기다린 것**으로 맨 위에 선다 — 사람이 읽는 글자라 틀린 값이 그대로 뜻이
    // 된다(`topSignalView`가 같은 자리에서 같은 이유로 문을 다시 딛는다).
    const attention = attentionOn(shell);
    if (attention === null) continue;
    calling.push({ shell, kind, attention });
  }

  return calling.sort((a, b) =>
    a.kind === b.kind
      ? a.attention.since - b.attention.since
      : RANK[a.kind] - RANK[b.kind],
  );
}

/**
 * 「확인할 것」 띠의 **줄 하나**(#204). `callingShells`가 정한 차례 그대로이고, 줄이 지는
 * 것은 넷이다 — 어느 화면으로 가는가(`owner`) · 어느 칸을 켜는가(`id`) · 마크의 재료 ·
 * 그리고 셸 이름을 붙이는가.
 *
 * **work 제목은 여기 없다.** 그 값은 목록 API가 주는 것이라 터미널이 모르고, 알려면 이
 * 모듈이 works를 물어야 한다 — 띠를 그리는 자리(`Sidebar.tsx`)가 이미 둘 다 쥐고 있으므로
 * 거기서 붙인다. 최상위 셸의 `Terminal`도 화면의 말이라 그쪽이 든다(CONTEXT.md의 표기 —
 * 대문자 `Terminal`은 nav가 가는 곳의 이름이다).
 */
export interface BandRow {
  /** 레지스트리의 칸 번호. 누르면 이 칸이 켜진다(`selectShell`). */
  id: number;
  /** 어느 화면인가. `null`이면 최상위 셸이고 누르면 `/terminal`로 간다(결정 13). */
  owner: string | null;
  /** 부르는 줄만 서므로 **둘 중 하나**다 — 도는 중은 여기 못 온다(`CallingKind`). */
  kind: CallingKind;
  /** 경과가 읽는 시각. 정렬의 둘째 키이기도 하다. */
  since: number;
  /** 마크의 재료. 규칙은 행과 같다(`SignalView.running`) — 도는 것이 먼저, 없으면 말한 쪽. */
  running: string | null;
  /**
   * 탭에 적히는 그 이름. **한 화면에서 부르는 셸이 둘 이상일 때만** 찬다(결정 5) —
   * 하나뿐이면 제목만으로 어느 셸인지 정해지므로 붙일 이유가 없다.
   */
  shellName: string | null;
}

/**
 * 띠에 서는 줄 전부. **자르지 않는다** — 상한 3과 `+N 더`는 그리는 쪽의 일이고, 여기서
 * 자르면 헤더의 `N`이 셀 것이 사라진다(`callingShells` 머리말과 같은 가름).
 *
 * **셸 이름의 조건이 이 안에 있는 것**은 그것이 줄 하나로는 못 내는 판정이어서다:
 * 「이 화면에서 부르는 셸이 둘 이상인가」는 목록 전체를 봐야 안다. 그리는 쪽에 두면 띠가
 * 스스로 무리를 세게 되고, 그 셈이 정렬과 갈리는 날 이름이 엉뚱한 줄에 붙는다.
 *
 * 무리를 가르는 키가 `owner`인 것은 **켜지는 자리가 화면마다 따로이기 때문이다**
 * (`activeByOwner`) — 최상위 셸 둘이 부르면 그 둘도 서로 갈려야 한다.
 */
export function bandRows(state: ShellsState): ReadonlyArray<BandRow> {
  const calling = callingShells(state.shells);

  // 화면마다 **부르는** 셸이 몇인가. 조용한 형제는 안 센다 — 이름이 붙는 근거는 「띠에서
  // 두 줄이 같은 제목으로 선다」이지 「그 work에 셸이 여럿이다」가 아니다.
  const perOwner = new Map<string | null, number>();
  for (const { shell } of calling) perOwner.set(shell.owner, (perOwner.get(shell.owner) ?? 0) + 1);

  // **여기서는 아무것도 다시 판정하지 않는다.** 부르는가 · 어떤 부름인가 · 언제부터인가는
  // `callingShells`가 이미 정했고, 이 자리가 더하는 것은 그 줄을 **화면에 세우는 데만**
  // 필요한 것 셋뿐이다 — 어느 칸을 켜는가 · 마크의 재료 · 이름을 붙이는가.
  return calling.map(({ shell, kind, attention }) => ({
    id: shell.id,
    owner: shell.owner,
    kind,
    since: attention.since,
    running: runningOn(shell) ?? attention.agent,
    shellName: (perOwner.get(shell.owner) ?? 0) > 1 ? shellRowName(shell) : null,
  }));
}

/**
 * 지금 화면에 켜져 있는 것. 「봤다」 판정이 딛는 전부다 — **여기 없는 입력은 「봤다」가
 * 아니다**(사이드바 hover · 클릭 · 호버 카드, 결정 7).
 */
export interface ShellView {
  /**
   * 지금 **보고 있는** 셸 id들.
   *
   * **여럿을 받는 것은 이 함수의 계약이지 지금 화면이 아니다.** 결정 7이 「분할 중이면
   * 켜진 탭이 둘」이라 적었지만, 이 판의 분할은 조합이 늘 `spec ▏터미널`이라(결정 87 ·
   * `WorksPage`) 셸 열이 둘이 되는 화면이 없다 — 배선(`terminal-store`의 `shownShell`)은
   * 그래서 하나로 좁혀 있고, 여기만 여럿을 진다. 순수 함수라 그 값이 공짜이고, 열이 둘이
   * 되는 날 고칠 자리가 배선 하나로 남는다. 사람에게 열어 둔 물음은
   * `spec/물음-봤다의-셋째-조건.md`의 둘째 물음이다.
   */
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
 * 지금 보고 있는 셸들에 「봤다」를 앉힌다 — **판정과 기록 사이의 유일한 문**이다(#205).
 *
 * 판정은 위 `isShellSeen` 하나이고 기록은 레지스트리의 `markSeen` 하나다. 그 둘을 잇는
 * 자리가 여럿이면 탭 물들임과 알림 억제(#206)가 **다른 순간에** 같은 판정을 쓰게 된다 —
 * 초록은 꺼졌는데 알림은 울리는(또는 그 반대인) 어긋남이고, 화면에서는 어느 쪽이 틀렸는지
 * 안 보인다.
 *
 * **목록을 다 훑는다** — `view.activeIds`만 보고 앉히지 않는다. 판정을 아는 자리가
 * `isShellSeen`이라 그것을 셸마다 물어야 하고, 그래야 조건이 넓어지는 날(예: 「호버 카드도
 * 봤다」) 이 함수를 안 고쳐도 따라온다. 여덟 칸짜리 목록이라 값이 없다.
 *
 * **안 바뀌면 받은 것을 그대로 돌려준다** — `markSeen`이 그 계약을 지고 있고, 이 함수는
 * 창 포커스가 오갈 때마다 불릴 자리라 그 성질이 없으면 창을 눌렀다 뗄 때마다 목록 전체가
 * 다시 그려진다.
 */
export function markShellsSeen(state: ShellsState, view: ShellView): ShellsState {
  return markSeen(
    state,
    state.shells.filter((shell) => isShellSeen(shell.id, view)).map((shell) => shell.id),
  );
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

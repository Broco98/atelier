import type { ShellSignal } from "@/components/shell/shell-signal";
import type { StatusMarkKind } from "@/components/shell/status-mark";

// **Work 줄의 상태 표시를 고르는 순수 함수**(02 구현 스펙 §4 · S8 · 티켓 05). Work 줄 오른쪽 끝에는 표시가 하나만 서고(`StatusMark`), 그
// 하나는 그 Work에 이은 Thread들 가운데 가장 센 것이다 — 차례는 내 차례 › 도는 중 › 실패 › 새 결과. Thread들이 조용하면 그 Work의 셸
// 신호가 선다: 답을 기다리는 셸은 내 차례 알약, 끝났는데 안 본 셸은 새 결과 점이다. 도는 셸은 표시가 없다(스펙이 셸 신호를 둘만 옮겼다) —
// 사이드바 줄의 스피너는 Thread가 도는 것이고, 셸이 도는 것은 그 Work 화면의 셸 탭 이름(claude 타이틀)과 Processes가 말한다.
//
// **두 출처를 한 차례로 접는다**(S8의 까닭). 셸 신호를 위 차례의 자리로 옮긴 뒤 둘을 함께 견준다 — 그래서 Thread가 조용할 때는 셸
// 신호가 서고(S8 그대로), 셸이 나를 기다리면 도는 Thread보다도 앞이다(나를 기다리는 것이 가장 세다). 안 본 셸은 새 결과의 자리라 실패한
// Thread보다 약하다. 「Thread 먼저, 조용할 때만 셸」로 가르면 Thread 하나가 새 결과일 때 나를 기다리는 셸이 Work 줄에서 사라진다 —
// 그것이 스토리 21의 「셸 신호를 잃지 않는다」가 막는 화면이다(결정.md 「05」).
//
// Thread의 표시는 부르는 쪽이 `markOf`로 지어 건넨다(멈춤 · 조용함 · 아직 못 읽은 Thread는 `null`). 이 함수는 기록도 셸 스토어도 모른다.

/** 센 차례 — 앞이 세다. */
const RANK: readonly StatusMarkKind[] = ["mine", "working", "failed", "new"];

/** 셸 신호가 Work 줄에서 서는 자리 — 도는 셸은 표시가 없다. */
const SHELL_MARK: Readonly<Record<ShellSignal, StatusMarkKind | null>> = {
  waiting: "mine",
  done: "new",
  working: null,
};

/** 그 Work 줄의 상태 표시 — `threads`는 그 Work에 이은 Thread마다의 표시, `shell`은 그 Work 셸들의 화면값(없으면 `null`)이다. */
export function workMark(threads: readonly (StatusMarkKind | null)[], shell: ShellSignal | null): StatusMarkKind | null {
  const marks = [...threads, shell === null ? null : SHELL_MARK[shell]];
  return RANK.find((kind) => marks.includes(kind)) ?? null;
}

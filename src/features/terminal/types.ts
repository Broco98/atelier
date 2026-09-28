/** `pty_spawn`의 응답. `shellName`은 셸 행에 적히는 이름의 재료다(결정 31). */
export interface PtySpawned {
  id: number;
  /**
   * 셸 키 — `<세대>-<PTY 번호>`, 그 셸 env의 `ATELIER_SHELL`과 같은 값이다(프로세스 스펙 S34). **세대는 백엔드만 알아서
   * 답에 실려 온다** — 프런트가 번호만 쥐면 다른 실행이 준 키(알림 클릭)와 이번 실행의 같은 번호 셸을 못 가른다.
   */
  shellKey: string;
  shellName: string;
}

/**
 * 종료 프레임. 출력 프레임과 **같은 채널**로 오므로 마지막 출력보다 늦게 도착하는 것이
 * 보장된다(결정 22).
 *
 * `signal`은 시그널 이름이 아니라 `strsignal()`이 준 사람이 읽는 문자열이다 —
 * macOS에서 `"Terminated: 15"` 꼴이다. 표시용으로만 쓰고 파싱하거나 비교하지 않는다.
 * 같은 이유로 `exitCode`는 시그널로 죽었을 때 셸 관례인 `128+N`이 아니라 `1`이다.
 */
export interface PtyExit {
  exitCode: number;
  signal: string | null;
}

/**
 * 셸을 닫기 전에 묻는 답(`pty_close_check` · `pty_close_checks`) — 프로세스 결정 3이 ux-papercuts 결정 92의
 * 「명령이 도는가」를 넓힌 모양이다.
 *
 * `descendants`는 **확인 창이 말할 수**다 — 이 셸에서 띄운 프로세스 중 셸 도우미(사람이 처음 입력하기 전에 뜬 것),
 * 예외 목록에 걸린 것, 명령 자신(foreground 그룹)을 뺀 것. 빼는 규칙은 백엔드 한 자리(`verdict::close_count`)에만
 * 있다 — 여기서 다시 거르지 않는다.
 */
export interface CloseCheck {
  command: boolean;
  descendants: number;
}

/**
 * 정리 기록의 까닭(프로세스 결정 6 · 프로세스 스펙 S5) — Rust `cleanup_log::Reason`의 와이어 글자(camelCase)다. 화면의 말은
 * `features/processes/cleanup-log.ts`의 `REASON_LABEL`이 든다 — 두 언어가 이 글자로만 이어지므로 그 검사가 Rust 선언을 읽어
 * 견준다.
 *
 * **여기 사는 것은 아래 `CloseReason`이 이것을 좁히기 때문이다.** 정리 기록은 `features/processes`의 것이지만, 그 기능이 이
 * 기능을 가져다 쓰고 반대는 없다 — 닫기의 까닭이 이것을 보려면 이 층에 있어야 한다. `features/processes/types.ts`가 다시
 * 내보낸다.
 */
export type CleanupReason =
  | "shellClose"
  | "shellExit"
  | "appExit"
  | "reload"
  | "archive"
  | "mcpArchive"
  | "startupCleanup"
  | "manual";

/**
 * 닫기 IPC(`pty_kill`)가 싣는 **까닭** — 그 닫기가 끝낸 것이 정리 기록에 이 까닭으로 적힌다(티켓 11). 글자는 Rust
 * `cleanup_log::CloseReason`과 같고, 모르는 글자는 백엔드가 인자째 거절한다. 앱 종료 · 새로고침 · 시작 정리처럼 Rust 안에서
 * 생기는 까닭은 여기 없다.
 *
 * **정리 기록의 까닭에서 좁힌다**(Rust의 `impl From<CloseReason> for Reason`과 같은 관계) — 따로 적으면 한쪽 글자가 바뀌어도
 * 둘이 갈린 줄 모른다. 좁힌 결과가 이 셋 그대로인지는 `types.test.ts`가 타입으로 잰다: `Extract`는 없는 글자를 조용히 버린다.
 *
 * 어느 닫기가 어느 까닭인지는 `shell-registry.ts`의 `CLOSE_REASONS` 한 자리가 고른다.
 */
export type CloseReason = Extract<CleanupReason, "shellClose" | "archive" | "mcpArchive">;

/**
 * 셸 하나에서 **지금 도는 명령**의 이름. `running`이 `null`이면 프롬프트에 서 있다.
 *
 * **채널이 아니라 이벤트로 온다** — 위 둘은 셸 하나에 매인 채널로 오지만 이것은 백엔드의
 * 폴링 스레드가 앱 전체로 쏘는 것이라 통로가 다르다(adr-04). **바뀐 셸만** 실려 오므로,
 * 여기 없는 셸은 「값이 그대로」이지 「아무것도 안 돈다」가 아니다.
 *
 * **`id`는 pty id다** — 셸 레지스트리의 `id`는 프런트가 따로 발급하는 다른 번호이고
 * (`shell-registry.ts`의 `openShell`), 백엔드는 그것을 모른다. 둘을 잇는 자리는
 * `terminal-store.ts`의 `shellOfPty` 하나다.
 */
export interface PtyRunning {
  id: number;
  running: string | null;
}

/**
 * 채널로 오는 프레임 둘. 출력은 `ArrayBuffer`로 도착하므로 읽으려면 `new Uint8Array(frame)`로
 * 한 번 감싸야 한다. 바이트 그대로 오는 이유는 PTY 읽기가 멀티바이트 문자를 조각 경계에서
 * 가르기 때문이다 — 백엔드가 조각마다 문자열로 만들면 그 자리가 `U+FFFD`가 된다.
 */
export type PtyFrame = ArrayBuffer | PtyExit;

/**
 * 셸이 **스스로 말한 것** 한 장 — 훅이 `~/.atelier/shells/<셸 ID>.json`에 적고 백엔드의
 * 감시가 그대로 실어 온다.
 *
 * **`message`가 없다.** 화면에 설 한 줄(호버 카드의 말 칸·띠)은 이벤트마다 다른 자리에서 나오므로
 * (`tool_input` 요약 · `last_assistant_message`의 첫 줄) 에이전트별 어댑터가 `payload`에서
 * 접는다. 그 규칙을 사용자 홈에 설치된 스크립트가 들면 앱을 고쳐도 낡은 셸에서는 안 바뀐다.
 */
export interface ShellHookState {
  agent: string;
  event: string;
  at: number;
  payload: unknown;
  /**
   * 도는 서브에이전트 수(프로세스 스펙 S51). 훅 처리기가 사건마다 id 집합으로 접은 것의 크기다 — 파일은 마지막 사건
   * 하나만 담으므로 화면이 사건을 세면 수가 샌다. 옛 처리기의 파일이면 0이다.
   */
  subagents: number;
  /**
   * 턴이 멈췄나(S50) — Stop · StopFailure에서 참, 새 턴 · 중단에서 거짓, 세션 끝은 그대로 둔다(`claude -p`의 끝을 읽는
   * 칸이다 — `applySignal`의 `end` 줄). 순서 가드에 막힌 늦은 사건은
   * `event` · `at`을 그대로 두고 이 칸과 `subagents`만 바꾼다(S27). 옛 처리기의 파일이면 거짓이다.
   */
  stopped: boolean;
}

/**
 * 상태가 바뀐 셸 하나. **`shellId`는 pty id도 레지스트리 id도 아니다** — 앱이 PTY에 심고
 * 훅이 되읽는 셸 키 `<세대>-<pty id>` 문자열이다(Rust `processes/shell_key.rs`의 `mint`, 프런트는 `shell-key.ts`).
 *
 * `state`가 `null`이면 그 셸의 상태가 사라졌다 — 셸이 닫혔다는 뜻이다. **바뀐 셸만** 실려
 * 오므로 여기 없는 셸은 「값이 그대로」이지 「조용하다」가 아니다.
 */
export interface ShellAttention {
  shellId: string;
  state: ShellHookState | null;
}

/** `pty_spawn`의 응답. `shellName`은 셸 행에 적히는 이름의 재료다(결정 31). */
export interface PtySpawned {
  id: number;
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
 * **`message`가 없다.** 화면 둘째 줄에 설 한 줄은 이벤트마다 다른 자리에서 나오므로
 * (`tool_input` 요약 · `last_assistant_message`의 첫 줄) 에이전트별 어댑터가 `payload`에서
 * 접는다. 그 규칙을 사용자 홈에 설치된 스크립트가 들면 앱을 고쳐도 낡은 셸에서는 안 바뀐다.
 */
export interface ShellHookState {
  agent: string;
  event: string;
  at: number;
  payload: unknown;
}

/**
 * 상태가 바뀐 셸 하나. **`shellId`는 pty id도 레지스트리 id도 아니다** — 앱이 PTY에 심고
 * 훅이 되읽는 `<앱 인스턴스 접두사>-<pty id>` 문자열이다(`pty.rs`의 `shell_id`).
 *
 * `state`가 `null`이면 그 셸의 상태가 사라졌다 — 셸이 닫혔다는 뜻이다. **바뀐 셸만** 실려
 * 오므로 여기 없는 셸은 「값이 그대로」이지 「조용하다」가 아니다.
 */
export interface ShellAttention {
  shellId: string;
  state: ShellHookState | null;
}

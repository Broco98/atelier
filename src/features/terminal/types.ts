/** `pty_spawn`의 응답. `shellName`은 탭 이름의 재료다(결정 31). */
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
 * 채널로 오는 프레임 둘. 출력은 `ArrayBuffer`로 도착하므로 읽으려면 `new Uint8Array(frame)`로
 * 한 번 감싸야 한다. 바이트 그대로 오는 이유는 PTY 읽기가 멀티바이트 문자를 조각 경계에서
 * 가르기 때문이다 — 백엔드가 조각마다 문자열로 만들면 그 자리가 `U+FFFD`가 된다.
 */
export type PtyFrame = ArrayBuffer | PtyExit;

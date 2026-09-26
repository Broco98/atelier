// 셸 키 — `<세대>-<PTY 번호>`. 앱이 셸을 띄울 때 짓는 이름이고, 그 셸 env의 표식(`ATELIER_SHELL`), 훅 상태 파일의 이름,
// 셸 띄우기 답의 `shellKey`가 모두 이 값이다(프로세스 스펙 S34).
//
// **이 파일은 Rust `src-tauri/src/processes/shell_key.rs`의 짝이다.** 짓는 쪽(`mint`)과 세대로 가르는 쪽(`of_generation`)은
// 그쪽에 있고, 여기는 프런트가 키에서 PTY 번호를 되뽑는 한 자리다. 두 언어는 IPC 타입을 나누지 않아 규칙이 **글자로만**
// 이어진다 — 구분자는 하나, 뒤에서 한 번 자르고, 꼬리는 숫자다. `shell-key.test.ts`가 Rust `split`의 검사와 같은 줄을 잰다.
// 한쪽 규칙을 바꾸면 다른 쪽도 함께 바꾼다.

/**
 * 셸 키에서 **pty 번호**를 되뽑는다. 훅이 아는 이름(셸 키)과 레지스트리가 아는 번호를 잇는 첫 칸이고, 그다음은
 * `terminal-store`의 `shellOfPty`가 잇는다 — 그 두 번호가 다르다는 것은 `PtyRunning`의 머리말이 든다.
 *
 * **모르는 모양은 `null`이다.** 세대에도 `-`가 있을 수 있어 마지막 것 뒤만 본다. 숫자가
 * 아니면 `NaN`을 흘리지 않고 여기서 끊는다 — 흘려보내면 `shellOfPty`가 아무 칸도 못 찾은
 * 것과 구분이 안 되어, 왜 상태가 안 앉는지 어디서도 안 보인다.
 */
export function ptyIdOf(shellId: string): number | null {
  const cut = shellId.lastIndexOf("-");
  // 세대가 있어야 한다. `-`가 없으면 `cut`이 -1이라 통째로 번호로 읽히고, 맨 앞이면
  // 세대가 빈 것이라 앱이 만든 이름이 아니다 — 둘 다 `cut < 1`로 함께 막힌다.
  if (cut < 1) return null;
  const tail = shellId.slice(cut + 1);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

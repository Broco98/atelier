import { invoke, type Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PtyFrame, PtyRunning, PtySpawned } from "./types";

// `cwd`에 `null`을 주면 백엔드가 데이터 루트를 쓴다. 여기서 `"~/.atelier"`를 박으면
// `ATELIER_HOME` 오버라이드가 죽는다 — 그 자리가 어디인지는 atelier-core만 안다.
export const terminalApi = {
  spawn: (cwd: string | null, cols: number, rows: number, onFrame: Channel<PtyFrame>) =>
    invoke<PtySpawned>("pty_spawn", { cwd, cols, rows, onFrame }),
  write: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: number, cols: number, rows: number) =>
    invoke<void>("pty_resize", { id, cols, rows }),
  // 화면을 옮기는 것만으로는 죽이지 않는다(결정 20) — 언마운트 정리에는 없다.
  // 부르는 곳은 둘, 둘 다 사람이 끝내겠다고 한 자리다: `×`(판 02)와, 아카이빙·삭제가
  // 성공한 뒤의 회수(결정 26).
  kill: (id: number) => invoke<void>("pty_kill", { id }),
  // 셸 안에서 **명령이 도는가** — 포그라운드 그룹이 셸 자신이 아닌가다(결정 92).
  //
  // **이 값을 구독하는 곳은 여전히 없다 — 그런데 이유가 바뀌었다.** 한때 여기 「매 순간
  // 바뀌는 값이라 구독하지 않는다」고 적혀 있었는데, adr-04가 그것을 뒤집어 아래
  // `onPtyRunning`이 같은 판정을 1초마다 실어 온다. 그래도 **이 자리는 그대로다**: 닫기
  // 판정은 그 순간의 진실이어야 하고 구독값은 최대 1초 낡았다. 묻는 자리는 여전히
  // 닫기 직전 한 번뿐이다(`requestCloseShell`).
  commandRunning: (id: number) => invoke<boolean>("pty_command_running", { id }),
};

/**
 * 백엔드의 폴링 스레드가 쏘는 이벤트 이름. **양쪽이 이 문자열로만 이어져 있다** —
 * 한쪽을 고치면 컴파일도 타입 검사도 통과하고 아무 일도 안 일어난다. 그 연결은
 * `shell-registry.test.ts`가 `pty.rs`와 이 파일을 함께 읽어 못박는다.
 */
const PTY_RUNNING = "pty:running";

/**
 * 도는 명령이 **바뀐 셸만** 실려 온다(adr-04). 배선은 `watcher.rs`가 `works:changed`를 쏘고
 * 프런트가 `listen`으로 받는 그 길과 같다.
 *
 * **`terminalApi` 안이 아니라 곁에 선다** — 저쪽은 우리가 부르는 invoke의 목록이고
 * 이것은 백엔드가 먼저 말을 거는 통로라, 한 객체에 섞으면 방향이 갈린 둘이 같은 것처럼
 * 읽힌다.
 */
export function onPtyRunning(listener: (changed: PtyRunning[]) => void): Promise<UnlistenFn> {
  return listen<PtyRunning[]>(PTY_RUNNING, (event) => listener(event.payload));
}

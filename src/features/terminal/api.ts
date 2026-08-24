import { invoke, type Channel } from "@tauri-apps/api/core";
import type { PtyFrame, PtySpawned } from "./types";

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
  // 셸 안에서 **명령이 도는가** — 포그라운드 그룹이 셸 자신이 아닌가다(결정 92). 묻는
  // 자리는 닫기 직전 한 번뿐이라(`requestCloseShell`) 이 값을 구독하는 곳은 없다.
  commandRunning: (id: number) => invoke<boolean>("pty_command_running", { id }),
};

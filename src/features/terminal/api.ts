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
  kill: (id: number) => invoke<void>("pty_kill", { id }),
};

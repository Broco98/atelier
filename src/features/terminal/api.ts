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
  // **지금 부르는 곳이 없다.** 화면을 옮기는 것만으로는 셸을 죽이지 않기로 했으므로
  // (결정 20) 언마운트 정리에서 빠졌고, 죽이는 유일한 조작인 `×`는 판 02에 온다.
  // 이 객체는 Rust에 등록된 `pty_*` 넷을 그대로 비추는 자리라 하나만 빼두지 않는다 —
  // 빼면 "프런트에서 셸을 못 죽인다"로 읽힌다.
  kill: (id: number) => invoke<void>("pty_kill", { id }),
};

import { invoke } from "@tauri-apps/api/core";
import type { ProcessSnapshot } from "./types";

// `Processes` 화면의 IPC(프로세스 스펙 「IPC (판 04)」). 지금은 스냅샷 하나다 — 요약 · 추이 · 끝내기 · 정리 기록은 29 · 30 · 31 · 32가
// 이 자리에 더한다.
//
// **모드를 안 싣는다.** 화면이 앱 전체를 보여(프로세스 결정 9) 두 세계의 주소가 같은 것을 묻는다 — 모드를 실으면 백엔드가 그
// 세계의 것만 가르리라고 읽히는데, 그런 갈래는 없다.
export const processesApi = {
  snapshot: () => invoke<ProcessSnapshot>("processes_snapshot"),
};

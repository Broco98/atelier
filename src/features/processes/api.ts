import { invoke } from "@tauri-apps/api/core";
import type { CleanupEvent, ProcessIdentity, ProcessSnapshot, ProcessSummary, TrendPoint } from "./types";

// `Processes` 화면과 nav 메타의 IPC(프로세스 스펙 「IPC (판 04)」). 스냅샷(26), 요약(29), 추이(30), 신원 목록 끝내기(31), 정리
// 기록 읽기(32)다.
//
// **모드를 안 싣는다.** 화면이 앱 전체를 보여(프로세스 결정 9) 두 세계의 주소가 같은 것을 묻는다 — 모드를 실으면 백엔드가 그
// 세계의 것만 가르리라고 읽히는데, 그런 갈래는 없다. nav 메타도 같다(「이 세계의 것만 센다」의 예외).
export const processesApi = {
  snapshot: () => invoke<ProcessSnapshot>("processes_snapshot"),
  summary: () => invoke<ProcessSummary>("processes_summary"),
  trend: () => invoke<TrendPoint[]>("processes_trend"),
  // 신원 목록 끝내기(티켓 31) — 자손 행 [끝내기]와 고아 묶음의 [정리]. **화면에 보인 표본의 신원**을 그대로 넘긴다. 백엔드가 다시
  // 판정하지 않고, 신호 직전에 신원을 다시 본다(S4).
  end: (targets: ProcessIdentity[]) => invoke<void>("processes_end", { targets }),
  // 정리 기록 읽기(티켓 32 · 프로세스 스펙 S12) — 새것부터 최근 100건. 기록을 적는 것은 Rust의 끝내기 길들이고, 여기는 읽기만 한다.
  cleanupLog: () => invoke<CleanupEvent[]>("processes_cleanup_log"),
};

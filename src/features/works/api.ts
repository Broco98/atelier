import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "@/mode";
import type { WorkStatus, WorkView } from "./types";

// **모든 명령이 `mode`를 받는다** — 어느 루트를 읽는가가 slug보다 앞선 물음이라 자리도 맨
// 앞이다. 코어의 표기가 그대로 나가므로(`@/mode`의 `Mode` 주석) 여기서 변환하지 않는다.
//
// 백엔드에서는 아직 **선택 인자**이고(없으면 Atelier), 필수로 닫는 것은 #187이다. 그래서
// 여기서 빠뜨린 호출은 오류가 아니라 **조용히 Atelier 데이터**로 답한다 — 아래 인자 객체가
// 평평한 것도 그 때문이다: `tauri-commands.test.ts`의 인자 대조가 중첩 `{}`를 만나면 그
// 호출을 통째로 못 보고 넘어간다.
export const worksApi = {
  list: (mode: Mode) => invoke<WorkView[]>("list_works", { mode }),
  get: (mode: Mode, slug: string) => invoke<WorkView>("get_work", { mode, slug }),
  setTitle: (mode: Mode, slug: string, title: string) =>
    invoke<WorkView>("set_work_title", { mode, slug, title }),
  setStatus: (mode: Mode, slug: string, status: WorkStatus) =>
    invoke<WorkView>("set_work_status", { mode, slug, status }),
  setPinned: (mode: Mode, slug: string, pinned: boolean) =>
    invoke<WorkView>("set_work_pinned", { mode, slug, pinned }),
  readSpec: (mode: Mode, slug: string, path: string) =>
    invoke<string>("read_spec_file", { mode, slug, path }),
  archive: (mode: Mode, slug: string) => invoke<void>("archive_work", { mode, slug }),
  remove: (mode: Mode, slug: string) => invoke<void>("remove_work", { mode, slug }),
};

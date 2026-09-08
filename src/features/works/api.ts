import { invoke } from "@tauri-apps/api/core";
import type { WorkStatus, WorkView } from "./types";

export const worksApi = {
  list: () => invoke<WorkView[]>("list_works"),
  get: (slug: string) => invoke<WorkView>("get_work", { slug }),
  setTitle: (slug: string, title: string) =>
    invoke<WorkView>("set_work_title", { slug, title }),
  setStatus: (slug: string, status: WorkStatus) =>
    invoke<WorkView>("set_work_status", { slug, status }),
  setPinned: (slug: string, pinned: boolean) =>
    invoke<WorkView>("set_work_pinned", { slug, pinned }),
  readSpec: (slug: string, path: string) =>
    invoke<string>("read_spec_file", { slug, path }),
  archive: (slug: string) => invoke<void>("archive_work", { slug }),
  /**
   * 그 work 화면이 **떠 있게 됐다**고 알린다(결정 12·14) — 이력 맨 앞으로 간다.
   *
   * 답이 없는 부름이다. 화면이 이 값을 도로 읽지 않으므로(순서를 세우는 것은 코어의 검색이다)
   * 실패해도 화면에 아무 일이 없어야 한다 — 부르는 쪽이 삼키되 **이유는 한 줄 남긴다.**
   */
  touchRecent: (slug: string) => invoke<void>("touch_recent_work", { slug }),
  remove: (slug: string) => invoke<void>("remove_work", { slug }),
};

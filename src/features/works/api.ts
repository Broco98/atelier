import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "@/mode";
import type { KernelWorkView, WorkStatus, WorkView } from "./types";

// **모든 명령이 `mode`를 받는다** — 어느 루트를 읽는가가 slug보다 앞선 물음이라 자리도 맨
// 앞이다. 코어의 표기가 그대로 나가므로(`@/mode`의 `Mode` 주석) 여기서 변환하지 않는다.
//
// 백엔드에서도 **필수 인자다**(#187). 빠뜨린 호출은 조용히 Atelier 데이터로 답하는 대신
// Tauri의 인자 역직렬화에서 거절된다 — 그래도 여기 타입이 그물의 앞자리다: `tsc`가 잡으면
// 화면을 띄우기 전에 알고, 백엔드가 잡으면 버튼을 누르는 순간에 안다.
//
// 아래 인자 객체가 평평한 것은 다른 이유다 — `tauri-commands.test.ts`의 인자 대조가 중첩
// `{}`를 만나면 그 호출을 통째로 못 보고 넘어간다.
export const worksApi = {
  list: (mode: Mode) => invoke<WorkView[]>("list_works", { mode }),
  get: (mode: Mode, slug: string) => invoke<WorkView>("get_work", { mode, slug }),
  setTitle: (mode: Mode, slug: string, title: string) =>
    invoke<KernelWorkView>("set_work_title", { mode, slug, title }),
  setStatus: (mode: Mode, slug: string, status: WorkStatus) =>
    invoke<KernelWorkView>("set_work_status", { mode, slug, status }),
  setPinned: (mode: Mode, slug: string, pinned: boolean) =>
    invoke<KernelWorkView>("set_work_pinned", { mode, slug, pinned }),
  /** `before: null`은 구획의 끝이다. 인자와 응답의 뜻은 코어 `move_work`에 있다. */
  move: (mode: Mode, slug: string, pinned: boolean, before: string | null) =>
    invoke<WorkView[]>("move_work", { mode, slug, pinned, before }),
  readSpec: (mode: Mode, slug: string, path: string) =>
    invoke<string>("read_spec_file", { mode, slug, path }),
  archive: (mode: Mode, slug: string) => invoke<void>("archive_work", { mode, slug }),
  /**
   * 그 work 화면이 **떠 있게 됐다**고 알린다(팔레트 결정 12·14) — 이력 맨 앞으로 간다.
   *
   * 답이 없는 부름이다. 화면이 이 값을 도로 읽지 않으므로(순서를 세우는 것은 코어의 검색이다)
   * 실패해도 화면에 아무 일이 없어야 한다 — 부르는 쪽이 삼키되 **이유는 한 줄 남긴다.**
   *
   * **세계를 싣는다.** 이력은 세계마다 한 장이라(`maison/recent.json`), 안 실으면 Maison에서
   * 연 Room이 Atelier 팔레트의 같은 이름을 맨 위로 올린다 — 두 세계에 같은 slug가 설 수
   * 있다는 것이 결정 10이다.
   */
  touchRecent: (mode: Mode, slug: string) =>
    invoke<void>("touch_recent_work", { mode, slug }),
  remove: (mode: Mode, slug: string) => invoke<void>("remove_work", { mode, slug }),
};

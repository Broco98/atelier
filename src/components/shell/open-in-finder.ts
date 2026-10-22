import { showToast } from "@/components/ui/toast";

// **Finder에서 연다 — 못 열었을 때의 말이 하나다**(codex-ds 스펙 S6). Finder 열기는 자리마다 다른 코어 명령이다 — work의 spec 폴더 ·
// worktree(`open_work_folder`), 아카이브의 spec 폴더(`open_archived_spec_folder`), 프로젝트 폴더(`open_project_folder`). 부르는 쪽이
// 그 명령을 건네고, 못 열면(손으로 지운 폴더 등) 코어가 돌려준 문장을 「못 한 일」 토스트로 알린다 — 메뉴는 이미 닫혔고, 그 문장이 어느
// 폴더가 없는지 말한다. 자리마다 말을 따로 지으면 한쪽만 고친 날 같은 실패가 두 말로 선다. 토스트는 그 화면의 자리(`Toaster`)에 선다.

/** 그 Finder 열기 명령을 부르고, 거절되면 그 문장을 토스트로 알린다. */
export function openInFinder(call: () => Promise<unknown>): void {
  call().catch((e: unknown) => showToast(`Finder에서 열지 못했어요: ${e}`, "rejected"));
}

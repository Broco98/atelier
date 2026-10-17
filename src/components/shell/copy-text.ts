import { showToast } from "@/components/ui/toast";

// **클립보드에 쓰고 「… 복사됨」을 알린다 — 화면의 복사가 이 한 길이다**(codex-ds 결정 11). Works(work 메뉴의 복사 ▸ · 트리 · 문서
// 링크 · 문서 글 · spec 탭 · 셸 탭 메뉴의 경로 복사) · Archive(⋯ · 행 메뉴 · 트리 · 문서 링크 · 문서 글의 경로 복사) · 프로젝트 메뉴의
// 경로 복사가 모두 이것을 부른다. 자리마다 따로 적으면 한쪽만 고친 날 같은 복사가 두 말로 선다. 모듈 함수라 참조가 늘 같다 — 화면이 다시 그려질 때 이것을 받는
// 마크다운 트리가 리마운트(깜빡임)되지 않는다.
//
// 토스트는 그 화면의 자리(`Toaster`)에 선다 — 자리가 있는 화면은 Works · Archive · 프로젝트다. 다른 화면의 사이드바에서 연 메뉴의 복사는
// 클립보드에는 쓰이고 알림은 서지 않는다. 쓰기의 거절은 보지 않는다 — 문서 글의 「고른 글자 복사」만 제 길로 거절을 알린다(`DocText`).

/** 글자를 클립보드에 쓰고 「… 복사됨」을 알린다. */
export function copyText(text: string): void {
  navigator.clipboard.writeText(text);
  showToast(`${text} 복사됨`);
}

// 사이드바 줄의 모양 한 벌(코드 리뷰 2차 C) — nav 줄(새 Thread · Library · 설정 항목) · Work 줄 · Thread 줄이 같은 면 · 글자색과 같은
// 줄 리듬을 쓴다. Codex 사이드바를 재어 맞춘 값이라(v1 티켓 46 · 시안-비교/46 `참고/codex-사이드바.png`) 한 자리만 바뀌면 그 묶음만 결이
// 갈린다 — 46은 글자색 하나를 바꾸려고 세 파일을 고쳤다. 사분 단의 출처는 `spacing-guard.test.ts`의 `QUARTERS`가 이 파일 이름으로 든다.

/**
 * 줄의 면과 글자 — 고른 줄은 `selected-row`(사이드바 안에서는 `fill-selected` 면에 `fg-sidebar` 글자 — index.css), 안 고른 줄은 사이드바
 * 글자색에 지나는 면 `fill-soft`다. 안 고른 줄도 흐린 회색이 아니라 줄 글자색이다(ui-refresh 결정 11) — 흐리면 고른 줄만 읽힌다.
 */
export function sidebarRowTone(selected: boolean): string {
  return selected ? "selected-row" : "text-fg-sidebar hover:bg-fill-soft";
}

/** 줄 목록 — 줄 30이 사이 1을 두고 선다(Codex 사이드바의 줄 30 · 간격 31). 구획 머리와 몸 사이도 같은 1이다. */
export const SIDEBAR_ROWS = "flex flex-col gap-px";

/**
 * 묶음 소제목의 줄 — 높이 30에 라벨을 가운데 세우고 아래 3을 둔다. 줄 사이 1과 더해 소제목 가운데 → 첫 줄 가운데가 34다(15 + 3 + 1 + 15,
 * Codex 「프로젝트」 · 「최근」). 글자는 부르는 쪽이 정한다(머리 단추는 라벨 칸이, 「Thread」 소제목은 제 글자가).
 */
export const SIDEBAR_HEADING = "mb-0.75 flex h-7.5 shrink-0 items-center px-2";

/** 앞 묶음 뒤에 서는 소제목의 위 — 23. 줄 사이 1과 더해 마지막 줄 가운데 → 다음 소제목 가운데가 54다(15 + 1 + 23 + 15, Codex 「프로젝트」 → 「최근」). */
export const SIDEBAR_AFTER_SECTION = "mt-5.75";

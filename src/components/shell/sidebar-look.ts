// 사이드바 줄의 모양 한 벌(코드 리뷰 2차 C) — nav 줄(위 칸 · 설정 항목 · 맨 아래 설정) · Work 줄 · Thread 줄이 같은 면 · 글자 · 둥글기와 같은
// 줄 리듬을 쓴다. 값은 시안 Shell · Main의 사이드바(`.ra-sr-row` · `.ra-sr-label` · `.ra-side-in`)다(restart 02a-3). 한 자리만 바뀌면 그 묶음만
// 결이 갈린다 — v1 티켓 46은 글자색 하나를 바꾸려고 세 파일을 고쳤다. 사분 단의 출처는 `spacing-guard.test.ts`의 `QUARTERS`가 이 파일 이름으로
// 든다.
//
// 한때(v1 티켓 46 – 02a-2) 이 값들은 Codex 사이드바를 잰 것이었다 — 글자 14/20 · 둥글기 superellipse 12.5(WebKit 10) · 줄 사이 1 · 지나는
// 면과 고른 면이 같은 투명 .053(`fill-nav-selected`) · 소제목 14.

/**
 * 줄의 면과 글자 — 고른 줄은 `selected-row`(사이드바 안에서는 `fill-hover` 면에 `fg` 글자 — index.css의 그 유틸리티), 안 고른 줄은 사이드바
 * 글자색에 지나는 면 `fill-soft`다(시안 `.ra-sr-row:hover` · `.ra-sr-row.on`). 지나는 면이 고른 면보다 옅어 둘이 갈린다. 안 고른 줄도 흐린
 * 회색이 아니라 줄 글자색이다(ui-refresh 결정 11) — 흐리면 고른 줄만 읽힌다.
 */
export function sidebarRowTone(selected: boolean): string {
  return selected ? "selected-row" : "text-fg-sidebar hover:bg-fill-soft";
}

/** 줄의 모양 — 틀 안 줄의 둥글기 4(`radius-ctl` — 시안 Shell 규격 「선택 줄 4」). 면을 칠하는 상자와 그 안의 이름 버튼(포커스 링)이 같이 쓴다. */
export const SIDEBAR_ROW_SHAPE = "rounded-ctl";

/** 줄의 글자 — 13/18(시안 `.ra-sr-row`의 `font-size: 13px; line-height: 18px`). 이름을 그 자리에서 고치는 입력칸도 같다. */
export const SIDEBAR_ROW_TEXT = "text-chat-meta";

/** 줄 앞 글리프 — 15 · `fg-secondary`(시안 `.ra-sr-row > .ic`). 고른 줄에서도 그대로다. */
export const SIDEBAR_GLYPH = "size-3.75 shrink-0 text-fg-secondary";

/** 줄 안 글리프와 글자 사이 — 9(시안 `.ra-sr-row`의 `gap: 9px`). */
export const SIDEBAR_GLYPH_GAP = "gap-2.25";

/** 줄 목록 — 줄 30이 사이 2를 두고 선다(시안 `.ra-side-in`의 `gap: 2px`). 소제목과 첫 줄 사이도 같은 2다. */
export const SIDEBAR_ROWS = "flex flex-col gap-0.5";

/**
 * 묶음 소제목의 줄 — 높이 30에 라벨을 가운데 세운다. 글자는 12/18 · 자간 .025 · `fg-tertiary`다(`text-xs` — 시안 `.ra-sr-label`). 끝의
 * 단추(「작업공간 만들기」)는 이 줄 오른쪽 끝에 겹쳐 선다(`WorkSectionList`). 위 사이는 놓인 자리가 고른다(첫 묶음은 nav 뒤 12, 다음 묶음은
 * `SIDEBAR_AFTER_SECTION`).
 */
export const SIDEBAR_HEADING = "flex h-7.5 shrink-0 items-center px-2 text-xs text-fg-tertiary";

/** 앞 묶음 뒤에 서는 소제목의 위 — 10. 줄 사이 2와 더해 앞 묶음 끝 줄 → 소제목이 12다(시안 `.ra-sr-label`의 `margin-top: 10px`). */
export const SIDEBAR_AFTER_SECTION = "mt-2.5";

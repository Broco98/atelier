import { useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

// **목록 하나가 Tab 정류장 하나다**(roving tabindex — codex-ds 스펙 §9 · S10). 사이드바 work 목록 · main nav(설정 nav도) · 프로젝트
// 목록 · Archive 목록 · spec 트리가 이것을 쓴다. Tab은 목록에 한 번 앉고, 목록 안은 ↑↓로 옮기고 Enter로 연다(행이 버튼이라 Enter가 곧
// 누름이다). 행 안 버튼(고정 · 경로 복사)은 Tab에서 빠지고 그 동작은 행의 대상 메뉴(⇧F10)에 있다.
//
// 행은 `data-roving`(값은 그 행의 키)을 단 요소이고, 정류장 행만 `tabIndex={0}`, 나머지는 `-1`이다. **`0`도 명시한다** — WebKit의 Tab은
// 맨 `<button>`에 서지 않는다(macOS 「키보드 탐색」이 꺼진 기본값. 입력칸과 `tabindex`를 단 것만 다닌다).
//
// 화살표는 단축키 표 밖이다(`hotkeys.ts` 머리말 — 목록 안 움직임). 그래서 `code`가 아니라 `key`로 본다 — 화살표는 입력기를 타지 않는다.
// 끝에서 돌지 않는다(첫 행에서 ↑, 끝 행에서 ↓는 그 자리에 선다).

/** 행이 다는 속성 — 값은 그 행의 키(slug · 경로 · nav 키)다. 이 속성을 단 요소가 목록의 행이다. */
export const ROVING = "data-roving";

/** 목록 상자에 펴 주는 두 핸들러 — 포커스가 든 행을 기억하고, ↑↓로 옆 행에 포커스를 옮긴다. */
export interface RovingBox {
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * 목록 하나의 정류장 — `keys`는 지금 다닐 수 있는 행의 키를 화면 차례로, `current`는 고른 행(주소가 가리키는 것)이다.
 *
 * 정류장은 마지막에 포커스가 든 행 → 고른 행 → 첫 행 차례로 정한다. **고른 행이 바뀌면 기억을 버린다** — 클릭 · 주소로 다른 행을 고르면
 * Tab이 다시 그 행에 앉는다. 기억한 행이 목록에서 빠지면(접힌 구획 · 거르기) 다음 차례로 내려간다.
 */
export function useRoving(
  keys: readonly string[],
  current: string | null,
): { stop: string | null; box: RovingBox } {
  // 기억은 그때의 `current`와 함께 쥔다 — 이펙트 없이, 고른 행이 바뀐 렌더에서 바로 낡은 것이 된다.
  const [focused, setFocused] = useState<{ key: string; current: string | null } | null>(null);
  const kept = focused !== null && focused.current === current && keys.includes(focused.key);
  const stop = kept ? focused.key : current !== null && keys.includes(current) ? current : (keys[0] ?? null);

  function onFocus(event: FocusEvent<HTMLElement>) {
    const key = event.target.getAttribute(ROVING);
    if (key === null || (focused?.key === key && focused.current === current)) return;
    setFocused({ key, current });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const from = event.target as HTMLElement;
    if (!from.hasAttribute(ROVING)) return;
    event.preventDefault();
    const rows = rovingRows(event.currentTarget);
    rows[rows.indexOf(from) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  }

  return { stop, box: { onFocus, onKeyDown } };
}

/**
 * 상자 안에서 지금 다닐 수 있는 행 — 화면 차례(DOM 차례)다. `inert` 안의 행(접힌 구획 · 닫힌 패널)과 그려지지 않은 행(닫힌
 * `Collapsible`의 숨은 몸)은 건너뛴다.
 */
export function rovingRows(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(`[${ROVING}]`)).filter(
    (row) => row.closest("[inert]") === null && row.getClientRects().length > 0,
  );
}

/** 상자 안에서 그 키의 행에 포커스를 준다 — 트리의 ←(부모로)처럼 옆 행이 아닌 곳으로 옮길 때 쓴다. */
export function focusRow(box: HTMLElement, key: string): void {
  box.querySelector<HTMLElement>(`[${ROVING}="${CSS.escape(key)}"]`)?.focus();
}

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Copy, Pencil, Trash2 } from "lucide-react";
import * as Context from "./context-menu";
import * as Dropdown from "./dropdown-menu";

// codex-ds 티켓 11 — **우클릭 메뉴 바탕은 ⋯ 메뉴와 같은 항목 부품으로 그린다**(codex-ds 결정 15 — 정의 하나), 그리고 메뉴 줄에
// **단축키 칸**과 **하위 메뉴**가 선다(codex-ds 결정 10).
//
// **열린 카드는 정적 마크업에 안 그려진다.** Base UI 메뉴의 카드는 포털 안에 서고 포털은 브라우저에서만 자리를 잡는다 — 하위 메뉴
// 트리거도 카드의 Positioner 안에서만 선다(밖에서는 부품이 던진다). Root 안에서 그려지는 것은 항목 · 구분선 줄이다. 그래서 여기서는
// 두 래퍼가 내보내는 부품이 같은 함수인지, 그 줄이 두 Root에서 같은 마크업인지, 단축키 칸과 체크가 줄 안 어디에 서는지를 잰다.
// 크기 · 색은 클래스가 아니라 칠해진 값으로 잰다(codex-ds 스펙 「Testing Decisions」) — 열린 카드의 모양(폭 · 반경 · 그림자 · 줄 30 ·
// 뜨는 박자), 체크(14 · `fg`), 끈 줄(55% · 글자 · 글리프 `fg-tertiary`)은 L3(`e2e/frame.spec.ts`의 「작업 ⋯ 메뉴」 · 「상태 메뉴」 ·
// work 메뉴 Finder ▸의 사라진 worktree 줄)가 잰다. 하위 메뉴의 모양(트리거의 셰브런 · 연 줄의 면, 카드의 폭 · 자리, → · ← · 포인터로
// 여닫기)은 메뉴 부품의 진열대 위에서 L3(`e2e/submenu.spec.ts`)가 잰다 — 앱의 work 메뉴도 하위 메뉴를 달지만 그 줄 길이가 work의
// slug · 프로젝트 이름을 따라가 카드 폭의 두 끝을 골라 세울 수 없다(`e2e/menu-fixture.tsx` 머리말). 단축키 칸의 칠해진 크기 · 색은 아직
// 어느 층도 재지 않는다 — 단축키 칸을 다는 화면이 아직 없고, 그것을 처음 쓰는 화면의 L3가 잴 몫이다.

/** 우클릭 메뉴가 ⋯ 메뉴에게서 받아 쓰는 부품 — 이름의 뒷부분이 같다(`ContextMenuItem` ↔ `DropdownMenuItem`). */
const SHARED_PARTS = [
  "Group",
  "Label",
  "Item",
  "CheckboxItem",
  "RadioGroup",
  "RadioItem",
  "Sub",
  "SubTrigger",
  "SubContent",
  "Separator",
  "Shortcut",
] as const;

/** 메뉴 줄 네 가지 — 단축키 칸이 선 글리프 줄, 단축키가 없는 글리프 줄, 구분선, 지우기 줄. */
const rows = (
  <>
    <Dropdown.DropdownMenuItem>
      <Pencil />
      <span className="min-w-0 flex-1 truncate">이름 바꾸기</span>
      <Dropdown.DropdownMenuShortcut>F2</Dropdown.DropdownMenuShortcut>
    </Dropdown.DropdownMenuItem>
    <Dropdown.DropdownMenuItem>
      <Copy />
      <span className="min-w-0 flex-1 truncate">경로 복사</span>
    </Dropdown.DropdownMenuItem>
    <Dropdown.DropdownMenuSeparator />
    <Dropdown.DropdownMenuItem variant="destructive">
      <Trash2 />
      <span className="min-w-0 flex-1 truncate">삭제</span>
    </Dropdown.DropdownMenuItem>
  </>
);

const inDropdown = (children: ReactNode) =>
  renderToStaticMarkup(<Dropdown.DropdownMenu open>{children}</Dropdown.DropdownMenu>);
const inContext = (children: ReactNode) =>
  renderToStaticMarkup(<Context.ContextMenu open>{children}</Context.ContextMenu>);

/** 부품이 줄마다 다는 `id`(`useId`)를 걷는다 — 우클릭 Root가 제 몫의 id를 먼저 떼어 가서 번호만 갈린다. */
const withoutIds = (markup: string) => markup.replace(/ id="base-ui-[^"]*"/g, "");

/** 마크업의 `menuitem` 줄 하나 — 여는 태그부터 닫는 태그까지. 줄 안에 `div`가 없어서 첫 `</div>`가 그 줄의 끝이다. */
function rowOf(markup: string, name: string): string {
  const row = markup.match(new RegExp(`<div[^>]*role="menuitem"[^>]*>(?:(?!</div>).)*${name}(?:(?!</div>).)*</div>`))?.[0];
  if (!row) throw new Error(`「${name}」 줄이 없다:\n${markup}`);
  return row;
}

/** 단축키 칸의 여는 태그와 글자. */
function shortcutOf(row: string) {
  const match = row.match(/<span([^>]*data-slot="dropdown-menu-shortcut"[^>]*)>([^<]*)<\/span>/);
  return match ? { attrs: match[1], text: match[2] } : null;
}

describe("우클릭 메뉴 바탕 — ⋯ 메뉴와 같은 부품", () => {
  it.each(SHARED_PARTS)("ContextMenu%s는 DropdownMenu의 그 부품과 같은 함수다", (part) => {
    const shared = Dropdown[`DropdownMenu${part}`];
    expect(shared, `DropdownMenu${part}`).toBeTypeOf("function");
    expect(Context[`ContextMenu${part}`]).toBe(shared);
  });

  it("같은 줄을 우클릭 메뉴 안에 그리면 ⋯ 메뉴 안과 같은 마크업이다", () => {
    const dropdown = inDropdown(rows);
    // 앵커: 줄이 정말 그려졌다 — 둘 다 빈 문자열이면 아래 견줌이 초록이다.
    expect(dropdown.match(/role="menuitem"/g)).toHaveLength(3);
    expect(dropdown).toContain('role="separator"');
    expect(withoutIds(inContext(rows))).toBe(withoutIds(dropdown));
  });

  it("우클릭 대상은 그 자리를 그대로 감싸고, 닫혀 있으면 열린 표식이 없다", () => {
    const target = (open: boolean) =>
      renderToStaticMarkup(
        <Context.ContextMenu open={open}>
          <Context.ContextMenuTrigger>
            <span>work 행</span>
          </Context.ContextMenuTrigger>
          <Context.ContextMenuContent>{rows}</Context.ContextMenuContent>
        </Context.ContextMenu>,
      );
    const closed = target(false);
    expect(closed).toContain("<span>work 행</span>");
    expect(closed).not.toContain("data-popup-open");
    // 대조: 열면 같은 대상에 열린 표식이 선다 — 이 표식이 정적 마크업에 아예 안 나오면 위 「없다」가 저절로 초록이다.
    expect(target(true)).toContain("data-popup-open");
  });
});

/** 고른 값의 체크가 서는 두 줄 — 체크 줄과 라디오 줄. 둘 다 켜진 채로 그린다(지시자는 켜진 줄에만 선다). */
const checkedRows = {
  체크: (
    <Dropdown.DropdownMenuCheckboxItem checked>
      <Copy />
      <span className="min-w-0 flex-1 truncate">숨긴 것 보기</span>
    </Dropdown.DropdownMenuCheckboxItem>
  ),
  라디오: (
    <Dropdown.DropdownMenuRadioGroup value="active">
      <Dropdown.DropdownMenuRadioItem value="active">
        <Copy />
        <span className="min-w-0 flex-1 truncate">숨긴 것 보기</span>
      </Dropdown.DropdownMenuRadioItem>
    </Dropdown.DropdownMenuRadioGroup>
  ),
};

describe("고른 값의 체크", () => {
  // 우클릭 메뉴가 함께 쓰는 체크 줄이 다른 줄과 같은 줄이다 — 체크는 줄 끝의 흐름 안에 선다(`menu-check.tsx`). 줄 앞에 떠서
  // 오른쪽에 겹쳐 서는 체크(registry의 `absolute right-2`)는 마크업에서 이름보다 앞에 온다.
  it.each(Object.keys(checkedRows) as (keyof typeof checkedRows)[])("%s 줄의 체크는 이름 뒤, 줄의 마지막 칸이다", (kind) => {
    const markup = inDropdown(checkedRows[kind]);
    const row = markup.match(/<div[^>]*role="menuitem(?:checkbox|radio)"[^>]*aria-checked="true"[^>]*>(?:(?!<\/div>).)*<\/div>/)?.[0];
    if (!row) throw new Error(`켜진 ${kind} 줄이 없다:\n${markup}`);
    expect(row.indexOf("숨긴 것 보기")).toBeLessThan(row.indexOf("lucide-check"));
    expect(row).toMatch(/<svg[^>]*lucide-check[^>]*>(?:(?!<\/svg>).)*<\/svg><\/span><\/div>$/);
  });
});

describe("단축키 칸", () => {
  it("줄의 이름 뒤, 줄의 마지막 칸에 선다", () => {
    const row = rowOf(inDropdown(rows), "이름 바꾸기");
    expect(shortcutOf(row)?.text).toBe("F2");
    // 이름 칸이 먼저이고 단축키가 줄의 마지막 칸이다.
    expect(row.indexOf("이름 바꾸기")).toBeLessThan(row.indexOf(">F2<"));
    expect(row).toMatch(/>F2<\/span><\/div>$/);
  });

  it("보이는 단축키는 줄의 접근성 이름에 섞이지 않는다", () => {
    expect(shortcutOf(rowOf(inDropdown(rows), "이름 바꾸기"))?.attrs).toContain('aria-hidden="true"');
  });

  it("단축키가 없는 줄에는 칸이 서지 않는다", () => {
    expect(shortcutOf(rowOf(inDropdown(rows), "경로 복사"))).toBeNull();
  });
});

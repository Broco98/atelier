import { useRef, type ReactNode } from "react";
import { ContextMenu, ContextMenuContent, opensTargetMenu, useHiddenContextMenu } from "@/components/ui/context-menu";
import { opensEditMenu } from "./EditMenu";

// **대상 메뉴 — 자리 하나가 그 안의 대상들의 메뉴를 맡고, 그 자리를 감싸지 않는다**(codex-ds 스펙 §9 대상 메뉴 표 · 결정 6 · 7 · 11).
// 프로젝트(목록 행 · 머리 줄 이름) · Archive 목록 행 · Processes 행 · spec 레이아웃 행 · spec 트리 파일 행(작업 · Archive 패널의
// 「경로 복사」) · 문서 글이 이것을 쓴다. 메뉴의 목록은 그 대상의 ⋯과 같은 정의이고(`items` — ⋯이 없는 트리 파일 행은 행의 복사
// 버튼과 같은 일이다), 대상을 가르는 것은 메뉴를 다는 화면이다(`targetOf`).
//
// **우클릭 메뉴의 뿌리(`ContextMenu`)가 자리를 감싸지 않는다.** Base UI는 우클릭 메뉴 뿌리 밑에 선 메뉴 줄을 모두 「우클릭 메뉴의
// 줄」로 쳐서 오른쪽 버튼의 놓음으로만 고른다 — 그 밑의 ⋯ · 정렬 메뉴(`DropdownMenu`)를 누른 채 끌어 놓는 고름이 안 돈다. 이 자리들은
// 안에 ⋯을 품어(Processes 행 · spec 레이아웃 행) 뿌리를 자리 곁의 형제로 두고, 숨은 Trigger에 같은 자리의 우클릭 사건을 대신 낸다
// (`openAt` — 입력칸의 편집 메뉴 `EditMenu`와 한 손잡이 `useHiddenContextMenu`다). 그러면 우클릭 메뉴의 길이 그대로 돈다 — 카드가 커서 자리에 서고, 메뉴를 연
// 오른쪽 버튼의 놓음은 줄을 누르지 않는다. 자리는 받은 손잡이(`TargetRegion`)를 제 요소에 단다.
// - **대상이 아닌 자리**(목록의 빈 자리 · 메뉴가 없는 행)의 우클릭은 그대로 둔다 — 웹뷰의 기본 메뉴는 앱 뿌리가 막으므로(`AppShell`)
//   아무것도 서지 않는다(결정 8). **입력칸 · 터미널**은 편집 메뉴의 자리라 물러선다(`opensEditMenu` — 멈추지 않아 사건이 document의
//   편집 메뉴에 닿는다). 프로젝트 목록은 이름을 고치는 칸이 자리 안에 선다. 지금은 그 칸을 `targetOf`도 대상으로 가르지 않지만(고치는
//   행은 행 버튼이 아니다), 가름이 넓어져도 그 칸의 우클릭 · ⇧F10은 편집 메뉴다(`edit-menu.spec.ts`의 「이름을 고치는 칸」).
// - **대상 위의 우클릭은 멈춘다** — React가 그 전파를 앱 뿌리(`#root`)에서 끊어, document의 편집 메뉴 · 막이가 그 사건을 못 본다.
// - **자리 DOM 밖에서 난 것은 대상이 아니다** — 자리 안 ⋯ 카드 · 떠 있는 판은 포털로 `body` 밑에 서지만 React로는 자리의 자손이라,
//   그 안의 우클릭 · 키도 자리의 손잡이까지 올라온다. 손잡이를 단 요소(`currentTarget`) 안에서 난 것만 가르고 나머지는 그대로 둔다 —
//   열린 ⋯ 카드 위에 같은 메뉴가 하나 더 서지 않는다. 모든 자리가 이 한 규칙을 따른다(`targetOf`가 따로 거르지 않는다).
//
// **⇧F10 · 메뉴 키**(`opensTargetMenu`)는 자리 안에 포커스된 요소에서 그 대상의 메뉴를 연다 — 자리의 `onKeyDown`이 받는다(창의
// keydown이 아니다). 카드는 대상의 왼쪽 아래에 서고(`at`이 있으면 그 자리 — 문서 글은 고름의 끝이다), 그렇게 열면 카드가 포커스를
// 쥐어 ↓가 첫 항목이다. 키의 기본 동작은 막는다 — 그 키로 `contextmenu`를 스스로 내는 웹뷰가 한 번 더 열지 않게.
//
// **고름도 주소도 안 바뀐다**(결정 7) — 대상이 고른 것이 아니어도 그 대상의 메뉴다. 열린 동안 대상에 테두리(`focus-ring`의
// `[data-menu-target]`)가 서는 것이 「어느 것의 메뉴인가」를 말한다(결정 11) — 표식은 손잡이가 대상 요소(`ring`)에 직접 달고 닫히면
// 걷는다. 닫히면 포커스가 돌아간다(`finalFocus`) — 우클릭으로 열었으면 `back`(없으면 테두리가 선 대상), 키로 열었으면 그 키를 받은
// 요소다. **포커스를 남기고 닫히는 항목**(「이름 바꾸기」 — 막 선 입력칸이 포커스를 쥔다)은 `leaveFocus`를 부른다: 대상으로 돌아가면
// 입력칸이 곧바로 blur되어 「다른 곳 = 저장」으로 닫힌다(구현 노트 Q7).

/** 그 자리에서 가른 대상. */
export interface TargetHit<T> {
  /** 메뉴가 펼 것 — 프로젝트 · 아카이브 · 프로세스 이름 …. */
  of: T;
  /** 열린 동안 테두리가 설 요소. 없으면 테두리가 없다. */
  ring?: HTMLElement | null;
  /**
   * 우클릭으로 연 메뉴가 닫힐 때 포커스가 갈 요소. 없으면 `ring`이다 — 행 자신이 포커스를 받지 않는 대상은 그 행의 ⋯을 준다
   * (`rowMenuButton`).
   */
  back?: HTMLElement | null;
  /** 키로 열 때 카드가 설 자리. 없으면 `ring`(없으면 키를 받은 요소)의 왼쪽 아래다. */
  at?: { x: number; y: number };
}

/**
 * 행이 품은 ⋯ — 메뉴를 여는 버튼(`aria-haspopup="menu"`)의 첫째다. 행 자신이 포커스를 받지 않는 자리(Processes 행 · spec 레이아웃
 * 행)가 `back`으로 준다. 못 찾으면 `null`이고, 그러면 포커스는 `ring`으로 간다.
 */
export function rowMenuButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>("[aria-haspopup='menu']");
}

/** 자리가 제 요소에 다는 손잡이. */
export interface TargetRegion {
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function TargetMenu<T>({
  targetOf,
  items,
  onOpen,
  onFocusIn,
  label,
  children,
}: {
  /**
   * 우클릭 · 키가 난 요소(`from`)에서 대상을 가른다 — 대상이 아닌 자리면 `null`이고 메뉴가 안 선다. `region`은 손잡이를 단 요소이고,
   * `by`는 여는 길이다(우클릭 · 키). **`from`은 늘 `region` 안이다** — 포털로 React 트리를 타고 올라온 자리 밖의 사건은 이 조각이
   * 먼저 거른다(머리말).
   */
  targetOf: (from: Element, region: HTMLElement, by: "pointer" | "key") => TargetHit<T> | null;
  /** 그 대상의 메뉴 항목 — ⋯과 같은 정의다. `leaveFocus`는 닫힐 때 포커스를 돌리지 않게 한다(머리말). */
  items: (of: T, menu: { leaveFocus: () => void }) => ReactNode;
  /** 메뉴가 그 대상으로 열렸다. */
  onOpen?: (of: T) => void;
  /** 열린 메뉴 안으로 포커스가 들었다 — 카드가 포커스를 쥘 때와 줄을 옮길 때마다다. */
  onFocusIn?: (of: T) => void;
  /** 카드의 접근성 이름 — ⋯ 메뉴가 이름을 들면 같은 이름이다. */
  label?: string;
  /** 자리를 그린다 — 손잡이를 받아 제 요소에 달고, 지금 열린 메뉴의 대상(닫혔으면 `null`)을 받는다. */
  children: (region: TargetRegion, open: T | null) => ReactNode;
}) {
  // 닫히면 포커스가 돌아갈 자리와, 이번에는 돌리지 않는가(`leaveFocus`).
  const back = useRef<HTMLElement | null>(null);
  const left = useRef(false);
  // 숨은 Trigger · 닫혀도 남는 대상 · 대상 테두리(`ring`)는 편집 메뉴와 한 손잡이다(머리말).
  const { menu, openAt, root, hiddenTrigger } = useHiddenContextMenu<TargetHit<T>>({
    ringOf: (hit) => hit.ring,
    onOpen: (hit) => {
      left.current = false;
      onOpen?.(hit.of);
    },
  });

  const region: TargetRegion = {
    onContextMenu: (event) => {
      const from = event.target;
      if (!(from instanceof Element) || !event.currentTarget.contains(from) || opensEditMenu(from)) return;
      const hit = targetOf(from, event.currentTarget, "pointer");
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      back.current = hit.back ?? hit.ring ?? null;
      openAt(hit, event.clientX, event.clientY);
    },
    onKeyDown: (event) => {
      if (event.defaultPrevented || !opensTargetMenu(event)) return;
      const from = event.target;
      if (!(from instanceof HTMLElement) || !event.currentTarget.contains(from) || opensEditMenu(from)) return;
      const hit = targetOf(from, event.currentTarget, "key");
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      back.current = from;
      const spot = (hit.ring ?? from).getBoundingClientRect();
      const at = hit.at ?? { x: spot.left, y: spot.bottom };
      openAt(hit, at.x, at.y);
    },
  };

  return (
    <>
      {children(region, menu?.open === true ? menu.target.of : null)}
      <ContextMenu {...root}>
        {hiddenTrigger}
        <ContextMenuContent
          aria-label={label}
          finalFocus={() => (left.current ? false : (back.current ?? true))}
          onFocus={() => menu && onFocusIn?.(menu.target.of)}
        >
          {menu &&
            items(menu.target.of, {
              leaveFocus: () => {
                left.current = true;
              },
            })}
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { PANEL_MOTION } from "./panel-layout";

// **머리 줄**(02 구현 스펙 §3 · CONTEXT 「머리 줄」) — 크롬 맨 위 44 줄 하나다. 앱 셸이 그리고, 어느 화면에서나 같은 줄이다.
//
//   <header>(44 · 끌기) ─ 왼쪽 칸: 신호등 자리 · 셸 컨트롤(사이드바 토글 · 뒤 · 앞 · 검색)
//                       └ 화면 자리: 지금 화면이 보낸 이름 · 할 일(`ScreenHead` — 포털)
//
// - **화면 자리의 왼쪽 끝은 사이드바를 따른다** — 열렸으면 사이드바 오른쪽 끝(판 안 본문 왼쪽 끝)과 같은 x이고 그 앞에 세로선 하나가
//   선다(Codex). 접혔으면 셸 컨트롤 끝 + 틈(`--titlebar-inset-head`)이다. 왼쪽 칸의 폭이 그 끝이고, 폭은 사이드바 폭과 같은 박자
//   (`PANEL_MOTION`)로 옮겨 간다 — 사이드바를 끄는 동안은 둘 다 트랜지션을 끄고 커서를 곧장 따른다(`Sidebar`의 `asideClass`). 사이드바
//   폭(`--sidebar-width`)은 앱 셸 뿌리가 싣는다 — 사이드바와 이 줄이 한 값을 읽는다.
// - **줄 전부가 창을 끄는 자리다**(`deep`) — 창 맨 위 줄이라 제목 막대의 관례를 따른다. 버튼 · 포커스를 받는 이름은 Tauri가 스스로
//   비켜 둔다(셸 컨트롤의 버튼 사이 틈도 끈다).
// - **화면은 제 이름과 할 일만 보낸다** — 그릇은 여기 하나이고 화면은 `ScreenHead`로 그 안에 그린다. 머리의 상태(이름 고치기 · 카드
//   여닫기)는 화면에 산 채 자리만 머리 줄이다(설정 화면의 저장 버튼이 머리 줄의 할 일 묶음으로 가는 `HeadActionsSlot`과 같은 길).
//   공용 틀(`Frame`)의 화면들은 `FrameHead`가, Thread 화면들은 `PlainFrame`이 이것으로 보낸다.
// - **화면 것의 값도 여기 한 곳이다**(02 결정 「머리 줄은 한 결이다(03 뒤)」) — 이름(`HEAD_NAME`) · 아이콘 단추(`headButton` ·
//   `HEAD_GLYPH`) · 오른쪽 끝 묶음(`HeadEnd`). 줄이 하나이니 그 위에 서는 것도 어느 화면이든 한 결이다. 값은 Codex 크롬 줄(시안
//   Screen-Live `.tb-c` · `.tb-r` — Thread 머리 줄, 06)이다. 글자 단추는 `Button`의 `top`(28 — 아이콘 단추와 같은 높이)이다.

/** 머리 줄의 화면 자리 — 앱 셸이 그 그릇을 내린다. 셸 밖(그릇이 아직 없거나 셸 없이 그린 화면)이면 `null`이다. */
export const ShellHeadSlot = createContext<HTMLElement | null>(null);

interface ShellHeadRowProps {
  /** 사이드바가 열렸나 — 화면 자리의 왼쪽 끝과 세로선이 이것으로 갈린다. */
  open: boolean;
  /** 사이드바 폭을 끄는 중인가 — 그동안은 왼쪽 칸도 트랜지션 없이 따른다. */
  dragging: boolean;
  /** 화면 자리 그릇을 받는다(앱 셸이 쥐고 `ShellHeadSlot`으로 내린다). */
  onSlot: (slot: HTMLElement | null) => void;
  /** 왼쪽 칸에 서는 셸 컨트롤. */
  children: ReactNode;
}

export function ShellHeadRow({ open, dragging, onSlot, children }: ShellHeadRowProps) {
  return (
    <header data-tauri-drag-region="deep" className="flex h-(--titlebar-height) shrink-0 items-center">
      {/* 신호등은 이 칸의 왼쪽에 OS가 그린다(`tauri.conf.json`의 `trafficLightPosition`) — 컨트롤은 그 끝에서 16 띄운 자리
          (`--titlebar-controls-left`)에서 시작한다. 전체화면에 들고 날 때 그 자리가 옮겨 가는 것도 같은 박자다. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center pl-(--titlebar-controls-left)",
          !dragging && cn("transition-[width,padding]", PANEL_MOTION),
          open ? "w-(--titlebar-inset-sidebar)" : "w-(--titlebar-inset-head)",
        )}
      >
        {children}
      </div>
      {/* 세로선은 `separator`(#e5e5e5) 20 — 줄 가운데에 위아래 12씩 비운다(Codex). 이름이 그 뒤 14에서 시작한다(시안 `.tb-c`). 화면이
          아무것도 보내지 않으면(새 Thread) 선도 서지 않는다. 오른쪽 끝 여백은 8이다(시안 `.tb-r` — 06). */}
      <div
        ref={onSlot}
        data-slot="screen-head"
        className={cn(
          "relative flex h-full min-w-0 flex-1 items-center pr-2",
          open &&
            "pl-3.5 before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-separator empty:before:hidden",
        )}
      />
    </header>
  );
}

/**
 * 화면이 머리 줄에 보내는 이름 · 할 일. 자식은 머리 줄 화면 자리의 직계로 선다(가로 한 줄 · 가운데 맞춤) — 오른쪽 끝에 붙일 것은 제가
 * `ml-auto`를 단다. 셸 밖이면 아무것도 그리지 않는다.
 */
export function ScreenHead({ children }: { children: ReactNode }) {
  const slot = useContext(ShellHeadSlot);
  return slot ? createPortal(children, slot) : null;
}

/**
 * 머리 줄의 이름 글자 — 14/500 `fg`(시안 `.bar .title` · 02 §6). Thread 이름(`PlainFrame`)과 공용 틀의 이름 상자(`FrameHead`)가 같은
 * 글자다. 줄 높이는 부르는 자리가 든다(이름 상자는 24 줄 상자다).
 */
export const HEAD_NAME = "text-sm font-medium text-fg";

/** 머리 줄 아이콘 단추의 글리프 — 16(시안 Screen-Live 「…」 · 요약 토글). 셸 컨트롤(15)은 왼쪽 칸의 것이라 따로다. */
export const HEAD_GLYPH = "size-4";

/**
 * 머리 줄의 아이콘 단추 — 28 · `radius-lg`(아이콘 버튼 기본 — `--size-control`), 글리프 `fg-titlebar`(#898a8b — 크롬 위 글리프). 쉴 때
 * hover는 버튼 hover(`quiet-hover`)이고, 펼친 메뉴의 트리거(`open` — 「…」 · ⋯)는 hover와 같은 면, 켜진 토글(`on` — 요약 고정 · 분할)은
 * 크롬 위 켜진 면(`fill-toggle-on` #ebebec)이다. 둘 다 글리프가 `fg`로 진해진다. hover는 쉴 때의 가지에만 둔다(`quiet-hover` 머리말).
 * Thread의 「…」 · 요약 고정과 공용 틀의 ⋯ · 분할 · 패널 토글 · 돌아가기가 이 한 벌이다.
 */
export function headButton(state: "rest" | "open" | "on" = "rest") {
  return cn(
    "icon-button transition-colors focus-ring",
    state === "open" ? "bg-fill-hover text-fg" : state === "on" ? "bg-fill-toggle-on text-fg" : "text-fg-titlebar quiet-hover",
  );
}

/**
 * 머리 줄 오른쪽 끝 묶음 — 화면 자리 오른쪽 끝에 붙고(`ml-auto` — 끝 여백 8은 셸의 화면 자리가 든다) 줄지 않으며(`shrink-0`), 단추 사이
 * 2 · 이름 쪽과 적어도 12다(시안 `.tb-r`). 표식 `data-head-actions`는 그것을 재는 검사가 집는다(e2e `tab-row.ts`의 `rowOf`).
 */
export function HeadEnd({ children }: { children: ReactNode }) {
  return (
    <div data-head-actions className="ml-auto flex shrink-0 items-center gap-0.5 pl-3">
      {children}
    </div>
  );
}

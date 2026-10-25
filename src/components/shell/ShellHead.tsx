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
//   여닫기)는 화면에 산 채 자리만 머리 줄이다(설정 화면의 저장 버튼이 머리 카드로 가는 `HeadActionsSlot`과 같은 길).

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

import { useRef, type ReactNode } from "react";
import { InlineRename } from "@/components/ui/inline-rename";
import { HOTKEYS, pressed } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import type { HeadRename } from "./Frame";
import { PANEL_MOTION } from "./panel-layout";

// **Thread 화면의 틀**(v1 티켓 07 · 캔버스 Screen-Home · Screen-Thread 보드) — 카드 없는 흰 면이다. 공용 틀(`Frame`)은 회색 바탕에
// 머리 카드와 둥근 본문 카드를 띄우지만, v1의 Thread 화면(`/` · `/threads/<id>`)은 대화가 창 전부를 차지하는 흰 면이다. 사람 메뉴로 간
// 지금 화면들(Projects · Terminal · Processes · Archive · Settings)은 공용 틀 그대로다. 둘을 한 틀의 갈래로 두지 않은 까닭은 결정.md 07에
// 있다 — 공용 틀은 패널 · 레일 · 분할 · 목록 칸을 지키는 틀이고, 이 틀은 그 어느 것도 들지 않는다.
//
//   뿌리(bg-surface, 끌기) ─ 머리 줄 `<header>`(46 대신 48 — 앱의 머리 줄 높이, 끌기) ─ 이름(있으면 · 그 자리에서 바꾼다) · 이름 뒤(`after`)
//                                                                                       · 오른쪽 끝(`end`)
//                         └ 본문 `<main>` — 화면이 건넨 것이 곧장 선다
//
// - **머리 줄 전부가 창을 끄는 자리다** — 창 맨 위 줄이라 제목 막대의 관례를 따른다(공용 틀의 머리 카드와 같은 `deep`). 바꿀 수 있는
//   이름은 포커스를 받는 요소라 Tauri가 스스로 비켜 둔다 — 끄는 자리의 두 번 클릭은 창 키우기라, 두 번 클릭이 이름 바꾸기인 이름은
//   끌면 안 된다. 이름이 없는 새 Thread는 빈 줄이다(Screen-Home 보드). 이름이 서면 아래에 0.5px 선이 선다(Screen-Thread 보드 `.bar`).
// - **왼쪽 여백은 사이드바를 따른다** — 열렸으면 20(보드 `.bar`의 왼쪽 20), 접혔으면 신호등 · 셸 컨트롤 끝 + 틈
//   (`--titlebar-inset-head`)이고, 사이드바 폭과 같은 박자(`PANEL_MOTION`)로 따라온다 — 공용 틀의 머리 줄과 같은 규칙이다.
// - **이름은 그 자리에서 바꾼다**(두 번 클릭 · F2) — 공용 틀 머리 카드의 이름과 같은 길이다(`HeadRename` · `InlineRename`).

interface PlainFrameProps {
  /** 사이드바가 열렸나 — 머리 줄의 왼쪽 여백이 이것으로 갈린다. */
  sidebarOpen: boolean;
  /** 머리 줄의 이름 — 없으면 빈 줄이다(새 Thread). */
  title?: { name: string; rename?: HeadRename };
  /** 이름 바로 뒤 — 이은 Work의 알약(v1 티켓 30 · 화면 2 보드 `.wchip`, 이름과 틈 10). */
  after?: ReactNode;
  /** 머리 줄 오른쪽 끝 — 참여자 얼굴(v1 티켓 14). ⋯ · Work 패널 토글(31 · 34)도 여기 선다. */
  end?: ReactNode;
  /** 본문(`<main>`)의 이름(`aria-label`). */
  label: string;
  children: ReactNode;
}

export function PlainFrame({ sidebarOpen, title, after, end, label, children }: PlainFrameProps) {
  return (
    <div data-tauri-drag-region className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header
        data-tauri-drag-region="deep"
        className={cn(
          "flex h-(--titlebar-height) shrink-0 items-center pr-2.5 transition-[padding]",
          PANEL_MOTION,
          sidebarOpen ? "pl-5" : "pl-(--titlebar-inset-head)",
          title && "border-b-[0.5px] border-border-light",
        )}
      >
        {title && <PlainTitle name={title.name} rename={title.rename} />}
        {after && <div className="ml-2.5 flex min-w-0 items-center">{after}</div>}
        {end && <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2.5">{end}</div>}
      </header>
      <main aria-label={label} className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}

/**
 * 머리 줄의 이름 — 14/500 한 줄(보드 `.bar .title`). 바꿀 수 있으면 포커스를 받고 두 번 클릭 · F2가 고치기에 들며, 고치는 동안은 이름
 * 자리에 입력칸이 선다. 키로 끝내면 포커스가 이 이름으로 돌아온다.
 */
function PlainTitle({ name, rename }: { name: string; rename?: HeadRename }) {
  const nameEl = useRef<HTMLSpanElement>(null);
  if (rename?.editing) {
    return (
      <InlineRename
        value={name}
        label={rename.label}
        emptyMeans="revert"
        fit="text"
        onCommit={rename.onCommit}
        onDone={rename.onEnd}
        returnFocus={() => nameEl.current}
        className="-ml-1 h-6 px-1 text-sm font-medium text-fg"
      />
    );
  }
  return (
    <span
      ref={nameEl}
      tabIndex={rename ? 0 : undefined}
      aria-keyshortcuts={rename ? HOTKEYS.rename.aria : undefined}
      onKeyDown={(event) => {
        if (rename && pressed(event, "rename")) {
          event.preventDefault();
          rename.onStart();
        }
      }}
      onDoubleClick={rename?.onStart}
      className={cn("min-w-0 truncate rounded-md text-sm font-medium text-fg", rename && "focus-ring")}
    >
      {name}
    </span>
  );
}

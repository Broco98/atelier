import type { ReactNode } from "react";
import { Bell, SquarePen, type LucideIcon } from "lucide-react";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { sidebarRowTone } from "./sidebar-look";

// 사이드바의 nav 줄 — **위 줄**(새 Thread · 내 차례 · Library, 02 구현 스펙 §4 · CONTEXT 「위 줄」)과 설정 nav의 항목이 같은 컴포넌트를 쓴다.
// 둘은 같은 사이드바 자리에 갈아 서서 규격이 갈리면 들어가는 순간 행이 튄다(`Sidebar.tsx`의 GUTTER 주석과 같은 계약). 같은 문자열을 두 곳에
// 적어 두면 다음에 규격을 한 번 조정할 때 한쪽만 남는다 — index.css의 quiet-hover 주석이 같은 이유로 열 자리를 하나로 묶었다.
//
// 이 파일이 `Sidebar.tsx` 밖에 사는 것은 정적 마크업 seam 때문이다 — 그 파일은 터미널 스토어를 물어 `@xterm/*`가 딸려 와 렌더로 들일 수
// 없다(`Sidebar.test.tsx` 머리말). 행의 그림(이름 · 끝 글자 · 누름)은 여기서 잰다(`sidebar-item.test.tsx`), 켜짐을 무엇이 정하는지(주소 ·
// 거르기)는 `Sidebar.tsx`의 항목이 든다.

/** nav 정류장 목록에서 「새 Thread」의 열쇠 — nav 항목의 key와 겹치지 않는다. */
export const NEW_THREAD_KEY = "new-thread";
/** nav 정류장 목록에서 「내 차례」의 열쇠. */
export const MINE_KEY = "mine";
/** nav 정류장 목록에서 「Library」의 열쇠. */
export const LIBRARY_KEY = "library";

/**
 * 줄 하나. **누르면 바로 간다**(결정 6) — 더 갈라지지 않는 줄이다. 배경(선택 · hover)은 바깥 상자가 갖고 가로 여백은 이름 버튼이 품는다 —
 * 바깥이 가진 padding은 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가 된다. 끝 글자(⌘N · 기다리는 수)도
 * 버튼 안 오른쪽 끝에 선다 — 줄 어디를 눌러도 같은 일이다.
 */
export function SidebarItem({
  icon: Icon,
  label,
  active,
  roving,
  onClick,
  end,
  pressed,
  name,
  keyshortcuts,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  /**
   * 목록(nav) 안의 항목이면 그 키와 정류장인가(roving — `@/lib/roving`). 정류장만 `tabIndex={0}`이고 나머지는 `-1`이다. 없으면
   * 혼자 선 정류장이다(앱으로 돌아가기) — 그래도 `0`을 적는다: WebKit의 Tab은 맨 `<button>`에 서지 않는다.
   */
  roving?: { key: string; stop: boolean };
  onClick: () => void;
  /** 줄 오른쪽 끝의 글자(시안 `.end`) — 없으면 아무것도 안 선다. */
  end?: ReactNode;
  /** 누름 상태를 말하는 줄이면(「내 차례」 — 거르기를 켜고 끈다) 그 값. 가는 줄은 적지 않는다. */
  pressed?: boolean;
  /** 보이는 글과 다른 접근성 이름이 필요할 때만(수가 이름에 붙어 읽혀야 할 때) — 없으면 보이는 글이 이름이다. */
  name?: string;
  /** 그 줄의 단축키(단축키 표의 `aria`) — 줄 끝에 보이는 키를 스크린리더가 듣는 쪽이다. */
  keyshortcuts?: string;
}) {
  return (
    <div
      className={cn(
        // Codex 사이드바의 줄(v1 티켓 46 — 그림을 재었다 · 02 시안 `.row`) — 30(`size-row-nav`) · `radius-lg`, 글자 14/20 400(「새 채팅」은
        // 보통 굵기다) · 아이콘 16. 아이콘은 행 안쪽 8에 서서 거터 8과 합쳐 창 끝 + 16이고, 글자는 아이콘 뒤 8에 서서 창 끝 + 40이다(Codex
        // 「새 채팅」 · 폴더 줄). 오른쪽 안쪽도 8이다 — 끝 글자가 거터와 합쳐 창 끝 − 16에 선다(시안 `.row .end`).
        "flex h-(--size-row-nav) shrink-0 items-center rounded-lg transition-colors",
        // 면 · 글자색은 사이드바 줄 한 벌이다(`sidebar-look` — Work 줄 · Thread 줄과 같다).
        sidebarRowTone(active),
      )}
    >
      <button
        type="button"
        onClick={onClick}
        tabIndex={roving === undefined || roving.stop ? 0 : -1}
        data-roving={roving?.key}
        aria-pressed={pressed}
        aria-label={name}
        aria-keyshortcuts={keyshortcuts}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm focus-ring"
      >
        {/* 글리프는 줄 글자보다 한 단 옅은 `fg-icon`이다(시안 `.row .ico` #5d5f61) — 고른 줄에서도 그대로다. */}
        <Icon className="size-4 shrink-0 text-fg-icon" />
        <span className="min-w-0 truncate">{label}</span>
        {end}
      </button>
    </div>
  );
}

/**
 * 위 줄 「새 Thread」의 그림 — 끝에 그 키(⌘N)가 옅게 선다(12 · 3단계 색, 시안 F1-Home `.cnt`). 글자는 단축키 표의 것이고(`newThread`) 접근성
 * 이름에서 빠진다 — 이름이 「새 Thread⌘N」이 되면 이름으로 집는 자리와 스크린리더가 함께 흐려진다. 키는 `aria-keyshortcuts`가 말한다(메뉴
 * 단축키 칸 `MenuShortcut`과 같은 길). 켜짐(지금 `/`인가)은 부르는 쪽이 정한다.
 */
export function NewThreadRow({ active, stop, onClick }: { active: boolean; stop: boolean; onClick: () => void }) {
  const hotkey = HOTKEYS.newThread;
  return (
    <SidebarItem
      icon={SquarePen}
      label="새 Thread"
      active={active}
      roving={{ key: NEW_THREAD_KEY, stop }}
      onClick={onClick}
      keyshortcuts={hotkey.aria}
      end={
        <span aria-hidden className="ml-auto shrink-0 text-xs text-fg-tertiary">
          {hotkey.glyph}
        </span>
      }
    />
  );
}

/**
 * 위 줄 「내 차례」의 그림(02 구현 스펙 §4 · 스토리 12~15) — 종 글리프에, 끝에 나를 기다리는 Thread 수가 파랗게(12/500 `mine`) 선다. **0이면
 * 끝이 빈다** — 0이라는 숫자가 눈을 끌지 않게. 수가 있으면 이름에 함께 든다(「내 차례 2」 — 수가 글자에 붙어 읽혀 이름을 따로 적는다).
 *
 * 누르면 거르기를 켜고 끈다 — Work · Thread 묶음 대신 「기다리는 순서」 목록이 선다. 그래서 이 줄은 누름 상태(`aria-pressed`)를 말하고,
 * 켜진 동안 고른 줄의 면이다. 모아 보기 화면(F3-Inbox)으로 가지 않는다(02 경계). 수는 켜짐과 상관없이 늘 센다 — 몇이 기다리는지가 보여야
 * 누를 까닭이 생긴다.
 */
export function MineRow({
  count,
  on,
  stop,
  onToggle,
}: {
  count: number;
  on: boolean;
  stop: boolean;
  onToggle: () => void;
}) {
  return (
    <SidebarItem
      icon={Bell}
      label="내 차례"
      active={on}
      pressed={on}
      name={count > 0 ? `내 차례 ${count}` : undefined}
      roving={{ key: MINE_KEY, stop }}
      onClick={onToggle}
      end={count > 0 && <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-mine">{count}</span>}
    />
  );
}

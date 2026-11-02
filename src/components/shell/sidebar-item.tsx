import type { ReactNode } from "react";
import { Bell, MessageSquarePlus, Settings, type LucideIcon } from "lucide-react";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import type { navItems } from "./nav-items";
import { SIDEBAR_GLYPH, SIDEBAR_GLYPH_GAP, SIDEBAR_ROW_SHAPE, SIDEBAR_ROW_TEXT, sidebarRowTone } from "./sidebar-look";

/** 위 칸의 한 줄 — `navItems`의 그 줄이다. */
type NavItem = (typeof navItems)[number];

// 사이드바의 nav 줄 — **위 칸**(새 채팅 · 내 차례 · 가는 곳 다섯, restart 02a-3 · CONTEXT 「위 칸」) · 맨 아래 설정과 설정 nav의 항목이 같은 컴포넌트를 쓴다.
// 둘은 같은 사이드바 자리에 갈아 서서 규격이 갈리면 들어가는 순간 행이 튄다(`Sidebar.tsx`의 GUTTER 주석과 같은 계약). 같은 문자열을 두 곳에
// 적어 두면 다음에 규격을 한 번 조정할 때 한쪽만 남는다 — index.css의 quiet-hover 주석이 같은 이유로 열 자리를 하나로 묶었다.
//
// 이 파일이 `Sidebar.tsx` 밖에 사는 것은 정적 마크업 seam 때문이다 — 그 파일은 터미널 스토어를 물어 `@xterm/*`가 딸려 와 렌더로 들일 수
// 없다(`Sidebar.test.tsx` 머리말). 행의 그림(이름 · 끝 글자 · 누름)은 여기서 잰다(`sidebar-item.test.tsx`), 켜짐을 무엇이 정하는지(주소 ·
// 거르기)는 `Sidebar.tsx`의 항목이 든다.

/** nav 정류장 목록에서 「새 채팅」의 열쇠 — nav 항목의 key와 겹치지 않는다. */
export const NEW_THREAD_KEY = "new-thread";
/** nav 정류장 목록에서 「내 차례」의 열쇠. */
export const MINE_KEY = "mine";

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
  current,
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
  /** 지금 선 화면의 줄인가(위 칸의 다섯) — `aria-current="page"`로 말한다. 거르기(「내 차례」)나 설정 항목은 적지 않는다. */
  current?: boolean;
}) {
  return (
    <div
      className={cn(
        // 시안 Shell · Main의 줄(`.ra-sr-row` — restart 02a-3) — 30(`size-row-nav`), 글자 13/18 400 · 글리프 15. 글리프는 행 안쪽 8에 서서 거터
        // 8과 합쳐 창 끝 + 16이고, 글자는 글리프 뒤 9에 서서 창 끝 + 40이다. 오른쪽 안쪽도 8이다 — 끝 글자가 거터와 합쳐 창 끝 − 16에 선다
        // (`.ra-sr-row .end`). 한때(v1 티켓 46 – 02a-2) Codex 사이드바를 잰 14/20 · 글리프 16 · 사이 8이었다.
        "flex h-(--size-row-nav) shrink-0 items-center transition-colors",
        // 모양 · 면 · 글자색은 사이드바 줄 한 벌이다(`sidebar-look` — Work 줄 · Thread 줄과 같은 둥글기 4 · 02 코드 리뷰 S2).
        SIDEBAR_ROW_SHAPE,
        sidebarRowTone(active),
      )}
    >
      <button
        type="button"
        onClick={onClick}
        tabIndex={roving === undefined || roving.stop ? 0 : -1}
        data-roving={roving?.key}
        aria-pressed={pressed}
        aria-current={current ? "page" : undefined}
        aria-label={name}
        aria-keyshortcuts={keyshortcuts}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center px-2 text-left focus-ring",
          SIDEBAR_GLYPH_GAP,
          SIDEBAR_ROW_TEXT,
          SIDEBAR_ROW_SHAPE,
        )}
      >
        {/* 글리프는 줄 글자보다 옅은 `fg-secondary`다(시안 `.ra-sr-row > .ic`) — 고른 줄에서도 그대로다. */}
        <Icon className={SIDEBAR_GLYPH} />
        <span className="min-w-0 truncate">{label}</span>
        {end}
      </button>
    </div>
  );
}

/**
 * 위 칸 「새 채팅」의 그림 — 끝에 그 키(⌘N)가 옅게 선다(12 · 3단계 색, 시안 F1-Home `.cnt`). 글자는 단축키 표의 것이고(`newThread`) 접근성
 * 이름에서 빠진다 — 이름이 「새 채팅⌘N」이 되면 이름으로 집는 자리와 스크린리더가 함께 흐려진다. 키는 `aria-keyshortcuts`가 말한다(메뉴
 * 단축키 칸 `MenuShortcut`과 같은 길). 켜짐(지금 `/`인가)은 부르는 쪽이 정한다.
 */
export function NewThreadRow({ active, stop, onClick }: { active: boolean; stop: boolean; onClick: () => void }) {
  const hotkey = HOTKEYS.newThread;
  return (
    <SidebarItem
      icon={MessageSquarePlus}
      label="새 채팅"
      active={active}
      roving={{ key: NEW_THREAD_KEY, stop }}
      onClick={onClick}
      keyshortcuts={hotkey.aria}
      end={<RowKey glyph={hotkey.glyph} />}
    />
  );
}

/** 줄 끝의 키 글자(⌘N · ⌘,) — 이름에 들지 않는다(`aria-hidden`). 키는 그 줄의 `aria-keyshortcuts`가 말한다. */
function RowKey({ glyph }: { glyph: string }) {
  return (
    <span aria-hidden className="ml-auto shrink-0 text-xs text-fg-tertiary">
      {glyph}
    </span>
  );
}

/**
 * 위 칸 「가는 곳」의 줄 하나(restart 02a-3 · 스토리 86 · 시안 Main의 Services · Projects · Terminal · Processes · Archive) — 이름 · 글리프 · 가는
 * 곳은 `navItems`의 그 줄이다(⌘K의 「가는 곳」과 화면 머리 줄이 같은 배열을 읽는다). 지금 선 화면의 줄이면 고른 면이고 지금 자리를 말한다.
 * 끝 글자(`end` — Processes의 합계 · Terminal의 셸 수)는 부르는 쪽이 세어 건넨다 — 이 파일은 스토어를 모른다(머리말).
 */
export function PlaceRow({
  item,
  active,
  stop,
  onClick,
  end,
}: {
  item: NavItem;
  active: boolean;
  stop: boolean;
  onClick: () => void;
  end?: ReactNode;
}) {
  return (
    <SidebarItem
      icon={item.icon}
      label={item.label}
      active={active}
      current={active}
      roving={{ key: item.key, stop }}
      onClick={onClick}
      // 끝 글자는 줄 안쪽 8에 선다(시안 `.ra-sr-row .end`) — 메타 한 벌(`row-meta`)의 오른쪽 여백 4를 여기서 되돌려, 「새 채팅」의 ⌘N과 같은
      // 세로줄에 끝이 선다.
      end={end === undefined ? undefined : <span className="-mr-1 ml-auto flex shrink-0">{end}</span>}
    />
  );
}

/**
 * 맨 아래 「설정」 줄(restart 02a-3 · 시안 `.ra-sr-foot`) — 끝에 그 키(⌘,)가 옅게 선다. 「새 채팅」의 ⌘N과 같은 길이다 — 글자는 단축키 표의
 * 것이고(`settings`) 이름에서 빠지며, 키는 `aria-keyshortcuts`가 말한다. 설정은 위 칸의 다섯과 성질이 달라(결정 51) 목록 밖 맨 아래에 혼자
 * 선다 — 혼자 선 Tab 정류장이다.
 */
export function SettingsRow({ onClick }: { onClick: () => void }) {
  const hotkey = HOTKEYS.settings;
  return (
    <SidebarItem
      icon={Settings}
      label="설정"
      active={false}
      onClick={onClick}
      keyshortcuts={hotkey.aria}
      end={<RowKey glyph={hotkey.glyph} />}
    />
  );
}

/**
 * 위 칸 「내 차례」의 그림(02 구현 스펙 §4 · 스토리 12~15) — 종 글리프에, 끝에 나를 기다리는 Thread 수가 파랗게(12/500 `mine`) 선다. **0이면
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

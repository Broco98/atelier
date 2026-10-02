import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Crumbs } from "@/components/ui/crumbs";
import { useShellBackground } from "@/features/terminal/terminal-settings";
import { cn } from "@/lib/utils";
import { TAB_ROW_COLUMN } from "./panel-layout";
import type { ResizableWidth } from "./useResizableWidth";

// 화면의 **공용 틀**(ui-refresh 결정 27). 옅은 회색 바탕(`bg-chrome`) 위에 44px 바탕 줄이 서고, 그 아래 목록 · 본문 · 패널이
// 각자 둥근 흰 카드로 뜬다(ui-refresh 결정 4). 화면은 내용만 건넨다 — 틈 · 끌기 영역 · 신호등 inset을 이 파일 한 곳이 지킨다. 일곱 화면이
// 저마다 그 규칙을 적으면 한 화면만 틈 하나를 빠뜨려도 화면으로는 어디가 죽었는지가 안 보인다.
//
//   뿌리(bg-chrome) ─ 본문 열(TAB_ROW_COLUMN, 아래 틈) ─ 바탕 줄 `<header>`(TitleBar)
//                  │                                 └ 카드 줄(오른쪽 틈 · 사이드바를 접으면 왼쪽 틈) ─ list · 본문 카드 · panel · overlay
//                  └ 레일 열(rail이 있을 때만)
//
// **틈도 창을 끄는 자리다.** Tauri는 누른 요소 **자신**의 `data-tauri-drag-region`만 본다 — 회색 틈이 드러나는 상자(뿌리 ·
// 본문 열 · 카드 줄 · 레일 열 · 접히는 바깥 상자) 모두에 단다. 하나라도 빠지면 그 틈은 창을 못 끄는 죽은 자리가 된다. 카드
// 안(카드 머리의 빈 자리도)은 끌기 영역이 아니다. 틈의 실제 자리와 그 자리를 누르면 무엇이 눌리는지는 `e2e/frame.spec.ts`가 잰다.
//
// **카드 줄에 flex `gap`을 쓰지 않는다.** 틈은 칸 상자의 안쪽 여백이다 — 접힌 칸 옆에 틈이 남지 않게(판 04 「지키는 것」).

/** 왼쪽 목록 카드 · 오른쪽 패널 카드 한 칸. 저장하는 폭은 **카드의 폭**이다(틈은 더하지 않는다). */
export interface SideSlot {
  open: boolean;
  size: ResizableWidth;
  label: string;
  children: ReactNode;
}

/** 레일의 칸 하나 — 소문자 영어 이름(`spec` · `info`, CONTEXT.md)이다. 칸은 목록으로 받아 뒤에 더해진다. */
export interface RailItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** 작업 화면의 레일(ui-refresh 결정 9 · 10) — 패널 토글 하나와 칸 묶음. 켜진 칸을 다시 고르면 부르는 쪽이 닫는다. */
export interface RailProps {
  open: boolean;
  onToggle: () => void;
  items: readonly RailItem[];
  active: string;
  onPick: (id: string) => void;
}

interface FrameProps {
  /** 사이드바가 열렸나 — 바탕 줄의 왼쪽 여백과 카드 줄의 왼쪽 틈이 이것으로 갈린다. */
  sidebarOpen: boolean;
  /** 바탕 줄에 서는 것(탭 줄). 없으면 창을 끄기만 하는 빈 줄이다(ui-refresh 결정 5 — 탭이 없는 화면). */
  titlebar?: ReactNode;
  /** 왼쪽 목록 카드 — `section`이다(`aside`는 사이드바와 작업 패널 둘뿐이다). */
  list?: SideSlot;
  /** 오른쪽 작업 패널 카드 — 바깥 상자가 두 번째 `<aside>`다. */
  panel?: SideSlot;
  /** 작업 화면의 레일 열. */
  rail?: RailProps;
  /**
   * 카드 줄 위를 덮는 것(놓기 겹판 · 토스트 · 생애 겹판). 카드 줄이 바탕 줄 **아래**에서 시작하므로 머리행을 빼는 계산 없이
   * 「끄는 것이 출발한 줄은 덮지 않는다」가 상자로 선다.
   */
  overlay?: ReactNode;
  /** 본문 카드(`<Card as="main">`) 또는 나란히 선 카드 둘. */
  children: ReactNode;
}

function Frame({ sidebarOpen, titlebar, list, panel, rail, overlay, children }: FrameProps) {
  return (
    // **뿌리가 제 min-content를 바깥에 알린다**(`min-w-min`) — 그것이 탭 줄의 바닥(`TAB_ROW_COLUMN`)이 사이드바에게 자리를
    // 요구하는 길이다. 카드 줄은 제 내용 폭을 안 알리므로(아래) 넓은 문서 · xterm이 그 바닥을 부풀리지 않는다.
    <div data-tauri-drag-region className="flex min-h-0 min-w-min flex-1 bg-chrome">
      <div data-tauri-drag-region className={cn("flex flex-1 flex-col pb-(--gap)", TAB_ROW_COLUMN)}>
        <TitleBar sidebarOpen={sidebarOpen}>{titlebar}</TitleBar>
        {/* 카드 줄. 사이드바가 열렸으면 왼쪽 틈이 0이다 — 사이드바 쪽 여백이 그 틈으로 보인다(프로토타입 `.at-main` ·
            `.at-sidebar`). 사이드바가 접히면 카드가 창 왼쪽 틈까지 넓어진다. 여백은 바탕 줄의 여백과 같은 곡선으로
            따라온다 — 사이드바 폭 트랜지션과 곡선이 다르면 카드 모서리가 자리를 지나쳤다 되돌아온다(index.css의 `--panel-ease`).
            `relative`는 `overlay`의 기준이다. */}
        <div
          data-tauri-drag-region
          className={cn(
            "relative flex min-h-0 flex-1 pr-(--gap) transition-[padding] duration-[220ms] ease-panel",
            sidebarOpen ? "pl-0" : "pl-(--gap)",
          )}
        >
          {list && <SideBox kind="list" slot={list} />}
          {children}
          {panel && <SideBox kind="panel" slot={panel} />}
          {overlay}
        </div>
      </div>
      {rail && (
        // 레일 열의 자리(ui-refresh 결정 10). 패널 토글과 칸 묶음은 이 열에 선다 — 판 04 티켓 04가 채운다. 왼쪽 틈은 본문
        // 열의 오른쪽 틈(바탕 줄 · 카드 줄의 `pr-(--gap)`)이다.
        <div data-tauri-drag-region className="w-(--rail) shrink-0 box-content pr-(--gap)" />
      )}
    </div>
  );
}

/**
 * 목록 · 패널 칸의 자리 — 바깥 상자(끌기 영역, 카드 쪽 틈을 안쪽 여백으로 든다)와 카드 하나. 접힘 트랜지션(`PANEL_MOTION` ·
 * `foldingInnerClass`) · 틈 가운데의 손잡이 · 폭 저장은 이 자리를 처음 쓰는 화면이 채운다(판 04 티켓 02 · 03).
 */
function SideBox({ kind, slot }: { kind: "list" | "panel"; slot: SideSlot }) {
  const Box = kind === "panel" ? "aside" : "div";
  return (
    <Box
      data-tauri-drag-region
      hidden={!slot.open}
      className={cn("flex shrink-0", kind === "list" ? "pr-(--gap)" : "pl-(--gap)")}
    >
      <Card label={slot.label} style={{ width: slot.size.width }}>
        {slot.children}
      </Card>
    </Box>
  );
}

/**
 * 바탕 줄 — 창 맨 위 44px의 `<header>` 하나(ui-refresh 결정 5). 문서의 **첫 `header`가 이 줄이다**(e2e `tab-row.ts`가 그것을
 * 탭 줄로 집는다). 탭 줄(`ShellTabs`)의 칸들이 이 줄의 자식으로 바로 서고, 탭이 없는 화면에서는 비어 있는 끌기 줄이다.
 *
 * **신호등 inset은 이 줄 하나만 계산한다.** 왼쪽 여백은 사이드바가 열렸으면 `--tab-lead`(사이드바 경계에서 재는 거리),
 * 접혔으면 `--titlebar-inset-tabs`(셸 컨트롤 뒤 같은 거리)다 — 갈라 두면 ⌘B로 접었다 펴는 동안 첫 칸이 두 리듬으로 움직인다
 * (index.css의 `[data-titlebar]`). 여백은 사이드바 폭과 같은 곡선(`ease-panel`)으로 따라온다. 오른쪽 여백은 카드 줄의 오른쪽
 * 틈과 같은 값이라 오른쪽 끝 조작이 카드 모서리와 한 줄에 선다.
 *
 * 줄 안의 버튼들은 이 속성이 없으므로 그대로 눌린다 — 칸 사이 빈 자리와 끄는 여백은 탭 줄이 제 자식에 단다.
 */
function TitleBar({
  sidebarOpen,
  className,
  children,
}: {
  sidebarOpen: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 바탕이 선으로 잘리지 않고 카드 줄로 이어진다.
        "flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-(--gap) transition-[padding] duration-[220ms] ease-panel",
        sidebarOpen ? "pl-(--tab-lead)" : "pl-(--titlebar-inset-tabs)",
        className,
      )}
    >
      {children}
    </header>
  );
}

type CardTag = "section" | "main" | "div";

interface CardProps {
  /** 카드의 요소. 본문 카드는 `main`이고(문서의 `main`은 하나다), 그 밖은 `section`이다. */
  as?: CardTag;
  /** 카드의 이름(`aria-label`). */
  label: string;
  /** 카드 머리(`CardHead`). 터미널 카드처럼 머리가 없는 카드는 곧바로 내용이 선다(ui-refresh 결정 5). */
  head?: ReactNode;
  /**
   * `terminal`이면 카드 바탕이 **터미널 테마의 바탕**이다(판 04 기본값 — 설정이 밝게면 흰 카드). 셸의 집이 칠하는 값과 같은
   * 출처에서 읽는다(`useShellBackground`) — 둘이 갈리면 둥근 모서리 안쪽에 다른 색의 띠가 선다.
   */
  tone?: "terminal";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * 바탕 위에 뜬 둥근 카드 하나(ui-refresh 결정 4 · 15 — 칸 하나 = 카드 하나). 모서리는 카드가 자른다(`overflow-hidden`) — 안의
 * 스크롤 상자 · 셸 화면이 모서리 밖으로 그려지지 않는다. `relative`는 카드 안에 덮이는 것(설정의 메시지 등)의 기준이다.
 */
function Card({ tone, ...props }: CardProps) {
  return tone === "terminal" ? <TerminalCard {...props} /> : <CardBox {...props} paint="bg-card" />;
}

/** 터미널 카드 — 설정의 테마를 구독하는 것은 이 갈래뿐이다(다른 카드가 설정이 바뀔 때마다 다시 그려질 까닭이 없다). */
function TerminalCard({ style, ...props }: Omit<CardProps, "tone">) {
  const background = useShellBackground();
  return <CardBox {...props} tone="terminal" style={{ ...style, backgroundColor: background }} />;
}

function CardBox({
  as: Tag = "section",
  label,
  head,
  tone,
  paint,
  className,
  style,
  children,
}: CardProps & { paint?: string }) {
  return (
    <Tag
      aria-label={label}
      data-slot="card"
      data-tone={tone}
      style={style}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card",
        paint,
        className,
      )}
    >
      {head}
      {children}
    </Tag>
  );
}

/**
 * 카드 머리(ui-refresh 결정 5) — 「지금 보는 것」의 브레드크럼 캡슐과 알약 버튼이 서는 48px 줄이다. `div`이고 끌기 영역이 아니다
 * (카드 안이다). 좌우 여백은 캡슐 · 알약의 안쪽 여백(14)을 뺀 값이라 캡슐의 글자가 카드 안 여백(`--card-pad`)에 선다.
 *
 * `lead`는 캡슐 앞(하위 화면의 뒤로), `meta`는 캡슐 바로 뒤(상태 배지 등), `end`는 오른쪽 끝에 고정되는 조작이다.
 */
function CardHead({
  lead,
  crumbs,
  meta,
  end,
}: {
  lead?: ReactNode;
  /** 뿌리부터 지금 선 곳까지(`Crumbs`). 마지막이 지금 선 곳이다. */
  crumbs: readonly string[];
  meta?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div
      data-slot="card-head"
      className="flex h-(--card-head) shrink-0 items-center gap-1.5 px-[calc(var(--card-pad)-14px)]"
    >
      {lead}
      <Crumbs items={crumbs} />
      {meta}
      {end && <div className="ml-auto flex shrink-0 items-center gap-1.5">{end}</div>}
    </div>
  );
}

export { Card, CardHead, Frame, TitleBar };

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, Settings, type LucideIcon } from "lucide-react";
import { shallow, useStore } from "@tanstack/react-store";
import { cn } from "@/lib/utils";
import SidebarWorkList from "@/features/works/SidebarWorkList";
import ShellBranch from "@/features/terminal/ShellBranch";
import { shellCountsOf, shellsOf } from "@/features/terminal/shell-registry";
import { terminalStore } from "@/features/terminal/terminal-store";
import { navItems, type NavKey } from "./nav-items";
import { SectionBody } from "./sidebar-tree";
import useResizableWidth, { ResizeHandle } from "./useResizableWidth";

interface SidebarProps {
  open: boolean;
  // Works 화면에서는 활성 항목이 없다 — nav에 Works가 없기 때문이다
  activeKey: NavKey | null;
  onSelect: (key: NavKey) => void;
  // 설정은 nav 항목이 아니라 바닥에 따로 산다(결정 51) — 활성 판정도 그래서 따로 온다
  settingsActive: boolean;
  onOpenSettings: () => void;
}

// 오른쪽만 19px = 거터 8 + 스크롤바 11(scroll-quiet). 가운데 작업 목록은 스크롤바가
// 늘 자리를 잡고 있어 항목 폭이 그만큼 좁다 — 같은 값을 비워 둬야 nav 항목과 목록
// 항목의 오른쪽 끝이 맞는다. 둘이 세로로 붙어 있어 어긋나면 그 자리에서 보인다.
// **바닥의 설정도 같은 거터를 쓴다** — 결정 51이 이 정렬 계약의 경계를 하나 늘렸다.
const GUTTER = "pl-2 pr-[19px]";

// 고정 nav 블록 + 상주하는 작업 목록 + 바닥에 고정된 설정. 어느 화면에 있든 이 사이드바는
// 바뀌지 않는다.
// 목록이 여기 살면서 셸이 작업 데이터를 직접 읽게 됐다 — 순수 프레젠테이션이 아니다.
function Sidebar({
  open,
  activeKey,
  onSelect,
  settingsActive,
  onOpenSettings,
}: SidebarProps) {
  const size = useResizableWidth("sidebar-width", 280, 240, 400);
  // 호버 카드가 이 상자 오른쪽으로 비켜 열린다 — 행이 아니라 사이드바가 기준이다
  const asideRef = useRef<HTMLElement>(null);
  // **어느 work에 가지가 서는가만 읽는다**(결정 71). 셀렉터가 얕은 비교를 타므로 셸이
  // 열리고 닫힐 때만 이 셸이 다시 그려진다 — 프롬프트마다 오는 OSC 타이틀에는 안 흔들린다.
  // 목록이 스스로 구독하지 않는 이유는 SidebarWorkList의 `shellCounts` 주석에 있다.
  const shellCounts = useStore(terminalStore, shellCountsOf, shallow);
  // 최상위 셸은 work의 것이 아니라 nav 항목에 붙는 가지다(결정 72) — 세는 자리도 따로다.
  // 숫자 하나라 얕은 비교가 필요 없다.
  const topShells = useStore(terminalStore, (state) => shellsOf(state, null).length);

  /**
   * nav `Terminal`의 가지가 펼쳐졌는가 — work의 가지와 **같은 규칙**이다(결정 107).
   * `null`은 「사람이 아직 안 정했다」이고, 그 화면을 처음 고를 때 한 번 펼친다.
   * 사람이 접으면 `false`가 남아 다시 들어가도 접힌 채다. 세션 메모리다.
   */
  const [terminalBranch, setTerminalBranch] = useState<boolean | null>(null);
  useEffect(() => {
    if (activeKey === "terminal") setTerminalBranch((open) => open ?? true);
  }, [activeKey]);
  const terminalOpen = terminalBranch === true;
  // 가지가 서는 조건은 work과 같은 **합집합**이다 — 지금 그 화면이거나, 셸이 하나라도 있거나.
  const terminalStands = activeKey === "terminal" || topShells > 0;

  return (
    <aside
      ref={asideRef}
      style={{ "--sidebar-width": `${size.width}px` } as React.CSSProperties}
      className={cn(
        "relative shrink-0 overflow-hidden border-r bg-sidebar",
        // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다.
        // 곡선은 --ease-panel — 접히는 패널 넷이 같은 값을 읽는다 (index.css)
        !size.dragging &&
          "transition-[width,border-color] duration-[220ms] ease-panel",
        // 접을 때 테두리 폭을 0으로 보낸다. border-transparent는 색만 지우고 1px 자리를 남기는데,
        // box-sizing이 border-box라 사용 폭이 0이 아니라 1px에서 바닥을 친다. 그 1px이 오른쪽
        // 전부를 밀어 --titlebar-inset-panel 계산이 어긋났고(간격 6px가 7px), 접힘이 끝난 뒤에도
        // 창 왼쪽 끝에 사이드바 배경 한 줄이 남았다. 목록 패널 둘도 같은 이유로 같은 처리를 한다.
        //
        // border-width는 위 트랜지션 목록에 **넣지 않는다.** WebKit이 0보다 큰 테두리를 디바이스
        // 픽셀 하나로 올림해서, 보간해 봐야 폭 바닥은 그대로인 채 레티나에서 구분선 두께만
        // 1↔2 디바이스픽셀로 튄다 (열림 끝에 툭 굵어진다). 폭은 그냥 끊어 바꾸는 편이 낫다.
        open ? "w-(--sidebar-width)" : "w-0 border-transparent border-r-0",
      )}
    >
      {/* fixed inner width so text doesn't reflow while the width animates */}
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col pb-2.5 transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        {/* traffic light strip — same height as the main header (the header no
            longer draws a bottom border; the 44px strip is what keeps the two
            columns aligned). It is also the nav's top breathing room, which is
            why the nav below carries no top padding of its own. */}
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />

        {/* 거터는 GUTTER 하나가 정한다 — 위 주석의 정렬 계약이 이제 두 자리에 걸린다 */}
        <nav className={cn("flex shrink-0 flex-col gap-[3px]", GUTTER)}>
          {navItems.map((item) => (
            <Fragment key={item.key}>
              <SidebarItem
                icon={item.icon}
                label={item.label}
                active={item.key === activeKey}
                onClick={() => onSelect(item.key)}
                // **nav 항목에도 가지가 붙는다**(결정 72). 최상위 셸을 고르는 자리가
                // 가로 탭 줄에서 여기로 왔고, 그 줄이 겸하던 타이틀바는 PageHeader가 받았다.
                branch={
                  item.key === "terminal" && terminalStands
                    ? {
                        open: terminalOpen,
                        count: topShells,
                        onToggle: () => setTerminalBranch(!terminalOpen),
                      }
                    : undefined
                }
              />
              {item.key === "terminal" && terminalStands && (
                // 들여쓰기는 이 상자 하나가 준다 — work의 가지와 같은 값이다.
                <SectionBody open={terminalOpen}>
                  <ShellBranch work={null} />
                </SectionBody>
              )}
            </Fragment>
          ))}
        </nav>

        <SidebarWorkList
          open={open}
          boundaryRef={asideRef}
          shellCounts={shellCounts}
          renderShells={(work) => <ShellBranch work={work} />}
        />

        {/* **바닥 고정** — 「설정은 목적지 셋과 성질이 다르다」를 위치로 말한다(결정 51).
            `navItems` 배열에 한 줄 넣는 안은 기각됐다: 그 배열의 주석이 「앞으로 늘어날
            목적지는 이 배열에 한 줄」로 길을 열어 뒀지만, 설정은 그 목적지들이 아니다.
            대가는 여기 그대로 있다 — 작업 목록 아래에 새 영역이 생기고, 위 nav와 같은
            규격을 쓰면서 자리가 갈린다. 그래서 규격은 `SidebarItem` 하나로, 거터는 GUTTER
            하나로 묶어 「같은 규격」이 주석이 아니라 구조가 되게 했다. */}
        <div className={cn("shrink-0 pt-1.5", GUTTER)}>
          <SidebarItem
            icon={Settings}
            label="Settings"
            active={settingsActive}
            onClick={onOpenSettings}
          />
        </div>
      </div>

      {open && <ResizeHandle control={size} />}
    </aside>
  );
}

// nav 항목과 바닥의 설정이 **같은 컴포넌트**를 쓴다. 둘은 한 컬럼에 세로로 붙어 있어
// 규격이 갈리면 그 자리에서 보이는데(위 GUTTER 주석과 같은 계약), 같은 문자열을 두 곳에
// 적어 두면 다음에 규격을 한 번 조정할 때 한쪽만 남는다 — index.css의 quiet-hover 주석이
// 같은 이유로 열 자리를 하나로 묶었다.
//
// **행이 바깥 상자 + 버튼 둘이 됐다**(결정 72). `Terminal`이 가는 곳이면서 접히는 가지를
// 이고 있게 되어, 한 행에 누를 것이 둘이다. 중첩 button은 HTML에서 허용되지 않고
// span role="button"으로 흉내 내면 Tab으로 도달할 수 없다 — 작업 행(WorkRow)과 셸 행이
// 이미 같은 문제를 이 구조로 풀었다. 가지가 없는 항목도 **같은 구조로 남긴다**: 규격이
// 갈리는 것이 이 컬럼에서 가장 먼저 보이는 결함이라, 분기를 마크업이 아니라 값으로 둔다.
//
// 배경(선택·hover)은 바깥 상자가 갖고 가로 여백은 이름 버튼이 품는다 — 바깥이 가진 padding은
// 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가 된다.
function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  branch,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  /** 이 항목이 가지를 이고 있으면. 없으면 화살표도 개수도 서지 않는다. */
  branch?: { open: boolean; count: number; onToggle: () => void };
}) {
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center rounded-[10px] pr-1 transition-colors",
        active ? "selected-row" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-full min-w-0 flex-1 items-center gap-[9px] pl-[9px] pr-1.5 text-left text-[13.5px] font-medium"
      >
        <Icon className="size-[17px] shrink-0" strokeWidth={1.7} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {branch && (
        <>
          {/* 접힌 채로도 「몇 개가 돌고 있나」가 보여야 한다 — work의 가지 머리행과 같은 규칙이다. */}
          {branch.count > 0 && (
            <span className="shrink-0 text-[11.5px] tabular-nums text-tertiary">{branch.count}</span>
          )}
          <button
            type="button"
            // 표식은 검사가 이 버튼을 정체성으로 집기 위한 것이다(sidebar-tree의 같은 주석).
            data-branch=""
            aria-expanded={branch.open}
            aria-label={`${label} 가지 접기`}
            onClick={branch.onToggle}
            className="icon-button-quiet shrink-0 text-tertiary"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-[rotate] duration-[180ms] ease-panel",
                !branch.open && "-rotate-90",
              )}
              strokeWidth={2.2}
            />
          </button>
        </>
      )}
    </div>
  );
}

export default Sidebar;

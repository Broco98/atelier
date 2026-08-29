import { useRef } from "react";
import { Settings, type LucideIcon } from "lucide-react";
import { shallow, useStore } from "@tanstack/react-store";
import { cn } from "@/lib/utils";
import SidebarWorkList, { RunningMarks } from "@/features/works/SidebarWorkList";
import { runningKindsOf, shellCountsOf, shellsOf } from "@/features/terminal/shell-registry";
import { terminalStore } from "@/features/terminal/terminal-store";
import { navItems, type NavKey } from "./nav-items";
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
  // **work마다 셸이 몇 개인가만 읽는다**(결정 2·3). 셀렉터가 얕은 비교를 타므로 셸이
  // 열리고 닫힐 때만 이 셸이 다시 그려진다 — 프롬프트마다 오는 OSC 타이틀에는 안 흔들린다.
  // 목록이 스스로 구독하지 않는 이유는 SidebarWorkList의 `shellCounts` 주석에 있다.
  const shellCounts = useStore(terminalStore, shellCountsOf, shallow);
  // 최상위 셸은 어느 work의 것도 아니라 nav 항목이 그 수를 안는다 — 세는 자리도 따로다.
  // 숫자 하나라 얕은 비교가 필요 없다.
  const topShells = useStore(terminalStore, (state) => shellsOf(state, null).length);

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
        <nav className={cn("flex shrink-0 flex-col gap-(--row-gap)", GUTTER)}>
          {navItems.map((item) => (
            <SidebarItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={item.key === activeKey}
              onClick={() => onSelect(item.key)}
              // **최상위 셸이 몇 개인가는 남는다**(결정 6이 걷은 것은 펼침이지 이 숫자가
              // 아니다). work 행이 둘째 줄로 「여기서 일이 돌고 있다」를 말하는 것과 같은
              // 몫이고, 여기가 아니면 그 셸들의 수가 사이드바 어디에도 안 남는다 —
              // 그 화면에 들어가야만 보인다.
              count={item.key === "terminal" ? topShells : 0}
            />
          ))}
        </nav>

        <SidebarWorkList
          open={open}
          boundaryRef={asideRef}
          shellCounts={shellCounts}
          // 둘째 줄의 로고도 **여기서 읽어 내린다**(결정 2) — 개수(`shellCounts`)가 이미
          // 쓰는 그 우회와 같은 길이고, 이유도 같다: 목록은 터미널을 한 번도 참조하지
          // 않는다. 구독이 행마다 따로인 이유는 `RowRunning`이 든다.
          renderRunning={(work) => <RowRunning slug={work.slug} />}
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

/**
 * work 행 하나가 **자기 것만** 구독한다(결정 2).
 *
 * 이 값은 자주 흔들린다 — 셸은 프롬프트마다 OSC 타이틀을 쏘고 claude는 도는 동안 계속
 * 갈아 끼운다. 그것을 목록이 읽어야 하는데, **위에서 한 번에 읽어 내리면 안 된다**:
 * `Record<slug, string[]>`로 주면 안쪽 배열이 회차마다 새 객체라 얕은 비교가 늘 어긋나고,
 * work 하나에서 명령이 시작될 때마다 **목록 전체가** 다시 그려진다(`runningKindsOf`
 * 머리말이 그 근거를 든다). 행마다 자기 것을 고르면 안 바뀐 행은 같은 배열을 받아 그
 * 자리에 머문다.
 *
 * **개수는 반대로 위에서 한 번에 읽는다**(`shellCounts`) — 그 값은 셸이 열리고 닫힐 때만
 * 바뀌어 얕은 비교가 실제로 걸린다. 둘이 갈리는 자리가 여기다.
 */
function RowRunning({ slug }: { slug: string }) {
  const kinds = useStore(terminalStore, (state) => runningKindsOf(state, slug), shallow);
  return <RunningMarks kinds={kinds} />;
}

// nav 항목과 바닥의 설정이 **같은 컴포넌트**를 쓴다. 둘은 한 컬럼에 세로로 붙어 있어
// 규격이 갈리면 그 자리에서 보이는데(위 GUTTER 주석과 같은 계약), 같은 문자열을 두 곳에
// 적어 두면 다음에 규격을 한 번 조정할 때 한쪽만 남는다 — index.css의 quiet-hover 주석이
// 같은 이유로 열 자리를 하나로 묶었다.
//
// **누르면 바로 간다**(결정 6). 한때 `Terminal`이 가는 곳이면서 셸 가지를 이고 있어 한
// 행에 누를 것이 둘이었는데(결정 72), 셸을 고르는 자리가 화면 안 탭 줄로 되돌아가면서
// (adr-03) 그 가지가 통째로 걷혔다 — 이 항목은 다시 잎이다.
//
// 남은 숫자는 **접힌 가지의 잔재가 아니다**: 그 work에서 몇 개가 도는지를 말하는 work 행의
// 둘째 줄과 같은 몫이고(결정 2), 여기 없으면 최상위 셸의 수가 사이드바에서 사라진다.
// 배경(선택·hover)은 바깥 상자가 갖고 가로 여백은 이름 버튼이 품는다 — 바깥이 가진 padding은
// 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가 된다.
// 숫자가 행 전체를 누르는 데 걸리적거리지 않게 이름 버튼 **안**에 두지 않는다: 그러면 셸
// 수가 이 항목의 접근성 이름에 섞여 「이름으로 nav를 집는다」가 깨진다(WorkRow의 둘째 줄과
// 같은 함정이다).
function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  count = 0,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  /** 이 항목이 안고 있는 셸 수. 0이면 아무것도 안 선다 — 「없음」은 숫자로 말하지 않는다. */
  count?: number;
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
      {/* 배지가 아니라 옅은 숫자다 — 구획 헤더의 개수와 같은 규격이라, 한 컬럼에 세로로
          붙어 서는 둘이 다른 무게로 읽히지 않는다(GUTTER 주석과 같은 계약). 오른쪽 끝도
          그 헤더와 같은 9px에 선다: 바깥 상자가 이미 pr-1(4px)을 물고 있어 5px만 더한다. */}
      {count > 0 && (
        <span className="shrink-0 pr-[5px] text-[11.5px] tabular-nums text-tertiary">{count}</span>
      )}
    </div>
  );
}

export default Sidebar;

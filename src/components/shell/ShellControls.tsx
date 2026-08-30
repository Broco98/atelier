import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import SidebarToggle from "./SidebarToggle";
import { useCanGoForward } from "@/can-go-forward";

interface HistoryButtonProps {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

// 갈 수 없으면 흐려지고 눌러도 반응하지 않는다 — 눌러도 아무 일이 없는 버튼을
// 활성처럼 보여주지 않는다 (disabled:pointer-events-none은 hover 배경까지 함께 막는다)
function HistoryButton({ label, disabled, onClick, children }: HistoryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="icon-button-quiet text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

interface ShellControlsProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /**
   * 검색 팔레트를 연다. **⇧⇧가 부르는 것과 같은 함수여야 한다** — 앱 셸이 그 하나를
   * 내려보낸다(AppShell의 호출부 주석). 여기서 따로 상태를 들면 키로 연 것과 버튼으로 연
   * 것이 서로를 모른다.
   */
  onOpenSearch: () => void;
}

// 신호등 오른쪽에 붙는 셸 컨트롤 행 — 사이드바 토글 → 뒤로 → 앞으로 → 검색.
// 사이드바를 접든 펴든 화면상 자리가 변하지 않는다 (macOS 관행, Codex 배치).
//
// 폭을 --titlebar-controls-width에 딱 맞추고 세로도 컨트롤 높이만큼만 차지한다.
// **칸이 늘면 그 값의 칸 수도 함께 고쳐야 한다**(index.css) — 안 고치면 넘친다.
//
// 이 상자에도 data-tauri-drag-region이 붙어야 한다. 아래 사이드바의 드래그 띠를 z-20으로
// 가리기 때문에, 없으면 흐려진 화살표와 버튼 사이 틈이 클릭도 드래그도 안 되는 죽은 구역이 된다
// (앱을 막 켜면 화살표 둘 다 흐려 신호등 오른쪽 52px가 통째로 그렇게 된다).
// 값을 주지 않은 형태라 "직접 맞은 곳만" 드래그다 — 활성 버튼은 tauri의 판정이 클릭 요소에서
// 먼저 끊어 주므로(drag.js의 isClickableElement) 눌림이 그대로 산다.
function ShellControls({ sidebarOpen, onToggleSidebar, onOpenSearch }: ShellControlsProps) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();

  return (
    <div
      data-tauri-drag-region
      className="absolute left-(--titlebar-controls-left) top-[calc((var(--titlebar-height)-var(--titlebar-control-size))/2)] z-20 flex w-(--titlebar-controls-width) items-center gap-(--titlebar-control-gap) transition-[left] duration-[220ms] ease-panel"
    >
      <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      {/* 마우스 사이드 버튼이 부르는 window.history.back()과 같은 길로 보낸다 */}
      <HistoryButton label="뒤로" disabled={!canGoBack} onClick={() => router.history.back()}>
        <ArrowLeft className="size-4" strokeWidth={1.7} />
      </HistoryButton>
      <HistoryButton
        label="앞으로"
        disabled={!canGoForward}
        onClick={() => router.history.forward()}
      >
        <ArrowRight className="size-4" strokeWidth={1.7} />
      </HistoryButton>
      {/* **뒤로·앞으로와 같은 간격으로 이어 붙는다 — 무리를 가르지 않는다.** 「지나온 길」과
          검색이 다른 성질인 것은 맞지만, 그것으로 간격을 가르는 규칙은 이 행에 없다: 첫 칸의
          사이드바 토글이 이미 히스토리가 아닌데 같은 --titlebar-control-gap으로 서 있다.
          **가르면 이 행의 오른쪽 끝에서 값을 치른다.** 탭 줄과 목록 패널의 첫 칸이 바로 그
          --titlebar-control-gap 거리에서 이어 붙으므로(결정 24 — --tab-lead·
          --titlebar-inset-panel), 검색 앞만 그보다 넓히면 검색이 셸 컨트롤의 마지막 칸이
          아니라 **오른쪽 줄의 첫 칸으로** 읽힌다. 24px 넷뿐인 줄에서 무리를 가르는 틈은
          「묶였다」가 아니라 「하나가 떨어졌다」로 보인다.

          **HistoryButton을 빌려 쓰지 않는 것은 disabled 때문이다.** 그 조각이 드는 것은
          「갈 수 없으면 흐려진다」 하나인데(위 주석), 검색은 갈 곳이 늘 있어 그 가지가 영영
          안 켜진다 — disabled={false}로 부르면 화면에 절대 안 서는 상태를 계약으로만 들고
          있게 된다.

          **떠 있을 때 눌리는 일은 없다.** 팔레트는 `modal-scrim`(z-50)을 깔고 이 행은
          z-20이라, 그동안 이 자리를 누르면 그 배경이 먼저 받아 팔레트가 닫힌다(바깥 클릭
          규칙). 그래서 토글로 만들 것이 없다 — 여는 갈래 하나면 된다. 여는 함수 자체도
          같은 setter라 두 번 열려도 한 번 연 것과 같다.

          **이 행에서 유일하게 title을 든다 — 알릴 것이 글리프 밖에 있기 때문이다.** 이웃
          셋은 그림이 곧 이름이지만(패널·화살표), 이 버튼의 값은 「누를 수 있다」보다 **⇧⇧라는
          키가 있다는 것을 알리는 것**에 가깝다. 사이드바 목록의 핀이 title을 피한 이유(행에
          머물면 호버 카드가 떠서 OS 툴팁이 그 위로 겹친다)는 여기 없다 — 타이틀바에는 뜨는
          카드가 없다.
          **키는 aria-label이 아니라 title에 적는다.** 읽어 주는 이름에 ⇧⇧가 들어가면 글리프
          두 개를 그대로 읽어 소음이 되고, aria-keyshortcuts로는 애초에 못 적는다 — 그 값은
          **대안들의** 공백 구분 목록이라 「⇧ 다음 ⇧」가 아니라 「⇧ 또는 ⇧」로 읽힌다. */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="검색"
        title="검색 (⇧⇧)"
        className="icon-button-quiet text-muted-foreground"
      >
        <Search className="size-4" strokeWidth={1.7} />
      </button>
    </div>
  );
}

export default ShellControls;

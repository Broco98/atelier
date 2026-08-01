import { ArrowLeft, ArrowRight } from "lucide-react";
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
      className="icon-button text-muted-foreground transition-colors hover:bg-state-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

interface ShellControlsProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// 신호등 오른쪽에 붙는 셸 컨트롤 행 — 사이드바 토글 → 뒤로 → 앞으로.
// 사이드바를 접든 펴든 화면상 자리가 변하지 않는다 (macOS 관행, Codex 배치).
//
// 폭을 --titlebar-controls-width에 딱 맞추고 세로도 컨트롤 높이만큼만 차지한다.
//
// 이 상자에도 data-tauri-drag-region이 붙어야 한다. 아래 사이드바의 드래그 띠를 z-20으로
// 가리기 때문에, 없으면 흐려진 화살표와 버튼 사이 틈이 클릭도 드래그도 안 되는 죽은 구역이 된다
// (앱을 막 켜면 화살표 둘 다 흐려 신호등 오른쪽 52px가 통째로 그렇게 된다).
// 값을 주지 않은 형태라 "직접 맞은 곳만" 드래그다 — 활성 버튼은 tauri의 판정이 클릭 요소에서
// 먼저 끊어 주므로(drag.js의 isClickableElement) 눌림이 그대로 산다.
function ShellControls({ sidebarOpen, onToggleSidebar }: ShellControlsProps) {
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
    </div>
  );
}

export default ShellControls;

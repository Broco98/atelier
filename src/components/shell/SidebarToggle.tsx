import { PanelLeft } from "lucide-react";

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

// 셸 컨트롤 행의 첫 칸 — 자리는 ShellControls가 잡는다.
function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="사이드바 토글"
      aria-expanded={open}
      // 창 위 줄의 작은 아이콘 버튼 규격(`icon-button-xs` — 24 · `radius-md`)을 쓴다 — 셸 컨트롤과 같은 48 머리 줄에 나란히 서
      // 있어서, 이 버튼만 크기가 다르면 그 자리에서 바로 어긋나 보인다.
      // 기본 아이콘 색은 다른 아이콘 버튼(text-fg-tertiary)보다 진한 채로 둔다:
      // 사이드바가 닫혔을 때 이걸 못 찾으면 되돌릴 방법이 없다
      className="icon-button-quiet icon-button-xs text-fg-secondary focus-ring"
    >
      <PanelLeft className="size-3.75" />
    </button>
  );
}

export default SidebarToggle;

import { PanelLeft } from "lucide-react";

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

// Fixed in the titlebar strip, right of the traffic lights — stays put
// whether the sidebar is open or collapsed (Codex model).
// 위치·크기는 index.css의 [data-titlebar]가 정한다 (전체화면 분기 포함).
function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="사이드바 토글"
      aria-expanded={open}
      // icon-button 규격(24px·8px)을 쓴다 — 목록 패널 토글과 같은 44px 행에 나란히 서 있어서,
      // 이 버튼만 26px로 남으면 그 자리에서 바로 어긋나 보인다.
      // 기본 아이콘 색은 다른 아이콘 버튼(text-tertiary)보다 진한 채로 둔다:
      // 사이드바가 닫혔을 때 이걸 못 찾으면 되돌릴 방법이 없다
      className="icon-button absolute left-(--titlebar-controls-left) top-[calc((var(--titlebar-height)-var(--titlebar-control-size))/2)] z-20 text-muted-foreground transition-[left,color,background-color] duration-[220ms] hover:bg-state-2 hover:text-foreground"
    >
      <PanelLeft className="size-4" strokeWidth={1.7} />
    </button>
  );
}

export default SidebarToggle;

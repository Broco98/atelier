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
      className="absolute left-(--titlebar-controls-left) top-[calc((var(--titlebar-height)-var(--titlebar-control-size))/2)] z-20 flex size-(--titlebar-control-size) items-center justify-center rounded-md text-muted-foreground transition-[left,color,background-color] duration-[220ms] hover:bg-accent hover:text-foreground"
    >
      <PanelLeft className="size-4" strokeWidth={1.7} />
    </button>
  );
}

export default SidebarToggle;

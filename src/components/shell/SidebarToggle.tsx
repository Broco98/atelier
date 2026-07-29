import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import useIsFullscreen from "./useIsFullscreen";

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

// Fixed in the titlebar strip, right of the traffic lights — stays put
// whether the sidebar is open or collapsed (Codex model).
// left-[88px] clears the native traffic lights at trafficLightPosition (13, 24)
// in tauri.conf.json; that y centers them in --titlebar-height — keep in sync.
// macOS fullscreen auto-hides the traffic lights, so the offset collapses to left-4.
function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  const fullscreen = useIsFullscreen();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="사이드바 토글"
      aria-expanded={open}
      className={cn(
        // icon-button 규격(24px·8px)을 쓴다 — 목록 패널 토글과 같은 44px 행에 나란히 서 있어서,
        // 이 버튼만 26px로 남으면 그 자리에서 바로 어긋나 보인다.
        // 기본 아이콘 색은 다른 아이콘 버튼(text-tertiary)보다 진한 채로 둔다:
        // 사이드바가 닫혔을 때 이걸 못 찾으면 되돌릴 방법이 없다
        "icon-button absolute top-[calc((var(--titlebar-height)-24px)/2)] z-20 text-muted-foreground transition-[left,color,background-color] duration-[220ms] hover:bg-state-2 hover:text-foreground",
        fullscreen ? "left-4" : "left-[88px]",
      )}
    >
      <PanelLeft className="size-4" strokeWidth={1.7} />
    </button>
  );
}

export default SidebarToggle;

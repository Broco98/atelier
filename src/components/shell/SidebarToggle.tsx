import { PanelLeft } from "lucide-react";

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

// Fixed in the titlebar strip, right of the traffic lights — stays put
// whether the sidebar is open or collapsed (Codex model).
// left-[88px] clears the native traffic lights at trafficLightPosition (13, 24)
// in tauri.conf.json; that y centers them in --titlebar-height — keep in sync.
function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="사이드바 토글"
      aria-expanded={open}
      className="absolute left-[88px] top-[calc((var(--titlebar-height)-26px)/2)] z-20 flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <PanelLeft className="size-4" strokeWidth={1.7} />
    </button>
  );
}

export default SidebarToggle;

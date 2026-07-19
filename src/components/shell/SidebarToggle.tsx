import { PanelLeft } from "lucide-react";

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

// Fixed in the titlebar strip, right of the traffic lights — stays put
// whether the sidebar is open or collapsed (Codex model).
function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="사이드바 토글"
      aria-expanded={open}
      className="absolute left-20 top-[calc((var(--titlebar-height)-2rem)/2)] z-20 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <PanelLeft className="size-[18px]" />
    </button>
  );
}

export default SidebarToggle;

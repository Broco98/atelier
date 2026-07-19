import { PanelLeft } from "lucide-react";

interface PageHeaderProps {
  root: string;
  leaf?: string;
  actions?: React.ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// 페이지 소유 브레드크럼 바 — 메인 영역의 44px 타이틀바를 겸한다 (drag region).
function PageHeader({ root, leaf, actions, sidebarOpen, onToggleSidebar }: PageHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 border-b px-4"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-tertiary">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="사이드바 토글"
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? "사이드바 접기 ⌘B" : "사이드바 펼치기 ⌘B"}
          className="mr-1 flex size-[26px] shrink-0 items-center justify-center rounded-[9px] text-tertiary transition-colors hover:bg-accent hover:text-muted-foreground"
        >
          <PanelLeft className="size-[15px]" strokeWidth={1.7} />
        </button>
        <span data-tauri-drag-region className="shrink-0">{root}</span>
        {leaf && (
          <>
            <span className="text-border-strong">/</span>
            <span className="min-w-0 truncate font-medium text-foreground">{leaf}</span>
          </>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export default PageHeader;

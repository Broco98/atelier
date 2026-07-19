import { cn } from "@/lib/utils";

interface PageHeaderProps {
  root: string;
  leaf?: string;
  actions?: React.ReactNode;
  sidebarOpen: boolean;
}

// 페이지 소유 브레드크럼 바 — 메인 영역의 44px 타이틀바를 겸한다 (drag region).
// 사이드바 닫힘 시 신호등·SidebarToggle을 피해 좌측 패딩을 넓힌다.
function PageHeader({ root, leaf, actions, sidebarOpen }: PageHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 border-b pr-4 transition-[padding] duration-[220ms]",
        sidebarOpen ? "pl-4" : "pl-[126px]",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-tertiary">
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

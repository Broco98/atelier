interface PageHeaderProps {
  root: string;
  leaf?: string;
  actions?: React.ReactNode;
}

// 페이지 소유 브레드크럼 바 — 메인 영역의 44px 타이틀바를 겸한다 (drag region).
// 왼쪽에 항상 목록 패널이 있어 신호등·SidebarToggle과 겹치지 않는다.
function PageHeader({ root, leaf, actions }: PageHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 border-b px-4"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[14px] text-tertiary">
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

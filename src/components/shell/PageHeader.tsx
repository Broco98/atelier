import { cn } from "@/lib/utils";

interface PageHeaderProps {
  root: string;
  leaf?: string;
  // 브레드크럼 바로 뒤에 붙는 부가 요소 (상태 배지·칩 등)
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  // 사이드바·목록 패널이 모두 닫혀 헤더가 창 왼쪽 끝에 붙을 때 신호등·SidebarToggle 회피
  inset?: boolean;
}

// 페이지 소유 브레드크럼 바 — 메인 영역의 44px 타이틀바를 겸한다 (drag region).
function PageHeader({ root, leaf, meta, actions, inset = false }: PageHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 border-b pr-4 transition-[padding] duration-[220ms]",
        inset ? "pl-(--titlebar-inset)" : "pl-4",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[14px] text-tertiary">
        <span data-tauri-drag-region className="shrink-0">{root}</span>
        {leaf && (
          <>
            <span className="text-border-strong">/</span>
            <span className="min-w-0 truncate font-medium text-foreground">{leaf}</span>
          </>
        )}
        {meta}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export default PageHeader;

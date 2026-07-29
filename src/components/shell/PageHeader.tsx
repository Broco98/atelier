import { cn } from "@/lib/utils";
import useIsFullscreen from "./useIsFullscreen";

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
  // 전체화면에선 신호등이 숨으므로 SidebarToggle(left-4 + 26px + 12px 간격)만 회피
  const fullscreen = useIsFullscreen();
  return (
    <header
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 화면이 선으로 잘리지 않고 본문으로 이어진다.
        // 이 행은 여전히 창 드래그 영역이다 (data-tauri-drag-region)
        "flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 pr-4 transition-[padding] duration-[220ms]",
        inset ? (fullscreen ? "pl-[54px]" : "pl-[126px]") : "pl-4",
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

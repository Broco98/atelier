import { cn } from "@/lib/utils";

interface PageHeaderProps {
  root: string;
  // 문자열이면 그대로 렌더된다. 노드를 주면 그 자리에서 편집시킬 수 있다 —
  // 감싸는 span이 truncate(overflow:hidden)라 노드도 max-w-full truncate를 스스로 가져야
  // 오늘과 같은 말줄임이 나온다.
  leaf?: React.ReactNode;
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
        // 아래 경계선이 없다 — 화면이 선으로 잘리지 않고 본문으로 이어진다.
        // 이 행은 여전히 창 드래그 영역이다 (data-tauri-drag-region)
        //
        // ease-panel은 앞에 놓인 패널들의 폭 트랜지션과 같아야 한다 — 브레드크럼의 화면상
        // 위치가 그 폭들과 이 패딩의 합이라, 곡선이 다르면 최종 자리를 지나쳤다 되돌아온다
        // (index.css의 --panel-ease 주석)
        "flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 pr-4 transition-[padding] duration-[220ms] ease-panel",
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

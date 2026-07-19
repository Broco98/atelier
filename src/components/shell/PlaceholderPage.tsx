import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "./PageHeader";

interface EmptyCard {
  icon: LucideIcon;
  title: string;
  body: string;
}

interface PlaceholderPageProps {
  root: string;
  listHeader: string;
  listHint: string;
  listEmpty?: EmptyCard;
  main: EmptyCard;
  sidebarOpen: boolean;
}

// Works 등 데이터 없는 화면의 공용 빈 화면 — 목록 패널(360px) + 브레드크럼 + 메인 빈 상태.
function PlaceholderPage({
  root,
  listHeader,
  listHint,
  listEmpty,
  main,
  sidebarOpen,
}: PlaceholderPageProps) {
  const MainIcon = main.icon;
  const ListIcon = listEmpty?.icon;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-[360px] shrink-0 flex-col border-r bg-panel px-3 pb-3">
        {/* 타이틀바 스트립을 겸하는 패널 헤더 — 사이드바 닫힘 시 신호등·토글을 피해 좌측 패딩을 넓힌다 */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-(--titlebar-height) shrink-0 items-center justify-between pr-0.5 transition-[padding] duration-[220ms]",
            sidebarOpen ? "pl-0.5" : "pl-[114px]",
          )}
        >
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{listHeader}</span>
          <span className="text-[12.5px] text-tertiary">{listHint}</span>
        </div>
        {listEmpty && ListIcon && (
          <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
            <ListIcon className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
            <span className="text-[13.5px] font-medium text-muted-foreground">{listEmpty.title}</span>
            <span className="text-[12.5px] leading-normal text-tertiary">{listEmpty.body}</span>
          </div>
        )}
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root={root} />
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="flex max-w-[400px] flex-col items-center gap-2.5 text-center">
            <div className="mb-2 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
              <MainIcon className="size-5" strokeWidth={1.6} />
            </div>
            <span className="text-[17px] font-semibold tracking-[-0.01em]">{main.title}</span>
            <span className="text-[14px] leading-[1.65] text-muted-foreground">{main.body}</span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default PlaceholderPage;

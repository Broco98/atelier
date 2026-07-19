import type { LucideIcon } from "lucide-react";
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
  main: EmptyCard & { mono?: string; green?: boolean };
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// Works·Review 공용 빈 화면 — 목록 패널(304px) + 브레드크럼 + 메인 빈 상태.
function PlaceholderPage({
  root,
  listHeader,
  listHint,
  listEmpty,
  main,
  sidebarOpen,
  onToggleSidebar,
}: PlaceholderPageProps) {
  const MainIcon = main.icon;
  const ListIcon = listEmpty?.icon;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-[304px] shrink-0 flex-col border-r bg-panel px-3 pb-3">
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
        <div data-tauri-drag-region className="flex h-[50px] shrink-0 items-center justify-between px-0.5">
          <span className="text-sm font-semibold tracking-[-0.01em]">{listHeader}</span>
          <span className="text-[11.5px] text-tertiary">{listHint}</span>
        </div>
        {listEmpty && ListIcon && (
          <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
            <ListIcon className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
            <span className="text-[12.5px] font-medium text-muted-foreground">{listEmpty.title}</span>
            <span className="text-[11.5px] leading-normal text-tertiary">{listEmpty.body}</span>
          </div>
        )}
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root={root} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="flex max-w-[400px] flex-col items-center gap-2.5 text-center">
            {main.green ? (
              <span className="flex size-12 items-center justify-center rounded-full bg-[#0f7b52]/10 text-[#0f7b52]">
                <MainIcon className="size-[22px]" strokeWidth={1.8} />
              </span>
            ) : (
              <div className="mb-2 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                <MainIcon className="size-5" strokeWidth={1.6} />
              </div>
            )}
            <span className="text-base font-semibold tracking-[-0.01em]">{main.title}</span>
            <span className="text-[13px] leading-[1.65] text-muted-foreground">{main.body}</span>
            {main.mono && <span className="font-mono text-[11.5px] text-tertiary">{main.mono}</span>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default PlaceholderPage;

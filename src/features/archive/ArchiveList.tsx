import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth, { ResizeHandle } from "@/components/shell/useResizableWidth";
import SpecTree from "@/features/works/SpecTree";
import { formatCreated, StatusIcon } from "@/features/works/status";
import type { ArchiveEntry } from "./types";

interface ArchiveListProps {
  entries: ArchiveEntry[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  // 선택된 아카이브의 문서들 — 그 행 **아래에 펼쳐진다**
  docs: string[];
  currentDoc: string | null;
  onSelectDoc: (path: string) => void;
  onCopyDoc: (path: string) => void;
  sidebarOpen: boolean;
  open: boolean;
}

// 아카이브 목록 패널. `ProjectList`와 같은 접힘·리사이즈 패턴이되, 문서 트리를 **이 안에**
// 품는다 — 우측에 따로 문서 패널을 세우면 컬럼이 넷(사이드바+목록+본문+문서)이 되어
// 1280 창에서 본문이 370px로 쪼그라든다. `works-nav-depth`가 되찾은 폭(536→864)을
// 아카이브에서 다시 잃을 이유가 없다.
//
// 폭은 `ProjectList`와 키를 나눠 갖지 않는다 — 이쪽은 문서 트리까지 담아 쓸모 있는 폭이 다르다.
function ArchiveList({
  entries,
  selectedSlug,
  onSelect,
  docs,
  currentDoc,
  onSelectDoc,
  onCopyDoc,
  sidebarOpen,
  open,
}: ArchiveListProps) {
  const size = useResizableWidth("archive-panel-width", 360, 280, 560);

  return (
    // Sidebar·ProjectList와 같은 접힘 패턴 — 바깥은 폭 애니메이션, 안쪽은 고정 폭으로 리플로 방지
    <div
      style={{ "--panel-width": `${size.width}px` } as React.CSSProperties}
      className={cn(
        "relative shrink-0 overflow-hidden border-r bg-background",
        !size.dragging && "transition-[width,border-color] duration-[220ms] ease-panel",
        open ? "w-(--panel-width)" : "w-0 border-transparent border-r-0",
      )}
    >
      <div
        className={cn(
          "flex h-full w-(--panel-width) flex-col px-3 pb-3 transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        {/* 타이틀바 스트립 — 사이드바가 닫히면 신호등·셸 컨트롤을 피해 좌측 패딩을 넓힌다.
            등록 같은 액션이 없어 비어 있지만, 본문 헤더와 같은 높이를 지켜야 두 열이 맞는다 */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-(--titlebar-height) shrink-0 items-center transition-[padding] duration-[220ms] ease-panel",
            sidebarOpen ? "pl-0.5" : "pl-(--titlebar-inset-panel)",
          )}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-quiet">
          {entries.length === 0 ? (
            <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
              <Archive className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
              <span className="text-[13px] font-medium">아직 치운 작업이 없어요</span>
              <span className="text-[12px] leading-[1.6] text-tertiary">
                끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요
              </span>
            </div>
          ) : (
            entries.map((entry) => {
              const selected = entry.slug === selectedSlug;
              return (
                <div key={entry.slug} className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => onSelect(entry.slug)}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-[10px] px-2 text-left transition-colors",
                      selected
                        ? "selected-row font-medium text-foreground"
                        : "text-muted-foreground hover:bg-state-1",
                    )}
                  >
                    {/* 치운 시점의 상태를 그대로 보존한다 — 아카이브가 done을 뜻하지는 않는다 */}
                    <StatusIcon status={entry.status} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{entry.title}</span>
                    {/* 손으로 옮겨 둔 폴더에는 일시가 없다 — 없으면 자리를 비운다 */}
                    <span className="shrink-0 text-[11.5px] text-tertiary">
                      {entry.archivedAt ? formatCreated(entry.archivedAt) : ""}
                    </span>
                  </button>

                  {/* 선택된 것만 문서를 편다. 전부 펴 두면 아카이브가 쌓일수록 목록이
                      문서에 파묻혀 "무엇을 치웠나"를 훑을 수 없다. */}
                  {selected && (
                    <div className="mb-1 ml-2 border-l pl-1.5">
                      {docs.length === 0 ? (
                        <span className="block px-2 py-1.5 text-[12px] text-tertiary">
                          남은 문서가 없어요
                        </span>
                      ) : (
                        <SpecTree
                          files={docs}
                          current={currentDoc}
                          onSelect={onSelectDoc}
                          onCopy={onCopyDoc}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {open && <ResizeHandle control={size} />}
    </div>
  );
}

export default ArchiveList;

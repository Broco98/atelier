import { useEffect, useRef, useState } from "react";
import { Archive, ArrowDown, Check, ChevronDown, Filter, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth, { ResizeHandle } from "@/components/shell/useResizableWidth";
import { PopoverPortal } from "@/components/ui/popover-portal";
import SpecTree from "@/features/works/SpecTree";
import { formatCreated } from "@/features/works/status";
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

// 아카이브 목록 패널. `ProjectList`와 같은 접힘·리사이즈·검색 패턴이되, 문서 트리를 **이 안에**
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

  // 정렬·필터·검색은 **영속하지 않는다.** 화면이 백엔드 순서 위에 자기 순서를 얹으면
  // 진입 정규화(pickSlug의 "목록 첫 항목")가 고르는 것과 눈에 보이는 첫 항목이 갈린다 —
  // 실제로 그랬고(#58), `works-nav-depth`가 정렬·필터를 지운 이유가 그것이다.
  // 세션 안에서만 살면 진입 시점에는 언제나 백엔드 순서라 그 어긋남이 생기지 않는다.
  const [query, setQuery] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);

  const projectOptions = [...new Set(entries.flatMap((e) => e.projects))].sort();
  const q = query.trim().toLowerCase();
  const filtered = entries.filter(
    (entry) =>
      (!projectFilter || entry.projects.includes(projectFilter)) &&
      (!q || [entry.title, entry.slug, ...entry.projects].some((s) => s.toLowerCase().includes(q))),
  );
  // 백엔드 기본 정렬 = 아카이브일 내림차순·slug 오름차순 tiebreak.
  // 오름차순은 날짜만 뒤집고 tiebreak 방향은 유지한다 (reverse()는 tiebreak도 뒤집힌다).
  // 일시가 없는 폴더(손으로 옮긴 것)는 ""로 취급돼 내림차순에서 맨 뒤에 선다 — 백엔드와 같다.
  const sorted = sortAsc
    ? [...filtered].sort(
        (a, b) =>
          (a.archivedAt ?? "").localeCompare(b.archivedAt ?? "") || a.slug.localeCompare(b.slug),
      )
    : filtered;

  // 선택이 바뀌면 닫힌 채로 시작해 문서가 도착한 다음 프레임에 편다 — 그래야 "골랐다 →
  // 펼쳐진다"가 손으로 접었다 펴는 것과 같은 동작으로 보인다. 사용자가 직접 접은 뒤에는
  // 문서 목록이 그대로이므로 이 효과가 다시 돌지 않는다.
  const [treeOpen, setTreeOpen] = useState(false);
  useEffect(() => {
    setTreeOpen(false);
    if (docs.length === 0) return;
    const frame = requestAnimationFrame(() => setTreeOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [selectedSlug, docs.length]);

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
        {/* 타이틀바 스트립을 겸하는 컨트롤 행 — 사이드바가 닫히면 신호등·셸 컨트롤을 피해
            좌측 패딩을 넓힌다 (ProjectList와 같은 규칙) */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-(--titlebar-height) shrink-0 items-center transition-[padding] duration-[220ms] ease-panel",
            sidebarOpen ? "pl-0.5" : "pl-(--titlebar-inset-panel)",
          )}
        >
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSortAsc((v) => !v)}
              title="아카이브한 날짜 기준 정렬"
              className="flex h-6 items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium text-muted-foreground transition-colors hover:bg-state-2 hover:text-foreground"
            >
              <ArrowDown
                className={cn("size-3 transition-transform", sortAsc && "rotate-180")}
                strokeWidth={2}
              />
              {/* 사이드바 닫힘 시 신호등 인셋 때문에 라벨을 접고 아이콘만 남긴다 */}
              {sidebarOpen && "치운 날"}
            </button>
            <span className="relative flex min-w-0">
              <button
                ref={filterAnchor}
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                title={projectFilter ?? "모든 프로젝트"}
                className={cn(
                  "flex h-6 max-w-[120px] items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium transition-colors",
                  projectFilter
                    ? "toggle-on"
                    : "text-muted-foreground hover:bg-state-2 hover:text-foreground",
                )}
              >
                <Filter className="size-3 shrink-0" strokeWidth={2} />
                {sidebarOpen && (
                  <>
                    <span className="truncate">{projectFilter ?? "모든 프로젝트"}</span>
                    <ChevronDown className="size-2.5 shrink-0" strokeWidth={2.2} />
                  </>
                )}
              </button>
              {filterOpen && (
                <PopoverPortal
                  anchorRef={filterAnchor}
                  align="right"
                  width={200}
                  onClose={() => setFilterOpen(false)}
                  className="flex flex-col gap-px p-[5px]"
                >
                  {[null, ...projectOptions].map((option) => (
                    <button
                      key={option ?? "*"}
                      type="button"
                      onClick={() => {
                        setProjectFilter(option);
                        setFilterOpen(false);
                      }}
                      className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                        {option ?? "모든 프로젝트"}
                      </span>
                      {projectFilter === option && (
                        <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                      )}
                    </button>
                  ))}
                </PopoverPortal>
              )}
            </span>
          </span>
        </div>

        {/* mb-[10px] = 헤더 행(44px)에서 24px 컨트롤을 뺀 상하 여백 (ProjectList와 같은 값) */}
        {entries.length > 0 && (
          <div className="relative mb-[10px] shrink-0">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tertiary"
              strokeWidth={1.8}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="아카이브 검색"
              className="h-9 w-full rounded-full border bg-background pl-9 pr-3.5 text-[13.5px] outline-none placeholder:text-tertiary focus:border-primary"
            />
          </div>
        )}

        {entries.length === 0 ? (
          <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
            <Archive className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
            <span className="text-[13.5px] font-medium text-muted-foreground">
              아직 치운 작업이 없어요
            </span>
            <span className="text-[12.5px] leading-normal text-tertiary">
              끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.
            </span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-1 items-center justify-center pb-10">
            <span className="text-[13px] text-tertiary">
              {q ? "검색 결과가 없어요" : "해당 프로젝트의 아카이브가 없어요"}
            </span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto scroll-quiet">
            {sorted.map((entry) => {
              const selected = entry.slug === selectedSlug;
              const expanded = selected && treeOpen;
              return (
                <div key={entry.slug} className="flex shrink-0 flex-col">
                  {/* 행 전체가 토글이다 — 고르면 펼쳐지고, 고른 것을 다시 누르면 접힌다
                      (사이드바 섹션 헤더와 같은 규칙). 상태 아이콘은 두지 않는다:
                      치운 시점의 상태는 본문 머리말이 배지로 들고 있고, 목록에서 매 행마다
                      반복하면 정작 봐야 할 제목보다 먼저 눈에 들어온다. */}
                  <button
                    type="button"
                    onClick={() => (selected ? setTreeOpen((v) => !v) : onSelect(entry.slug))}
                    aria-expanded={expanded}
                    className={cn(
                      "group flex h-8 w-full shrink-0 items-center gap-[9px] rounded-[10px] px-[9px] text-left transition-colors",
                      selected
                        ? "selected-row text-foreground"
                        : "text-muted-foreground hover:bg-state-1",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                      {entry.title}
                    </span>
                    {/* 목록이 접히는 것과 같은 시간·같은 곡선으로 돈다 — 한 동작으로 읽혀야 한다.
                        트랜지션에 transform이 아니라 rotate를 적는다(Tailwind v4의 rotate-*는
                        독립 rotate 속성이라 transform만 걸면 화살표가 뚝 끊긴다).
                        평소 숨어 있다가 hover에 나타나되, **고른 것이 접혀 있으면 계속 보인다** —
                        비어 있는 게 아니라 접혔다는 유일한 표시다. */}
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 text-tertiary transition-[opacity,rotate] duration-[180ms] ease-panel",
                        expanded ? "" : "-rotate-90",
                        selected && !treeOpen
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                      strokeWidth={2.2}
                    />
                    {/* 손으로 옮겨 둔 폴더에는 일시가 없다 — 없으면 자리를 비운다 */}
                    <span className="shrink-0 text-[11.5px] text-tertiary">
                      {entry.archivedAt ? formatCreated(entry.archivedAt) : ""}
                    </span>
                  </button>

                  {/* 선택된 것만 문서를 편다. 전부 펴 두면 아카이브가 쌓일수록 목록이
                      문서에 파묻혀 "무엇을 치웠나"를 훑을 수 없다. */}
                  {selected && (
                    <SectionBody open={treeOpen}>
                      {docs.length === 0 ? (
                        <span className="px-[9px] py-1.5 text-[12.5px] text-tertiary">
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
                    </SectionBody>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && <ResizeHandle control={size} />}
    </div>
  );
}

// 접기 애니메이션 — grid-template-rows를 0fr↔1fr로 보간한다. height:auto는 트랜지션되지 않고,
// max-height는 트리 길이를 추정해야 해서 문서가 많을수록 타이밍이 어긋난다.
// (사이드바 목록의 SectionBody와 같은 방식·같은 값이다 — 두 접힘이 다르게 보이면 안 된다.)
//
// 접힌 동안에도 항목은 DOM에 남는다 — 그래야 펼치는 쪽도 애니메이션된다. 그래서 inert로
// 포커스와 포인터를 막는다: 높이 0에 가려 보이지 않는 버튼에 탭이 들어가면 안 된다.
function SectionBody({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-[180ms] ease-panel",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden">
        <div className="flex flex-col pt-[3px]">{children}</div>
      </div>
    </div>
  );
}

export default ArchiveList;

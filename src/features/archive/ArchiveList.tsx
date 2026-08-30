import { useEffect, useRef, useState } from "react";
import { Archive, ArrowDown, Check, ChevronDown, Filter, Folder, FolderOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth, { ResizeHandle } from "@/components/shell/useResizableWidth";
import { PopoverPortal } from "@/components/ui/popover-portal";
import SpecTree from "@/features/works/SpecTree";
import { formatCreated } from "@/features/works/status";
import { useArchivedDocs } from "./hooks";
import type { ArchiveEntry } from "./types";

interface ArchiveListProps {
  entries: ArchiveEntry[];
  selectedSlug: string | null;
  // 목록이 아직 안 왔다 — 빈 배열을 "하나도 없다"로 읽으면 안 되는 동안
  loading: boolean;
  currentDoc: string | null;
  // 문서를 고르는 것이 아카이브를 고르는 것이다 — 어느 아카이브의 문서인지 함께 넘긴다
  onSelectDoc: (slug: string, path: string) => void;
  onCopyDoc: (slug: string, path: string) => void;
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
  loading,
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

  // 펼침은 **선택과 무관하다.** 여럿을 동시에 펴 두고 아카이브를 가로질러 비교하는 것이
  // 이 화면의 쓰임새다 — 하나만 펴지면 다른 것을 보려 할 때마다 방금 편 것이 접힌다.
  // 대신 목록이 문서에 파묻히지 않게, 무엇이 펴졌는지를 행 앞 폴더 아이콘이 늘 말해 준다.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    selectedSlug ? new Set([selectedSlug]) : new Set(),
  );
  // 보고 있는 아카이브만은 펴 둔다 — 선택 표시가 그 안의 문서 행에만 있어서, 접혀 있으면
  // 무엇을 보고 있는지가 화면 어디에도 남지 않는다. slug가 바뀔 때만 도므로 사용자가
  // 손으로 접은 것을 되살리지는 않는다.
  useEffect(() => {
    if (!selectedSlug) return;
    setExpanded((prev) => (prev.has(selectedSlug) ? prev : new Set(prev).add(selectedSlug)));
  }, [selectedSlug]);

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
              className="flex h-6 items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium text-muted-foreground transition-colors quiet-hover"
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
                    : "text-muted-foreground quiet-hover",
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
                      className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
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

        {/* 도착 전에는 비어 있다고 말하지 않는다 — 본문 빈 상태와 같은 이유다 */}
        {loading ? null : entries.length === 0 ? (
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
          <div className="-mx-3 flex min-h-0 flex-1 flex-col gap-(--row-gap) overflow-y-auto px-3 scroll-quiet">
            {/* **`-mx-3 px-3`가 거터를 뚫고 나갔다 되돌린다** — 보이는 것은 안 움직이고 막대만
                패널 가장자리로 간다. 이 목록은 행 오른쪽 끝에 날짜가 서서 막대와 **0px**까지
                붙어 있었다(실측 콘텐츠 619 · 막대 619~625). 뚫고 나간 지금은 12px 떨어진다.
                같은 병이 사이드바 work 목록에 있었고 그쪽 주석이 내력을 든다. */}
            {sorted.map((entry) => (
              <ArchiveRow
                key={entry.slug}
                entry={entry}
                expanded={expanded.has(entry.slug)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(entry.slug)) next.add(entry.slug);
                    return next;
                  })
                }
                // 선택 표시는 **보고 있는 아카이브 안에서만** 켠다. 이름이 같은 문서가
                // 여럿에 있으므로(record.md·overview.md), 경로만 비교하면 펼쳐 둔 모든
                // 아카이브에서 같은 줄이 동시에 켜진다.
                currentDoc={entry.slug === selectedSlug ? currentDoc : null}
                onSelectDoc={onSelectDoc}
                onCopyDoc={onCopyDoc}
              />
            ))}
          </div>
        )}
      </div>

      {open && <ResizeHandle control={size} />}
    </div>
  );
}

// 아카이브 한 줄 + 그 아래 문서 트리. 행 자체는 **펼침 토글일 뿐** 선택 표시를 받지 않는다 —
// 선택은 "지금 보고 있는 문서"에만 있고, 그 문서가 어느 아카이브 것인지는 트리의 들여쓰기와
// 머리말의 제목이 말한다. 행까지 켜지면 화면에 켜진 것이 둘이 되어 어느 쪽이 본문인지 흐려진다.
function ArchiveRow({
  entry,
  expanded,
  onToggle,
  currentDoc,
  onSelectDoc,
  onCopyDoc,
}: {
  entry: ArchiveEntry;
  expanded: boolean;
  onToggle: () => void;
  currentDoc: string | null;
  onSelectDoc: (slug: string, path: string) => void;
  onCopyDoc: (slug: string, path: string) => void;
}) {
  // 한 번 편 뒤로는 접혀도 계속 읽는다 — 접힘 애니메이션이 도는 동안 내용이 비면 높이가
  // 0으로 순간이동한다. 아카이브 문서는 바뀌지 않으니 다시 읽히지도 않는다.
  // 한 번도 안 편 행은 IPC를 아예 내지 않는다: 아카이브는 계속 쌓이기만 하는 곳이라
  // 전부 미리 읽으면 패널을 열 때마다 아카이브 수만큼 호출이 나간다.
  const [everOpened, setEverOpened] = useState(expanded);
  useEffect(() => {
    if (expanded) setEverOpened(true);
  }, [expanded]);
  const { data: docs, isPending } = useArchivedDocs(everOpened ? entry.slug : null);

  return (
    <div className="flex shrink-0 flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex h-8 w-full shrink-0 items-center gap-[9px] rounded-[10px] px-[9px] text-left text-muted-foreground transition-colors hover:bg-state-1"
      >
        {/* 펼쳤는지는 폴더 아이콘 하나가 말한다 — 늘 보이므로 hover해 보지 않아도 어느 것이
            펴져 있는지 훑힌다. 여닫이 화살표는 문서 트리 안쪽(SpecTree)이 이미 쓰고 있어서,
            같은 글리프를 두 층에 겹쳐 쓰면 어느 층이 접히는지 읽히지 않는다. */}
        {expanded ? (
          <FolderOpen className="size-[15px] shrink-0 text-tertiary" strokeWidth={1.7} />
        ) : (
          <Folder className="size-[15px] shrink-0 text-tertiary" strokeWidth={1.7} />
        )}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{entry.title}</span>
        {/* 손으로 옮겨 둔 폴더에는 일시가 없다 — 없으면 자리를 비운다 */}
        <span className="shrink-0 text-[11.5px] text-tertiary">
          {entry.archivedAt ? formatCreated(entry.archivedAt) : ""}
        </span>
      </button>

      <SectionBody open={expanded}>
        {/* 도착 전에는 아무 말도 하지 않는다 — 빈 배열과 "아직 안 읽었다"를 같이 다루면
            펼치는 순간 "없어요"가 한 프레임 스쳤다가 트리로 바뀐다 */}
        {isPending ? null : docs && docs.length > 0 ? (
          <SpecTree
            files={docs}
            current={currentDoc}
            onSelect={(path) => onSelectDoc(entry.slug, path)}
            onCopy={(path) => onCopyDoc(entry.slug, path)}
          />
        ) : (
          <span className="px-[9px] py-1.5 text-[12.5px] text-tertiary">남은 문서가 없어요</span>
        )}
      </SectionBody>
    </div>
  );
}

// 접기 애니메이션 — grid-template-rows를 0fr↔1fr로 보간한다. height:auto는 트랜지션되지 않고,
// max-height는 트리 길이를 추정해야 해서 문서가 많을수록 타이밍이 어긋난다.
// (사이드바 목록의 SectionBody와 같은 방식·같은 시간·같은 곡선이다 — 두 접힘이 다르게 보이면
// 안 된다. 안쪽 gap만 없다: 저쪽은 작업 행을 직접 늘어놓지만 이쪽 자식은 SpecTree 하나이고,
// 트리 행의 간격은 트리가 정한다.)
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

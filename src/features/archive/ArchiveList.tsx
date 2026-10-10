import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ChevronDown, Filter, Folder, FolderOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardHead } from "@/components/shell/Frame";
import { buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Hint } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SpecTree, { treeIndent } from "@/features/works/SpecTree";
import { formatCreated } from "@/features/works/status";
import { ARCHIVE_COPY, narrowedNotice } from "./archive-copy";
import { archiveTreeItems } from "./archive-tree";
import { useArchivedDocs } from "./hooks";
import type { ArchiveEntry } from "./types";

/**
 * 펼친 문서 트리가 서는 깊이 — 아카이브 행 아래 한 단이다(Archive 프로토타입, 생성기 `atree`의 깊이가 1부터다). 행과 같은 x에
 * 서면 문서 줄이 아카이브 행과 한 층으로 읽힌다. 「남은 문서가 없어요」도 같은 자리에 선다.
 */
const TREE_DEPTH = 1;

/** 정렬 버튼의 도움말 — 툴팁의 글자이고, 스크린리더에는 설명으로 간다(아래 버튼 주석). */
const SORT_HELP = "아카이브한 날짜 기준 정렬";

/**
 * 정렬 · 거르기 알약 — 작은 흰 알약이다(`size="pill-sm"`, DS `.at-pill.sm`). 줄에 눌리면 거르기의 글자가 말줄임으로
 * 줄어든다(`min-w-0 shrink` — 버튼은 평소 안 줄어든다).
 */
const SMALL_PILL = cn(buttonVariants({ variant: "outline", size: "pill-sm" }), "min-w-0 shrink");

/**
 * 거른 동안의 켜짐(`fill-active`) — 흰 알약 위에 한 겹 얹는다(머리 컨트롤의 hover · 펼침이 같은 방식으로 겹을 얹는다). hover · 펼침의
 * 옅은 겹이 켜짐을 덮지 않게 세 자리를 같은 값으로 묶는다 — 펼침은 부품이 메뉴 트리거에만 주는 겹이라 같은 조건으로 적는다.
 * 켜짐은 알약의 모양이 아니라 이 거르개의 상태라 부품에 두지 않는다.
 */
const FILTER_ON =
  "bg-[image:linear-gradient(var(--fill-active),var(--fill-active))] hover:bg-[image:linear-gradient(var(--fill-active),var(--fill-active))] aria-[haspopup=menu]:aria-expanded:bg-[image:linear-gradient(var(--fill-active),var(--fill-active))]";

/**
 * 거르개 값의 보이는 이름. 「모든 프로젝트」는 거르지 않는 값(`null`)이다 — 거르개의 글자 · 툴팁 · 설명과 메뉴의 줄이
 * 모두 이것에서 읽어, 한 자리만 다른 말을 하는 일이 없다.
 */
const filterNameOf = (project: string | null) => project ?? "모든 프로젝트";

interface ArchiveListProps {
  entries: ArchiveEntry[];
  selectedSlug: string | null;
  // 목록이 아직 안 왔다 — 빈 배열을 "하나도 없다"로 읽으면 안 되는 동안
  loading: boolean;
  currentDoc: string | null;
  // 문서를 고르는 것이 아카이브를 고르는 것이다 — 어느 아카이브의 문서인지 함께 넘긴다
  onSelectDoc: (slug: string, path: string) => void;
  onCopyDoc: (slug: string, path: string) => void;
}

// 아카이브 목록 카드의 안 — 머리(검색칸), 첫 줄(정렬 · 거르기), 몸(아카이브 행). `ProjectList`와 같은 목록 카드이되 문서
// 트리를 **이 안에** 품는다 — 우측에 따로 문서 패널을 세우면 컬럼이 넷(사이드바+목록+본문+문서)이 되어
// 1280 창에서 본문이 370px로 쪼그라든다. `works-nav-depth`가 되찾은 폭(536→864)을
// 아카이브에서 다시 잃을 이유가 없다.
//
// 카드 · 접힘 · 폭 손잡이는 공용 틀의 목록 칸이 든다(`Frame`의 `list`, ui-refresh 결정 15 · 27). 폭은 `ProjectList`와 키를
// 나눠 갖지 않는다(`ArchivePage`의 `archive-panel-width`) — 이쪽은 문서 트리까지 담아 쓸모 있는 폭이 다르다.
function ArchiveList({
  entries,
  selectedSlug,
  loading,
  currentDoc,
  onSelectDoc,
  onCopyDoc,
}: ArchiveListProps) {
  // 정렬·필터·검색은 **영속하지 않는다.** 화면이 백엔드 순서 위에 자기 순서를 얹으면
  // 진입 정규화(pickSlug의 "목록 첫 항목")가 고르는 것과 눈에 보이는 첫 항목이 갈린다 —
  // 실제로 그랬고(#58), `works-nav-depth`가 정렬·필터를 지운 이유가 그것이다.
  // 세션 안에서만 살면 진입 시점에는 언제나 백엔드 순서라 그 어긋남이 생기지 않는다.
  const [query, setQuery] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const filterName = filterNameOf(projectFilter);

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
    <>
      {/* 목록 카드 머리 — 검색칸 하나가 캡슐 자리에 늘어선다(Archive 프로토타입). */}
      <CardHead>
        {entries.length > 0 && (
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            {/* 이름은 aria-label이 든다(S37) — placeholder는 이름표가 아니라 빈 칸에만 서는 안내 글자다. */}
            <InputGroupInput
              aria-label="아카이브 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="아카이브 검색"
            />
          </InputGroup>
        )}
      </CardHead>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        {/* 첫 줄 — 정렬 · 거르기 알약. 신호등을 피할 일은 바탕 줄의 몫이라 사이드바가 접혀도 글자가 그대로 선다. */}
        <div className="flex shrink-0 items-center gap-1.5 pb-2 pl-0.5">
          {/* 도움말 「아카이브한 날짜 기준 정렬」은 툴팁이다. 툴팁은 스크린리더에 아무것도 주지 않으므로(S28) 그 말은
              설명으로 남는다 — 이름은 글자 「치운 날」이 들고, 도움말은 그보다 더 말하는 것이다. */}
          <Hint
            text={SORT_HELP}
            announce="description"
            type="button"
            onClick={() => setSortAsc((v) => !v)}
            className={SMALL_PILL}
          >
            <ArrowDown className={cn("size-3.5 transition-transform", sortAsc && "rotate-180")} />
            치운 날
          </Hint>
          {/* **라디오 메뉴다**(판 3, 스토리 46~49 · 51 · 52). 여닫이 · 줄 옮기기 · Esc 닫기와 거르개로
              포커스 돌려주기 · 바깥 누르기가 닫기만 하는 것은 메뉴 부품이 한다. 지금 값은 줄의
              `aria-checked`로 읽히고, 고르면 닫힌다(라디오 항목의 `closeOnClick`, S33). */}
          <DropdownMenu>
            {/* **이름을 단다**(S37) — 버튼의 글자는 지금 값이라 그것만으로는 무엇을 고르는 버튼인지 말하지 않는다. 지금 값은
                툴팁이 보이고, 이름보다 더 말하는 것이라 설명(`aria-description`)으로도 남긴다(S28 — 툴팁은 스크린리더에
                아무것도 주지 않는다). */}
            <Hint
              text={filterName}
              announce="description"
              render={
                <DropdownMenuTrigger
                  aria-label="프로젝트 거르기"
                  className={cn(SMALL_PILL, projectFilter && FILTER_ON)}
                />
              }
            >
              <Filter className="size-3.5 shrink-0" />
              <span className="truncate">{filterName}</span>
              <ChevronDown className="-mr-1 size-3 shrink-0 text-fg-tertiary" strokeWidth={SMALL_GLYPH_STROKE} />
            </Hint>
            {/* 거르개와 오른쪽 끝끼리 맞춘다(옛 카드의 `align="right"`). 폭은 메뉴 기본(208px)이다. */}
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                // 「모든 프로젝트」는 거르지 않는 값(`null`)이다 — 줄의 값도 그대로 `null`이다.
                value={projectFilter}
                onValueChange={(option: string | null) => setProjectFilter(option)}
              >
                {[null, ...projectOptions].map((option) => (
                  <DropdownMenuRadioItem key={option ?? "*"} value={option}>
                    <span className="min-w-0 flex-1 truncate text-fg-secondary">
                      {filterNameOf(option)}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 도착 전에는 비어 있다고 말하지 않는다 — 본문 빈 상태와 같은 이유다 */}
        {loading ? null : entries.length === 0 ? (
          <Empty variant="list" className="my-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Archive />
              </EmptyMedia>
              <EmptyTitle>{ARCHIVE_COPY.emptyList.title}</EmptyTitle>
              <EmptyDescription>{ARCHIVE_COPY.emptyList.body}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : sorted.length === 0 ? (
          <div className="flex flex-1 items-center justify-center pb-10">
            {/* 좁힌 것이 검색어인지 필터인지를 말한다 — 문장은 `archive-copy.ts`가 든다. */}
            <span className="text-chat-meta text-fg-tertiary">{narrowedNotice(q !== "")}</span>
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
                onExpandedChange={(open) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(entry.slug);
                    else next.delete(entry.slug);
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
    </>
  );
}

// 아카이브 한 줄 + 그 아래 문서 트리. 행 자체는 **펼침 토글일 뿐** 선택 표시를 받지 않는다 —
// 선택은 "지금 보고 있는 문서"에만 있고, 그 문서가 어느 아카이브 것인지는 트리의 들여쓰기와
// 머리말의 제목이 말한다. 행까지 켜지면 화면에 켜진 것이 둘이 되어 어느 쪽이 본문인지 흐려진다.
//
// **여닫음은 Collapsible이 든다**(판 4, 스토리 114·115). 행이 트리거라 `aria-expanded`를 스스로 달고,
// 문서 트리는 패널이다. 패널은 180ms로 접히는 변형(`fold`)이고 닫혀도 마운트된 채다(`keepMounted`) —
// 그래야 펼치는 쪽도 움직이고, 한 번 편 트리의 폴더 접힘이 항목을 접었다 펴도 남는다. 닫힌 패널은
// 부품이 `inert`로 막는다: 접히는 동안 아직 보이는 문서 줄에 포커스와 포인터가 닿으면 안 된다.
//
// 행의 규격은 DS `.at-archive-row`다(ui-refresh 결정 6 · 25) — 32px · 안쪽 0 10px · 모서리 10 · hover `fill-soft`, 폴더 글리프 15px
// `fg-tertiary`, 제목 `text-sm`(14 · 400) 본문 색, 오른쪽 날짜 `text-xs` `fg-tertiary` 고정폭 숫자.
function ArchiveRow({
  entry,
  expanded,
  onExpandedChange,
  currentDoc,
  onSelectDoc,
  onCopyDoc,
}: {
  entry: ArchiveEntry;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
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
  // 문서 목록과 spec 트리가 **한 답으로** 온다 — 그래서 "도착 전에는 null"을 지키는 쿼리가 여전히
  // 하나다. 둘이 따로 오면 목록만 먼저 와서 펼치는 도중 트리가 늦게 서며 높이가 튄다.
  const { data: archived, isPending } = useArchivedDocs(everOpened ? entry.slug : null);
  const items = useMemo(() => (archived ? archiveTreeItems(archived) : []), [archived]);

  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange} className="flex shrink-0 flex-col">
      <CollapsibleTrigger className="flex h-8 w-full shrink-0 items-center gap-[9px] rounded-lg px-2.5 text-left transition-colors hover:bg-fill-soft">
        {/* 펼쳤는지는 폴더 아이콘 하나가 말한다 — 늘 보이므로 hover해 보지 않아도 어느 것이
            펴져 있는지 훑힌다. 여닫이 화살표는 문서 트리 안쪽(SpecTree)이 이미 쓰고 있어서,
            같은 글리프를 두 층에 겹쳐 쓰면 어느 층이 접히는지 읽히지 않는다. */}
        {expanded ? (
          <FolderOpen className="size-[15px] shrink-0 text-fg-tertiary" />
        ) : (
          <Folder className="size-[15px] shrink-0 text-fg-tertiary" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
        {/* 손으로 옮겨 둔 폴더에는 일시가 없다 — 없으면 자리를 비운다. 숫자가 고정폭이라 날짜의 오른쪽 끝이 줄마다
            같은 x에 선다. */}
        <span className="shrink-0 pl-2 text-xs text-fg-tertiary tabular-nums">
          {entry.archivedAt ? formatCreated(entry.archivedAt) : ""}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent variant="fold" keepMounted>
        {/* 행과 첫 문서 줄 사이도 줄 사이와 같은 2px 틈이다(DS `.at-tree`). 접힌 동안은 안쪽 칸이 이 틈까지 가린다. */}
        <div className="flex flex-col pt-(--row-gap)">
          {/* 도착 전에는 아무 말도 하지 않는다 — 빈 배열과 "아직 안 읽었다"를 같이 다루면
              펼치는 순간 "없어요"가 한 프레임 스쳤다가 트리로 바뀐다 */}
          {isPending ? null : items.length > 0 ? (
            // 경로는 모두 work 폴더 기준이다(`archiveTreeItems`) — 선택 표시·복사·읽기가 그대로 쓴다
            <SpecTree
              items={items}
              depth={TREE_DEPTH}
              current={currentDoc}
              onSelect={(path) => onSelectDoc(entry.slug, path)}
              onCopy={(path) => onCopyDoc(entry.slug, path)}
            />
          ) : (
            <span className="py-1.5 pr-2.5 text-chat-meta text-fg-tertiary" style={treeIndent(TREE_DEPTH)}>
              남은 문서가 없어요
            </span>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default ArchiveList;

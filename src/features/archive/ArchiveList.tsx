import { Fragment, useState } from "react";
import { Archive, ListFilter, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ListHead } from "@/components/shell/Frame";
import { navItem } from "@/components/shell/nav-items";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Hint } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_META } from "@/features/works/status";
import { ARCHIVE_COPY, narrowedNotice } from "./archive-copy";
import { archivedDay, archivedDayText, dayHeading } from "./archive-days";
import type { ArchiveEntry } from "./types";

/**
 * 정렬 — 치운 날의 두 방향이다(지금 앱의 정렬 그대로 — codex-ds 스펙 S11). 메뉴의 라디오 줄 이름이 값의 보이는 이름이다. 둘 다
 * 날짜순이라 날짜 소제목이 늘 선다(아래 `groupByDay`).
 */
const SORTS = { newest: "최근에 치운 순", oldest: "먼저 치운 순" } as const;
type Sort = keyof typeof SORTS;

/**
 * 거르개 값의 보이는 이름. 「모든 프로젝트」는 거르지 않는 값(`null`)이다 — 메뉴의 줄이 이것에서 읽는다.
 */
const filterNameOf = (project: string | null) => project ?? "모든 프로젝트";

interface ArchiveListProps {
  entries: ArchiveEntry[];
  selectedSlug: string | null;
  // 목록이 아직 안 왔다 — 빈 배열을 "하나도 없다"로 읽으면 안 되는 동안
  loading: boolean;
  /** 행을 누르면 그 아카이브를 고른다 — 주소를 옮기는 것은 부르는 쪽이다. */
  onSelect: (slug: string) => void;
}

// 아카이브 목록 칸의 안 — 목록 머리(「Archive」 · 개수 · 정렬과 거르기 메뉴), 찾기 칸, 날짜 소제목 아래의 두 줄 행(codex-ds 스펙 §7
// 「Archive」 · DS `.at-listcol` · `.at-label` · `.at-row.two`). 행은 펼치지 않는다 — 고른 아카이브의 문서 트리는 오른쪽 spec 목록
// 패널이 든다(`ArchivePage`). 목록이 문서에 파묻히지 않는다(스토리 55).
//
// 칸 · 세로 선 · 폭 손잡이는 공용 틀의 목록 칸이 든다(`Frame`의 `list`, codex-ds 결정 28). 폭은 `ProjectList`와 키를
// 나눠 갖지 않는다(`ArchivePage`의 `archive-panel-width`) — 두 목록의 이름 길이가 달라 쓸모 있는 폭이 다르다.
function ArchiveList({ entries, selectedSlug, loading, onSelect }: ArchiveListProps) {
  // 정렬·필터·검색은 **영속하지 않는다.** 화면이 백엔드 순서 위에 자기 순서를 얹으면
  // 진입 정규화(pickSlug의 "목록 첫 항목")가 고르는 것과 눈에 보이는 첫 항목이 갈린다 —
  // 실제로 그랬고(#58), `works-nav-depth`가 정렬·필터를 지운 이유가 그것이다.
  // 세션 안에서만 살면 진입 시점에는 언제나 백엔드 순서라 그 어긋남이 생기지 않는다.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

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
  const sorted =
    sort === "oldest"
      ? [...filtered].sort(
          (a, b) =>
            (a.archivedAt ?? "").localeCompare(b.archivedAt ?? "") || a.slug.localeCompare(b.slug),
        )
      : filtered;

  return (
    <>
      {/* 목록 머리 — 제목 · 치운 work 수(DS `.at-listcol-head`)와 끝의 정렬 · 거르기 메뉴. 목록이 오기 전에는 수를 말하지 않는다 —
          `[]`가 「하나도 없다」와 「아직 모른다」를 겸한다(`ArchivePage`). 고를 것이 없으면 메뉴도 없다. */}
      <ListHead
        title={navItem("archive").label}
        count={loading ? undefined : entries.length}
        end={
          entries.length > 0 && (
            <SortFilterMenu
              sort={sort}
              onSort={setSort}
              project={projectFilter}
              projects={projectOptions}
              onProject={setProjectFilter}
            />
          )
        }
      />

      {/* 찾기 칸 — 머리 아래 칸 폭으로 서고 행과 8 떨어진다(DS `.at-search`). */}
      {entries.length > 0 && (
        <InputGroup className="mb-2 shrink-0">
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
        <div className="-mx-2 -mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2 scroll-quiet">
          {/* **`-mx-2 px-2`가 칸의 안쪽 여백을 뚫고 나갔다 되돌린다** — 보이는 것은 안 움직이고 막대만
              칸 가장자리로 간다. 상자가 안쪽 여백 안에 들어앉아 있으면 막대(상자 안쪽 3~9px)가
              그만큼 더 안쪽에 서서 행 위로 들어온다. 같은 병이 사이드바 work 목록에 있었고 그쪽 주석이 내력을 든다.
              위끝의 `-mt-1 pt-1`도 같은 손버릇이다 — 첫 행의 포커스 링(테두리 바깥 4px)이 구르는 상자의 위끝에 잘리지
              않게 상자만 4px 나갔다 되돌린다(codex-ds 결정 11 · `index.css`의 `focus-ring-room`). 아래끝은 `pb-2`가 그 자리이자
              칸 바닥의 안쪽 8이다(DS `.at-listcol`). */}
          {groupByDay(sorted, new Date()).map(({ heading, rows }) => (
            <Fragment key={heading}>
              {/* 날짜 소제목 — DS `.at-label`(13 · `fg-tertiary`, 위 12 · 옆 8 · 아래 6). 글자가 칸 + 16에 서서 행 글자와 한
                  세로줄이다. 옆 8은 안쪽이 아니라 바깥 여백이다 — 안쪽이면 글자 상자가 오른쪽 끝 안쪽 8까지 와 스크롤 막대가 서는
                  자리(`lib/scroll-quiet.ts`의 EDGE · THICKNESS)에 든다(`scrollbar.spec.ts`). */}
              <div className="mx-2 shrink-0 pt-3 pb-1.5 text-chat-meta text-fg-tertiary">{heading}</div>
              {rows.map((entry) => (
                <ArchiveRow
                  key={entry.slug}
                  entry={entry}
                  selected={entry.slug === selectedSlug}
                  onSelect={() => onSelect(entry.slug)}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * 날짜순 목록을 날짜 소제목(`dayHeading`)마다 끊는다 — 받은 차례 그대로, 같은 소제목이 이어진 행끼리 한 묶음이다. 정렬이 날짜순이라
 * 같은 소제목은 늘 이어 선다(codex-ds 스펙 S11 「날짜 소제목은 날짜순일 때만 선다」 — 정렬은 둘 다 치운 날 순이다).
 */
function groupByDay(entries: ArchiveEntry[], today: Date): { heading: string; rows: ArchiveEntry[] }[] {
  const groups: { heading: string; rows: ArchiveEntry[] }[] = [];
  for (const entry of entries) {
    const heading = dayHeading(archivedDay(entry.archivedAt), today);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.rows.push(entry);
    else groups.push({ heading, rows: [entry] });
  }
  return groups;
}

/**
 * 목록 머리 끝의 정렬 · 거르기 메뉴(codex-ds 스펙 S11) — 아이콘 버튼 하나가 라디오 메뉴를 연다. 묶음은 둘이고 구분선이 가른다:
 * 정렬(치운 날의 두 방향) · 프로젝트(「모든 프로젝트」 다음에 프로젝트들). 지금 값은 줄의 `aria-checked`로 읽히고, 고르면 닫힌다(라디오
 * 항목의 `closeOnClick`, S33). 여닫이 · 줄 옮기기 · Esc 닫기와 버튼으로 포커스 돌려주기는 메뉴 부품이 한다.
 *
 * 버튼은 목록 머리의 아이콘 버튼이다(DS `.at-ib` 28 — Projects 머리의 `+`와 같은 규격). 거르는 동안은 켜진 면(`toggle-on`)이다 — 거른
 * 값이 버튼 글자로 보이지 않으니 목록이 좁혀져 있다는 것을 면이 말한다(펼친 동안도 켜진 면이다). 정렬은 행 차례가 스스로 말해 켜짐을
 * 두지 않는다. 이름은 툴팁 글자이고, 둘의 지금 값은 버튼의 설명으로 간다(「먼저 치운 순 · atelier」) — 켜진 면은 눈에만 보여, 설명이
 * 없으면 목록이 좁혀져 있다는 것을 스크린리더는 메뉴를 열어야 안다(S28 · S37 — 툴팁은 스크린리더에 아무것도 주지 않는다).
 */
function SortFilterMenu({
  sort,
  onSort,
  project,
  projects,
  onProject,
}: {
  sort: Sort;
  onSort: (sort: Sort) => void;
  project: string | null;
  projects: string[];
  onProject: (project: string | null) => void;
}) {
  // 열림을 여기서 든다 — 켜진 면이 펼친 동안에도 선다(앱의 펼친 메뉴 트리거와 같다).
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Hint
        text="정렬 · 거르기"
        announce="name"
        aria-description={`${SORTS[sort]} · ${filterNameOf(project)}`}
        render={
          <DropdownMenuTrigger
            // 켜짐과 hover는 가지로 가른다 — `quiet-hover`가 `toggle-on`과 한 요소에 겹치면 hover 규칙이 두 벌이라 정렬 순서가 승자를
            // 정하고(`index.css`의 그 유틸리티), 켜진 채 hover한 면이 꺼진 면으로 읽힌다. 꺼진 가지는 Projects 머리 `+`(`Button`
            // ghost · icon)와 같은 글자색 · hover다.
            className={cn(
              "icon-button transition-colors focus-ring",
              open || project !== null ? "toggle-on" : "text-fg-secondary quiet-hover",
            )}
          />
        }
      >
        <ListFilter className="size-4" />
      </Hint>
      {/* 버튼과 오른쪽 끝끼리 맞춘다 — 목록 머리 오른쪽 끝의 버튼이라 카드가 목록 칸 안쪽으로 펴진다. 폭은 메뉴 폭(`size-menu`)이다. */}
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={sort} onValueChange={(next: Sort) => onSort(next)}>
          <DropdownMenuLabel>정렬</DropdownMenuLabel>
          {(Object.keys(SORTS) as Sort[]).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <span className="min-w-0 flex-1 truncate">{SORTS[option]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          // 「모든 프로젝트」는 거르지 않는 값(`null`)이다 — 줄의 값도 그대로 `null`이다.
          value={project}
          onValueChange={(option: string | null) => onProject(option)}
        >
          <DropdownMenuLabel>프로젝트</DropdownMenuLabel>
          {[null, ...projects].map((option) => (
            <DropdownMenuRadioItem key={option ?? "*"} value={option}>
              <span className="min-w-0 flex-1 truncate">{filterNameOf(option)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 아카이브 한 줄 — 두 줄 행이다(DS `.at-row.two` — 50 이상 · 안쪽 7 8 · 모서리 10, 두 줄 사이 2). 첫 줄은 제목(14 · 본문 색), 둘째
// 줄은 치운 날과 치운 때의 상태(12 `fg-tertiary` — 행 메타, DS 「대비」)다. 날짜가 없는 폴더(손으로 옮긴 것)는 상태만 선다. 글자가 칸 +
// 16에 서서 목록 머리의 제목 · 날짜 소제목과 한 세로줄이다. **펼치지 않는다** — 누르면 그 아카이브를 고른다. 고른 행과 hover는 카드
// 안 목록의 두 단이다(`ProjectList`의 행과 같다).
function ArchiveRow({
  entry,
  selected,
  onSelect,
}: {
  entry: ArchiveEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = [archivedDayText(entry.archivedAt), STATUS_META[entry.status].label].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-h-12.5 w-full shrink-0 flex-col gap-0.5 rounded-lg px-2 py-1.75 text-left transition-colors focus-ring",
        selected ? "selected-row" : "hover:bg-fill-soft",
      )}
    >
      <span className="w-full truncate text-sm">{entry.title}</span>
      <span className="w-full truncate text-xs text-fg-tertiary">{meta}</span>
    </button>
  );
}

export default ArchiveList;

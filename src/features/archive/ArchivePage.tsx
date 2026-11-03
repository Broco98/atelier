import { useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { Archive, MoreHorizontal } from "lucide-react";
import { HeadCrumb } from "@/components/catalog/DetailParts";
import { FIRST_SORT, nextSort, placeDate, sortPlaces, type PlaceSort } from "@/components/catalog/place-list";
import {
  PLACE_ROW_BUTTON,
  PlaceEmpty,
  PlaceList,
  PlaceRow,
  PlaceSearch,
  PlaceSkeleton,
  PlaceStage,
  PlaceTable,
  useLate,
} from "@/components/catalog/PlaceList";
import { navItem } from "@/components/shell/nav-items";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { archiveDesc, shownArchive } from "./archive-view";
import { archivedDay } from "./archive-days";
import { ArchiveMenuItems, archiveMenuActions } from "./ArchiveMenuItems";
import { useArchive } from "./hooks";
import type { ArchiveEntry } from "./types";

// **Archive**(restart 03-4 · 스펙 「03 — 목록과 상세」 · 스토리 107 – 113 · 120 · 보드 MainArchive · MainArchiveDetail · PlaceSheet · Places) — 사이드바 위 칸
// 「Archive」가 여는 자리다. 공용 목록 틀(`PlaceList`)에 선다. 목록과 상세(`/archive/$slug`)가 한 자리를 번갈아 쓴다(`PlaceStage`) — 이 라우트
// (`/archive`)가 둘의 틀이라 상세에 가 있는 동안에도 목록은 마운트된 채 숨어, 돌아오면 찾는 글 · 정렬 · 스크롤이 그대로다. 창 머리의 뒤로 · 앞으로는
// 주소의 히스토리라 목록과 상세도 오간다.
//
//   머리 줄 ─ 목록은 「Archive」, 상세는 「Archive / 이름」(눌러 목록으로)
//   목록 ─ 제목 · 「Archive 찾기」(주 단추 없음 — 작업공간을 아카이브하면 쌓인다), 이름(상태 · Project) · 보관한 날 · ⋯
//
// 한때(codex-ds 결정 28 · 32) 문서 | 목록 한 카드와 오른쪽 spec 목록 패널이었다 — 고른 아카이브의 문서가 왼쪽 칸에, 목록이 오른쪽 칸에 늘 서고, 문서
// 트리는 따로 여닫는 패널(⌘Enter · 머리 줄의 패널 토글)에 섰다. `/archive`는 마지막으로 보던 아카이브로 고쳐 쓰였다. 이제 문서는 상세에서 읽고
// (`ArchiveDetail`), 이 화면들에는 레일 · 패널이 없다(PlaceSheet 「레일 · 패널」). 되살리기는 앱에 없어 그리지 않는다.

/** `/archive`의 틀 — 머리 줄과 목록 · 상세의 자리. 상세는 자식 라우트(`/archive/$slug`)가 그린다. */
export default function ArchivePlace() {
  const { slug } = useParams({ strict: false });
  const { data: entries = [] } = useArchive();
  const navigate = useNavigate();
  const label = navItem("archive").label;
  const detail = slug === undefined ? null : (entries.find((one) => one.slug === slug) ?? null);
  return (
    <PlainFrame
      label={slug === undefined ? label : `${label} 상세`}
      lead={slug !== undefined && <HeadCrumb label={label} onOpen={() => void navigate({ to: "/archive" })} />}
      title={slug === undefined ? { name: label } : detail ? { name: detail.title } : undefined}
    >
      <PlaceStage list={<ArchiveList />} detail={<Outlet />} detailKey={slug ?? null} />
    </PlainFrame>
  );
}

/** Archive 목록 — 찾기 · 정렬 · 줄. 상세에 가 있는 동안에도 마운트된 채라 이 상태가 남는다. */
function ArchiveList() {
  const { data: entries = [], isPending } = useArchive();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PlaceSort>(FIRST_SORT);
  const late = useLate(isPending);
  const label = navItem("archive").label;

  // 처음 차례는 보관한 날 순이다(최근에 치운 것부터) — 날이 없는 폴더(손으로 옮긴 것)는 어느 방향이든 끝이다(`sortPlaces`).
  const rows = useMemo(
    () =>
      sortPlaces(
        shownArchive(entries, query),
        sort,
        (one) => one.title,
        (one) => archivedDay(one.archivedAt),
      ),
    [entries, query, sort],
  );
  const now = Date.now();
  const open = (slug: string) => void navigate({ to: "/archive/$slug", params: { slug } });

  const empty = !isPending && entries.length === 0;
  const needle = query.trim();
  return (
    <PlaceList
      title={label}
      // 찾기 칸은 목록이 있을 때만 — 빈 목록 · 처음 읽는 동안은 제목뿐이다(보드 `showTools`). 주 단추는 없다(PlaceSheet 「세 화면」).
      tools={!empty && !isPending && <PlaceSearch label="Archive 찾기" value={query} onChange={setQuery} />}
    >
      {isPending ? (
        late && <PlaceSkeleton whenLabel="보관한 날" />
      ) : empty ? (
        // 보드 「Archive 없음」의 글 그대로다 — 「종료」는 작업공간 ⋯의 「아카이브」다(PlaceSheet 「세 화면」 「작업공간을 종료하면 쌓인다」).
        <PlaceEmpty icon={<Archive />} title="보관한 작업공간이 없어요" body="작업공간을 종료하면 문서와 기록이 여기에 남아요." />
      ) : (
        <PlaceTable
          label="Archive 목록"
          whenLabel="보관한 날"
          sort={sort}
          onSort={(key) => setSort((held) => nextSort(held, key))}
          empty={rows.length === 0 ? `「${needle}」와 맞는 Archive가 없어요` : null}
        >
          {rows.map((entry) => (
            <ArchiveRow
              key={entry.slug}
              entry={entry}
              when={placeDate(archivedDay(entry.archivedAt), now)}
              onOpen={() => open(entry.slug)}
            />
          ))}
        </PlaceTable>
      )}
    </PlaceList>
  );
}

/** 줄 하나(보드 Places 줄) — 보관함 글리프 · 이름 · 상태와 Project, 보관한 날, 오른쪽에 ⋯(Finder에서 열기 · 경로 복사). */
function ArchiveRow({ entry, when, onOpen }: { entry: ArchiveEntry; when: string; onOpen: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <PlaceRow
      anchor={wrap}
      icon={<Archive />}
      name={entry.title}
      link={{ to: "/archive/$slug", params: { slug: entry.slug } }}
      desc={archiveDesc(entry)}
      when={when}
      onOpen={onOpen}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`${entry.title} 메뉴`} className={PLACE_ROW_BUTTON}>
            <MoreHorizontal aria-hidden className="size-3.75" />
          </DropdownMenuTrigger>
          {/* 줄 아래에서 줄 오른쪽 끝에 맞춰 선다 — 줄의 아래 12에 걸친다(보드 `.pl-menu` — Projects 줄과 같다). */}
          <DropdownMenuContent anchor={wrap} side="bottom" align="end" sideOffset={-12} width="place">
            <ArchiveMenuItems actions={archiveMenuActions(entry.slug)} />
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}

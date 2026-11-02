import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { PLACE_ICON_BUTTON, PlaceButton, PlaceDetail, PlaceFact, PlaceFacts, PlaceLede } from "@/components/catalog/PlaceDetail";
import { copyText } from "@/components/shell/copy-text";
import { navItem } from "@/components/shell/nav-items";
import type { PathView } from "@/components/shell/PathBar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DocTextBox } from "@/features/works/DocText";
import { docBody, ignoresViewSwitch, type DocBody } from "@/features/works/doc-refs";
import { archiveRef } from "@/features/works/refs";
import SpecTree from "@/features/works/SpecTree";
import { HtmlDoc, ImageDoc, PrettyView, SourceView } from "@/features/works/SpecViewer";
import { archiveTreeItems } from "./archive-tree";
import { archiveFacts } from "./archive-view";
import { ArchiveMenuItems, archiveMenuActions, openArchivedSpecFolder } from "./ArchiveMenuItems";
import { useArchive, useArchivedDocs, useArchivedFile } from "./hooks";
import type { ArchiveEntry } from "./types";

// **Archive 상세**(restart 03-4 · 스펙 「03 — 목록과 상세」 · 스토리 120 · 보드 MainArchiveDetail · PlaceSheet 「세 화면」 · Places `DETAILS['process-manager']`) —
// 공용 상세 틀(`PlaceDetail`)에 선다. 틀은 `/archive`의 것이다(`ArchivePlace`): 머리 줄 「Archive / 이름」과 본문 카드는 목록과 한 자리를 번갈아 쓰는 틀이
// 그리고, 여기는 상세의 판만 그린다.
//
//   「← Archive」 ─ 언제나 목록으로(창의 뒤로 · 앞으로는 주소의 히스토리라 목록 · 상세 · 그 너머를 오간다)
//   머리 ─ 이름 · 「Finder에서 열기」(그 아카이브의 spec 폴더) · ⋯(Finder에서 열기 · 경로 복사). 되살리기는 앱에 없어 그리지 않는다
//   설명 자리 ─ 비어 있다(아카이브한 work에는 설명이 없다 — 자리만 남아 위 카드가 Project 상세와 같은 틈에 선다)
//   위 카드 ─ 상태 · 보관한 날 · Project · 브랜치(`archiveFacts`)
//   문서 ─ 왼쪽에 읽는 글, 오른쪽 240에 「문서」 트리(기록 · spec/ — `archiveTreeItems`). 트리는 판이 굴러도 위에 붙어 선다
//
// **읽는 문서는 주소가 정본이다**(`?file=` — 이슈 #25). 트리로 고르면 주소만 갈아 쓰고(훑기라 히스토리를 만들지 않는다 — Works의 트리와 같다), 문서
// 안 링크를 따라가면 돌아올 자리를 남긴다(push). 검색(⌘K의 아카이브 문서 줄 — `hitTarget`)도 이 주소로 와서 그 문서가 그대로 열린다. 주소에 문서가
// 없거나 목록에 없는 문서면 첫 문서(기록이 있으면 기록 — `list_archived_docs`)다.
//
// 한때(codex-ds 결정 28 · 32) 이 글은 문서 | 목록 한 카드의 왼쪽 칸이었고 머리에 경로 줄(경로 캡슐 · 문서 | 원문 · 경로 복사)이 섰으며, 트리는 오른쪽
// spec 목록 패널(⌘Enter · 패널 토글)에 섰다. 보드 상세에는 경로 줄이 없다 — 문서 | 원문 · 경로 복사는 문서 글의 우클릭 메뉴(`DocTextBox`)에 남았다.

export default function ArchiveDetail({ slug, file }: { slug: string; file: string | null }) {
  const { data: entries = [], isPending, isFetching } = useArchive();
  const entry = entries.find((one) => one.slug === slug) ?? null;
  const navigate = useNavigate();

  // 보던 아카이브가 목록에 없다(옮겼거나 이름을 바꾼 폴더 · 묵은 주소) — 목록으로 간다. 빈 상세가 남으면 뒤로가기 한 번이 아무 일도 하지 않으니 이
  // 칸을 갈아 쓴다(replace — Project 상세와 같다). 한때는 「그 아카이브를 찾을 수 없어요」가 문서 칸에 섰다.
  const gone = !isPending && !isFetching && entry === null;
  useEffect(() => {
    if (gone) void navigate({ to: "/archive", replace: true });
    // navigate는 의존성에 넣지 않는다 — 라우터가 고정해 준다
  }, [gone]);

  if (!entry) return <PlaceDetail back={BACK()} title={null}>{null}</PlaceDetail>;
  return <ArchiveBody entry={entry} file={file} />;
}

const BACK = () => ({ to: "/archive" as const, label: navItem("archive").label });

function ArchiveBody({ entry, file }: { entry: ArchiveEntry; file: string | null }) {
  return (
    <PlaceDetail
      back={BACK()}
      title={entry.title}
      actions={
        <>
          <PlaceButton label="Finder에서 열기" onClick={() => openArchivedSpecFolder(entry.slug)} />
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`${entry.title} 메뉴`} className={PLACE_ICON_BUTTON}>
              <MoreHorizontal aria-hidden className="size-3.75" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width="place">
              <ArchiveMenuItems actions={archiveMenuActions(entry.slug)} />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <PlaceLede />
      <PlaceFacts>
        {archiveFacts(entry).map((fact) => (
          <PlaceFact key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </PlaceFacts>
      <ArchiveDocs slug={entry.slug} file={file} />
    </PlaceDetail>
  );
}

// 문서 목록이 아직 없을 때의 빈 목록 — 렌더마다 새 배열을 지으면 그것을 받는 본문이 매번 바뀐 값을 받는다.
const NO_DOCS: string[] = [];

/**
 * 문서 칸(보드 Places `.pl-doc` — 위 28 · 왼쪽 글(최대 680) | 오른쪽 240 트리 · 사이 32). 글은 작업 화면 · 넓힌 카드와 같은 문서 보기다(`docBody`의 표 —
 * 마크다운 · 원문 · HTML · 그림). 마크다운은 판의 글 열에 선다(왼쪽 거터 없이 · 최대 680 — `PROSE`). 원문 보기는 문서 글의 우클릭 메뉴가 켠다.
 */
function ArchiveDocs({ slug, file }: { slug: string; file: string | null }) {
  const navigate = useNavigate();
  // 답에는 spec 트리도 실려 온다 — 글이 목록을, 트리가 spec 트리를 한 답에서 읽는다. `undefined`는 「아직 모른다」다 — 그동안은 아무 말도 하지 않는다
  // (「남은 문서가 없어요」를 먼저 띄우면 도착한 뒤 문서가 서며 말이 뒤집힌다).
  const { data: archived } = useArchivedDocs(slug);
  const docs = archived?.docs ?? NO_DOCS;
  const current = file && docs.includes(file) ? file : (docs[0] ?? null);
  const items = useMemo(() => (archived ? archiveTreeItems(archived) : []), [archived]);

  const [showSource, setShowSource] = useState(false);
  // 본문 갈래도 읽을지 말지도 Works와 같은 표가 정한다(결정 7 · 11 · 15) — 그림이면 읽지 않는다.
  const body = docBody(current, showSource);
  const { data: content } = useArchivedFile(slug, body === "image" ? null : current);

  // 트리로 고르면 주소만 갈아 쓴다(훑기 — 히스토리를 만들지 않는다). 본문 링크는 따라 들어간 만큼 돌아올 자리를 남긴다(push).
  const selectDoc = useCallback(
    (path: string) => void navigate({ to: "/archive/$slug", params: { slug }, search: { file: path }, replace: true }),
    [navigate, slug],
  );
  const followLink = useCallback(
    (path: string) => void navigate({ to: "/archive/$slug", params: { slug }, search: { file: path } }),
    [navigate, slug],
  );
  // 참조가 안정적이어야 이 칸이 다시 그려질 때 마크다운 트리가 리마운트되지 않는다.
  const copyBlockRef = useCallback(
    (start: number, end: number) => {
      if (current) copyText(archiveRef(slug, current, start, end));
    },
    [slug, current],
  );

  // **다른 문서로 옮기면 글의 첫 줄이 보이게 한다** — 판이 굴러 글 칸의 위끝이 판 위로 넘어가 있을 때만 그 위끝으로 굴린다. 트리는 판 위에 붙어 서
  // (`sticky`) 긴 글을 읽다 다른 문서를 고를 수 있는데, 그대로 두면 새 글의 한가운데나 그 아래 빈자리가 선다. 붙은 트리의 위끝이 판의 위끝이라 그것과
  // 견준다. 처음 선 문서는 굴리지 않는다.
  const place = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLElement>(null);
  const shown = useRef(current);
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    const box = place.current;
    const top = tree.current?.getBoundingClientRect().top;
    if (box && top !== undefined && box.getBoundingClientRect().top < top) box.scrollIntoView({ block: "start" });
  }, [current]);

  if (archived === undefined) return null;
  if (current === null) return <p className="mt-7 text-chat-meta text-fg-tertiary">남은 문서가 없어요</p>;

  const view: PathView = { source: showSource, locked: ignoresViewSwitch(current), onChange: setShowSource };
  const docView = (kind: DocBody): ReactNode => {
    switch (kind) {
      case "image":
        // 아카이브 목록은 경량이라 문서 위치를 담지 않는다 — 그림은 뜨지 않고 자리표시가 선다(전과 같다).
        return <ImageDoc path={null} name={current} />;
      case "html":
        // 프레임은 제 안에서 구른다(결정 9) — 판이 구르는 칸이라 높이를 정해 준다(그대로면 0으로 접힌다).
        return (
          <div className="flex h-160 flex-col">
            <HtmlDoc content={content} name={current} />
          </div>
        );
      case "pretty":
        return (
          <PrettyView
            file={current}
            content={content ?? ""}
            onCopyBlock={copyBlockRef}
            files={docs}
            onNavigate={followLink}
            specRoot={null}
            className={PROSE}
          />
        );
      case "source":
        return <SourceView content={content ?? ""} className="max-w-none px-0 py-0" />;
      default: {
        const unhandled: never = kind;
        return unhandled;
      }
    }
  };

  return (
    <div ref={place} className="mt-7 grid scroll-mt-2 grid-cols-[minmax(0,1fr)_240px] items-start gap-8">
      {/* 문서 글 — 우클릭 · ⇧F10이 「원문으로 보기 · 경로 복사」(고른 글이 있으면 「복사」)를 연다. */}
      <DocTextBox menu={{ view, onCopyPath: () => copyText(archiveRef(slug, current)) }} className="min-w-0 rounded-ctl">
        {docView(body)}
      </DocTextBox>
      <nav ref={tree} aria-label="문서" className="sticky top-0 flex min-w-0 flex-col gap-px">
        <span className="px-1.5 pb-1.5 text-xs text-fg-tertiary">문서</span>
        <SpecTree dense items={items} current={current} onSelect={selectDoc} onCopy={(path) => copyText(archiveRef(slug, path))} />
      </nav>
    </div>
  );
}

/**
 * 문서 글의 열(보드 `.pl-prose` — 최대 680). 문서 카드의 열(`bodyColumn` — 왼쪽 거터 20 · 위 20 · 아래 64)만 덮는다 — 판의 가운데 열이 이미 거터(56)를
 * 들어 글이 위 카드와 한 세로줄에 선다. 블록 참조 복사 단추는 그 거터에 선다. **글자는 문서 보기 그대로다**(14/22.75 · `fg` · 제목 단계) — 보드
 * `.pl-prose`는 14/23 · `fg-secondary` · 제목 16이지만, 같은 문서는 어디서 열든 같게 읽힌다(결정 11 — 작업 화면 · 넓힌 카드와 한 벌).
 */
const PROSE = "max-w-170 px-0 pt-0 pb-0";

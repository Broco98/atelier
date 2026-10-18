import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, FolderOpen, MoreHorizontal, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Toaster } from "@/components/ui/toast";
import { Hint } from "@/components/ui/tooltip";
import { copyText } from "@/components/shell/copy-text";
import { Card, CardHead, Frame } from "@/components/shell/Frame";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, WORK_PANEL_WIDTH } from "@/components/shell/panel-layout";
import { togglesPanel } from "@/components/shell/PanelToggle";
import { PathBar, type PathView } from "@/components/shell/PathBar";
import { TargetMenu } from "@/components/shell/TargetMenu";
import useResizableWidth from "@/components/shell/useResizableWidth";
import { DocTextBox } from "@/features/works/DocText";
import { HtmlDoc, ImageDoc, PrettyView, SourceView } from "@/features/works/SpecViewer";
import SpecTree from "@/features/works/SpecTree";
import { docBody, ignoresViewSwitch } from "@/features/works/doc-refs";
import type { DocBody } from "@/features/works/doc-refs";
import { archiveRef, archiveSpecDirRef } from "@/features/works/refs";
import { STATUS_BADGE, STATUS_META } from "@/features/works/status";
import { archiveApi } from "./api";
import { ARCHIVE_COPY } from "./archive-copy";
import { archivedDayText } from "./archive-days";
import { archiveTreeItems } from "./archive-tree";
import ArchiveList from "./ArchiveList";
import { ArchiveMenuItems } from "./ArchiveMenuItems";
import type { ArchiveMenuActions } from "./ArchiveMenuItems";
import { useArchive, useArchivedDocs, useArchivedFile } from "./hooks";
import type { ArchivedDocs } from "./types";

interface ArchivePageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서는 주소가 정본이다 — 여기서 들면 문서를 옮긴 자취가 히스토리에 남지 않아
  // 링크를 따라 들어간 뒤 뒤로가기가 아카이브 전체를 건너뛴다 (Works와 같은 근거).
  currentFile: string | null;
  // 목록 행을 누르면 그 아카이브를 고른다 — 주소를 옮기는 것은 라우트다
  onSelect: (slug: string) => void;
  // spec 목록 패널의 트리에서 문서를 고른다 — 패널은 고른 아카이브의 것이라 경로만 넘긴다(주소를 옮기는 것은 라우트다)
  onSelectDoc: (path: string) => void;
  // 본문 링크는 지금 아카이브 안에서만 움직인다
  onFollowLink: (path: string) => void;
}

// 문서 목록이 아직 없을 때의 빈 목록 — 렌더마다 새 배열을 지으면 그것을 받는 본문이 매번 바뀐
// 값을 받는다.
const NO_DOCS: string[] = [];

/** 이 화면의 nav 항목 — 고른 아카이브가 없을 때 머리 카드의 이름 · 아이콘이 여기서 읽는다(nav와 한 글자 · 한 얼굴). */
const PLACE = navItem("archive");

// 문서 | 목록 한 카드(codex-ds 결정 28)와 그 오른쪽의 spec 목록 패널 — 왼쪽부터 문서 · 목록 · 패널이다. Projects와 같은 2단 카드다 —
// 아카이브 목록은 사이드바에 상주하지 않으므로(nav 항목 하나뿐) 목록 칸이 그 목록의 자리다. `works-nav-depth`가 지운 것은 **Works의**
// 목록 컬럼이고, 그 근거는 같은 목록이 사이드바에 이미 있다는 것이었다. 고른 아카이브의 문서 트리는 따로 여닫는 패널에 선다 — 작업
// 화면의 작업 패널과 같은 손이다(스토리 55 · 56, codex-ds 결정 32). 패널이 목록 칸 너머 맨 오른쪽인 것은 목록과 문서가 한 카드의 두
// 칸이라 그 사이에 설 수 없고, ⌘Enter와 머리 카드 끝의 토글이 여닫는 것이 「그 화면의 오른쪽 패널」이라서다.
function ArchivePage({
  sidebarOpen,
  selectedSlug,
  currentFile,
  onSelect,
  onSelectDoc,
  onFollowLink,
}: ArchivePageProps) {
  // `[]`는 "하나도 없다"와 "아직 모른다"를 같이 뜻한다. 아래 두 자리(본문 빈 상태·목록 칸)가
  // 그것으로 "없어요"라고 단언하므로 둘을 갈라 둔다. 목록이 캐시에 없는 채로 /archive/$slug에
  // 바로 닿는 경로가 있다 — 이 라우트에는 beforeLoad가 없고(세 $slug 라우트 모두 그렇다),
  // archiveQuery는 gcTime이 지나면 캐시에서 빠진다.
  const { data: entries = [], isPending: entriesPending } = useArchive();
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? null;

  // 문서 목록도 같다 — `[]`가 "문서가 없다"와 "아직 모른다"를 겸한다. 겸하게 두면
  // `current`가 null이 되어 본문이 "남은 문서가 없어요"를 띄운다 (결정 30과 같은 결함).
  // 답에는 spec 트리도 실려 온다 — 본문이 목록을, spec 목록 패널이 트리를 한 답에서 읽는다.
  const { data: archived, isPending: docsPending } = useArchivedDocs(selected?.slug ?? null);
  const docs = archived?.docs ?? NO_DOCS;
  // 고른 문서가 **어느 아카이브의 것인지**는 이제 주소가 함께 들고 있다 — 아카이브를 옮길 때
  // 이동이 search를 비우므로, 이름이 같은 문서(record.md·overview.md)가 딸려가 엉뚱하게
  // 열리던 경로가 아예 없다. 목록에 없는 경로면 아래에서 기본값으로 떨어진다.
  // 목록의 첫 항목이 그 기본값이다 — 기록이 있으면 그것이 맨 앞이다 (list_archived_docs)
  const current = currentFile && docs.includes(currentFile) ? currentFile : (docs[0] ?? null);

  const [showSource, setShowSource] = useState(false);
  // 본문 갈래는 Works 화면과 **같은 표**가 정한다(결정 7·11). 여기서 식을 한 벌 더 들면
  // 같은 spec이 어디서 열렸느냐에 따라 다르게 보인다 — 실제로 그랬다: 그림이 줄번호 `1`
  // 하나로 섰고, 비-md에서 토글이 안 잠겨 **선 칸만 「문서」로 옮겨 가고 본문은 소스에
  // 눌러앉았다**(눌리는데 아무 일도 안 나는 그 어긋남, 결정 21).
  const body = docBody(current, showSource);
  // **읽을지 말지도 그 표가 정한다**(결정 15) — 그림이면 안 읽는다. 아카이브 목록에도
  // `.png`가 뜨고(list_archived_docs가 spec_files를 그대로 쓴다) 읽기 바닥은
  // read_to_string이라, 그냥 읽으면 고를 때마다 UTF-8 실패가 재시도까지 달고 나간다.
  // 읽기만 표 밖에 남기면 결정 11이 막으려던 **화면별 예외**가 여기 생긴다.
  const { data: content } = useArchivedFile(selected?.slug ?? null, body === "image" ? null : current);

  // 목록 칸의 폭 — 프로젝트 목록(`panel-width`)과 키를 나눠 갖지 않는다(`ArchiveList` 머리말). 기본은 DS `size-list`(264)이고 범위는
  // 240–560이다(codex-ds 스펙 S4). 목록 칸은 카드의 오른쪽 칸이라(`Frame`의 `ListCard`) 손잡이가 칸의 왼쪽 끝이다 — `"right"`가
  // 끄는 방향을 뒤집는다. 목록 칸은 접지 않는다(codex-ds 결정 32) — ⌘Enter는 아래 spec 목록 패널의 것이다.
  const listSize = useResizableWidth("archive-panel-width", 264, 240, 560, "right");

  // spec 목록 패널 — 오른쪽에 따로 여닫는 패널 카드다(codex-ds 결정 28 · 32). 머리 카드의 spec 목록 토글과 ⌘Enter가 이 값 하나를
  // 뒤집는다. 처음에는 열려 있다(DS 캔버스 Archive). 저장하지 않는다 — 작업 패널의 열림도 저장하지 않는다(`WorksPage`). 아카이브를 옮겨도
  // 같은 인스턴스라 이 값이 그대로 따라온다.
  const [panelOpen, setPanelOpen] = useState(true);
  // 패널 카드의 폭 — 작업 패널과 같은 규격(기본 DS `size-panel` 340 · 범위는 `panel-layout`의 한 벌, codex-ds 스펙 S4)이고 저장 키는 이 패널 전용이다.
  // 같은 키를 쓰면 두 화면의 패널이 서로의 폭을 덮는다. 화면 오른쪽에 놓인 패널이라 손잡이가 왼쪽 틈에 선다.
  const panelSize = useResizableWidth("archive-spec-panel-width", WORK_PANEL_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, "right");
  // 패널이 서는가 — 고른 아카이브가 있을 때만이다(그 아카이브의 문서 트리를 든다). 없으면 패널도 머리 카드의 토글도 없다.
  const hasPanel = selected !== null;

  // ⌘Enter — spec 목록 패널을 여닫는다(codex-ds 결정 32 「⌘Enter는 그 화면의 오른쪽 패널」). 판정은 작업 화면의 ⌘Enter와 한 벌이다
  // (`togglesPanel` — 머리 카드의 패널 토글 곁에 산다) — 입력칸(찾기 칸)이나 편집 가능한 자리에 포커스가 있으면 그쪽 몫이다. 패널이
  // 없으면 듣지 않는다.
  useEffect(() => {
    if (!hasPanel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!togglesPanel(e)) return;
      e.preventDefault();
      setPanelOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPanel]);

  // 참조가 안정적이어야 이 화면이 다시 그려질 때 마크다운 트리가 리마운트되지 않는다
  const slug = selected?.slug;
  const copyBlockRef = useCallback(
    (start: number, end: number) => {
      if (!slug || !current) return;
      copyText(archiveRef(slug, current, start, end));
    },
    [slug, current],
  );

  // 접을 수 있는 것을 모두 접어 화면을 비웠으면 본문이 넓은 글 폭을 쓴다(SpecViewer의 `bodyColumn` — Works 쪽도 같은 규칙). 이 화면의
  // 접이식은 사이드바와 spec 목록 패널 둘이다 — 목록 칸은 접지 않는 카드 안 칸이라(codex-ds 결정 28 · 32) 곁에 서 있어도 넓게를 막지
  // 않는다.
  const wide = !sidebarOpen && !panelOpen;

  const meta = selected && STATUS_META[selected.status];
  // 머리 카드 이름 뒤의 옅은 글자 — 그 work가 걸쳤던 프로젝트와 치운 날이다(DS `.at-winhead .sub`). 문서 카드의 머리 자리를 경로 줄이
  // 갖게 되어 옛 카드 머리의 꼬리표 · 날짜가 이리 왔다. 둘 다 없으면 서지 않는다. 날짜는 목록 행의 날짜와 같은 글자다(`archivedDayText`).
  const day = selected && archivedDayText(selected.archivedAt);
  const about = selected ? [...selected.projects, ...(day ? [`${day}에 치움`] : [])].join(" · ") : "";

  // 표의 값 하나가 본문 하나로 간다. **`switch`인 것이 계약이다** — 표에 칸이 하나 늘면
  // 여기가 컴파일에서 깨진다. 마지막을 `else`로 두면 새 칸이 **조용히 소스 보기로** 떨어지고
  // 아무 데서도 안 잡힌다. Works 화면(`SpecViewer`)에도 같은 네 갈래가 같은 모양으로 있다 —
  // 인자와 근거가 갈려 한 컴포넌트로는 안 묶지만, 칸이 늘면 두 자리가 함께 깨져야 한다.
  //
  // 문서 이름을 인자로 받는 것은 **여기 오는 길이 「문서가 있다」를 이미 가른 뒤**라서다
  // (`current === null`은 위에서 「남은 문서가 없어요」로 끝난다).
  const bodyView = (body: DocBody, name: string): React.ReactNode => {
    switch (body) {
      case "image":
        // 아카이브 목록은 경량이라 문서 위치를 담지 않는다 — **뜨지는 않고** 자리표시가
        // 선다. 그래도 줄번호 `1` 하나보다 낫다: 그쪽은 빈 문서라는 거짓말이고 자리표시는
        // 사실이다. 경로를 내려 주는 일은 다음 판이다.
        return <ImageDoc path={null} name={name} />;
      case "html":
        // **여기만 `?? ""`를 걷어낸다**(결정 17). 이 화면은 `placeholderData`가 없어
        // 문서를 옮길 때마다 `undefined`를 지나는데, 프레임이 그 값을 빈 문서로 받으면
        // 한 번 항해했다 다시 항해한다. 마크다운·소스가 잠깐 비는 것과는 성질이 다르다 —
        // 나머지 두 자리는 그대로 둔다.
        return <HtmlDoc content={content} name={name} />;
      case "pretty":
        return (
          <PrettyView
            file={name}
            content={content ?? ""}
            onCopyBlock={copyBlockRef}
            wide={wide}
            files={docs}
            onNavigate={onFollowLink}
            // 아카이브 목록은 경량이라 문서 위치를 담지 않는다 — 로컬 이미지는
            // 자리표시로 남고, 그 자리를 채우려면 코어가 경로를 함께 내려야 한다
            specRoot={null}
          />
        );
      case "source":
        return <SourceView content={content ?? ""} wide={wide} />;
      // 반환 타입만으로는 빠진 칸이 안 잡힌다 — `ReactNode`가 `undefined`를 품는다.
      default: {
        const unhandled: never = body;
        return unhandled;
      }
    }
  };

  // 경로 줄의 보기 묶음 · 경로 복사 — 문서 글의 우클릭 메뉴(`DocTextBox`)도 같은 값을 받는다(codex-ds 티켓 30).
  const docView: PathView = {
    source: showSource,
    // 잠김도 표에서 나온다 — 본문이 묶음을 안 따르는 파일에서 두 칸이 살아 있으면 선 칸과 본문이 서로 다른 말을
    // 한다(결정 11).
    //
    // **`current === null`이 따로 얹힌다** — Works의 `!currentSpec`과 같은 항이다(`WorksPage.tsx`의 `sourceLocked`).
    // 남은 문서가 하나도 없으면 표는 마크다운으로 떨어지지만 그 기본값은 **본문 분기를 위한 것이지 「누를 것이
    // 있다」는 뜻이 아니다** — 표 스스로 「잠그는 것은 화면의 사정이다」로 이 항을 여기 넘겨 뒀다(`doc-refs`의 표
    // 머리말). 본문은 아래에서 "남은 문서가 없어요"에 고정이라, 안 얹으면 두 칸이 멀쩡히 눌리고 칩만 미끄러진다(결정 21).
    locked: current === null || ignoresViewSwitch(current),
    onChange: setShowSource,
  };
  // spec 목록 패널의 트리 행이 복사하는 것과 같은 값이다(`archiveRef` → `copyText`) — 새 동작이 아니라 자리가 하나 더
  // 생긴 것이다. 가리킬 문서가 없으면 서지 않는다(결정 11 · 21).
  const copyDocPath = selected && current ? () => copyText(archiveRef(selected.slug, current)) : undefined;

  return (
    // 공용 틀 위의 문서 | 목록 카드 하나(codex-ds 결정 28 — 0.5px 세로 선이 두 칸을 가른다)와 오른쪽 spec 목록 패널 카드. 머리 줄에는
    // 고른 아카이브의 머리 카드가 선다(codex-ds 스펙 §7).
    <Frame
      sidebarOpen={sidebarOpen}
      // 머리 카드 — 왼쪽은 ⚡(work 아이콘 — 아카이브한 것도 work다)와 그 제목 · 프로젝트 · 치운 날이고, 고른 것이 없으면 nav의 화면
      // 이름 · 아이콘이다.
      // 오른쪽은 치운 때의 상태 배지와 ⋯ 아카이브 메뉴이고(스토리 57), 세로선 너머 맨 끝에 spec 목록 토글이 선다 — 토글은 틀이 패널
      // 칸에서 짓는다(`Frame`의 `PanelSlot`). 배지는 보이기만 한다 — 작업 화면의 배지와 달리 상태를 바꾸는 메뉴가 없다(아카이브는
      // 치운 시점 그대로다). 캔버스의 「되살리기」는 지금 앱에 없는 조작이라 짓지 않는다(codex-ds 결정 31).
      head={{
        icon: selected ? Zap : PLACE.icon,
        name: selected?.title ?? PLACE.label,
        sub: about ? [about] : undefined,
        actions: selected && meta && (
          <>
            {/* 배지의 모양은 작업 화면 배지와 한 규격이다(DS `StatusBadge` — 24 · 점 · 글자). */}
            <span className={cn(STATUS_BADGE, meta.badgeClass)}>{meta.label}</span>
            {/* 아카이브를 옮기면 메뉴를 새로 세운다(`key`) — 열어 둔 채 옮기면 화면에 보이는 것과 다른 아카이브를 겨눈다. */}
            <ArchiveMenu key={selected.slug} slug={selected.slug} onCopy={copyText} />
          </>
        ),
      }}
      list={{
        size: listSize,
        label: "아카이브 목록",
        // 목록 행의 메뉴(codex-ds 티켓 30) — 머리 카드 ⋯과 같은 정의(`ArchiveMenuItems`)이고 같은 동작을 그 행의 아카이브로 부른다.
        // 행 목록 하나가 메뉴 하나를 맡는다(`TargetMenu`). 고른 행이 아니어도 그 행의 것이다(결정 7) — 고름 · 주소는 그대로다.
        children: (
          <TargetMenu
            targetOf={(from) => {
              const row = from.closest<HTMLElement>("button[data-archive-row]");
              const slug = row?.dataset.archiveRow;
              return row && slug ? { of: slug, ring: row } : null;
            }}
            items={(slug) => <ArchiveMenuItems actions={archiveMenuActions(slug, copyText)} />}
          >
            {(region) => (
              <ArchiveList
                entries={entries}
                selectedSlug={selected?.slug ?? null}
                loading={entriesPending}
                onSelect={onSelect}
                rowMenu={region}
              />
            )}
          </TargetMenu>
        ),
      }}
      // spec 목록 패널(codex-ds 스펙 §7 「Archive」) — 고른 아카이브의 문서 트리다. 바깥 상자가 둘째 `aside`이고 220ms로 여닫힌다(공용 틀의
      // 패널 칸 — 작업 패널과 같은 칸이다). 이름 「spec 목록」은 카드의 이름이자 머리 카드 토글의 앞말이다(「spec 목록 접기」).
      panel={
        selected
          ? {
              open: panelOpen,
              onToggle: () => setPanelOpen((open) => !open),
              size: panelSize,
              label: "spec 목록",
              children: (
                <SpecListPanel
                  slug={selected.slug}
                  archived={archived}
                  current={current}
                  onSelect={onSelectDoc}
                  onCopy={(path) => copyText(archiveRef(selected.slug, path))}
                />
              ),
            }
          : undefined
      }
      // 토스트의 자리 — 카드 줄의 아래 가운데다(판 04 「덮는 것의 기준 상자」). 작업 화면과 같은 부품이고 같은 상자에 선다.
      overlay={<Toaster />}
    >
      <Card
        as="main"
        label="아카이브 문서"
        className="flex-1"
        // 문서 칸 — 문서 | 목록 카드의 왼쪽 칸이다. 경로 줄(codex-ds 스펙 §7 「Archive」 · `PathBar`)이 그 머리다 — 탭이 없는 칸이라
        // 머리 자리에 서고(DS `PathBar`), 목록 칸의 목록 머리와 같은 48이라 둘이 한 줄에 선다(codex-ds 결정 28).
        // 작업 화면의 문서와 같은 줄이다: 경로 캡슐 · 보기 묶음 · 경로 복사이고 닫기 ×는 없다(codex-ds 결정 13). 경로는 work 폴더
        // 기준이라(`list_archived_docs`) 기록(`record.md`)은 `slug › record.md`, spec 문서는 `slug › spec › …`로 읽힌다. 고른
        // 아카이브가 없으면 칸 안에 고를 것이 없어 머리도 없다.
        head={
          selected && (
            <PathBar
              path={[selected.slug, ...(current ? current.split("/") : [])]}
              view={docView}
              onCopy={copyDocPath}
            />
          )
        }
      >
        {/* 문서가 서면 몸이 **문서 글**이다(`DocTextBox` — 우클릭 · ⇧F10의 메뉴, 포커스를 받는 자리). 고른 아카이브가 없거나 남은
            문서가 없으면 같은 모양의 상자일 뿐이다 — 거기 우클릭은 아무것도 안 선다. */}
        {selected && !docsPending && current !== null ? (
          <DocTextBox menu={{ view: docView, onCopyPath: copyDocPath }} className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
            <div className="flex min-h-full min-w-0 flex-col">{bodyView(body, current)}</div>
          </DocTextBox>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
            {/* 아직 모르는 동안에는 아무 말도 하지 않는다 — 목록이 도착하기 전에 "없어요"를
                띄우면, 이 분기가 막으려던 바로 그 모순(목록 칸엔 있고, 본문엔 없다)이 로딩
                타이밍에서 되살아난다. */}
            {!selected ? (
              entriesPending ? null : (
              <div className="flex h-full items-center justify-center p-10">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Archive />
                    </EmptyMedia>
                    {/* 목록이 비었을 때와 "그 slug가 목록에 없을 때"는 다른 사정이다. 하나로 묶으면
                        목록 칸이 아카이브를 가득 그린 채 본문만 "없어요"라고 말한다 — 주소에
                        stale한 slug가 남았을 때 실제로 그렇게 된다. */}
                    <EmptyTitle>
                      {entries.length === 0
                        ? ARCHIVE_COPY.emptyScreen.title
                        : "그 아카이브를 찾을 수 없어요"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {entries.length === 0
                        ? ARCHIVE_COPY.emptyScreen.body
                        : "옮겨졌거나 이름이 바뀐 것 같아요. 오른쪽 목록에서 골라 주세요."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
              )
            ) : (
              <div className="flex min-h-full min-w-0 flex-col">
                {docsPending ? null : (
                  <div className="flex flex-1 items-center justify-center p-10 text-sm text-fg-tertiary">
                    남은 문서가 없어요
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </Frame>
  );
}

/**
 * 아카이브된 work의 spec 폴더를 Finder에서 연다(codex-ds 스펙 S6) — 아카이브 메뉴(머리 카드 ⋯ · 목록 행)의 「Finder에서 열기」와 spec
 * 목록 패널 머리의 「spec 폴더 열기」가 부른다. 못 열면(폴더가 없는 아카이브 등) 백엔드가 돌려준 문장을 「못 한 일」 토스트로 알린다 —
 * 앱의 Finder 열기가 모두 그 한 길이다(`openInFinder`).
 */
function openArchivedSpecFolder(slug: string): void {
  openInFinder(() => archiveApi.openSpecFolder(slug));
}

/** 아카이브 메뉴가 그 아카이브로 부르는 동작 — 머리 카드 ⋯와 목록 행의 메뉴가 같은 한 벌을 쓴다. */
function archiveMenuActions(slug: string, onCopy: (text: string) => void): ArchiveMenuActions {
  return {
    openFolder: () => openArchivedSpecFolder(slug),
    // 「Finder에서 열기」가 여는 폴더의 참조다(`refs.ts` — 끝에 `/`).
    copyPath: () => onCopy(archiveSpecDirRef(slug)),
  };
}

// 머리 카드의 ⋯ — 아카이브 메뉴(codex-ds 결정 16 「Archive 목록 행」 · 스펙 §7). 무엇을 어떤 차례로 보이는지는 메뉴 정의
// (`ArchiveMenuItems`)가 들고, 여기는 그 항목이 부르는 동작을 잇는다: Finder 열기와 spec 폴더 경로 복사. 모양과 여닫이는 작업 화면의
// ⋯(`WorksPage`의 `WorkMenu`)와 같다 — 위 줄의 24 아이콘 버튼이고 펼친 동안 켜진 면이다. 머리 카드 안이고 버튼이라 창 끌기 영역이 아니다.
function ArchiveMenu({ slug, onCopy }: { slug: string; onCopy: (text: string) => void }) {
  // 열림을 여기서 든다 — ⋯의 켜짐(`toggle-on`)이 그것을 그린다.
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Hint
        text="아카이브 메뉴"
        announce="name"
        render={
          <DropdownMenuTrigger
            className={cn(
              "icon-button icon-button-xs transition-colors focus-ring",
              open ? "toggle-on" : "text-fg-tertiary quiet-hover",
            )}
          />
        }
      >
        <MoreHorizontal className="size-3.75" />
      </Hint>
      <DropdownMenuContent>
        <ArchiveMenuItems actions={archiveMenuActions(slug, onCopy)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * spec 목록 패널의 카드 안(codex-ds 스펙 §7 「Archive」 · DS `.at-panel`) — 머리 「spec」 · spec 폴더 열기와 고른 아카이브의 문서 트리.
 * 작업 패널(`WorkPanel`)과 같은 짜임이다: 머리는 패널 머리(46 — 카드 머리 `--card-head`)이고 카드에 고정되며, 세로 스크롤은 몸
 * 안에서만 돈다. 머리 제목은 DS 패널 머리 제목(14/20 · 500)이고 글자가 카드 + 16에 선다(머리 여백 8 + 제목 안쪽 8).
 *
 * 트리는 기록 행 곁의 `spec/` 행 아래에 받은 spec 트리를 얹은 것이다(`archiveTreeItems` — 경로는 work 폴더 기준이라 선택 표시 · 복사 ·
 * 읽기가 그대로 쓴다). 한때 목록 행 안에 펼쳐졌는데 목록이 문서에 파묻혀 이 패널로 옮겼다(스토리 55). **아카이브마다 새로 선다**
 * (`key`) — 손으로 접은 폴더는 그 아카이브를 보는 동안만 산다. 아카이브끼리는 같은 이름의 폴더(판 폴더 · `tickets`)가 흔해, 이어
 * 받으면 처음 보는 아카이브가 남의 접힘으로 뜬다.
 */
function SpecListPanel({
  slug,
  archived,
  current,
  onSelect,
  onCopy,
}: {
  slug: string;
  /** 그 아카이브의 문서 답 — 아직 안 왔으면 `undefined`다. 도착 전에는 아무 말도 하지 않는다(빈 트리와 「아직 모른다」를 가른다). */
  archived: ArchivedDocs | undefined;
  current: string | null;
  onSelect: (path: string) => void;
  /** work 폴더 기준 경로를 받는다 — 참조 문자열 조립은 부르는 쪽이 한다. */
  onCopy: (path: string) => void;
}) {
  const items = useMemo(() => (archived ? archiveTreeItems(archived) : []), [archived]);
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-2">
      <CardHead
        end={
          <Hint
            text="spec 폴더 열기"
            announce="name"
            type="button"
            tabIndex={0}
            onClick={() => openArchivedSpecFolder(slug)}
            className="icon-button-quiet text-fg-secondary focus-ring"
          >
            <FolderOpen className="size-4" />
          </Hint>
        }
      >
        <span className="px-2 text-sm font-medium">spec</span>
      </CardHead>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
        {archived === undefined ? null : items.length === 0 ? (
          <span className="px-2 py-1.5 text-chat-meta text-fg-tertiary">남은 문서가 없어요</span>
        ) : (
          <SpecTree key={slug} items={items} current={current} onSelect={onSelect} onCopy={onCopy} />
        )}
      </div>
    </div>
  );
}

export default ArchivePage;

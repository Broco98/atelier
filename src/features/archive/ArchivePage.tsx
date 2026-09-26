import { useCallback, useState } from "react";
import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceToggle } from "@/components/ui/SourceToggle";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Toaster, showToast } from "@/components/ui/toast";
import ListPanelToggle, { useListPanel } from "@/components/shell/ListPanelToggle";
import PageHeader from "@/components/shell/PageHeader";
import { HtmlDoc, ImageDoc, PrettyView, SourceView } from "@/features/works/SpecViewer";
import { docBody, ignoresSourceToggle } from "@/features/works/doc-refs";
import type { DocBody } from "@/features/works/doc-refs";
import { hasProjects } from "@/mode";
import type { Mode } from "@/mode";
import { archiveRef } from "@/features/works/refs";
import { formatCreated, STATUS_META } from "@/features/works/status";
import { emptyScreenCopy } from "./archive-copy";
import ArchiveList from "./ArchiveList";
import { useArchive, useArchivedDocs, useArchivedFile } from "./hooks";

interface ArchivePageProps {
  // 어느 세계의 아카이브인가 — 목록도 문서도 이 값으로 루트가 갈린다(WorksPage와 같은 계약).
  mode: Mode;
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서는 주소가 정본이다 — 여기서 들면 문서를 옮긴 자취가 히스토리에 남지 않아
  // 링크를 따라 들어간 뒤 뒤로가기가 아카이브 전체를 건너뛴다 (Works와 같은 근거).
  currentFile: string | null;
  // 목록에서 문서를 고르는 것은 아카이브를 고르는 것이기도 하다 — 둘을 함께 넘긴다
  onSelectDoc: (slug: string, path: string) => void;
  // 본문 링크는 지금 아카이브 안에서만 움직인다
  onFollowLink: (path: string) => void;
}

// 문서 목록이 아직 없을 때의 빈 목록 — 렌더마다 새 배열을 지으면 그것을 받는 본문이 매번 바뀐
// 값을 받는다.
const NO_DOCS: string[] = [];

// 목록 패널 + 본문. Projects와 같은 2단이다 — 아카이브 목록은 사이드바에 상주하지 않으므로
// (nav 항목 하나뿐) 패널이 그 목록의 자리다. `works-nav-depth`가 지운 것은 **Works의**
// 목록 컬럼이고, 그 근거는 같은 목록이 사이드바에 이미 있다는 것이었다.
function ArchivePage({
  mode,
  sidebarOpen,
  selectedSlug,
  currentFile,
  onSelectDoc,
  onFollowLink,
}: ArchivePageProps) {
  // `[]`는 "하나도 없다"와 "아직 모른다"를 같이 뜻한다. 아래 두 자리(본문 빈 상태·목록 패널)가
  // 그것으로 "없어요"라고 단언하므로 둘을 갈라 둔다. 목록이 캐시에 없는 채로 /archive/$slug에
  // 바로 닿는 경로가 있다 — 이 라우트에는 beforeLoad가 없고(세 $slug 라우트 모두 그렇다),
  // archiveQuery는 gcTime이 지나면 캐시에서 빠진다.
  const { data: entries = [], isPending: entriesPending } = useArchive(mode);
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? null;

  // 문서 목록도 같다 — `[]`가 "문서가 없다"와 "아직 모른다"를 겸한다. 겸하게 두면
  // `current`가 null이 되어 본문이 "남은 문서가 없어요"를 띄운다 (결정 30과 같은 결함).
  // 답에는 spec 트리도 실려 오지만 이 화면이 쓰는 것은 목록뿐이다 — 트리는 목록 패널이 그린다.
  const { data: archived, isPending: docsPending } = useArchivedDocs(mode, selected?.slug ?? null);
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
  const { data: content } = useArchivedFile(
    mode,
    selected?.slug ?? null,
    body === "image" ? null : current,
  );

  // 목록 패널의 접힘과 ⌘Enter(본문을 넓히는 토글) — Projects와 같은 하나를 쓴다.
  const [panelOpen, togglePanel] = useListPanel("archive-panel-open");

  // 작업 화면과 **같은 호출**이다(결정 11) — 토스트의 상태는 부품이 들고, 여기서는 내기만 한다.
  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${text} 복사됨`);
  }, []);

  // 참조가 안정적이어야 이 화면이 다시 그려질 때 마크다운 트리가 리마운트되지 않는다
  const slug = selected?.slug;
  const copyBlockRef = useCallback(
    (start: number, end: number) => {
      if (!slug || !current) return;
      copyText(archiveRef(mode, slug, current, start, end));
    },
    [mode, slug, current, copyText],
  );

  // 이 화면의 접이식은 사이드바와 목록 패널 둘이다. 화면을 비웠는지를 말하는 값이
  // 헤더 인셋과 본문 폭 두 곳에서 쓰이므로 여기 한 번만 적는다 (Works 쪽도 같은 규칙).
  const wide = !sidebarOpen && !panelOpen;

  const meta = selected && STATUS_META[selected.status];

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ArchiveList
        mode={mode}
        entries={entries}
        selectedSlug={selected?.slug ?? null}
        loading={entriesPending}
        currentDoc={current}
        // 문서를 고르는 것이 곧 아카이브를 고르는 것이다 — 목록 행은 펼침만 맡는다.
        // 둘은 한 번의 이동으로 함께 옮겨진다(주소가 둘 다 들고 있다).
        onSelectDoc={onSelectDoc}
        onCopyDoc={(docSlug, path) => copyText(archiveRef(mode, docSlug, path))}
        sidebarOpen={sidebarOpen}
        open={panelOpen}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Archive"
          leaf={selected?.title}
          inset={wide}
          meta={
            selected &&
            meta && (
              <span className="ml-1.5 flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "flex h-[22px] items-center rounded-[7px] px-2 text-[12px] font-medium",
                    meta.badgeClass,
                  )}
                >
                  {meta.label}
                </span>
                {selected.archivedAt && (
                  <span className="text-[12px] text-tertiary">
                    {formatCreated(selected.archivedAt)}에 치움
                  </span>
                )}
                {/* **Maison에는 프로젝트가 없다**(결정 17). 값으로만 가르지 않는 이유는
                    정보 탭·목록 필터 쪽과 같다 — 손으로 고친 work.json이나 저쪽 세계에서
                    옮겨 온 폴더가 Room 아카이브에도 프로젝트 이름을 실어 올 수 있고,
                    「비면 안 그린다」로 두면 그날 여기에만 저 세계의 개념이 되살아난다. */}
                {hasProjects(mode) && (
                  <span className="flex gap-1.5">
                    {selected.projects.map((project) => (
                      <span
                        key={project}
                        className="rounded-[7px] bg-accent px-2 py-[3px] text-[12px] text-muted-foreground"
                      >
                        {project}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )
          }
          actions={
            <>
              {/* 글자 하나로 「소스」라고만 적던 자리다 — 여기도 같은 컨트롤을 쓴다(결정 33).
                  한 화면에서만 다른 어휘를 쓰면 같은 일이 두 모양으로 읽힌다. */}
              {selected && (
                <SourceToggle
                  on={showSource}
                  // 잠김도 표에서 나온다 — 본문이 토글을 안 따르는 파일에서 두 칸이 살아
                  // 있으면 선 칸과 본문이 서로 다른 말을 한다(결정 11).
                  //
                  // **`current === null`이 따로 얹힌다** — Works의 `!currentSpec`과 같은
                  // 항이다(`WorksPage.tsx`의 `sourceLocked`). 남은 문서가 하나도 없으면
                  // 표는 마크다운으로 떨어지지만 그 기본값은 **본문 분기를 위한 것이지
                  // 「누를 것이 있다」는 뜻이 아니다** — 표 스스로 「잠그는 것은 화면의
                  // 사정이다」로 이 항을 여기 넘겨 뒀다(`doc-refs`의 표 머리말). 본문은
                  // 아래에서 "남은 문서가 없어요"에 고정이라, 안 얹으면 두 칸이 멀쩡히
                  // 눌리고 칩만 미끄러진다(결정 21).
                  locked={current === null || ignoresSourceToggle(current)}
                  onChange={setShowSource}
                />
              )}
              <ListPanelToggle open={panelOpen} onToggle={togglePanel} />
            </>
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
          {/* 아직 모르는 동안에는 아무 말도 하지 않는다 — 목록이 도착하기 전에 "없어요"를
              띄우면, 이 분기가 막으려던 바로 그 모순(왼쪽엔 목록, 본문엔 없다)이 로딩
              타이밍에서 되살아난다. */}
          {!selected ? (
            entriesPending ? null : (
            <div className="flex h-full items-center justify-center p-10">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Archive strokeWidth={1.6} />
                  </EmptyMedia>
                  {/* 목록이 비었을 때와 "그 slug가 목록에 없을 때"는 다른 사정이다. 하나로 묶으면
                      왼쪽 패널이 아카이브를 가득 그린 채 본문만 "없어요"라고 말한다 — 주소에
                      stale한 slug가 남았을 때 실제로 그렇게 된다. */}
                  {/* 「하나도 없다」는 세계마다 낱말이 다르고(#183), 「그 slug를 못 찾겠다」는
                      두 세계가 같은 말을 한다 — 아카이브도 slug도 이 세계 저 세계 이름이 아니다. */}
                  <EmptyTitle>
                    {entries.length === 0
                      ? emptyScreenCopy(mode).title
                      : "그 아카이브를 찾을 수 없어요"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {entries.length === 0
                      ? emptyScreenCopy(mode).body
                      : "옮겨졌거나 이름이 바뀐 것 같아요. 왼쪽 목록에서 골라 주세요."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
            )
          ) : (
            <div className="flex min-h-full min-w-0 flex-col">
              {docsPending ? null : current === null ? (
                <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-tertiary">
                  남은 문서가 없어요
                </div>
              ) : (
                bodyView(body, current)
              )}
            </div>
          )}
        </div>

        {/* 토스트의 자리 — 목록 패널을 뺀 본문의 아래 가운데다. 작업 화면과 같은 부품이지만 자리는
            화면마다 지금 그대로 둔다(S14): 한 자리로 모으려면 라우트 자리를 새 상자로 감싸야 하고,
            그러면 이 토스트가 목록 패널 폭의 반만큼 옮겨 간다. */}
        <Toaster />
      </main>
    </div>
  );
}

export default ArchivePage;

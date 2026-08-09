import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Check, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/shell/PageHeader";
import { PrettyView, SourceView } from "@/features/works/SpecViewer";
import { archiveRef } from "@/features/works/refs";
import { formatCreated, STATUS_META } from "@/features/works/status";
import ArchiveList from "./ArchiveList";
import { useArchive, useArchivedDocs, useArchivedFile } from "./hooks";

interface ArchivePageProps {
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

const PANEL_OPEN_KEY = "archive-panel-open";

// 목록 패널 + 본문. Projects와 같은 2단이다 — 아카이브 목록은 사이드바에 상주하지 않으므로
// (nav 항목 하나뿐) 패널이 그 목록의 자리다. `works-nav-depth`가 지운 것은 **Works의**
// 목록 컬럼이고, 그 근거는 같은 목록이 사이드바에 이미 있다는 것이었다.
function ArchivePage({
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
  const { data: entries = [], isPending: entriesPending } = useArchive();
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? null;

  // 문서 목록도 같다 — `[]`가 "문서가 없다"와 "아직 모른다"를 겸한다. 겸하게 두면
  // `current`가 null이 되어 본문이 "남은 문서가 없어요"를 띄운다 (결정 30과 같은 결함).
  const { data: docs = [], isPending: docsPending } = useArchivedDocs(selected?.slug ?? null);
  // 고른 문서가 **어느 아카이브의 것인지**는 이제 주소가 함께 들고 있다 — 아카이브를 옮길 때
  // 이동이 search를 비우므로, 이름이 같은 문서(record.md·overview.md)가 딸려가 엉뚱하게
  // 열리던 경로가 아예 없다. 목록에 없는 경로면 아래에서 기본값으로 떨어진다.
  // 목록의 첫 항목이 그 기본값이다 — 기록이 있으면 그것이 맨 앞이다 (list_archived_docs)
  const current = currentFile && docs.includes(currentFile) ? currentFile : (docs[0] ?? null);
  const { data: content } = useArchivedFile(selected?.slug ?? null, current);

  const [showSource, setShowSource] = useState(false);
  const isMarkdown = current?.toLowerCase().endsWith(".md") ?? true;

  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem(PANEL_OPEN_KEY) !== "0",
  );
  useEffect(() => {
    localStorage.setItem(PANEL_OPEN_KEY, panelOpen ? "1" : "0");
  }, [panelOpen]);

  // ⌘Enter — "본문을 넓히는 토글". 이 화면의 유일한 접이식이 목록 패널이라 그 자리를 받는다
  // (Projects와 같은 규칙). 입력 중에는 무시.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      setPanelOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setToast(`${text} 복사됨`);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // 참조가 안정적이어야 토스트 표시/해제 리렌더가 마크다운 트리를 리마운트하지 않는다
  const slug = selected?.slug;
  const copyBlockRef = useCallback(
    (start: number, end: number) => {
      if (!slug || !current) return;
      copyText(archiveRef(slug, current, start, end));
    },
    [slug, current, copyText],
  );

  // 이 화면의 접이식은 사이드바와 목록 패널 둘이다. 화면을 비웠는지를 말하는 값이
  // 헤더 인셋과 본문 폭 두 곳에서 쓰이므로 여기 한 번만 적는다 (Works 쪽도 같은 규칙).
  const wide = !sidebarOpen && !panelOpen;

  const meta = selected && STATUS_META[selected.status];

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ArchiveList
        entries={entries}
        selectedSlug={selected?.slug ?? null}
        loading={entriesPending}
        currentDoc={current}
        // 문서를 고르는 것이 곧 아카이브를 고르는 것이다 — 목록 행은 펼침만 맡는다.
        // 둘은 한 번의 이동으로 함께 옮겨진다(주소가 둘 다 들고 있다).
        onSelectDoc={onSelectDoc}
        onCopyDoc={(docSlug, path) => copyText(archiveRef(docSlug, path))}
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
              </span>
            )
          }
          actions={
            <>
              {selected && (
                <button
                  type="button"
                  onClick={() => setShowSource((v) => !v)}
                  className={cn(
                    "h-6 rounded-[8px] px-[9px] text-[12.5px] transition-colors",
                    showSource
                      ? "toggle-on"
                      : "text-tertiary quiet-hover",
                  )}
                >
                  소스
                </button>
              )}
              <button
                type="button"
                onClick={() => setPanelOpen((open) => !open)}
                aria-label="목록 패널 토글"
                aria-expanded={panelOpen}
                title={panelOpen ? "목록 패널 접기" : "목록 패널 펼치기"}
                className="icon-button-quiet text-tertiary"
              >
                {panelOpen ? (
                  <Maximize2 className="size-4" strokeWidth={1.7} />
                ) : (
                  <Minimize2 className="size-4" strokeWidth={1.7} />
                )}
              </button>
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
              <div className="flex max-w-[420px] flex-col items-center gap-[7px] text-center">
                <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                  <Archive className="size-5" strokeWidth={1.6} />
                </div>
                {/* 목록이 비었을 때와 "그 slug가 목록에 없을 때"는 다른 사정이다. 하나로 묶으면
                    왼쪽 패널이 아카이브를 가득 그린 채 본문만 "없어요"라고 말한다 — 주소에
                    stale한 slug가 남았을 때 실제로 그렇게 된다. */}
                <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
                  {entries.length === 0 ? "아직 치운 작업이 없어요" : "그 아카이브를 찾을 수 없어요"}
                </span>
                <span className="text-[14px] leading-[1.65] text-tertiary">
                  {entries.length === 0
                    ? "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요."
                    : "옮겨졌거나 이름이 바뀐 것 같아요. 왼쪽 목록에서 골라 주세요."}
                </span>
              </div>
            </div>
            )
          ) : (
            <div className="flex min-h-full min-w-0 flex-col">
              {docsPending ? null : current === null ? (
                <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-tertiary">
                  남은 문서가 없어요
                </div>
              ) : showSource || !isMarkdown ? (
                <SourceView content={content ?? ""} wide={wide} />
              ) : (
                <PrettyView
                  file={current}
                  content={content ?? ""}
                  onCopyBlock={copyBlockRef}
                  wide={wide}
                  files={docs}
                  onNavigate={onFollowLink}
                  // 아카이브 목록은 경량이라 문서 위치를 담지 않는다 — 로컬 이미지는
                  // 자리표시로 남고, 그 자리를 채우려면 코어가 경로를 함께 내려야 한다
                  specRoot={null}
                />
              )}
            </div>
          )}
        </div>

        {toast && (
          <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg">
            <Check className="size-3.5 text-green-700" strokeWidth={2.4} />
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}

export default ArchivePage;

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
  onSelect: (slug: string | null) => void;
}

const PANEL_OPEN_KEY = "archive-panel-open";

// 목록 패널 + 본문. Projects와 같은 2단이다 — 아카이브 목록은 사이드바에 상주하지 않으므로
// (nav 항목 하나뿐) 패널이 그 목록의 자리다. `works-nav-depth`가 지운 것은 **Works의**
// 목록 컬럼이고, 그 근거는 같은 목록이 사이드바에 이미 있다는 것이었다.
function ArchivePage({ sidebarOpen, selectedSlug, onSelect }: ArchivePageProps) {
  const { data: entries = [] } = useArchive();
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? null;

  const { data: docs = [] } = useArchivedDocs(selected?.slug ?? null);
  const [doc, setDoc] = useState<string | null>(null);
  // 목록의 첫 항목이 기본값이다 — 기록이 있으면 그것이 맨 앞이다 (list_archived_docs)
  const current = doc && docs.includes(doc) ? doc : (docs[0] ?? null);
  const { data: content } = useArchivedFile(selected?.slug ?? null, current);
  // 다른 아카이브로 옮기면 문서 선택을 놓는다 — 이름이 같은 문서가 양쪽에 있으면
  // 새로 연 아카이브에서 기록 대신 그 문서가 열려, 처음 보이는 것이 아카이브마다 달라진다
  useEffect(() => setDoc(null), [selectedSlug]);

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

  const meta = selected && STATUS_META[selected.status];

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ArchiveList
        entries={entries}
        selectedSlug={selected?.slug ?? null}
        onSelect={onSelect}
        docs={docs}
        currentDoc={current}
        onSelectDoc={setDoc}
        onCopyDoc={(path) => slug && copyText(archiveRef(slug, path))}
        sidebarOpen={sidebarOpen}
        open={panelOpen}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Archive"
          leaf={selected?.title}
          inset={!sidebarOpen && !panelOpen}
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
                      : "text-tertiary hover:bg-state-2 hover:text-foreground",
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
                className="icon-button text-tertiary transition-colors hover:bg-state-2 hover:text-foreground"
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
          {!selected ? (
            <div className="flex h-full items-center justify-center p-10">
              <div className="flex max-w-[420px] flex-col items-center gap-[7px] text-center">
                <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                  <Archive className="size-5" strokeWidth={1.6} />
                </div>
                <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
                  아직 치운 작업이 없어요
                </span>
                <span className="text-[14px] leading-[1.65] text-tertiary">
                  끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex min-h-full min-w-0 flex-col">
              {current === null ? (
                <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-tertiary">
                  남은 문서가 없어요
                </div>
              ) : showSource || !isMarkdown ? (
                <SourceView content={content ?? ""} />
              ) : (
                <PrettyView file={current} content={content ?? ""} onCopyBlock={copyBlockRef} />
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

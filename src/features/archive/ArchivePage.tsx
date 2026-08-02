import { useCallback, useEffect, useRef, useState } from "react";
// 빈 상태 아이콘은 nav 항목과 같은 것을 쓴다 — Works의 빈 상태가 Zap을 쓰는 것과 같은 규칙
import { Archive, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/shell/PageHeader";
import SpecTree from "@/features/works/SpecTree";
import { PrettyView, SourceView } from "@/features/works/SpecViewer";
import { archiveRef } from "@/features/works/refs";
import { formatCreated, StatusIcon, STATUS_META } from "@/features/works/status";
import { useArchive, useArchivedDocs, useArchivedFile } from "./hooks";
import type { ArchiveEntry } from "./types";

interface ArchivePageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  onSelect: (slug: string | null, replace?: boolean) => void;
}

// 아카이브는 사이드바에 상주 목록을 두지 않는다 — 차가운 보관물이라 늘 자리를 차지할 이유가
// 없고, 그것이 nav 항목으로 간 이유다(결정 11). 그래서 목록과 상세가 같은 본문 영역을
// 번갈아 쓰고, 돌아가는 길은 브레드크럼의 뿌리다.
function ArchivePage({ sidebarOpen, selectedSlug, onSelect }: ArchivePageProps) {
  const { data: entries = [], isPending, isFetching } = useArchive();
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? null;

  // 주소가 가리키는 아카이브가 없다(지워졌거나 잘못된 링크) — 목록으로 되돌려 주소와 화면을
  // 맞춘다. 목록이 아직 오는 중이면 판단을 미룬다: 방금 치운 것을 "없다"고 오판하면
  // 아카이빙 직후 상세를 열자마자 튕긴다.
  // onSelect는 의존성에 넣지 않는다 — 호출부가 인라인으로 만들어 매 렌더 새 참조다.
  useEffect(() => {
    if (selectedSlug === null || selected || isPending || isFetching) return;
    onSelect(null, true);
  }, [selectedSlug, selected, isPending, isFetching]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <ArchiveDetail
            key={selected.slug}
            entry={selected}
            sidebarOpen={sidebarOpen}
            onBack={() => onSelect(null)}
          />
        ) : (
          <ArchiveList
            entries={entries}
            // 목록이 아직 오는 중인 것을 "하나도 없다"로 읽으면 매 진입마다 빈 상태가 스친다
            pending={isPending}
            sidebarOpen={sidebarOpen}
            onOpen={onSelect}
          />
        )}
      </main>
    </div>
  );
}

function ArchiveList({
  entries,
  pending,
  sidebarOpen,
  onOpen,
}: {
  entries: ArchiveEntry[];
  pending: boolean;
  sidebarOpen: boolean;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <PageHeader
        root="Archive"
        inset={!sidebarOpen}
        meta={
          entries.length > 0 && (
            <span className="ml-1.5 shrink-0 text-[12.5px] text-tertiary">{entries.length}</span>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-10">
            {!pending && (
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
            )}
          </div>
        ) : (
          // 문서 열(bodyColumn)처럼 가운데 정렬하지 않는다. 이 화면에는 폭을 먹는 우측
          // 패널이 없어서, 가운데로 몰면 왼쪽에 빈 벌판이 생기고 목록이 머리말에서
          // 떨어져 나온다. 목록은 자기 머리말에 맞춘다 — 행 안쪽 여백(px-3)까지 더해
          // 제목 첫 글자가 브레드크럼과 같은 x에 선다.
          <div className="flex w-full max-w-[820px] flex-col gap-px px-1 py-2">
            {entries.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                onClick={() => onOpen(entry.slug)}
                className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-state-1"
              >
                {/* 치운 시점의 상태를 그대로 보존한다 — 아카이브가 done을 뜻하지는 않는다 */}
                <StatusIcon status={entry.status} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                  {entry.title}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {entry.projects.map((project) => (
                    <span
                      key={project}
                      className="rounded-[7px] bg-accent px-2 py-[3px] text-[11.5px] text-muted-foreground"
                    >
                      {project}
                    </span>
                  ))}
                </span>
                {/* 손으로 옮겨 둔 폴더에는 일시가 없다 — 없으면 자리를 비운다 */}
                <span className="w-[62px] shrink-0 text-right text-[12px] text-tertiary">
                  {entry.archivedAt ? formatCreated(entry.archivedAt) : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ArchiveDetail({
  entry,
  sidebarOpen,
  onBack,
}: {
  entry: ArchiveEntry;
  sidebarOpen: boolean;
  onBack: () => void;
}) {
  const { data: docs = [] } = useArchivedDocs(entry.slug);
  const [selected, setSelected] = useState<string | null>(null);
  // 목록의 첫 항목이 기본값이다 — 기록이 있으면 그것이 맨 앞이다 (list_archived_docs)
  const current = selected && docs.includes(selected) ? selected : (docs[0] ?? null);
  const { data: content } = useArchivedFile(entry.slug, current);
  const [showSource, setShowSource] = useState(false);
  const isMarkdown = current?.toLowerCase().endsWith(".md") ?? true;
  const meta = STATUS_META[entry.status];

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
  const copyBlockRef = useCallback(
    (start: number, end: number) => {
      if (!current) return;
      copyText(archiveRef(entry.slug, current, start, end));
    },
    [entry.slug, current, copyText],
  );

  return (
    <>
      <PageHeader
        root="Archive"
        onRoot={onBack}
        leaf={entry.title}
        inset={!sidebarOpen}
        meta={
          <span className="ml-1.5 flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "flex h-[22px] items-center rounded-[7px] px-2 text-[12px] font-medium",
                meta.badgeClass,
              )}
            >
              {meta.label}
            </span>
            {entry.archivedAt && (
              <span className="text-[12px] text-tertiary">
                {formatCreated(entry.archivedAt)}에 치움
              </span>
            )}
          </span>
        }
        actions={
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className={cn(
              "h-6 rounded-[8px] px-[9px] text-[12.5px] transition-colors",
              showSource ? "toggle-on" : "text-tertiary hover:bg-state-2 hover:text-foreground",
            )}
          >
            소스
          </button>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
            <div className="flex min-h-full min-w-0 flex-col">
              {docs.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-tertiary">
                  남은 문서가 없어요
                </div>
              ) : showSource || !isMarkdown ? (
                <SourceView content={content ?? ""} />
              ) : (
                <PrettyView
                  file={current ?? ""}
                  content={content ?? ""}
                  onCopyBlock={copyBlockRef}
                />
              )}
            </div>
          </div>
          {toast && (
            <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg">
              <Check className="size-3.5 text-green-700" strokeWidth={2.4} />
              {toast}
            </div>
          )}
        </div>

        {/* 문서 목록. 작업 패널(WorkPanel)을 쓰지 않는다 — 그쪽은 워크트리와 base 브랜치를
            보여주는데 아카이브에는 워크트리가 없어, 빈 Git 요약을 세우는 꼴이 된다.
            아카이브에서 남은 좌표는 기록 문서 안에 있다. */}
        <aside className="flex w-[264px] shrink-0 flex-col p-4 pl-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border bg-panel pb-2 pt-1">
            <div className="flex items-center px-4 pb-0.5 pt-3">
              <span className="text-[13.5px] font-semibold">문서</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
              <SpecTree
                files={docs}
                current={current}
                onSelect={setSelected}
                onCopy={(path) => copyText(archiveRef(entry.slug, path))}
              />
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export default ArchivePage;

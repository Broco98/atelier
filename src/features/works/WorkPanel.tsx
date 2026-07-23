import { ArrowRight, Copy, GitFork } from "lucide-react";
import { useProjects } from "@/features/projects/hooks";
import { specRef, treeDirRef, workDirRef } from "./refs";
import SpecTree from "./SpecTree";
import type { WorkView } from "./types";

interface WorkPanelProps {
  work: WorkView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
}

// 목업 S5t 작업 패널 — Git 요약 + Spec 파일 트리. PR 연동 카드는 v2.
function WorkPanel({ work, currentFile, onSelectFile, onCopy }: WorkPanelProps) {
  const { data: projects = [] } = useProjects();
  const bases = [
    ...new Set(
      work.projects
        .map((p) => projects.find((x) => x.slug === p)?.baseBranch)
        .filter((b): b is string => Boolean(b)),
    ),
  ];
  const treeCount = work.trees.filter((t) => t.exists).length;

  return (
    // 레이아웃 영역을 차지하는 우측 컬럼 (2026-07-19 사용자 정정).
    // 스크롤바가 화면 맨 오른쪽에 오도록 부모가 스크롤하고, 패널은 sticky로 고정된다.
    <aside className="sticky top-0 flex w-[296px] shrink-0 origin-top-right animate-[panel-pop_260ms_cubic-bezier(0.22,1,0.36,1)_both] flex-col self-start p-4 pl-0">
      <div className="flex max-h-[calc(100vh-104px)] shrink-0 flex-col overflow-y-auto rounded-[16px] border bg-panel pb-2 pt-1 shadow-lg">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <span className="text-[13.5px] font-semibold">Git</span>
          <span
            title={`워크트리 ${treeCount}개`}
            className="text-[11.5px] text-tertiary"
          >
            트리 {treeCount}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 px-4 pb-3 pt-2.5 font-mono text-[12px] text-muted-foreground">
          <GitFork className="size-3 shrink-0 text-tertiary" strokeWidth={2} />
          <span className="truncate">{work.branch}</span>
          {bases.length > 0 && (
            <>
              <ArrowRight className="size-2.5 shrink-0 text-tertiary" strokeWidth={2} />
              <span className="shrink-0 text-tertiary">{bases.join(", ")}</span>
            </>
          )}
        </div>
        <div className="flex flex-col px-2 pb-2">
          <PathCopyRow label="작업 폴더" onCopy={() => onCopy(workDirRef(work.slug))} />
          {work.trees.map((t) => (
            <PathCopyRow
              key={t.project}
              label={`트리 · ${t.project}`}
              onCopy={() => onCopy(treeDirRef(t.path))}
            />
          ))}
        </div>
        <div className="mx-4 h-px bg-border" />
        <div className="flex items-center px-4 pb-0.5 pt-2">
          <span className="text-[13.5px] font-semibold">Spec</span>
        </div>
        <div className="flex flex-col px-2 pb-0.5 pt-1">
          {work.specFiles.length === 0 ? (
            <span className="px-2 py-1.5 text-[12.5px] text-tertiary">아직 spec 파일이 없어요</span>
          ) : (
            <SpecTree
              files={work.specFiles}
              current={currentFile}
              onSelect={onSelectFile}
              onCopy={(path) => onCopy(specRef(work.slug, path))}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

// 경로 복사 행 — 행 전체가 버튼, hover 시 복사 아이콘 (SpecTree 파일 행과 같은 패턴)
function PathCopyRow({ label, onCopy }: { label: string; onCopy: () => void }) {
  return (
    <button
      type="button"
      title="경로 복사"
      onClick={onCopy}
      className="group flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Copy
        className="size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
        strokeWidth={1.8}
      />
    </button>
  );
}

export default WorkPanel;

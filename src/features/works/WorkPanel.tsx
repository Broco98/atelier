import { ArrowRight, GitFork } from "lucide-react";
import { useProjects } from "@/features/projects/hooks";
import SpecTree from "./SpecTree";
import type { WorkView } from "./types";

interface WorkPanelProps {
  work: WorkView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  onCopyPath: (path: string) => void;
}

// 목업 S5t 작업 패널 — Git 요약 + Spec 파일 트리. PR 연동 카드는 v2.
function WorkPanel({ work, currentFile, onSelectFile, onCopyPath }: WorkPanelProps) {
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
    <aside className="absolute right-0 top-0 z-10 flex max-h-full w-[296px] flex-col overflow-y-auto p-4">
      <div className="flex shrink-0 flex-col rounded-[16px] border bg-panel pb-2 pt-1 shadow-lg">
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
              onCopy={onCopyPath}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

export default WorkPanel;

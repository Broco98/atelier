import { ArrowRight, Copy, GitFork } from "lucide-react";
import { cn } from "@/lib/utils";
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
  // 닫히는 중 — 부모가 언마운트를 늦춰 퇴장 애니메이션을 재생시킨다 (PANEL_ANIM_MS).
  closing?: boolean;
}

// 등장·퇴장 애니메이션 길이. SpecViewer의 언마운트 지연과 같은 값을 써야 한다.
export const PANEL_ANIM_MS = 260;

// 목업 S5t 작업 패널 — Git 요약 + Spec 파일 트리. PR 연동 카드는 v2.
function WorkPanel({ work, currentFile, onSelectFile, onCopy, closing }: WorkPanelProps) {
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
    // 본문 스크롤 영역의 형제라 전체 높이를 차지한다 — 화면 고정도 높이 상한도 필요 없다.
    // 떠 있는 카드가 아니라 영역을 차지하는 surface다 — 그림자 대신 배경과 옅은 경계선으로 본문과 구분한다.
    <aside
      className={cn(
        "flex w-[296px] shrink-0 origin-top-right flex-col p-4 pl-0",
        closing
          ? "animate-[panel-fade-out_260ms_cubic-bezier(0.4,0,1,1)_both]"
          : "animate-[panel-fade_260ms_cubic-bezier(0.22,1,0.36,1)_both]",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border bg-panel pb-2 pt-1">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <span className="text-[13.5px] font-semibold">Git</span>
          {/* 셀 수 있는 트리가 있을 때만 — 브랜치 유무와는 별개다 */}
          {work.trees.length > 0 && (
            <span
              title={`워크트리 ${treeCount}개`}
              className="text-[11.5px] text-tertiary"
            >
              트리 {treeCount}
            </span>
          )}
        </div>
        {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다 */}
        {work.branch === null ? (
          <div className="px-4 pb-3 pt-2 text-[12px] leading-normal text-tertiary">
            아직 프로젝트가 없어요. 프로젝트를 붙이면 브랜치가 정해져요.
          </div>
        ) : (
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
        )}
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
        {/* 세로 스크롤은 여기까지 — Git 요약과 Spec 머리글은 고정되어 항상 보인다 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
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

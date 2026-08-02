import { useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, GitFork } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjects } from "@/features/projects/hooks";
import { specRef, worktreeDirRef, workDirRef } from "./refs";
import SpecSection from "./SpecSection";
import type { WorkView } from "./types";

interface WorkPanelProps {
  work: WorkView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
  // 펼쳐져 있는가. 접힘은 폭 트랜지션이라 패널은 언제나 마운트된 채다.
  open: boolean;
}

// 목업 S5t 작업 패널 — Git 요약 + Spec 파일 트리. PR 연동 카드는 v2.
function WorkPanel({ work, currentFile, onSelectFile, onCopy, open }: WorkPanelProps) {
  const { data: projects = [] } = useProjects();
  // 폭 접기는 패널을 언마운트하지 않는다. 그런데 **"스펙 트리의 폴더 접힘은 패널 토글을
  // 넘어 살지 않는다"** 는 계약이 그 언마운트에 기대고 있었으므로, 접힐 때 안쪽만 새로
  // 세워 그 일을 대신한다.
  //
  // **다시 세우는 것은 안쪽뿐이다.** 바깥 aside까지 key로 갈면 새 요소의 첫 계산 스타일이
  // 이미 w-0·opacity-0이라 트랜지션이 출발할 자리가 없어져 패널이 뚝 끊긴다 —
  // CSS 트랜지션은 요소의 초기 스타일에서는 돌지 않는다.
  //
  // 열려 있다가 닫힐 때만 센다. 닫힌 채로 마운트되는 경로(패널을 접어 둔 채 다른 작업으로
  // 옮기기)에서 공짜로 한 번 더 세지 않게 한다.
  const [treeGeneration, setTreeGeneration] = useState(0);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setTreeGeneration((n) => n + 1);
    wasOpen.current = open;
  }, [open]);
  const bases = [
    ...new Set(
      work.projects
        .map((p) => projects.find((x) => x.slug === p)?.baseBranch)
        .filter((b): b is string => Boolean(b)),
    ),
  ];
  const worktreeCount = work.worktrees.filter((t) => t.exists).length;

  return (
    // 레이아웃 영역을 차지하는 우측 컬럼 (2026-07-19 사용자 정정).
    // 본문 스크롤 영역의 형제라 전체 높이를 차지한다 — 화면 고정도 높이 상한도 필요 없다.
    // 떠 있는 카드가 아니라 영역을 차지하는 surface다 — 그림자 대신 배경과 옅은 경계선으로 본문과 구분한다.
    <aside
      // 폭은 한 곳에만 적는다 — 바깥이 접히는 폭이고 안쪽이 그 폭으로 버틴다.
      // 둘이 갈리면 접히는 동안 글이 되흐른다 (목록 패널 둘과 같은 방식).
      //
      // 이름이 --panel-width가 아닌 이유: 목록 패널 둘은 그 이름으로 **드래그해 바꾼 폭**을
      // 담는다. 상속되는 값이라 같은 이름을 쓰면 어느 쪽이 이겼는지가 위치에 달리게 된다.
      // 사이드바가 자기 키(--sidebar-width)를 따로 갖는 것과 같은 이유다.
      style={{ "--work-panel-width": "296px" } as React.CSSProperties}
      className={cn(
        // 좌측 사이드바·목록 패널과 **같은 폭 접기**다: 넘침을 감춘 상자의 폭을 0으로 보내고
        // 안쪽은 고정 폭을 유지한다. 220ms·--ease-panel도 그쪽과 같은 값을 읽는다.
        //
        // 다른 점은 테두리 하나뿐이다. 저쪽은 aside가 구분선을 그려서 접을 때 border-color와
        // border-r-0까지 함께 보내야 하지만(그 1px이 남으면 폭 바닥이 0이 아니다), 이 패널의
        // 테두리는 안쪽 카드에 있어 폭과 함께 사라진다. 그래서 트랜지션 목록이 width 하나다.
        //
        // translateX로 옆으로 밀어내는 방식은 **이미 실패한 길이다** — 패널이 본문 스크롤
        // 영역의 형제가 된 뒤로 제 상자 밖 넘침을 문서가 받아, 애니메이션이 도는 동안
        // 가로 스크롤이 깜빡인다. 다시 시도하지 말 것.
        "shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-panel",
        open ? "w-(--work-panel-width)" : "w-0",
      )}
    >
      {/* 폭이 도는 동안 글이 되흐르지 않도록 안쪽은 고정 폭이다 */}
      <div
        className={cn(
          "flex h-full w-(--work-panel-width) flex-col p-4 pl-0 transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border bg-panel pb-2 pt-1">
          <div className="flex items-center justify-between gap-2 px-4 pt-3">
            <span className="text-[13.5px] font-semibold">Git</span>
            {/* 셀 수 있는 워크트리가 있을 때만 — 브랜치 유무와는 별개다.
                세는 것과 같은 값으로 판단한다: 선언된 프로젝트는 있는데 워크트리 생성이
                전부 실패한 work가 "worktree 0"을 내보이던 것을 막는다. */}
            {worktreeCount > 0 && (
              <span
                title={`worktree ${worktreeCount}개`}
                className="text-[11.5px] text-tertiary"
              >
                worktree {worktreeCount}
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
            {work.worktrees.map((t) => (
              <PathCopyRow
                key={t.project}
                label={`worktree · ${t.project}`}
                onCopy={() => onCopy(worktreeDirRef(t.path))}
              />
            ))}
          </div>
          <div className="mx-4 h-px bg-border" />
          <SpecSection
            key={treeGeneration}
            files={work.specFiles}
            current={currentFile}
            onSelect={onSelectFile}
            onCopy={(path) => onCopy(specRef(work.slug, path))}
          />
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
      className="group flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-state-1"
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

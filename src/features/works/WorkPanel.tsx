import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth, { ResizeHandle } from "@/components/shell/useResizableWidth";
import { useProjects } from "@/features/projects/hooks";
import { specRef } from "./refs";
import SpecSection from "./SpecSection";
import WorkInfo, { type ProjectBase } from "./WorkInfo";
import type { WorkView } from "./types";

interface WorkPanelProps {
  work: WorkView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
  // 탭 바 오른쪽 끝의 ×가 부른다. 헤더의 여는 아이콘과 짝이라 여는 길과 닫는 길이
  // 각각 하나다 — 접기 단축키(⌘Enter)와 같은 state를 뒤집는다.
  onClose: () => void;
  // 정보 탭의 프로젝트 이름을 누르면 그 프로젝트 상세로 간다.
  onOpenProject: (slug: string) => void;
  // 펼쳐져 있는가. 접힘은 폭 트랜지션이라 패널은 언제나 마운트된 채다.
  open: boolean;
}

type PanelTab = "spec" | "info";

// 목업 S5t 작업 패널 — `spec | 정보` 두 탭. PR 연동 카드는 v2.
function WorkPanel({
  work,
  currentFile,
  onSelectFile,
  onCopy,
  onClose,
  onOpenProject,
  open,
}: WorkPanelProps) {
  const { data: projects } = useProjects();
  // 화면 오른쪽에 놓인 패널이다 — 핸들이 왼쪽 가장자리에 붙고 왼쪽으로 끌면 넓어진다.
  // 저장 키는 이 패널 전용이다: 목록 패널과 같은 키를 쓰면 폭 범위가 다른 둘이 서로를 덮는다.
  const size = useResizableWidth("work-panel-width", 296, 260, 520, "right");
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
  // 탭 선택도 여기 산다. "작업을 옮기면 spec으로 돌아온다"가 공짜로 따라오기 때문이다 —
  // 이 컴포넌트는 key={slug}가 걸린 SpecViewer 아래에 key 없이 놓여 함께 다시 세워진다.
  // 반대로 패널 접기는 언마운트가 아니라 폭 트랜지션이라, 탭은 접었다 펴도 유지된다.
  //
  // 트리 접힘과 수명이 다르다. 접힘 초기화는 아래 treeGeneration이 패널을 접을 때만
  // 올리고, 탭 전환은 그 계약에 들지 않는다 — 탭 전환은 같은 패널 안에서 잠시 다른 것을
  // 보는 일이고, 패널 접기는 이 패널을 끝냈다는 신호다.
  const [tab, setTab] = useState<PanelTab>("spec");
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setTreeGeneration((n) => n + 1);
    wasOpen.current = open;
  }, [open]);
  // 프로젝트별 base를 뽑아 정보 탭에 값으로 내려준다 — 그쪽은 순수 표현이라 스스로 조회하지
  // 않는다. 도는 것은 워크트리 목록 하나다(코어가 프로젝트에서 1:1로 만든다).
  //
  // **`= []` 기본값을 두지 않는다.** 두면 "목록이 아직 안 왔다"가 "등록이 하나도 없다"와
  // 완전히 같은 값이 되어, 화면이 로딩 중에도 "알 수 없다"를 내보인다. 이 화면은 프로젝트
  // 목록을 프리로드하지 않으므로 그 순간이 매번 실재한다.
  const bases: Record<string, ProjectBase> = Object.fromEntries(
    work.worktrees.map((worktree) => {
      const project = projects?.find((p) => p.slug === worktree.project);
      return [
        worktree.project,
        { base: project?.baseBranch ?? null, unregistered: projects !== undefined && !project },
      ];
    }),
  );

  return (
    // 레이아웃 영역을 차지하는 우측 컬럼 (2026-07-19 사용자 정정).
    // 본문 스크롤 영역의 형제라 전체 높이를 차지한다 — 화면 고정도 높이 상한도 필요 없다.
    // 떠 있는 카드가 아니라 영역을 차지하는 surface다 — 그림자 대신 배경과 옅은 경계선으로 본문과 구분한다.
    <aside
      // 폭은 한 곳에만 적는다 — 바깥이 접히는 폭이고 안쪽이 그 폭으로 버틴다.
      // 둘이 갈리면 접히는 동안 글이 되흐른다 (목록 패널 둘과 같은 방식).
      //
      // 이름이 --panel-width가 아닌 이유는 **상속 충돌 하나**다. 이 패널도 이제 드래그로
      // 폭이 바뀌니 "저쪽만 드래그해 바꾼 폭을 담는다"는 근거는 더 이상 없다. 남는 이유는
      // 상속뿐이다 — 같은 이름을 쓰면 어느 쪽이 이겼는지가 위치에 달리게 된다.
      // 사이드바가 자기 키(--sidebar-width)를 따로 갖는 것과 같은 이유다.
      style={{ "--work-panel-width": `${size.width}px` } as React.CSSProperties}
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
        //
        // relative는 폭 조절 핸들이 이 상자의 왼쪽 가장자리를 기준으로 서기 위한 것이다.
        "relative shrink-0 overflow-hidden",
        // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다 (목록 패널 둘과 같다)
        !size.dragging && "transition-[width] duration-[220ms] ease-panel",
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
          {/* 탭 바는 카드에 고정된다 — 세로 스크롤은 각 탭 안에서만 돈다.
              전환은 클릭뿐이고, 어느 탭을 보고 있는지는 주소에 넣지 않는다: 탭을 누를
              때마다 히스토리가 쌓여 문서 사이 뒤로가기를 묻어버린다. 주소를 정본으로
              삼은 대상은 **문서**이지 훑기 상태가 아니다 (이슈 #25). */}
          <div className="flex items-center gap-1 px-2 pb-1.5 pt-1.5">
            <TabButton label="spec" active={tab === "spec"} onClick={() => setTab("spec")} />
            <TabButton label="정보" active={tab === "info"} onClick={() => setTab("info")} />
            <button
              type="button"
              onClick={onClose}
              aria-label="작업 패널 접기"
              title="작업 패널 접기"
              className="icon-button-quiet ml-auto text-tertiary"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <div className="mx-4 h-px bg-border" />
          <TabPanel active={tab === "spec"}>
            <SpecSection
              key={treeGeneration}
              files={work.specFiles}
              current={currentFile}
              onSelect={onSelectFile}
              onCopy={(path) => onCopy(specRef(work.slug, path))}
            />
          </TabPanel>
          <TabPanel active={tab === "info"}>
            <WorkInfo
              work={work}
              bases={bases}
              onCopy={onCopy}
              onOpenProject={onOpenProject}
            />
          </TabPanel>
        </div>
      </div>

      {open && <ResizeHandle control={size} />}
    </aside>
  );
}

// 탭 하나 — 헤더의 [소스] 토글과 **같은 규격·같은 켜짐 어휘**를 읽는다. 새 토큰은 없다.
// quiet-hover는 꺼진 가지 안에만 둔다: toggle-on과 한 요소에 겹치면 hover 규칙이 두 벌이
// 되어 유틸리티 정렬 순서가 승자를 정한다 (index.css의 quiet-hover 주석).
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // 색만으로는 어느 쪽이 켜졌는지 접근성 트리에 드러나지 않는다. role="tab"을 쓰지
      // 않는 것은 그것이 화살표 키 이동까지 약속하기 때문이다 — 전환은 클릭뿐이다.
      aria-pressed={active}
      className={cn(
        "h-6 rounded-[8px] px-[9px] text-[12.5px] transition-colors",
        active ? "toggle-on" : "text-tertiary quiet-hover",
      )}
    >
      {label}
    </button>
  );
}

// 탭 하나의 내용. **보이지 않는 탭도 마운트된 채로 둔다** — 언마운트하면 정보를 보고
// spec으로 돌아왔을 때 접어둔 판이 도로 펴져 있다.
//
// display:contents인 것이 핵심이다. 평범한 div로 감싸면 자식의 flex-1이 패널 카드가
// 아니라 이 껍데기를 기준으로 잡혀 스크롤 경계가 카드에서 옮겨가고, 카드의 넘침 감춤에
// 트리가 잘린다 — 마크업만 보면 멀쩡하다. contents는 상자를 만들지 않아 자식이 카드의
// 직계 flex 자식으로 남는다. 감춤은 cn이 twMerge라 display 충돌을 알아서 정리한다.
function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={cn("contents", !active && "hidden")}>{children}</div>;
}

export default WorkPanel;

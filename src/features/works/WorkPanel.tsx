import { useEffect, useRef, useState } from "react";
import { CodeXml, X } from "lucide-react";
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
  // `</>`가 켜져 있는가 — **사람이 정한 값**이지 본문이 지금 무엇이냐가 아니다.
  // 그 둘은 비-md 파일에서 갈린다 (아래 sourceLocked).
  //
  // **이 패널은 그 상태를 소유하지 않는다.** 바꾸는 대상이 본문이라 주인은 SpecViewer이고
  // 여기에는 버튼만 산다 (결정 6). 그래서 패널을 닫으면 토글이 함께 사라져 그때의 보기가
  // 양방향으로 잠긴다 — 알고 받아들인 대가이고, 되돌리는 길은 패널을 다시 여는 것이다.
  sourceOn: boolean;
  // 토글이 잠겼는가. 비-md 파일은 이 토글과 **무관하게** 코드뷰로 고정되므로(결정 6),
  // 살아 있으면서 아무 일도 하지 않는 버튼이 되지 않게 흐리고 누를 수 없게 한다 (결정 21).
  sourceLocked: boolean;
  onToggleSource: () => void;
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
  sourceOn,
  sourceLocked,
  onToggleSource,
  open,
}: WorkPanelProps) {
  const { data: projects } = useProjects();
  // 화면 오른쪽에 놓인 패널이다 — 핸들이 왼쪽 가장자리에 붙고 왼쪽으로 끌면 넓어진다.
  // 저장 키는 이 패널 전용이다: 목록 패널과 같은 키를 쓰면 폭 범위가 다른 둘이 서로를 덮는다.
  // 기본 폭 330 — 296은 좁았다. 여기 들어오는 것이 **경로와 파일 이름**이라 꼬리가 잘리면
  // 판·티켓 문서가 서로 구분되지 않는다.
  //
  // **이 값은 계산이 아니라 사용자가 끌어서 고른 폭이다** (2026-08-17, 실측 326.38px을
  // 반올림). 한 번 420으로 올렸다가 사람이 그 자리에서 다시 줄인 값이라, 여기서 폭을
  // 조정할 때는 계산으로 덮지 말고 같은 방식으로 다시 물어볼 것.
  //
  // 참고로 본문이 버티는 폭은 이보다 넉넉하다 — 본문 열은 좌우 거터 48px씩(bodyColumn의
  // px-12)을 떼고 남는 폭에 글을 앉히므로, 창 1280·사이드바 280에서도 글자 자리가
  // 1280-280-330-96 = 574px 남는다. 최대 560은 목록 패널 둘과 같은 값이다.
  const size = useResizableWidth("work-panel-width", 330, 260, 560, "right");
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
          "flex h-full w-(--work-panel-width) flex-col transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        {/* **떠 있는 카드가 아니라 창 끝에서 끝까지 가는 컬럼이다.** 화면 머리행과 같은 층에
            서면서 바깥 여백과 둥근 모서리가 설 자리를 잃었다 — 창 위·아래 끝에서 카드가
            잘린 것처럼 보인다. 본문과의 구분은 왼쪽 경계선 하나가 맡는다 (사이드바와 같은 방식). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l bg-background pb-2">
          {/* 탭 바는 카드에 고정된다 — 세로 스크롤은 각 탭 안에서만 돈다.
              전환은 클릭뿐이고, 어느 탭을 보고 있는지는 주소에 넣지 않는다: 탭을 누를
              때마다 히스토리가 쌓여 문서 사이 뒤로가기를 묻어버린다. 주소를 정본으로
              삼은 대상은 **문서**이지 훑기 상태가 아니다 (이슈 #25). */}
          {/* 높이는 **타이틀바 높이를 그대로 읽는다** — 이 행과 화면 브레드크럼이 같은 층에
              나란히 서므로, 값을 손으로 적으면 그 높이가 바뀔 때 여기만 남아 어긋난다.
              드래그 영역인 것도 같은 이유다: 이 행이 없으면 창 오른쪽 위 296px로는
              창을 끌 수 없다 (PageHeader가 같은 속성을 단다). */}
          <div
            data-tauri-drag-region
            className="flex h-(--titlebar-height) shrink-0 items-center gap-1 px-2"
          >
            <TabButton label="spec" active={tab === "spec"} onClick={() => setTab("spec")} />
            <TabButton label="정보" active={tab === "info"} onClick={() => setTab("info")} />
            {/* `</>` — 이 버튼만 **왼쪽 본문**을 바꾼다. 나머지는 전부 이 패널의 일이다.
                규격은 icon-button 그대로이고 켜짐만 기존 toggle-on을 읽는다 — 새 토큰은
                없다. quiet-hover를 꺼진 가지 안에만 두는 이유는 아래 TabButton과 같다.

                **켜짐은 본문이 지금 소스냐가 아니라 사람이 정한 값이다.** 비-md 파일이
                코드뷰로 고정되는 것까지 켜짐으로 그리면, 트리에서 md와 비-md를 오갈 때마다
                누른 적도 없는 버튼이 저 혼자 켜졌다 꺼진다. 결정 6이 그 고정을 토글과
                **무관하다**고 적은 것도 같은 말이다 — 잠김을 말하는 것은 흐림이지 켜짐이 아니다.

                잠김은 흐림과 포인터 차단이 **함께** 간다. 흐리게만 하면 눌리는데 아무 일도
                일어나지 않는 오늘 그대로이고, 결정 21이 없애려는 것이 바로 그 어긋남이다.
                왜 잠겼는지를 title로 말할 수는 없다 — pointer-events가 꺼져 있으면 hover가
                성립하지 않아 네이티브 툴팁이 뜨지 않는다. 흐림과 코드뷰로 바뀐 본문이 그 말을 한다. */}
            <button
              type="button"
              onClick={onToggleSource}
              disabled={sourceLocked}
              aria-label="마크다운 원문 보기"
              aria-pressed={sourceOn}
              title="마크다운 원문 보기"
              className={cn(
                "icon-button ml-auto transition-colors",
                "disabled:pointer-events-none disabled:opacity-40",
                sourceOn ? "toggle-on" : "text-tertiary quiet-hover",
              )}
            >
              <CodeXml className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="작업 패널 접기"
              title="작업 패널 접기"
              className="icon-button-quiet text-tertiary"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
          {/* 머리행 아래에 선이 없다. 이 행은 화면 브레드크럼과 **같은 층**인데 그쪽이
              "아래 경계선이 없다 — 화면이 선으로 잘리지 않고 본문으로 이어진다"를 이미
              정해 뒀다 (PageHeader). 나란히 선 두 행 중 하나만 밑줄을 그으면 그 층이
              반쪽만 잘린 것처럼 읽힌다. 본문과 패널의 구분은 왼쪽 경계선이 맡는다. */}
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

// 탭 하나 — 켜짐은 저장소 공통 toggle-on, 꺼짐은 text-tertiary + quiet-hover다. 새 토큰은 없다.
// 규격(h-6 · rounded-8 · 12.5px)은 이 화면 헤더에 있던 [소스] 토글에서 왔고 그 버튼은 없어졌다.
// **그렇다고 규격을 정하는 곳이 여기 하나인 것은 아니다** — 같은 문자열이 분기까지 통째로
// ArchivePage의 [소스] 토글에 한 벌 더 있다. 아카이브에는 작업 패널이 없어 `</>`를 올릴
// 자리가 없었고, 그래서 옮기지 못했다. 규격을 고치려면 두 곳을 함께 고쳐야 한다.
// state-scale.test.ts는 이 중복을 잡지 못한다 — 그 정규식은 quiet-hover 손복사만 본다.
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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Info } from "lucide-react";
import { CardHead } from "@/components/shell/Frame";
import type { RailItem } from "@/components/shell/Rail";
import { useProjects } from "@/features/projects/hooks";
import { specRef } from "./refs";
import SpecTree from "./SpecTree";
import WorkInfo, { type ProjectBase } from "./WorkInfo";
import type { SpecTreeItem, WorkView } from "./types";

/** 레일에서 고르는 작업 패널의 칸 — 이 패널이 그리는 몸 하나씩이다. */
export type PanelView = "spec" | "info";

/**
 * 레일의 칸 목록(ui-refresh 결정 10) — 순서가 레일의 위에서 아래다. 몸을 그리는 이 파일이 칸도 함께 든다: 칸이 하나 늘면
 * 몸도 하나 는다(git-integration이 files · changes를 한 줄씩 더한다). 라벨은 소문자 영어다(결정 41 — 탭 줄의 `spec`과 한 가족).
 */
export const PANEL_VIEWS: readonly RailItem<PanelView>[] = [
  { id: "spec", label: "spec", icon: FileText },
  { id: "info", label: "info", icon: Info },
];

interface WorkPanelProps {
  work: WorkView;
  // 레일에서 고른 칸. 주인은 화면(`WorksPage`)이다 — 고르고 여닫는 자리(레일 · 패널 토글)가 패널 밖에 서서(ui-refresh
  // 결정 9 · 10) 이 패널은 받은 칸을 그리기만 한다.
  view: PanelView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
  // info 몸의 프로젝트 이름을 누르면 그 프로젝트 상세로 간다.
  onOpenProject: (slug: string) => void;
  // 펼쳐져 있는가. 접힘은 폭 트랜지션이라(공용 틀의 패널 칸) 패널은 언제나 마운트된 채다.
  open: boolean;
}

// 작업 패널 — `spec` · `info` 두 몸. 가운데 `shell` 탭이 있었는데, 셸을 고르는 자리가
// **사이드바 가지로 갔다**(결정 71). 같은 것을 두 자리에서 고르게 두면 어느 쪽이 지금인지가
// 화면마다 갈린다. PR 연동 카드는 v2.
//
// **카드 안만 그린다**(ui-refresh 결정 4 · 27). 바깥 상자(두 번째 `aside`) · 카드 · 왼쪽 틈 · 폭 손잡이 · 접힘은 공용 틀(`Frame`)의
// 패널 칸이 들고, 폭 훅은 화면(`WorksPage`)이 불러 그 칸에 건넨다 — 목록 칸과 같은 나눔이다. 칸을 고르고 여닫는 레일도 그 틀의
// 레일 열이다.
function WorkPanel({
  work,
  view,
  currentFile,
  onSelectFile,
  onCopy,
  onOpenProject,
  open,
}: WorkPanelProps) {
  const { data: projects } = useProjects();
  // 폭 접기는 패널을 언마운트하지 않는다. 그런데 **"스펙 트리의 폴더 접힘은 패널 토글을
  // 넘어 살지 않는다"** 는 계약이 그 언마운트에 기대고 있었으므로, 접힐 때 안쪽만 새로
  // 세워 그 일을 대신한다.
  //
  // **다시 세우는 것은 안쪽뿐이다.** 바깥 상자까지 key로 갈면 새 요소의 첫 계산 스타일이
  // 이미 접힌 폭이라 트랜지션이 출발할 자리가 없어져 패널이 뚝 끊긴다 —
  // CSS 트랜지션은 요소의 초기 스타일에서는 돌지 않는다.
  //
  // 열려 있다가 닫힐 때만 센다. 닫힌 채로 마운트되는 경로(패널을 접어 둔 채 다른 작업으로
  // 옮기기)에서 공짜로 한 번 더 세지 않게 한다.
  //
  // **작업을 옮기는 것은 더 이상 접힘을 초기화하지 않는다**(결정 49). 한때 이 패널이
  // key={slug}인 SpecViewer 아래에 있어 함께 다시 세워졌는데, 화면으로 올라오면서 그
  // 리마운트가 사라졌다. 감수한다 — 접힘 기억의 키가 **폴더의 spec 기준 경로**라 경로가
  // 완전히 같을 때만 물려받고, 판 폴더는 대부분 기억에 없는 이름이라 기본값(최신 판만 펼침)으로
  // 뜬다.
  const [treeGeneration, setTreeGeneration] = useState(0);
  // 고른 칸(`view`)은 화면(`WorksPage`)이 든다 — 레일이 패널 밖에 서면서 열림 옆으로 올라갔다(ui-refresh 판 04). 트리 접힘과
  // 수명이 다르다. 접힘 초기화는 아래 treeGeneration이 패널을 접을 때만 올리고, 칸 바꾸기는 그 계약에 들지 않는다 — 칸
  // 바꾸기는 같은 패널 안에서 잠시 다른 것을 보는 일이고, 패널 접기는 이 패널을 끝냈다는 신호다. 켜진 칸을 다시 눌러 닫는
  // 것도 접기다.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setTreeGeneration((n) => n + 1);
    wasOpen.current = open;
  }, [open]);
  // 프로젝트별 base를 뽑아 info 몸에 값으로 내려준다 — 그쪽은 순수 표현이라 스스로 조회하지
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
        // **`??`가 아니라 `||`다.** 빈 문자열도 "말할 base가 없다"로 접는다 — 코어가 빈
        // base_branch를 막지 않아서(atelier_edit_project에 검증이 없다) ""가 여기 닿을 수
        // 있고, `??`는 그것을 통과시킨다. 그러면 info 몸은 `base !== null`이 참이라 뒤에
        // 아무것도 없는 → 글리프만 그리고, ⓘ 팝오버는 truthy로 봐서 꼬리를 안 그린다.
        // 한 값이 두 화면에서 달리 읽히는 자리라, 값을 정하는 **이 한 곳**에서 접는다.
        { base: project?.baseBranch || null, unregistered: projects !== undefined && !project },
      ];
    }),
  );

  return (
    // 패널 카드의 몸 — 머리와 두 몸이 이 뿌리의 직계 자식으로 선다. 몸의 상자는 `contents`라(아래 `PanelBody`) 안의 스크롤
    // 상자가 이 뿌리의 flex 자식으로 남는다(SpecTab 머리말의 계약).
    //
    // 어느 칸을 보고 있는지는 주소에 넣지 않는다: 칸을 바꿀 때마다 히스토리가 쌓여 문서 사이 뒤로가기를 묻어버린다. 주소를
    // 정본으로 삼은 대상은 **문서**이지 훑기 상태가 아니다 (이슈 #25).
    <div className="flex min-h-0 flex-1 flex-col pb-2">
      {/* 머리는 카드 머리(48px)다(ui-refresh 결정 5) — 카드 안이라 창 끌기 자리가 아니다(바탕 줄과 회색 틈이 그 일을 한다).
          머리는 카드에 고정되고 세로 스크롤은 각 몸 안에서만 돈다. 아래에 선이 없다 — 카드 머리는 선으로 몸과 갈리지 않는다.

          **든 것은 고른 칸의 제목 하나다**(ui-refresh 결정 9 · 10 · 33). `spec | info` 탭은 레일로, 닫는 `×`는 레일 맨 위의 패널
          토글로 나갔다 — 같은 일을 하는 컨트롤이 한 화면에 둘이 서지 않는다. 프로토타입 머리의 「문서 16」은 info에 이미 있는
          수라 싣지 않는다. 제목은 카드 제목 규격(13px · 600, DS `.at-card-title`)이고 글자가 카드 안 여백에 선다(머리 여백 + 14).
          라벨은 소문자 영어다(결정 41) — 레일 · 탭 줄의 `spec`과 같은 어휘다. 문장 속 한국어는 그대로다(CONTEXT.md).

          문서/원문 전환은 여기 없다 — 그 컨트롤이 바꾸는 것은 왼쪽 문서라 **문서 카드 머리**로 갔다(ui-refresh 판 04). */}
      <CardHead>
        <span className="pl-3.5 text-ui font-semibold">{view}</span>
      </CardHead>
      {/* **보이지 않는 몸도 마운트된 채로 둔다**(결정 9) — 언마운트하면 info를 보고 spec으로 돌아왔을 때 접어 둔 판·폴더가
          도로 펴져 있다. 한때 탭 패널의 `keepMounted`가 지키던 것을 이제 몸의 상자가 직접 지킨다. */}
      <PanelBody view="spec" shown={view === "spec"}>
        <SpecTab
          key={treeGeneration}
          items={work.specTree.items}
          current={currentFile}
          onSelect={onSelectFile}
          onCopy={(path) => onCopy(specRef(work.slug, path))}
        />
      </PanelBody>
      <PanelBody view="info" shown={view === "info"}>
        <WorkInfo
          work={work}
          bases={bases}
          onCopy={onCopy}
          onOpenProject={onOpenProject}
        />
      </PanelBody>
    </div>
  );
}

/**
 * 몸 하나의 상자. **제 상자가 없다**(`contents`) — 안의 스크롤 상자가 패널 몸의 직계 flex 자식으로 남아야 해서다(SpecTab
 * 머리말의 계약). 안 보이는 몸은 `hidden`과 `inert`로 가린다: `hidden`은 preflight의 `display: none !important`로 `contents`를
 * 이겨 화면과 접근성 트리에서 빠지고, `inert`는 그 안으로 포커스 · 찾기가 들어가지 못하게 한다(한때 Base UI 탭 패널이 그
 * 둘을 달았다). 표식(`data-panel-view`)은 검사가 몸을 정체성으로 집는 고리다.
 */
function PanelBody({ view, shown, children }: { view: PanelView; shown: boolean; children: ReactNode }) {
  return (
    <div data-panel-view={view} hidden={!shown} inert={!shown} className="contents">
      {children}
    </div>
  );
}

// spec 몸 — 이 work의 spec 트리 하나다. 머리글은 바로 위 머리 제목이 이미 `spec`이라 없앴다(결정 23).
//
// **work 응답에 실려 온 spec 트리를 그리기만 한다**(spec 레이아웃 결정 13). 판 구획(`Iterations N`)과
// 판 밖 구획(`Documents`)이 사라지고(spec 레이아웃 결정 24) 레이아웃 순서의 트리 하나가 선다 — 판 폴더는 내장본
// 기준 `overview.md` 다음 자리에 최신이 위로 선다. 레이아웃이 물러섰어도 여기서는 말하지 않는다.
// 트리는 이미 내장본으로 갈려 왔고, 알리는 곳은 설정 페이지다(spec 레이아웃 구현 스펙 4절).
//
// **돌려주는 스크롤 영역이 패널 몸(WorkPanel 뿌리)의 직계 flex 자식이어야 한다** — 그것이 계약이다.
// 머리는 카드에 고정되고 트리만 세로로 스크롤한다. 한 겹 감싸면 flex-1이 패널 몸이 아니라
// 그 껍데기를 기준으로 잡혀 경계가 옮겨가고, 카드의 넘침 감춤에 트리가 잘린다.
// 몸의 상자(`PanelBody`)가 제 상자 없이(display:contents) 서는 이유가 그것이다.
function SpecTab({
  items,
  current,
  onSelect,
  onCopy,
}: {
  items: SpecTreeItem[];
  current: string | null;
  onSelect: (path: string) => void;
  // spec 폴더 기준 상대 경로를 받는다 — 참조 문자열 조립은 호출부가 한다.
  onCopy: (path: string) => void;
}) {
  return (
    // 세로 스크롤은 여기까지 — 머리는 패널 카드에 고정되어 항상 보인다
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
      {items.length === 0 ? (
        <span className="px-2 py-1.5 text-ui text-tertiary">아직 spec 파일이 없어요</span>
      ) : (
        <SpecTree items={items} current={current} onSelect={onSelect} onCopy={onCopy} />
      )}
    </div>
  );
}

export default WorkPanel;

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CardHead } from "@/components/shell/Frame";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hint } from "@/components/ui/tooltip";
import { useProjects } from "@/features/projects/hooks";
import { specRef } from "./refs";
import SpecTree from "./SpecTree";
import WorkInfo, { type ProjectBase } from "./WorkInfo";
import type { SpecTreeItem, WorkView } from "./types";

interface WorkPanelProps {
  work: WorkView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
  // 패널 머리 오른쪽 끝의 ×가 부른다. 바탕 줄의 여는 아이콘과 짝이라 여는 길과 닫는 길이
  // 각각 하나다 — 접기 단축키(⌘Enter)와 같은 state를 뒤집는다.
  onClose: () => void;
  // 정보 탭의 프로젝트 이름을 누르면 그 프로젝트 상세로 간다.
  onOpenProject: (slug: string) => void;
  // 펼쳐져 있는가. 접힘은 폭 트랜지션이라(공용 틀의 패널 칸) 패널은 언제나 마운트된 채다.
  open: boolean;
}

type PanelTab = "spec" | "info";

// 작업 패널 — `spec | info` 두 탭. 가운데 `shell` 탭이 있었는데, 셸을 고르는 자리가
// **사이드바 가지로 갔다**(결정 71). 같은 것을 두 자리에서 고르게 두면 어느 쪽이 지금인지가
// 화면마다 갈린다. PR 연동 카드는 v2.
//
// **카드 안만 그린다**(ui-refresh 결정 4 · 27). 바깥 상자(두 번째 `aside`) · 카드 · 왼쪽 틈 · 폭 손잡이 · 접힘은 공용 틀(`Frame`)의
// 패널 칸이 들고, 폭 훅은 화면(`WorksPage`)이 불러 그 칸에 건넨다 — 목록 칸과 같은 나눔이다.
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
  // 탭 선택은 여기 산다. **그리고 이제 작업을 옮겨도 유지된다**(결정 49).
  //
  // 한때 "작업을 옮기면 spec으로 돌아온다"(앞 판 결정 4)가 공짜로 따라왔다 — 이 컴포넌트가
  // key={slug}가 걸린 SpecViewer 아래에 key 없이 놓여 함께 다시 세워졌기 때문이다. 그것은
  // 코드가 아니라 **구조에서 나온 성질**이었고, 패널이 화면(WorksPage)으로 올라가면서
  // 사라졌다. 되살리지 않는다 — 되살리려면 여기에 없던 key를 새로 줘야 한다.
  //
  // 패널 접기는 언마운트가 아니라 폭 트랜지션이라, 탭은 접었다 펴도 유지된다. 뷰 탭
  // 왕복(spec ↔ terminal)에도 유지된다 — 호출부가 하나라 인스턴스도 하나다.
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
        // **`??`가 아니라 `||`다.** 빈 문자열도 "말할 base가 없다"로 접는다 — 코어가 빈
        // base_branch를 막지 않아서(atelier_edit_project에 검증이 없다) ""가 여기 닿을 수
        // 있고, `??`는 그것을 통과시킨다. 그러면 정보 탭은 `base !== null`이 참이라 뒤에
        // 아무것도 없는 → 글리프만 그리고, ⓘ 팝오버는 truthy로 봐서 꼬리를 안 그린다.
        // 한 값이 두 화면에서 달리 읽히는 자리라, 값을 정하는 **이 한 곳**에서 접는다.
        { base: project?.baseBranch || null, unregistered: projects !== undefined && !project },
      ];
    }),
  );

  return (
    // 패널 카드의 몸이 곧 Tabs의 뿌리다 — 머리와 두 패널이 그 직계 자식으로 선다. 패널은 상자가 없어서(`TabsContent`의
    // contents) 안의 스크롤 상자가 이 뿌리의 flex 자식으로 남는다(SpecTab 머리말의 계약).
    //
    // 어느 탭을 보고 있는지는 주소에 넣지 않는다: 탭을 바꿀 때마다 히스토리가 쌓여 문서 사이 뒤로가기를 묻어버린다. 주소를
    // 정본으로 삼은 대상은 **문서**이지 훑기 상태가 아니다 (이슈 #25).
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 pb-2">
      {/* 머리는 카드 머리(48px)다(ui-refresh 결정 5) — 카드 안이라 창 끌기 자리가 아니다(바탕 줄과 회색 틈이 그 일을 한다).
          탭 바는 카드에 고정되고 세로 스크롤은 각 탭 안에서만 돈다. 아래에 선이 없다 — 카드 머리는 선으로 몸과 갈리지 않는다.

          탭은 스크린리더에 탭으로 읽히고 ←/→로 옮긴다(결정 9). 옮기면 곧바로 켜진다(S18) — 두 패널이 이미 마운트돼 있어
          바로 바뀌어도 싸다. 라벨은 소문자 영어다(결정 41) — 탭 줄의 `spec`과 같은 어휘여야 한 층으로 읽힌다. 문장 속
          한국어는 그대로다(CONTEXT.md).

          문서/원문 전환은 여기 없다 — 그 컨트롤이 바꾸는 것은 왼쪽 문서라 **문서 카드 머리**로 갔다(ui-refresh 판 04). */}
      <CardHead
        end={
          <Hint
            text="작업 패널 접기"
            announce="name"
            type="button"
            onClick={onClose}
            className="icon-button-quiet text-tertiary"
          >
            <X className="size-4" strokeWidth={2} />
          </Hint>
        }
      >
        <TabsList activateOnFocus>
          <TabsTrigger value="spec">spec</TabsTrigger>
          <TabsTrigger value="info">info</TabsTrigger>
        </TabsList>
      </CardHead>
      {/* **보이지 않는 탭도 마운트된 채로 둔다**(`keepMounted`, 결정 9) — 언마운트하면 info를
          보고 spec으로 돌아왔을 때 접어 둔 판·폴더가 도로 펴져 있다. 숨은 패널은 Base UI가
          `hidden`과 `inert`로 가린다. */}
      <TabsContent value="spec" keepMounted>
        <SpecTab
          key={treeGeneration}
          items={work.specTree.items}
          current={currentFile}
          onSelect={onSelectFile}
          onCopy={(path) => onCopy(specRef(work.slug, path))}
        />
      </TabsContent>
      <TabsContent value="info" keepMounted>
        <WorkInfo
          work={work}
          bases={bases}
          onCopy={onCopy}
          onOpenProject={onOpenProject}
        />
      </TabsContent>
    </Tabs>
  );
}

// spec 탭 — 이 work의 spec 트리 하나다. 머리글은 바로 위 탭이 이미 `spec`이라 없앴다(결정 23).
//
// **work 응답에 실려 온 spec 트리를 그리기만 한다**(spec 레이아웃 결정 13). 판 구획(`Iterations N`)과
// 판 밖 구획(`Documents`)이 사라지고(spec 레이아웃 결정 24) 레이아웃 순서의 트리 하나가 선다 — 판 폴더는 내장본
// 기준 `overview.md` 다음 자리에 최신이 위로 선다. 레이아웃이 물러섰어도 여기서는 말하지 않는다.
// 트리는 이미 내장본으로 갈려 왔고, 알리는 곳은 설정 페이지다(spec 레이아웃 구현 스펙 4절).
//
// **돌려주는 스크롤 영역이 패널 몸(Tabs 뿌리)의 직계 flex 자식이어야 한다** — 그것이 계약이다.
// 탭 바는 카드에 고정되고 트리만 세로로 스크롤한다. 한 겹 감싸면 flex-1이 패널 몸이 아니라
// 그 껍데기를 기준으로 잡혀 경계가 옮겨가고, 카드의 넘침 감춤에 트리가 잘린다.
// 탭 패널(`TabsContent`, `tabs.tsx`)이 제 상자 없이(display:contents) 서는 이유가 그것이다.
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
    // 세로 스크롤은 여기까지 — 탭 바는 패널 카드에 고정되어 항상 보인다
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

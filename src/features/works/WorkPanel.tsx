import { FolderOpen } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { specRef } from "./refs";
import SpecTree from "./SpecTree";
import type { SpecTreeItem, WorkView } from "./types";

interface WorkPanelProps {
  work: WorkView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
  // 머리의 「spec 폴더 열기」 — 그 work의 spec 폴더를 Finder에서 연다. work 메뉴의 Finder ▸와 같은 명령이고(codex-ds 스펙 S6)
  // 못 열었을 때 알리는 것도 그쪽과 한 벌이라 화면(`WorksPage`)이 짓는다.
  onOpenFolder: () => void;
}

// spec 패널의 몸 — 이 work의 spec 트리 하나다(restart 02a-14). 한때 `spec` · `files` 두 몸이 레일의 칸마다 섰다(git-integration 판 01) —
// files 칸이 걷혀 워크트리 파일은 넓힌 카드의 Project 트리에서 연다(restart 02a-12). 그 앞에 `shell` 탭(결정 71 — 셸을 고르는 자리는
// 탭 줄이다)과 `info` 몸(codex-ds 결정 25)을 걷었다. PR 연동 카드는 v2.
//
// **카드 안만 그린다**(ui-refresh 결정 4 · 27). 바깥 상자(`aside`) · 카드 · 왼쪽 틈 · 폭 손잡이 · 접힘은 앱 셸의 작업공간 도구 기둥이
// 들고(`WorkTools`), 이 몸은 작업공간 화면이 그 기둥의 자리로 그린다. 여닫는 레일과 패널 토글도 패널 밖이다.
//
// **접어 둔 폴더는 패널을 여닫아도 그대로다**(스토리 83 · 시안 Shell 「닫아도 패널 몸은 언마운트하지 않아 접어 둔 폴더가 그대로예요」).
// 패널을 닫는 것은 폭 트랜지션이라 이 몸은 마운트된 채이고, 트리의 접힘은 트리가 든다(`SpecTree`). 한때 패널을 접을 때마다 트리를 새로
// 세워(`treeGeneration`) 접힘을 지웠다 — 「폴더 접힘은 패널 토글을 넘어 살지 않는다」던 계약을 이 스토리가 뒤집었다.
//
// **작업을 옮겨도 접힘이 남는다**(결정 49). 이 몸은 작업마다 새로 서지 않는다(`key`가 없다) — 접힘 기억의 키가 **폴더의 spec 기준
// 경로**라 경로가 완전히 같을 때만 물려받고, 판 폴더는 대부분 기억에 없는 이름이라 기본값(최신 판만 펼침)으로 뜬다. 작업공간을 떠나면
// 화면과 함께 내려가 접힘도 사라진다.
function WorkPanel({ work, currentFile, onSelectFile, onCopy, onOpenFolder }: WorkPanelProps) {
  return (
    // 패널 카드의 몸 — 머리와 스크롤 영역이 이 뿌리의 직계 자식으로 선다(SpecTab 머리말의 계약). 이 뿌리는 기둥의 자리(`contents`)를
    // 지나 패널 카드의 직계 flex 자식이다.
    //
    // 열린 문서는 주소가 정본이지만 트리를 훑는 상태(접힘 · 스크롤)는 주소에 넣지 않는다: 바꿀 때마다 히스토리가 쌓여 문서 사이 뒤로가기를
    // 묻어버린다(이슈 #25).
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리는 시안 Shell 「spec 패널」 · Main `.ra-phead`다(restart 03-12a) — 40 · 안쪽 왼 14 · 오 8, 제목이 카드 + 14에 선다. 카드 안이라 창
          끌기 자리가 아니다(머리 줄과 회색 틈이 그 일을 한다). 머리는 카드에 고정되고 세로 스크롤은 몸 안에서만 돈다. 한때 카드 머리
          46(`--card-head` — codex-ds 스펙 §4 「패널 머리」) · 제목 카드 + 16이었다. 표식 `data-slot="card-head"`는 카드 머리와 같다 — 검사가
          머리를 그것으로 집는다.

          **든 것은 이름 `spec`과 그 할 일이다**(codex-ds 스펙 §6 「작업공간 패널」). 여는 레일 칸과 닫는 패널 토글은 패널 밖이다(ui-refresh
          결정 9 · 10) — 같은 일을 하는 컨트롤이 한 화면에 둘이 서지 않는다. 이름은 14/20 · 500이다(시안 `.ttl` 15/20 — 앱 글자 단계에 15가
          없다). 라벨은 소문자 영어다(결정 41) — 레일 칸의 `spec`과 같은 어휘다.

          할 일은 spec 폴더 열기 하나다 — 시안의 끝 단추 자리(`.ra-tbtn` 24 · 둥글기 4 · 글리프 14 · `fg-secondary`)에 선다. 시안의 그
          자리는 「패널 메뉴」 ⋯이고 무엇을 담는지는 그리지 않는다 — 앱은 지금 할 일 하나를 그 모양으로 둔다. 문서/원문 전환은 여기 없다 — 그
          컨트롤이 바꾸는 것은 문서라 문서 위 경로 줄로 갔다(ui-refresh 판 04). */}
      <div data-slot="card-head" className="flex h-10 shrink-0 items-center gap-0.5 pr-2 pl-3.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">spec</span>
        <Hint
          text="spec 폴더 열기"
          announce="name"
          type="button"
          tabIndex={0}
          onClick={onOpenFolder}
          className="icon-button-quiet icon-button-xs icon-button-ctl text-fg-secondary focus-ring"
        >
          <FolderOpen className="size-3.5" />
        </Hint>
      </div>
      <SpecTab
        items={work.specTree.items}
        current={currentFile}
        onSelect={onSelectFile}
        onCopy={(path) => onCopy(specRef(work.slug, path))}
      />
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
// 기둥의 몸 자리(`WorkTools`의 `data-work-panel-body`)가 제 상자 없이(display:contents) 서는 이유가 그것이다.
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
    // 세로 스크롤은 여기까지 — 머리는 패널 카드에 고정되어 항상 보인다. 안쪽은 시안 `.ra-pbody`의 0 6 8이고, 행은 촘촘한 트리 행(시안
    // `.ra-tree-row` — 24 · 둥글기 4 · 사이 2 · 들여쓰기 8 + 깊이 × 12, 레이아웃이 아이콘을 주지 않은 파일은 확장자 글자)이라 글자가 카드 + 14에
    // 선다(restart 03-12a — 한때 안쪽 8 · 행 28 · 둥글기 10 · 사이 1, 글자 카드 + 16).
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2 scroll-quiet">
      {items.length === 0 ? (
        <span className="px-2 py-1.5 text-chat-meta text-fg-tertiary">아직 spec 파일이 없어요</span>
      ) : (
        <SpecTree items={items} current={current} onSelect={onSelect} onCopy={onCopy} dense />
      )}
    </div>
  );
}

export default WorkPanel;

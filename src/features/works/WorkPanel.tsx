import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, FolderTree } from "lucide-react";
import { CardHead } from "@/components/shell/Frame";
import { PanelBody, type RailItem } from "@/components/shell/Rail";
import { Hint } from "@/components/ui/tooltip";
import FilesTree, { FilesRefresh } from "@/features/files/FilesTree";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import { specRef } from "./refs";
import SpecTree from "./SpecTree";
import type { SpecTreeItem, WorkView } from "./types";

/** 레일에서 고르는 작업 패널의 칸 — 이 패널이 그리는 몸 하나씩이다. */
export type PanelView = "spec" | "files";

/**
 * 레일의 칸 목록(ui-refresh 결정 10) — 순서가 레일의 위에서 아래다. 몸을 그리는 이 파일이 칸도 함께 든다: 칸이 하나 늘면
 * 몸도 하나 는다(DS `PanelRail` — 대화 · files · changes가 한 줄씩 더해진다). 라벨은 소문자 영어다(결정 41 — 탭 줄의 `spec`과 한
 * 가족). `info` 칸은 걷었다(codex-ds 결정 25: 보기는 사이드바 행의 호버 카드가, 복사 · Finder 열기는 work 메뉴가 든다).
 *
 * `files`는 `spec` 뒤다(git-integration 결정 29 — spec · chat은 스펙 축, files · changes · git은 코드 축이라 붙여 둔다). 칸이 둘이라
 * 레일이 선다(`railStands`).
 */
export const PANEL_VIEWS: readonly RailItem<PanelView>[] = [
  { id: "spec", label: "spec", icon: FileText },
  { id: "files", label: "files", icon: FolderTree },
];

interface WorkPanelProps {
  work: WorkView;
  // 레일에서 고른 칸. 주인은 화면(`WorksPage`)이다 — 고르고 여닫는 자리(레일 · 패널 토글)가 패널 밖에 서서(ui-refresh
  // 결정 9 · 10) 이 패널은 받은 칸을 그리기만 한다.
  view: PanelView;
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  // 본문에 선 파일 탭 — files 트리가 그 행을 강조하고 따라간다(git-integration 스토리 14 · 15). 셸이나 문서가 서 있으면 `null`이다.
  currentCode: CodeTarget | null;
  // files 트리의 파일 행을 눌렀다(git-integration 결정 30). 열지 닫을지는 화면이 정한다 — 지금 보이는 탭과 닫는 길을 그쪽이 든다.
  onPressCode: (target: CodeTarget, clicks: number) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 참조 조립은 refs.ts가 담당.
  onCopy: (text: string) => void;
  // 머리의 「spec 폴더 열기」 — 그 work의 spec 폴더를 Finder에서 연다. work 메뉴의 Finder ▸와 같은 명령이고(codex-ds 스펙 S6)
  // 못 열었을 때 알리는 것도 그쪽과 한 벌이라 화면(`WorksPage`)이 짓는다.
  onOpenFolder: () => void;
  // 펼쳐져 있는가. 접힘은 폭 트랜지션이라(공용 틀의 패널 칸) 패널은 언제나 마운트된 채다.
  open: boolean;
}

// 작업 패널 — `spec` · `files` 두 몸. 가운데 `shell` 탭이 있었는데, 셸을 고르는 자리가 **사이드바 가지로 갔다**(결정 71). 같은 것을
// 두 자리에서 고르게 두면 어느 쪽이 지금인지가 화면마다 갈린다. `info` 몸도 있었다 — 같은 정보를 두 자리에서 보지 않게
// 걷었다(codex-ds 결정 25). PR 연동 카드는 v2.
//
// **카드 안만 그린다**(ui-refresh 결정 4 · 27). 바깥 상자(두 번째 `aside`) · 카드 · 왼쪽 틈 · 폭 손잡이 · 접힘은 공용 틀(`Frame`)의
// 패널 칸이 들고, 폭 훅은 화면(`WorksPage`)이 불러 그 칸에 건넨다 — 목록 칸과 같은 나눔이다. 칸을 고르는 레일과 여닫는 패널 토글도
// 그 틀의 것이다.
function WorkPanel({
  work,
  view,
  currentFile,
  onSelectFile,
  currentCode,
  onPressCode,
  onCopy,
  onOpenFolder,
  open,
}: WorkPanelProps) {
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

  return (
    // 패널 카드의 몸 — 머리와 몸이 이 뿌리의 직계 자식으로 선다. 몸의 상자는 `contents`라(레일의 `PanelBody`) 안의 스크롤
    // 상자가 이 뿌리의 flex 자식으로 남는다(SpecTab 머리말의 계약).
    //
    // 어느 칸을 보고 있는지는 주소에 넣지 않는다: 칸을 바꿀 때마다 히스토리가 쌓여 문서 사이 뒤로가기를 묻어버린다. 주소를
    // 정본으로 삼은 대상은 **문서**이지 훑기 상태가 아니다 (이슈 #25).
    <div className="flex min-h-0 flex-1 flex-col pb-2">
      {/* 머리는 패널 머리(46px — 카드 머리 `--card-head`)다(codex-ds 스펙 §4 「패널 머리」) — 카드 안이라 창 끌기 자리가 아니다(머리
          줄과 회색 틈이 그 일을 한다). 머리는 카드에 고정되고 세로 스크롤은 몸 안에서만 돈다.

          **든 것은 고른 칸의 이름과 그 칸의 할 일이다**(codex-ds 스펙 §6 「작업 패널」). 칸을 고르는 탭은 레일로, 닫는 `×`는 머리
          줄의 패널 토글로 나갔다(ui-refresh 결정 9 · 10) — 같은 일을 하는 컨트롤이 한 화면에 둘이 서지 않는다. 이름은 DS 패널 머리
          제목(`.at-panel-head .title` — 14/20 · 500)이고 글자가 카드 + 16에 선다(머리 여백 8 + 제목 안쪽 8 — 행 글자 16, codex-ds
          스펙 §4 「여백」). 라벨은 소문자 영어다(결정 41) — 탭 줄의 `spec`과 같은 어휘다. 문장 속 한국어는 그대로다(CONTEXT.md).

          `spec`의 할 일은 spec 폴더 열기 하나다 — DS 아이콘 버튼(`.at-ib` 28 · `fg-secondary`, hover `fill-hover`)이 머리 오른쪽
          끝에 선다. 문서/원문 전환은 여기 없다 — 그 컨트롤이 바꾸는 것은 왼쪽 문서라 문서 위 경로 줄로 갔다(ui-refresh 판 04).

          `files`의 할 일은 새로고침 하나다(git-integration 스토리 16) — 그 칸의 몸을 다시 읽는 것이라 몸의 머리에 선다. */}
      <CardHead
        end={
          view === "files" ? (
            <FilesRefresh slug={work.slug} />
          ) : (
            <Hint
              text="spec 폴더 열기"
              announce="name"
              type="button"
              onClick={onOpenFolder}
              className="icon-button-quiet text-fg-secondary focus-ring"
            >
              <FolderOpen className="size-4" />
            </Hint>
          )
        }
      >
        <span className="px-2 text-sm font-medium">{view}</span>
      </CardHead>
      {/* 몸은 칸마다 하나이고 고른 칸의 몸만 보인다(레일의 `PanelBody`). 보이지 않는 몸도 마운트된 채로 두는 것이 그 상자의
          계약이다(결정 9) — 칸이 더해지면 다녀와도 접어 둔 판 · 폴더가 그대로다(칸이 둘인 진열대에서 L3 `rail.spec.ts`가 잰다). */}
      <PanelBody view="spec" shown={view === "spec"}>
        <SpecTab
          key={treeGeneration}
          items={work.specTree.items}
          current={currentFile}
          onSelect={onSelectFile}
          onCopy={(path) => onCopy(specRef(work.slug, path))}
        />
      </PanelBody>
      {/* files 트리는 「트리 세대」를 타지 않는다(git-integration S14) — 접힘은 work · 프로젝트별 기억에 있고 패널 접기에
          리셋되지 않는다. 트리는 칸이 열려 보일 때만 읽는다(S9). */}
      <PanelBody view="files" shown={view === "files"}>
        <FilesTree work={work} visible={open && view === "files"} current={currentCode} onPress={onPressCode} />
      </PanelBody>
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
        <span className="px-2 py-1.5 text-chat-meta text-fg-tertiary">아직 spec 파일이 없어요</span>
      ) : (
        <SpecTree items={items} current={current} onSelect={onSelect} onCopy={onCopy} />
      )}
    </div>
  );
}

export default WorkPanel;

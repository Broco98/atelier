import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Store, useStore } from "@tanstack/react-store";
import { PanelBox } from "./Frame";
import { dropHeldBody, holdBody } from "./held-body";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, WORK_PANEL_WIDTH } from "./panel-layout";
import Rail from "./Rail";
import useResizableWidth, { type ResizableWidth } from "./useResizableWidth";

// **작업공간 도구** — 레일과 spec 패널(restart 02a-14 · 구현 스펙 「02a」 「레일과 패널은 작업공간에서만 서고 spec 한 칸만 있다」 · 스토리 80 ·
// 82 · 83 · 시안 Shell 「레일」 · 「어디에 서나」 · Main `.ra-panelwrap` · `.ra-rail` · Motion 「레일이 들고 난다」).
//
//   앱 셸의 카드 자리 ─ 화면(라우트) · spec 패널 상자(`aside`) · 레일 카드
//                                      └ 작업공간 화면이 몸을 그린다(포털 — `WorkTools`)
//
// **기둥은 앱 셸에 늘 서 있다**(`WorkToolsColumn`). 화면이 바뀌어도 그 자리 그대로라, 작업공간에 들어오면 폭 0에서 자라고 떠나면 같은 박자
// (500ms spring)로 접히는 것이 보인다 — 본문 카드가 그 폭을 같은 박자로 먹어 튀지 않는다. 한때 둘은 작업 화면의 틀(`Frame`)이 그렸다 —
// 화면과 함께 내려가 떠날 때 접힘 없이 사라졌다.
//
// **세우는 것은 작업공간 화면이다**(`WorkTools`) — 서 있는 동안 기둥의 값(패널 열림 · 여닫기 · 바쁨)을 적고(`showWorkTools`), 내려갈 때
// 지운다(`foldWorkTools`). 패널의 몸(spec 트리)은 그 화면이 기둥의 자리로 포털을 태워 그린다 — 머리 줄의 화면 자리(`ScreenHead`)와 같은
// 길이다. 몸의 상태(트리 접힘)는 화면에 산다. 패널을 닫아도 몸은 접힌 상자 안에 마운트된 채라 다시 열면 접어 둔 폴더가 그대로다.

/** spec 패널 상자의 id — 레일의 칸과 머리 줄의 패널 토글이 가리킨다(`aria-controls`). 앱에 하나다. */
export const WORK_PANEL_ID = "work-panel";

/** spec 패널 카드의 이름(`aria-label`) — 패널 토글의 이름이 그 뒤에 할 일을 붙인다(「작업공간 패널 접기」). */
export const WORK_PANEL_LABEL = "작업공간 패널";

/** 서 있는 작업공간 화면이 기둥에 적는 것. */
export interface WorkToolsState {
  /** spec 패널이 열렸나 — 오른쪽 자리의 값이다(spec 패널 · 요약 카드 · 없음 중 spec). */
  open: boolean;
  /** 작업공간의 일(아카이브 · 삭제)이 도는 중인가 — 그동안 패널의 몸은 누를 수 없다(본문은 생애 겹판이 덮는다). */
  busy: boolean;
  /** 레일의 칸을 눌렀다 — 패널을 여닫는다(오른쪽 자리의 `toggle spec` — 패널 토글 · ⌘Enter와 같다). */
  onToggle: () => void;
}

/** 기둥의 값 — 작업공간 화면이 서 있는 동안만 있다. 없으면 레일과 패널이 접힌다. 앱이 도는 동안 메모리에만 산다. */
export const workToolsStore = new Store<WorkToolsState | null>(null);

/** 작업공간 화면이 섰다 — 기둥을 세운다(또는 그 화면 안에서 바뀐 값을 적는다). */
export function showWorkTools(state: WorkToolsState): void {
  workToolsStore.setState(() => state);
}

/** 작업공간 화면이 내려갔다 — 레일과 패널이 함께 접힌다. */
export function foldWorkTools(): void {
  workToolsStore.setState(() => null);
}

/** 기둥이 화면에게 건네는 패널 몸의 자리 — 앱 셸이 쥐고 화면들 위에 내린다(`ShellHeadSlot`과 같은 길). */
export const WorkToolsSlot = createContext<HTMLElement | null>(null);

/**
 * 레일 카드의 몫 — 폭(`size-prail` 32)과 왼쪽 틈(8). 패널 상자가 본문 카드에 남길 폭을 잴 때 함께 뺀다(`PanelBox`의 `trail`).
 */
const RAIL_TRAIL = "calc(var(--size-prail) + var(--space-2))";

/** spec 패널 카드의 폭 — 끌어 바꾸고 이 패널 전용 키로 기억한다(작업 패널의 칸 규격 — 틈 8 + 카드 340 · 끌어서 260–560). */
export function useWorkPanelWidth(): ResizableWidth {
  return useResizableWidth("work-panel-width", WORK_PANEL_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, "right");
}

/**
 * 기둥의 그림 — spec 패널 상자(`PanelBox`)와 레일 카드다. 값(`tools`)이 없으면 둘 다 폭 0으로 접힌다. 패널 몸의 자리(`data-work-panel-body`)는
 * 패널 카드 안에 늘 있다 — 기둥은 그 요소를 `onSlot`으로 내주고, 검사는 몸을 그 자리에 곧장 그린다(`children` — `work-tools-inline`).
 *
 * 몸의 자리는 제 상자가 없다(`contents`) — 화면이 그린 몸의 뿌리가 패널 카드의 직계 flex 자식으로 남아야 스크롤 상자가 카드 높이를 받는다
 * (`WorkPanel`의 `SpecTab` 머리말).
 */
export function WorkToolsBoxes({
  tools,
  size,
  onSlot,
  children,
}: {
  tools: WorkToolsState | null;
  size: ResizableWidth;
  onSlot?: (slot: HTMLElement | null) => void;
  children?: ReactNode;
}) {
  const open = tools?.open ?? false;
  const toggle = () => tools?.onToggle();
  return (
    <>
      <PanelBox
        id={WORK_PANEL_ID}
        trail={RAIL_TRAIL}
        // 작업공간을 떠나 접힐 때는 카드가 옅어지지 않고 잘리기만 한다(시안 `.ra-panelwrap`) — 남긴 마지막 몸(`holdBody`)이 접히는 500ms
        // 내내 보인다. 작업공간 안의 여닫기는 앞 판의 접힘 장치대로 옅어진다(02a-2).
        fade={tools !== null}
        slot={{
          label: WORK_PANEL_LABEL,
          open,
          onToggle: toggle,
          size,
          children: (
            <div ref={onSlot} data-work-panel-body="" inert={tools?.busy ?? false} className="contents">
              {children}
            </div>
          ),
        }}
      />
      <Rail shown={tools !== null} open={open} onPick={toggle} controls={WORK_PANEL_ID} />
    </>
  );
}

/**
 * 앱 셸의 작업공간 도구 기둥 — 카드 자리 오른쪽 끝, 화면 뒤에 선다(`AppShell`). 값을 구독해 그린다. 폭 훅이 여기 있는 것은 상자가 화면을
 * 넘어 사는 자리라서다 — 화면이 쥐면 작업공간에 들어올 때마다 저장값을 다시 읽는다.
 */
export function WorkToolsColumn({ onSlot }: { onSlot: (slot: HTMLElement | null) => void }) {
  const tools = useStore(workToolsStore, (state) => state);
  return <WorkToolsBoxes tools={tools} size={useWorkPanelWidth()} onSlot={onSlot} />;
}

/**
 * 작업공간 화면이 기둥을 세운다 — 서 있는 동안 값을 적고 내려갈 때 지우며, 몸(`children` — spec 트리)을 기둥의 패널 카드로 보낸다. 앱 셸
 * 밖(자리가 없다)에서는 몸이 아무 데도 서지 않는다.
 *
 * **레이아웃 이펙트로 적는다** — 앱을 작업공간에서 처음 켤 때는 기둥과 화면이 같은 커밋에 서서, 그리기 전에 값이 닿아 기둥이 자라는
 * 움직임 없이 선다. 다른 화면에서 들어오면 이미 접혀 그려진 기둥이 자란다(Motion 「작업공간에 들어오면 폭 0 → 32」). 작업공간끼리 옮겨도
 * 화면은 그대로라 기둥이 접히지 않는다. 여닫는 함수는 회차마다 새로 짓는 것이라 기둥에는 늘 마지막 것을 부르는 한 벌을 적는다.
 *
 * **내려갈 때 패널이 열려 있었으면 몸의 그림을 남기고 접는다**(`holdBody`, restart 02a-14b) — 레이아웃 이펙트의 정리는 이 화면의 몸(포털의
 * 자식)이 자리에서 걷히기 전에 돈다. 그래서 접히는 500ms 동안 마지막 spec 트리가 그대로 보이고, 접힘이 끝나면 빈다. 다시 서면 남긴 그림을
 * 먼저 걷는다(StrictMode가 처음 설 때 정리 · 다시 세움을 한 번 더 돌려도 그 자리에서 걷힌다).
 */
export function WorkTools({
  open,
  busy = false,
  onToggle,
  children,
}: {
  open: boolean;
  busy?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const slot = useContext(WorkToolsSlot);
  // 기둥에 적은 여닫기와 내려갈 때의 정리가 읽는 마지막 값 — 회차마다 새로 짓는 것이라 늘 마지막 것을 읽는다.
  const seen = useRef({ onToggle, slot, open });
  useLayoutEffect(() => {
    seen.current = { onToggle, slot, open };
  });
  useLayoutEffect(() => {
    dropHeldBody();
    showWorkTools({ open, busy, onToggle: () => seen.current.onToggle() });
  }, [open, busy]);
  useLayoutEffect(
    () => () => {
      const at = seen.current.slot;
      if (at && seen.current.open) holdBody(at);
      foldWorkTools();
    },
    [],
  );
  return slot ? createPortal(children, slot) : null;
}

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Store, useStore } from "@tanstack/react-store";
import { cn } from "@/lib/utils";
import { Card } from "./Frame";
import { dropHeldBody, holdBody } from "./held-body";
import {
  clippingInnerClass,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_MOTION,
  STILL,
  useFoldedFocus,
  WORK_PANEL_WIDTH,
} from "./panel-layout";
import Rail from "./Rail";
import useResizableWidth, { ResizeHandle, type ResizableWidth } from "./useResizableWidth";

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
 * 오른쪽 패널 칸 — 작업공간의 spec 패널이다(이 기둥이 `PanelBox`로 세운다 — `WorkToolsBoxes`). 저장하는 폭은 **칸의 폭**이다.
 * 따로 여닫는 칸이라 머리 줄의 패널 토글이 함께 선다(`PanelToggle` — 작업공간 화면이 `Frame`의 `panelToggle`로 건넨다). 토글은 `onToggle`을
 * 부르고, ⌘Enter는 화면이 듣고 같은 열림을 뒤집는다 — 둘이 하는 일이 같다(codex-ds 결정 32 「⌘Enter는 그 화면의 오른쪽 패널」). 한때
 * Archive의 spec 목록 패널도 이 칸이라 `Frame`의 `panel`로 건넸다(restart 03-4가 걷었다).
 */
export interface PanelSlot {
  /** 카드의 이름(`aria-label`). */
  label: string;
  /** 카드 안(머리와 몸). */
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
  size: ResizableWidth;
}

/**
 * 오른쪽 패널 칸(ui-refresh 결정 4 · 15) — 작업공간의 spec 패널(앱 셸의 기둥). 한때 공용 틀(`Frame`)에 있었다 — 그 틀의 칸이던 때의 것이다.
 * 쓰는 자리가 이 기둥 하나라 restart 코드 리뷰(review-fix)가 이리 옮겼다. 바깥 상자가 두 번째 `<aside>`이고(e2e
 * `tab-row-floor`가 `aside` 순서를 잰다) 폭이 **틈 8 + 카드의 폭**이다 — 접히면 0이 되어 틈째 걷히고 왼쪽 카드가 카드 자리 오른쪽 끝
 * (레일이 서면 레일 카드 앞 틈)까지 넓어진다(시안 Motion 「패널을 닫으면 문서 카드가 넓어진다」). 왼쪽 카드와는 그 틈으로 갈린다 —
 * 틈은 안쪽 열의 왼쪽 여백이다. 손잡이는 그 틈을 덮는다(`gap` — 틈 안이라 넘침을 숨기는 상자에 잘리지 않는다).
 *
 * 폭은 **카드의 폭**이다(`--panel-width` — 저장 · 끄는 최소 폭도 카드의 것이다). 상자의 기준 폭 · 최소 폭은 그 위에 틈 하나(`space-2`)를
 * 더하고, 끄는 손이 잴 때 그 틈을 뺀다(`useResizableWidth`의 `drawnWidth`).
 *
 * **이 칸은 줄어든다**(`shrink-0`이 없다). 창이 좁으면 끄는 최소 폭(`--panel-min`, 폭 훅이 받은 값)까지 왼쪽 칸에 자리를
 * 내주고, 왼쪽 칸(작업 화면의 문서 칸)에는 **패널 자신의 최소 폭만큼은 남긴다**(`max-width`). 문서 칸은 머리에 탭 줄을 이고 그 줄의
 * 바닥 아래로는 안 준다(`TAB_ROW_CARD`) — 패널이 최소 폭까지 줄고도 둘이 칸 줄에 안 들면 그 합이 본문 열의 바닥이 되어 사이드바가 자리를
 * 내준다. 한때 Archive의 문서 | 목록 칸 곁에서는 두 칸의 최소를 남기고 제 최소 폭 아래로도 내줬다(`reserve` — restart 03-4가 그 패널을 걷었다).
 * 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은 그대로라 창을 넓히면 돌아온다.
 *
 * 폭을 `width`가 아니라 `flex-basis`로 주고 `contain-inline-size`를 다는 것은 이 칸이 제 내용이 아니라 최소 폭으로만 칸 줄의
 * min-content에 들어가게 하는 장치다 — 탭 줄을 품은 칸 줄은 제 min-content를 본문 열의 바닥으로 알리는데(`TAB_ROW_COLUMN`),
 * 넓은 트리 이름이 그 바닥도 칸의 폭도 정하지 않는다. 최소 폭은 **펼 때만** 트랜지션한다 — 펴는 순간 곧장 서면 0에서 최소 폭으로 튄 뒤
 * 자란다(접을 때는 곧장 걷는다). 접힘은 사이드바와 같은 장치다(`PANEL_MOTION` · `foldingInnerClass`). 끄는 동안에는 트랜지션을 꺼서 폭이 커서를
 * 곧장 따라온다. translateX로 밀어내는 길은 이미 실패한 길이다 — 제 상자 밖 넘침을 문서가 받아 도는 동안 가로 스크롤이 깜빡인다.
 *
 * **넘침은 가로만, 움직이는 동안만 자른다** — 카드의 0.5 링이 상자 끝에서 잘리지 않게(02a-15 · 카드의 링은 네 변에 선다, 02a-2). 카드는 상자
 * 끝까지 차서(높이 100% · 폭 = 상자 − 틈) 상자가 넘침을 자르면 바깥 링(`shadow-hairline`)이 위 · 오른쪽 · 아래에서 잘린다. 세로는 늘 놓는다 —
 * 폭만 움직이고 세로로 넘칠 것이 없다(사이드바의 `overflow-x-clip`과 같은 까닭). 가로는 접힌 동안과 접고 펴는 동안만 자른다 — 그동안 카드가
 * 상자에 잘리는 것이 이 패널의 움직임이고(시안 `.ra-panelwrap { overflow: hidden }` · 02a-14c), 접힌 안쪽 열(고정 폭)이 문서의 가로 넘침이 되지
 * 않는다. 다 편 뒤에는 놓는다 — 안쪽 열이 그때 상자 폭을 상한으로 받아(`clippingInnerClass` · `foldingInnerClass`) 넘치는 것은 링뿐이다. 놓는
 * 순간은 펴는 길이만큼 늦는다: 넘침은 이산 값이라 `transition-discrete`로 늦추고, 늦음은 안쪽 열의 상한과 같은 토큰이다. 길이 · 곡선은 상자의
 * 것 하나를 함께 쓴다(따로 적으면 상자 박자의 값이 목록이 된다) — 이산 값은 곡선을 거친 진행의 가운데서 바뀌어 상한보다 조금 뒤에 놓인다.
 * 접을 때는 넘침이 트랜지션 목록에 없어 곧장 자른다. 자르는 선을 링만큼 밖으로 내는 길(`focus-ring-room`처럼 안쪽 여백 + 같은 만큼 바깥
 * 여백)은 이 상자에 못 쓴다 — 상자 폭이 「틈 + 카드」인 것을 끄는 손(`drawnWidth`)과 L3가 잰다. WebKit에는 `overflow-clip-margin`이 없다.
 *
 * `id`는 패널 토글 · 레일 칸이 가리키는 자리다(`aria-controls`). 접혀도 이 상자는 그대로 서 있어(폭만 0) 가리킴이 끊기지 않는다.
 * 그래서 **닫힌 동안 안쪽 열은 `inert`다** — 폭만 0인 칸 안의 트리 행에 Tab · 찾기가 닿지 않게 한다(사이드바 목록 구획과 같은 손).
 * 접히는 동안 아직 보이는 안쪽에도 포커스가 닿지 않는다. 안에 있던 포커스는 패널 토글로 간다(`useFoldedFocus`). 상자 자신(`aside` — 보조
 * 랜드마크)도 닫힌 동안은 드러내지 않는다(`aria-hidden`) — 안이 다 `inert`라 빈 랜드마크만 남는다. 작업공간의 spec 패널 상자는 앱 셸에 늘
 * 서 있어, 이것이 없으면 작업공간이 아닌 화면마다 빈 `aside`가 랜드마크 목록에 읽힌다(restart 02a-14).
 *
 * **작업공간의 spec 패널은 앱 셸의 작업공간 도구 기둥에 선다**(`WorkTools` — 화면이 바뀌어도 그 자리에 남아 작업공간을 떠날 때 접힘이
 * 보인다, restart 02a-14). 기둥에서는 패널 뒤에 레일 카드가 한 줄로 서서, 남길 폭에서 그 몫(`trail` — 레일 폭 + 틈)을 더 뺀다. 안쪽은
 * 옅어지지 않고 상자에 잘리기만 한다(시안 `.ra-panelwrap`, restart 02a-14c `clippingInnerClass`) — 여닫을 때도, 떠나며 접히는 동안 남긴 마지막
 * 몸이 보일 때도 같다. 한때 Archive의 spec 목록 패널이 이 틀의 카드 줄에서 같은 상자를 쓰며 옅어졌다(`fade` — restart 03-4가 걷었다).
 */
export function PanelBox({
  id,
  slot,
  trail,
  still = false,
}: {
  id: string;
  slot: PanelSlot;
  /** 같은 줄에서 패널 뒤(오른쪽)에 서는 것의 폭(CSS 길이) — 남길 폭을 잴 때 함께 뺀다. 없으면 0이다. */
  trail?: string;
  /** 이번 그림은 움직이지 않고 선다 — 상자와 안쪽 열의 트랜지션을 끈다(`STILL` — 작업공간 도구 기둥이 처음 그려질 때). */
  still?: boolean;
}) {
  const { open, size, label, children } = slot;
  const box = useFoldedFocus<HTMLElement>(open);
  return (
    <aside
      ref={box}
      id={id}
      aria-hidden={open ? undefined : true}
      style={
        {
          "--panel-width": `${size.width}px`,
          "--panel-min": `${size.min}px`,
          ...(trail === undefined ? {} : { "--panel-trail": trail }),
          ...(still ? STILL : {}),
        } as CSSProperties
      }
      className={cn(
        "relative flex contain-inline-size",
        !size.dragging && PANEL_MOTION,
        // 넘침은 가로만, 움직이는 동안만 자른다(아래 머리말 「카드의 링」) — 펼 때 놓는 순간은 바깥 길이만큼 늦고 접을 때는 곧장 자른다.
        !size.dragging &&
          (open
            ? "transition-[flex-basis,min-width,overflow-x] delay-[0s,0s,var(--duration-panel-open)] transition-discrete"
            : "transition-[flex-basis]"),
        open
          ? cn(
              "overflow-x-visible",
              "max-w-[calc(100%-var(--panel-min)-var(--panel-trail,0px))] basis-[calc(var(--panel-width)+var(--space-2))]",
              "min-w-[calc(var(--panel-min)+var(--space-2))]",
            )
          : "basis-0 min-w-0 overflow-x-clip",
      )}
    >
      {/* 접히는 동안 글이 되흐르지 않게 안쪽은 고정 폭(틈 + 카드)이고, **펴진 뒤에만** 바깥 폭을 상한으로 받는다 — 좁게 선 칸에서 카드
          오른쪽이 잘리지 않게. 박자와 까닭은 `panel-layout`의 `foldingInnerClass` · `clippingInnerClass`에 있다. 틈은 안쪽 왼쪽 여백이다. */}
      <div
        inert={!open}
        style={still ? STILL : undefined}
        className={cn(
          "flex h-full w-[calc(var(--panel-width)+var(--space-2))] shrink-0 pl-2",
          clippingInnerClass(open),
        )}
      >
        <Card label={label} className="flex-1">
          {children}
        </Card>
      </div>
      {open && <ResizeHandle control={size} seat="gap" />}
    </aside>
  );
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
  still = false,
  onSlot,
  children,
}: {
  tools: WorkToolsState | null;
  size: ResizableWidth;
  /** 이번 그림은 움직이지 않고 선다(`WorkToolsColumn`의 `useFirstFrame`) — 상자와 레일의 트랜지션을 끈다. */
  still?: boolean;
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
        // 카드는 옅어지지 않고 상자에 잘리기만 한다(시안 `.ra-panelwrap` · `clippingInnerClass`) — 작업공간 안의 여닫기도, 떠날 때도 같다.
        // 떠나는 500ms 동안은 남긴 마지막 몸(`holdBody`)이 그대로 보인다. 한때(02a-2 · 02a-14b) 작업공간 안의 여닫기는 옅어졌다.
        still={still}
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
      <Rail shown={tools !== null} open={open} onPick={toggle} controls={WORK_PANEL_ID} still={still} />
    </>
  );
}

/**
 * 앱 셸의 작업공간 도구 기둥 — 카드 자리 오른쪽 끝, 화면 뒤에 선다(`AppShell`). 값을 구독해 그린다. 폭 훅이 여기 있는 것은 상자가 화면을
 * 넘어 사는 자리라서다 — 화면이 쥐면 작업공간에 들어올 때마다 저장값을 다시 읽는다.
 *
 * **첫 프레임까지는 움직이지 않는다**(`useFirstFrame`, restart 02a-15c). 앱을 작업공간에서 켜면 기둥은 접힌 채 마운트되고 같은 커밋의 레이아웃
 * 이펙트가 값을 적는다(`WorkTools`) — 그려지기 전이어도 그 사이 브라우저가 접힌 모양을 셈해 두면(화면의 이펙트가 상자를 재는 것 하나로 족하다)
 * 폭 트랜지션이 걸려 0에서 자랐다. 첫 프레임 뒤로는 박자대로다 — 다른 화면에서 들어오면 이미 접혀 그려진 기둥이 자란다.
 */
export function WorkToolsColumn({ onSlot }: { onSlot: (slot: HTMLElement | null) => void }) {
  const tools = useStore(workToolsStore, (state) => state);
  const still = useFirstFrame();
  return <WorkToolsBoxes tools={tools} size={useWorkPanelWidth()} still={still} onSlot={onSlot} />;
}

/**
 * 마운트에서 **첫 애니메이션 프레임까지** 참이다 — 그 프레임의 콜백이 거짓으로 바꾼다. 패시브 이펙트가 아니라 프레임에 매는 것은 같은 커밋의
 * 레이아웃 이펙트가 부른 동기 다시 그리기가 패시브 이펙트를 먼저 비우기 때문이다 — 이펙트에서 바로 거짓으로 두면 첫 값과 함께 트랜지션이
 * 켜진다. 창이 가려져 프레임이 안 오면 보일 때까지 참이다(그동안 움직일 것이 보이지 않는다).
 */
function useFirstFrame(): boolean {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFirst(false));
    return () => cancelAnimationFrame(frame);
  }, []);
  return first;
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

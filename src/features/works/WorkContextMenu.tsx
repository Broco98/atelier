import { useRef, useState, type ReactElement } from "react";
import { opensEditMenu } from "@/components/shell/EditMenu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useWorks } from "./hooks";
import { WorkMenuItems, type WorkMenuFlows } from "./WorkMenuItems";

// **work의 우클릭 메뉴**(codex-ds 스펙 §9 · 결정 6 · 7 · 11). 대상은 셋이다 — 사이드바 work 행 · 알림 띠 줄 · 머리 줄 이름. 펴는
// 목록은 ⋯ 메뉴와 같은 정의(`WorkMenuItems`)이고 부르는 흐름도 같다(`flows` — `work-menu-actions.ts`).
//
// **메뉴 하나가 여러 대상을 맡는다.** 목록 하나 · 띠 하나에 메뉴가 하나씩 서고, 우클릭이 난 자리에서 대상을 찾는다(`targetOf`). 행마다
// 메뉴를 세우지 않는 것은 행 파일이 훅을 안 부르는 그림이라서다(`SidebarWorkList.test.tsx`의 지킴) — 메뉴 상태(어느 work · 열렸나)는
// 이 조각이 쥐고, 행은 「내가 대상인가」 하나를 받아 테두리만 그린다. 대상이 아닌 자리(구획 머리 · 빈 자리 · 위쪽 Terminal 줄)를
// 우클릭하면 열기를 거둔다 — 웹뷰의 기본 메뉴는 앱 뿌리가 막으므로(`AppShell`) 그 자리에는 아무것도 서지 않는다(결정 8).
//
// **감싼 자리 안의 입력칸은 이 메뉴의 자리가 아니다.** 사이드바 행의 이름을 고치는 칸(`InlineRename`)은 목록 안에 서는데, 그
// 칸의 우클릭은 편집 메뉴다(`EditMenu`, 티켓 31). 그 자리에서는 Trigger가 물러선다(`opensEditMenu` — 제 처리를 건너뛰어 사건을
// 멈추지 않는다) — 사건이 document까지 올라가 편집 메뉴가 연다. ⇧F10 · 메뉴 키는 물러설 것이 없다: 이 키를 받는 것은 대상
// 요소 자신의 `onKeyDown`(`openMenuByKey`)인데, 이름을 고치는 칸은 그 요소(행의 이름 버튼 · 머리 줄 이름)를 갈아 끼우고 서서
// 그 칸의 키가 거기 안 간다.
//
// **고름도 주소도 안 바뀐다**(결정 7). 대상이 고른 work가 아니어도 그 줄의 work에 대한 메뉴이고, 열고 닫는 동안 목록의 고름과 주소는
// 그대로다. 열린 동안 대상에 테두리(`focus-ring` — 포커스 링과 같은 모양)가 서는 것이 「어느 것의 메뉴인가」를 말한다(결정 11).
// 닫히면 포커스가 그 대상으로 돌아간다(`finalFocus`). **「이름 바꾸기」로 닫힐 때만은 돌리지 않는다** — 메뉴를 다는 자리가 그 work의
// 이름을 그 자리에서 고치기 시작하고(`onRename`, codex-ds 스펙 §9), 막 선 입력칸이 포커스를 받는다. 대상으로 돌아가면 입력칸이 곧바로
// blur되어 「다른 곳 = 저장」으로 닫힌다(구현 노트 Q7).

/** 우클릭이 겨눈 대상. */
export interface MenuTarget {
  /** 메뉴가 펼 work. */
  slug: string;
  /**
   * 테두리가 설 자리의 이름 — 메뉴를 다는 요소를 그리는 함수(`children`)가 받는 값이다. 행 · 머리 줄 이름은 slug이고, 띠는 셸 줄의
   * 칸 번호다(한 work에서 둘이 부르면 줄이 둘이다).
   */
  id: string;
  /** 테두리가 서고 포커스가 돌아갈 요소. */
  element: HTMLElement;
}

export function WorkContextMenu({
  flows,
  targetOf,
  onRename,
  children,
}: {
  /** 메뉴가 부르는 흐름 — 메뉴를 다는 자리가 `useWorkMenuFlows`로 지어 건넨다(그 파일 머리말). */
  flows: WorkMenuFlows;
  /**
   * 우클릭이 난 요소(`from`)에서 대상을 찾는다 — 대상이 아닌 자리면 `null`이고 메뉴가 안 선다. `trigger`는 메뉴를 다는 요소 자신이다
   * (머리 줄 이름은 그것이 곧 대상이다).
   */
  targetOf: (from: Element, trigger: HTMLElement) => MenuTarget | null;
  /** 「이름 바꾸기」 — 그 work의 이름을 대상 자리에서 고치기 시작한다(머리 줄 이름 · 사이드바 행). */
  onRename: (slug: string) => void;
  /**
   * 메뉴를 다는 요소를 그린다 — 받는 값은 **지금 열린 메뉴의 대상 이름**(`MenuTarget.id`)이고(닫혔으면 `null`) 그 대상이 테두리를 그린다. 그린 요소가
   * 우클릭을 받는 자리가 된다(`ContextMenuTrigger`의 `render`).
   */
  children: (menuTarget: string | null) => ReactElement;
}) {
  const { data: works = [] } = useWorks();
  // 메뉴가 겨누는 work와 열림. 닫혀도 slug를 남긴다 — 닫히는 움직임 동안 카드가 같은 항목을 그린다.
  const [menu, setMenu] = useState<{ slug: string; id: string; open: boolean } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // 테두리가 서고 포커스가 돌아갈 요소 — 메뉴 카드가 닫힐 때 여기로 돌려준다.
  const target = useRef<HTMLElement | null>(null);
  // 「이름 바꾸기」로 닫혔나 — 그때는 포커스를 돌리지 않는다(머리말).
  const renamed = useRef(false);
  // **목록에서 찾는다** — 열어 둔 사이 그 work가 아카이브 · 삭제되면 메뉴도 사라진다.
  const menuWork = works.find((work) => work.slug === menu?.slug);
  const open = menu?.open === true && menuWork !== undefined;

  return (
    <ContextMenu
      open={open}
      // **아카이브 · 삭제가 도는 동안은 안 열린다** — 그 사이 다른 조작을 겹치면 두 번째가 사라진 work을 부른다(`flows.busy`).
      disabled={flows.busy}
      onOpenChange={(next, details) => {
        if (!next) {
          setMenu((now) => now && { ...now, open: false });
          return;
        }
        const from = details.event.target;
        const found = from instanceof Element && trigger.current ? targetOf(from, trigger.current) : null;
        // 대상이 아닌 자리, 또는 목록에 아직 없는 work(띠가 슬러그로 적는 셸)면 열기를 거둔다.
        if (!found || !works.some((work) => work.slug === found.slug)) {
          details.cancel();
          return;
        }
        target.current = found.element;
        setMenu({ slug: found.slug, id: found.id, open: true });
      }}
    >
      <ContextMenuTrigger
        ref={(node: HTMLElement | null) => {
          trigger.current = node;
        }}
        // 그 안의 편집 메뉴 자리(이름을 고치는 칸)에서는 물러선다 — 열지도 멈추지도 않아 사건이 document의 편집 메뉴에 닿는다(머리말).
        onContextMenu={(event) => {
          if (event.target instanceof Element && opensEditMenu(event.target)) event.preventBaseUIHandler();
        }}
        render={children(open && menu ? menu.id : null)}
      />
      <ContextMenuContent
        finalFocus={() => {
          if (!renamed.current) return target.current ?? true;
          renamed.current = false;
          return false;
        }}
      >
        {menuWork && (
          <WorkMenuItems
            work={menuWork}
            actions={flows.actionsFor(menuWork, () => {
              renamed.current = true;
              onRename(menuWork.slug);
            })}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

import { Store } from "@tanstack/react-store";
import { useEffect, useId, useState } from "react";

/**
 * **툴팁과 호버 카드의 무리**(codex-ds 스펙 §8 「뜨는 시간」 · 결정 20). 둘은 한 무리로 움직인다:
 *
 * - 첫 번째는 포인터가 멈춘 지 `duration-tip`에 선다.
 * - 하나가 떠 있는 동안, 그리고 닫힌 직후 잠깐(`GROUP_WINDOW_MS`) 옆 대상으로 옮기면 곧바로 선다(`instantNow`).
 * - 메뉴가 열려 있는 동안은 둘 다 서지 않는다(`menuOpen`).
 *
 * 무리에 드는 것은 **포인터가 세운 것**이다. 키보드 포커스로 선 툴팁은 무리 밖에 서고, 그 뒤 무리에 새것이 들면 비킨다(`Tooltip`).
 *
 * 툴팁끼리의 무리는 Base UI 공급자(`TooltipProvider`)가 이미 든다 — 그런데 그 무리는 Tooltip 트리거만 낄 수 있고, 호버 카드는 Base UI
 * 부품이 아니라(`PopoverPortal`) 공개 API로 그 무리에 못 낀다. 그래서 **앱 쪽에 무리를 하나 더 둔다** — 툴팁 · 카드가 뜨고 닫힐 때
 * 여기에 알리고, 툴팁(`Hint`)은 카드가 떠 있으면 지연을 0으로, 카드(`SidebarWorkList`)는 툴팁이 떠 있으면 곧바로 선다. 툴팁끼리는 이
 * 무리와 공급자의 무리가 같은 답을 낸다 — 닫힌 직후의 길이를 둘이 같은 값으로 읽기 때문이다(`TooltipProvider`의 `timeout`).
 *
 * 메뉴는 여는 쪽이 아니라 **메뉴 부품의 감싸개**(`DropdownMenu` · `ContextMenu`)가 알린다 — 앱의 메뉴는 모두 그 둘을 지나므로
 * (`@base-ui/react/menu`를 `components/ui` 밖에서 부르는 곳이 없다), 새 메뉴가 늘어도 알리기를 잊을 자리가 없다. Select · Popover는
 * 메뉴가 아니다 — 스펙이 꼽은 메뉴(⋯ · 우클릭 · 상태)는 모두 메뉴 부품이다.
 *
 * 값만 드는 저장소다(`confirm-store.ts`와 같은 꼴) — 읽는 쪽이 React 밖의 이벤트 처리기(카드의 열기 · 닫기 타이머)라 `state`로도 읽는다.
 */
interface HoverGroup {
  /** 지금 떠 있는 툴팁 · 카드. 하나씩 제 id로 든다 — 툴팁이 옆으로 옮겨 갈 때 새것이 먼저 서고 옛것이 뒤에 닫혀도 비지 않는다. */
  shown: readonly string[];
  /** 마지막 하나가 닫힌 직후 잠깐(`GROUP_WINDOW_MS`) 동안 참이다. */
  recent: boolean;
  /** 지금 열려 있는 메뉴. */
  menus: readonly string[];
}

/**
 * 「닫힌 직후 잠깐」의 길이(ms) — Base UI 공급자의 `timeout` 기본값 400 그대로다. DS 토큰이 없다(구현 노트 Q13 — 결정 20은 길이를
 * 말하지 않는다). 공급자에 이 값을 넘겨 툴팁끼리의 무리와 이 무리가 **한 값**을 읽는다.
 */
export const GROUP_WINDOW_MS = 400;

export const hoverGroup = new Store<HoverGroup>({ shown: [], recent: false, menus: [] });

let recentTimer: ReturnType<typeof setTimeout> | null = null;

/** 무리(`shown`)에 새것이 들 때마다 부를 것들(`whenJoined`). */
const joinWatchers = new Set<() => void>();

function join(kind: "shown" | "menus", id: string) {
  if (kind === "shown" && recentTimer !== null) {
    clearTimeout(recentTimer);
    recentTimer = null;
  }
  const fresh = !hoverGroup.state[kind].includes(id);
  hoverGroup.setState((state) => ({
    ...state,
    [kind]: state[kind].includes(id) ? state[kind] : [...state[kind], id],
    recent: kind === "shown" ? false : state.recent,
  }));
  if (kind === "shown" && fresh) for (const watcher of [...joinWatchers]) watcher();
}

/**
 * 무리(`shown`)에 툴팁 · 카드가 새로 들 때마다 부른다 — 돌려준 것을 부르면 그만 부른다. 무리 밖에 선 툴팁이 비키는 길이다(`Tooltip`).
 */
export function whenJoined(watcher: () => void): () => void {
  joinWatchers.add(watcher);
  return () => {
    joinWatchers.delete(watcher);
  };
}

function part(kind: "shown" | "menus", id: string) {
  if (!hoverGroup.state[kind].includes(id)) return;
  const rest = hoverGroup.state[kind].filter((one) => one !== id);
  const closedLast = kind === "shown" && rest.length === 0;
  hoverGroup.setState((state) => ({ ...state, [kind]: rest, recent: closedLast ? true : state.recent }));
  if (!closedLast) return;
  recentTimer = setTimeout(() => {
    recentTimer = null;
    hoverGroup.setState((state) => ({ ...state, recent: false }));
  }, GROUP_WINDOW_MS);
}

/** 지금 옮겨 오면 곧바로 서는가 — 하나가 떠 있거나 막 닫혔다. */
export const instantNow = (state: HoverGroup) => state.shown.length > 0 || state.recent;

/** 메뉴가 하나라도 열려 있는가 — 열린 동안은 툴팁도 카드도 서지 않는다. */
export const menuOpen = (state: HoverGroup) => state.menus.length > 0;

/**
 * 이 툴팁 · 카드 · 메뉴가 열려 있는 동안 무리에 든다. 닫히거나 사라지면(언마운트) 빠진다 — 열린 채 사라진 메뉴가 무리를 영영 막지 않는다.
 */
export function useInHoverGroup(kind: "shown" | "menus", open: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    join(kind, id);
    return () => part(kind, id);
  }, [kind, id, open]);
}

/**
 * **열림을 부품이 드는 Root**(툴팁 · ⋯ 메뉴 · 우클릭 메뉴 — 제어하지 않는 Base UI Root)가 무리에 알리는 길이다. Root의 `onOpenChange`를
 * 이것이 돌려준 것으로 갈아 끼우면, 부르는 쪽의 처리기를 먼저 부르고 바뀐 열림을 받아 적는다 — 거둔 열기(`isCanceled`)는 열림이 아니다.
 * 부르는 쪽이 `open`을 주면(제어하는 Root) 그 값을 그대로 든다.
 *
 * `joins`가 아니라고 한 열기는 **무리 밖에 선다**(`aside`) — 떠 있어도 무리에 들지 않아 옆 대상을 곧바로 세우지 않는다.
 */
export function useOpenInHoverGroup<Details extends { isCanceled: boolean }>(
  kind: "shown" | "menus",
  {
    open,
    onOpenChange,
    joins = () => true,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean, details: Details) => void;
    joins?: (details: Details) => boolean;
  },
): { onOpenChange: (open: boolean, details: Details) => void; aside: boolean } {
  const [own, setOwn] = useState<"in" | "aside" | null>(null);
  useInHoverGroup(kind, open ?? own === "in");
  return {
    onOpenChange: (next, details) => {
      onOpenChange?.(next, details);
      if (!details.isCanceled) setOwn(!next ? null : joins(details) ? "in" : "aside");
    },
    aside: open === undefined && own === "aside",
  };
}

/**
 * 시간 토큰 하나(ms) — 문서 뿌리에서 읽는다(`panel-layout.ts`의 `panelMotionMs`와 같은 길). 리터럴로 다시 적으면 토큰을 고친 날 타이머만
 * 옛 길이로 남는다. **늦게 읽는다** — 모듈이 뜰 때는 스타일시트가 없을 수 있고, node 검사에는 문서가 없다. 풀린 값만 기억한다(토큰은 앱이
 * 도는 동안 안 바뀐다). 안 풀리면(스타일시트 없이 그린 자리) 0이다.
 */
const tokenCache = new Map<string, number>();
export function durationMs(name: "--duration-tip" | "--duration-peek-close"): number {
  const known = tokenCache.get(name);
  if (known !== undefined) return known;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const time = parseFloat(value);
  if (!Number.isFinite(time)) return 0;
  const ms = value.endsWith("ms") ? time : time * 1000;
  tokenCache.set(name, ms);
  return ms;
}

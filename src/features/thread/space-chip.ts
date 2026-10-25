import { readingList, type ReadingScope, type ScopeSpace } from "@/features/spaces/scope";
import { particle } from "@/lib/particle";
import type { SpacePick, ThreadLink } from "./types";

// 트레이의 **Space 칩**과 **범위 줄**(03 구현 스펙 §5 · 티켓 06 · 캔버스 v52 F4-KitComposer · F4-HomeSpaceMenu · F4-HomeSpacePicked)의 순수
// 함수다. Space 칩은 Work 칩 바로 뒤에 서서 이 Thread가 읽을 Space를 고르고, 범위 줄은 그 곁에서 지금 읽는 Project를 한 줄로 말한다 — 글은
// 읽는 범위(core `reading_scope` — Session이 함께 여는 폴더와 같은 값)에서 나온다. 화면은 다시 세지 않는다.

/** 범위 줄 — 글 · 경고 색(빈 Space · 등록된 Project 없음) · 끝에 「Project 추가」를 다나(등록된 Project 없음). */
export interface ScopeLine {
  text: string;
  warn: boolean;
  addProject: boolean;
}

/**
 * 범위 줄의 넷(§5) — Space 없음 「등록된 Project 3개를 읽어요」, Space 「web-app · api-server를 읽어요」(셋을 넘으면 「… 외 2개를 읽어요」),
 * 빈 Space 「읽는 Project가 없어요 — Space에 Project를 넣어 주세요」(시안 칸의 글 — 스펙의 짧은 글에 할 일을 더했다), 등록된 Project 없음
 * 「등록된 Project가 없어요 · Project 추가」. 뒤의 둘은 경고 색이고 대화는 막지 않는다.
 *
 * Space의 이름들은 worktree에서 일하는 Project(`worked`)가 먼저, 그 뒤 함께 여는 Project다 — worktree가 Space를 다 덮어도 빈 Space가 아니다
 * (빈 Space는 파일에 Project가 없을 때만 — core가 가른다). 적힌 것을 하나도 읽을 수 없으면(등록되지 않음 · 폴더 없음) 경고 색으로 「읽는
 * Project가 없어요」만 — 넣으라고 하지 않는다(03 결정 「코드 리뷰 고침」).
 */
export function scopeLine(scope: ReadingScope): ScopeLine {
  switch (scope.kind) {
    case "all":
      return { text: `등록된 Project ${scope.registered}개를 읽어요`, warn: false, addProject: false };
    case "space": {
      const read = [...scope.worked, ...scope.projects].map((project) => project.name);
      if (read.length === 0) return { text: "읽는 Project가 없어요", warn: true, addProject: false };
      const names = readingList(read);
      return { text: `${names}${particle(names, "을", "를")} 읽어요`, warn: false, addProject: false };
    }
    case "emptySpace":
      return { text: "읽는 Project가 없어요 — Space에 Project를 넣어 주세요", warn: true, addProject: false };
    case "noProjects":
      return { text: "등록된 Project가 없어요", warn: true, addProject: true };
  }
}

/**
 * Space 칩의 모양(§5 · 시안 `.tc.ghost` · `.tc.on`) — Space가 없으면 흐린 「Space 넣기」, 있으면 흰 칩에 이름이다. 끝은 ×(빼기)인데, 그 칩이
 * 바꾸는 것이 Work의 Space면(Work에 이은 Thread · 최근 Work를 고른 첫 화면) × 대신 ▾다 — 빼기도 메뉴에서만 한다.
 */
export type SpaceChipLook = { kind: "ghost" } | { kind: "on"; slug: string; name: string; end: "remove" | "menu" };

/** 칩이 보이는 Space(쥔 Space가 없거나 그 파일이 없으면 `null`)의 칩. */
export function spaceChip(current: ScopeSpace | null, ofWork: boolean): SpaceChipLook {
  if (current === null) return { kind: "ghost" };
  return { kind: "on", slug: current.slug, name: current.name, end: ofWork ? "menu" : "remove" };
}

/**
 * 첫 말 전 칩이 보이는 쥔 Space — 쥔 것으로 센 읽는 범위(`reading_scope`)가 싣는 Space다. 화면이 Space 목록으로 다시 세지 않는다(§7 · 03 코드
 * 리뷰 P14): 그 파일이 없으면 범위에 Space가 없고 칩도 없음이다(§7 규칙 1 — 손으로 지운 파일). 범위를 아직 못 읽었거나 앞 답(`fresh`가
 * 아니다 — 쥔 것을 바꾼 사이)이면 쥔 slug가 이름 자리에 선다.
 */
export function shownSpace(held: string | null, scope: ReadingScope | undefined, fresh: boolean): ScopeSpace | null {
  if (held === null) return null;
  if (scope?.space?.slug === held) return scope.space;
  if (scope && fresh) return null;
  return { slug: held, name: held, troubled: false };
}

/**
 * 첫 말 전에 입력창이 쥔 Space(§5 · S4) — 둘을 따로 쥔다. Work 없는 쪽(「새 Work」 · 「Work 없이 대화」)이 고른 것은 그 둘을 오가도 남고,
 * 최근 Work를 고르고 Space 칩에서 바꾼 것은 그 Work를 고른 동안만 산다(바꾸지 않았으면 그 Work의 Space 그대로다). 바꾼 것은 첫 말을 보낼 때
 * 그 Work에 적는다 — 메뉴를 훑다 버린 입력이 Work 파일을 바꾸지 않게.
 */
export interface SpaceHold {
  loose: string | null;
  work: { slug: string; space: string | null } | null;
}

/** 주소 씨앗(`?space=`)이 처음 쥔 것 — Work 씨앗(`?work=`)과 함께 오면 그 Work의 Space를 바꾼 것으로 쥔다. */
export function holdOf(seed: { link: ThreadLink | null; space: string | null }): SpaceHold {
  const work = seed.link?.kind === "work" && seed.space !== null ? { slug: seed.link.slug, space: seed.space } : null;
  return { loose: seed.space, work };
}

/** Space 칩에서 고른 것을 쥔다 — 지금 고른 곳이 Work면 그 Work의 것으로, 아니면 Work 없는 쪽의 것으로. */
export function holdPick(link: ThreadLink, hold: SpaceHold, space: string | null): SpaceHold {
  return link.kind === "work" ? { ...hold, work: { slug: link.slug, space } } : { ...hold, loose: space };
}

/** 칩 · 범위 줄이 보이는 쥔 Space — 최근 Work면 바꾼 것, 바꾸지 않았으면 그 Work의 Space(`workSpace`)다. */
export function heldSpace(link: ThreadLink, hold: SpaceHold, workSpace: string | null): string | null {
  if (link.kind !== "work") return hold.loose;
  return hold.work?.slug === link.slug ? hold.work.space : workSpace;
}

/**
 * 첫 말과 함께 갈 것(새 Thread 시작 명령의 `space`) — 고르지 않았으면 `null`이라 이은 Work의 Space를 건드리지 않는다. 고른 Space의 파일이
 * 그사이 사라져 칩이 「Space 넣기」면(`shown`이 그것이 아니다) 보이는 대로 「Space 없음」으로 보낸다 — 지운 slug를 실어 첫 말이 거절되지
 * 않게(03 코드 리뷰 P6).
 */
export function startSpace(link: ThreadLink, hold: SpaceHold, shown: ScopeSpace | null): SpacePick | null {
  const pick = picked(link, hold);
  if (pick?.slug == null || shown?.slug === pick.slug) return pick;
  return link.kind === "work" ? { slug: null } : null;
}

/** 입력창이 쥔 것 가운데 첫 말과 함께 갈 것 — Work 없는 쪽의 것, 또는 지금 고른 Work에서 바꾼 것. */
function picked(link: ThreadLink, hold: SpaceHold): SpacePick | null {
  if (link.kind !== "work") return hold.loose === null ? null : { slug: hold.loose };
  return hold.work?.slug === link.slug ? { slug: hold.work.space } : null;
}

/**
 * Thread 머리 줄 이름 앞의 Space(§10) — Work 없는 Thread에 Space가 있으면 「흐린 Space / Thread 이름」의 그 Space다(누르면 Space 상세). 그
 * Thread의 읽는 범위가 싣는 Space다 — 없거나 그 파일이 없으면(범위를 아직 못 읽었어도) 이름만 선다. 빈 자리를 말하지 않는다. Work에 이은
 * Thread는 02 그대로 Work 단추만 둔다.
 */
export function headSpace(work: string | null, scope: ReadingScope | undefined): { slug: string; name: string } | null {
  if (work !== null || !scope?.space) return null;
  return { slug: scope.space.slug, name: scope.space.name };
}

import {
  NOTHING_READ,
  NOTHING_REGISTERED,
  readingText,
  registeredText,
  type ReadingScope,
  type ScopeService,
} from "@/features/services/scope";
import type { ServicePick, ThreadLink } from "./types";

// 트레이의 **Service 칩**과 **범위 줄**(03 구현 스펙 §5 · 티켓 06 · 캔버스 v52 F4-KitComposer · F4-HomeSpaceMenu · F4-HomeSpacePicked)의 순수
// 함수다. Service 칩은 Work 칩 바로 뒤에 서서 이 Thread가 읽을 Service를 고르고, 범위 줄은 그 곁에서 지금 읽는 Project를 한 줄로 말한다 — 글은
// 읽는 범위(core `reading_scope` — Session이 함께 여는 폴더와 같은 값)에서 나온다. 화면은 다시 세지 않는다.

/** 범위 줄 — 글 · 경고 색(빈 Service · 등록된 Project 없음) · 끝에 「Project 추가」를 다나(등록된 Project 없음). */
export interface ScopeLine {
  text: string;
  warn: boolean;
  addProject: boolean;
}

/**
 * 범위 줄의 넷(§5) — Service 없음 「등록된 Project 3개를 읽어요」, Service 「web-app · api-server를 읽어요」(셋을 넘으면 「… 외 2개를 읽어요」),
 * 빈 Service 「읽는 Project가 없어요 — Service에 Project를 넣어 주세요」(시안 칸의 글 — 스펙의 짧은 글에 할 일을 더했다), 등록된 Project 없음
 * 「등록된 Project가 없어요 · Project 추가」. 뒤의 둘은 경고 색이고 대화는 막지 않는다.
 *
 * Service의 이름들은 worktree에서 일하는 Project(`worked`)가 먼저, 그 뒤 함께 여는 Project다 — worktree가 Service를 다 덮어도 빈 Service가 아니다
 * (빈 Service는 파일에 Project가 없을 때만 — core가 가른다). 적힌 것을 하나도 읽을 수 없으면(등록되지 않음 · 폴더 없음) 경고 색으로 「읽는
 * Project가 없어요」만 — 넣으라고 하지 않는다(03 결정 「코드 리뷰 고침」).
 */
export function scopeLine(scope: ReadingScope): ScopeLine {
  switch (scope.kind) {
    case "all":
      return { text: registeredText(scope.registered), warn: false, addProject: false };
    case "service": {
      const read = [...scope.worked, ...scope.projects].map((project) => project.name);
      return { text: readingText(read), warn: read.length === 0, addProject: false };
    }
    case "emptyService":
      return { text: `${NOTHING_READ} — Service에 Project를 넣어 주세요`, warn: true, addProject: false };
    case "noProjects":
      return { text: NOTHING_REGISTERED, warn: true, addProject: true };
  }
}

/**
 * Service 칩의 모양(§5 · 시안 `.tc.ghost` · `.tc.on`) — Service가 없으면 흐린 「Service 넣기」, 있으면 흰 칩에 이름이다. 끝은 ×(빼기)인데, 그 칩이
 * 바꾸는 것이 Work의 Service면(Work에 이은 Thread · 최근 Work를 고른 첫 화면) × 대신 ▾다 — 빼기도 메뉴에서만 한다.
 */
export type ServiceChipLook = { kind: "ghost" } | { kind: "on"; slug: string; name: string; end: "remove" | "menu" };

/** 칩이 보이는 Service(쥔 Service가 없거나 그 파일이 없으면 `null`)의 칩. */
export function serviceChip(current: ScopeService | null, ofWork: boolean): ServiceChipLook {
  if (current === null) return { kind: "ghost" };
  return { kind: "on", slug: current.slug, name: current.name, end: ofWork ? "menu" : "remove" };
}

/**
 * 첫 말 전 칩이 보이는 쥔 Service — 쥔 것으로 센 읽는 범위(`reading_scope`)가 싣는 Service다. 화면이 Service 목록으로 다시 세지 않는다(§7 · 03 코드
 * 리뷰 P14): 그 파일이 없으면 범위에 Service가 없고 칩도 없음이다(§7 규칙 1 — 손으로 지운 파일). 범위를 아직 못 읽었거나 앞 답(`fresh`가
 * 아니다 — 쥔 것을 바꾼 사이)이면 쥔 slug가 이름 자리에 선다.
 */
export function shownService(held: string | null, scope: ReadingScope | undefined, fresh: boolean): ScopeService | null {
  if (held === null) return null;
  if (scope?.service?.slug === held) return scope.service;
  if (scope && fresh) return null;
  return { slug: held, name: held, troubled: false };
}

/**
 * 첫 말 전에 입력창이 쥔 Service(§5 · S4) — 둘을 따로 쥔다. Work 없는 쪽(「새 작업공간」 · 「작업공간 없이 대화」)이 고른 것은 그 둘을 오가도 남고,
 * 최근 Work를 고르고 Service 칩에서 바꾼 것은 그 Work를 고른 동안만 산다(바꾸지 않았으면 그 Work의 Service 그대로다). 바꾼 것은 첫 말을 보낼 때
 * 그 Work에 적는다 — 메뉴를 훑다 버린 입력이 Work 파일을 바꾸지 않게.
 */
export interface ServiceHold {
  loose: string | null;
  work: { slug: string; service: string | null } | null;
}

/** 주소 씨앗(`?service=`)이 처음 쥔 것 — Work 씨앗(`?work=`)과 함께 오면 그 Work의 Service를 바꾼 것으로 쥔다. */
export function holdOf(seed: { link: ThreadLink | null; service: string | null }): ServiceHold {
  const work = seed.link?.kind === "work" && seed.service !== null ? { slug: seed.link.slug, service: seed.service } : null;
  return { loose: seed.service, work };
}

/** Service 칩에서 고른 것을 쥔다 — 지금 고른 곳이 Work면 그 Work의 것으로, 아니면 Work 없는 쪽의 것으로. */
export function holdPick(link: ThreadLink, hold: ServiceHold, service: string | null): ServiceHold {
  return link.kind === "work" ? { ...hold, work: { slug: link.slug, service } } : { ...hold, loose: service };
}

/** 칩 · 범위 줄이 보이는 쥔 Service — 최근 Work면 바꾼 것, 바꾸지 않았으면 그 Work의 Service(`workService`)다. */
export function heldService(link: ThreadLink, hold: ServiceHold, workService: string | null): string | null {
  if (link.kind !== "work") return hold.loose;
  return hold.work?.slug === link.slug ? hold.work.service : workService;
}

/**
 * 첫 말과 함께 갈 것(새 Thread 시작 명령의 `service`) — 고르지 않았으면 `null`이라 이은 Work의 Service를 건드리지 않는다. 고른 Service의 파일이
 * 그사이 사라져 칩이 「Service 넣기」면(`shown`이 그것이 아니다) 보이는 대로 「Service 없음」으로 보낸다 — 지운 slug를 실어 첫 말이 거절되지
 * 않게(03 코드 리뷰 P6).
 */
export function startService(link: ThreadLink, hold: ServiceHold, shown: ScopeService | null): ServicePick | null {
  const pick = picked(link, hold);
  if (pick?.slug == null || shown?.slug === pick.slug) return pick;
  return link.kind === "work" ? { slug: null } : null;
}

/** 입력창이 쥔 것 가운데 첫 말과 함께 갈 것 — Work 없는 쪽의 것, 또는 지금 고른 Work에서 바꾼 것. */
function picked(link: ThreadLink, hold: ServiceHold): ServicePick | null {
  if (link.kind !== "work") return hold.loose === null ? null : { slug: hold.loose };
  return hold.work?.slug === link.slug ? { slug: hold.work.service } : null;
}

/**
 * Thread 머리 줄 이름 앞의 Service(§10) — Work 없는 Thread에 Service가 있으면 「흐린 Service / 채팅 이름」의 그 Service다(누르면 Service 상세). 그
 * Thread의 읽는 범위가 싣는 Service다 — 없거나 그 파일이 없으면(범위를 아직 못 읽었어도) 이름만 선다. 빈 자리를 말하지 않는다. Work에 이은
 * Thread는 02 그대로 Work 단추만 둔다.
 */
export function headService(work: string | null, scope: ReadingScope | undefined): { slug: string; name: string } | null {
  if (work !== null || !scope?.service) return null;
  return { slug: scope.service.slug, name: scope.service.name };
}

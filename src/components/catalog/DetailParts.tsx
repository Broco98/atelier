// **머리 줄의 crumb**(03 구현 스펙 §14 · §16 · 시안 F1-ProjectDetail · F1-SpaceDetail) — 상세의 머리 줄 「Projects / web-app」 · 「Services / 결제 시스템」과
// Work 화면 머리의 「Service / 작업공간 이름」이 함께 쓴다(03 결정 10 · 03 코드 리뷰 D1).
//
// 한때(03) 여기에 상세의 판 · 묶음 · 설명 칸(`DetailPanel` · `Section` · `DescriptionSection`)이 있었다. Project 상세(restart 03-2)와 Service 상세
// (restart 03-3)가 공용 상세 틀(`PlaceDetail`)로 옮겨 걷었다.

import { HEAD_CRUMB } from "@/components/shell/ShellHead";
import { cn } from "@/lib/utils";

/**
 * 머리 줄 이름 앞 흐린 자리와 「/」(시안 `.ra-crumb .svc` — 「Projects /」, 13/18 `fg-tertiary`) — `onOpen`이 있으면 누르는 글(목록으로), 없으면
 * 누르지 않는 글이다. 글과 「/」 사이는 한 칸(4)이다(시안은 「Projects /」 한 글이다). 이름과는 crumb 사이 6이다(부르는 자리 — `HEAD_CRUMB_GAP`).
 */
export function HeadCrumb({ label, onOpen }: { label: string; onOpen?: () => void }) {
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1">
      {onOpen ? (
        // `tabIndex`를 명시한다 — WebKit의 Tab은 맨 단추에 서지 않는다(`@/lib/roving` 머리말, restart 03-13b).
        <button
          type="button"
          tabIndex={0}
          onClick={onOpen}
          className={cn("rounded-md whitespace-nowrap transition-colors hover:text-fg focus-ring", HEAD_CRUMB)}
        >
          {label}
        </button>
      ) : (
        <span className={cn("min-w-0 truncate", HEAD_CRUMB)}>{label}</span>
      )}
      <CrumbSlash />
    </span>
  );
}

/** crumb 뒤의 「/」 — 이름 앞 자리를 메뉴로 여는 곳(Work 화면의 Service)도 이것을 쓴다. */
export function CrumbSlash() {
  return (
    <span aria-hidden className={cn("shrink-0", HEAD_CRUMB)}>
      /
    </span>
  );
}

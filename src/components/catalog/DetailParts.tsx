// **머리 줄의 crumb**(03 구현 스펙 §14 · §16 · 시안 F1-ProjectDetail · F1-SpaceDetail) — 상세의 머리 줄 「Projects / web-app」 · 「Services / 결제 시스템」과
// Work 화면 머리의 「Service / 작업공간 이름」이 함께 쓴다(03 결정 10 · 03 코드 리뷰 D1).
//
// 한때(03) 여기에 상세의 판 · 묶음 · 설명 칸(`DetailPanel` · `Section` · `DescriptionSection`)이 있었다. Project 상세(restart 03-2)와 Service 상세
// (restart 03-3)가 공용 상세 틀(`PlaceDetail`)로 옮겨 걷었다.

/** 머리 줄 이름 앞 흐린 자리와 「/」(시안 `.tb-c .muted`) — `onOpen`이 있으면 누르는 글(목록으로), 없으면 누르지 않는 글이다. */
export function HeadCrumb({ label, onOpen }: { label: string; onOpen?: () => void }) {
  return (
    <>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md text-sm whitespace-nowrap text-fg-titlebar transition-colors hover:text-fg focus-ring"
        >
          {label}
        </button>
      ) : (
        <span className="min-w-0 truncate text-sm text-fg-titlebar">{label}</span>
      )}
      <CrumbSlash />
    </>
  );
}

/** crumb 뒤의 「/」 — 이름 앞 자리를 메뉴로 여는 곳(Work 화면의 Service)도 이것을 쓴다. */
export function CrumbSlash() {
  return (
    <span aria-hidden className="shrink-0 text-sm text-fg-titlebar">
      /
    </span>
  );
}

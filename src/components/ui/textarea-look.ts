// **여러 줄 칸의 클래스** — 설정의 「셸을 닫아도 남길 프로세스」와 spec 레이아웃 편집기의 칸들이 함께 쓴다. 여러 줄 칸은
// 부품이 없어(develop P8 — Textarea를 들이지 않는다) 쓰는 자리가 손으로 짓는데, 자리마다 옮겨 적으면 한쪽만 고쳐져 여백이
// 갈린다(예외 칸만 좌우 9px · 위아래 6px이던 때가 있었다). 그래서 부품 대신 클래스 문자열을 여기 한 곳에 둔다
// (`dialog-look.ts`와 같은 까닭).
//
// 규격은 설정 화면의 한 줄 칸(`Input`의 `field`)과 같은 가족이다 — 모서리 `radius-md` · border-heavy · 흰 바탕 · `text-sm`, 포커스는
// 앱의 한 링(`focus-ring` — 디자인 시스템의 `.at-input.area`). 폭은 쓰는 자리가 `className`으로 정한다(`Input`과 같은 규칙 — 기본은
// w-full). Space · Project 상세의 설명 칸(`SpaceDetail` · `ProjectDetail`)은 이것을 쓰지 않는다 — 읽는 글과 같은 글자(`text-chat-body`) ·
// 반경(12)에 서는 시안의 칸이다(03 시안 `.ta`). 포커스만 이 가족의 것(앱의 한 링)이다.
export const textareaLook =
  "w-full resize-y rounded-md border border-border-heavy bg-surface px-2.5 py-2 text-sm outline-none focus-ring";

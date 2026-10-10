// **여러 줄 칸의 클래스** — 설정의 「셸을 닫아도 남길 프로세스」와 spec 레이아웃 편집기의 칸들이 함께 쓴다. 여러 줄 칸은
// 부품이 없어(develop P8 — Textarea를 들이지 않는다) 쓰는 자리가 손으로 짓는데, 자리마다 옮겨 적으면 한쪽만 고쳐져 여백이
// 갈린다(예외 칸만 좌우 9px · 위아래 6px이던 때가 있었다). 그래서 부품 대신 클래스 문자열을 여기 한 곳에 둔다
// (`dialog-look.ts`와 같은 까닭).
//
// 규격은 설정 화면의 한 줄 칸(`Input`의 `field`)과 같은 가족이다 — 모서리 `rounded-lg` · border-strong · 흰 바탕 · 13px, 포커스는
// 테두리 primary + 바깥 3px 옅은 링(디자인 시스템의 `.at-textarea` · `.at-input.focus`). 폭은 쓰는 자리가 `className`으로 정한다(`Input`과 같은 규칙 — 기본은 w-full). 프로젝트 설명의 여러 줄
// 칸(`ProjectDetail`)은 이것을 쓰지 않는다 — 누르기 전의 설명 상자와 같은 자리 · 반경(16) · 글자(`text-row`)에 서는 인라인 편집기다.
// 포커스만 이 가족의 것(테두리 primary + 3px 옅은 링)이다.
export const textareaLook =
  "w-full resize-y rounded-lg border border-border-strong bg-background px-2.5 py-2 text-ui leading-[1.6] outline-none focus:border-primary focus:ring-3 focus:ring-primary/20";

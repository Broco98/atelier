// **창(`dialog.tsx`)과 확인 창(`alert-dialog.tsx`)이 함께 쓰는 조각의 클래스.** 둘은 한 계열의 창이라
// 가림막 · 창 상자 · 가운데 창의 자리와 폭 · 머리 · 제목 · 설명 · 바닥이 같은 값이다. 두 부품 파일이
// 각자 옮겨 적고 「확인 창과 같은 값」이라 적어 두던 것을 여기 한 곳에 둔다 — 한쪽만 고쳐지는 날
// 두 창이 갈린다.
//
// `@utility`가 아니라 클래스 문자열인 까닭은 둘이다.
// - 가림막과 창 상자의 열림 애니메이션(`animate-in`·`animate-out`)은 registry 클래스 그대로 class
//   속성에 남아야 한다. 동작 줄이기 규칙(index.css의 `[data-slot][class*="animate-"]`)이 class 속성의
//   글자로 그 요소를 찾는다.
// - 쓰는 자리의 `className`과 `cn`으로 겨루는 것이 지금과 같게 남는다.
//
// 창 카드의 모양 자체(13px 모서리 · 강한 테두리 · 큰 그림자 · 흰 바탕)는 떠 있는 카드 모두의 것이라
// index.css의 `floating-card`가 든다.
export const dialogLook = {
  // 앱의 모든 모달이 쓰는 막(`modal-scrim`) — 뒤를 흐리지 않고 어둡게만 한다.
  overlay:
    "modal-scrim isolate duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
  // 창 상자 — 가로 가운데에 서는 떠 있는 카드. 세로 자리·폭·안쪽은 창마다 정한다.
  popup:
    "fixed left-1/2 z-50 -translate-x-1/2 floating-card text-foreground duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
  // 가운데의 작은 창 — 확인 창과 이름 바꾸기 창.
  center: "top-1/2 grid w-[330px] max-w-[calc(100%-4rem)] -translate-y-1/2 gap-4 p-4",
  header: "grid gap-1.5",
  footer: "flex justify-end gap-1.5",
  title: "text-[14px] font-semibold tracking-[-0.01em]",
  description:
    "text-[13px] leading-[1.6] text-tertiary *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
} as const

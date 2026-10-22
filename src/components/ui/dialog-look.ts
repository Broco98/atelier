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
// 창 카드의 모양 자체(카드 모서리 · 흰 바탕 · 테두리 없이 `shadow-prominent`)는 떠 있는 카드 모두의 것이라
// index.css의 `floating-card`가 든다. 팔레트 · 전체화면 뷰어 · 읽는 창(`dialog.tsx`)도 그 모양을 입는다.
//
// 가운데의 작은 창은 디자인 시스템의 확인 창(`.at-dialog`)이다 — 폭 400 · 안쪽 20 · 모서리 `radius-4xl`(24) · 그림자 `shadow-modal`
// (떠 있는 그림자 `prominent`에 큰 그림자 `2xl`을 겹친 것 — codex-ds 스펙 §3 「확인 창」). 제목과 설명 사이 8, 설명과 바닥 버튼 사이
// 20, 바닥 버튼 사이 8이다. 폭 400에 바닥 버튼 셋(떠날 때의 [계속 편집] · [버리고 나가기] · [저장하고 나가기])이 한 줄에 선다.
// 제목은 `heading-xs`(16/24 · 600), 설명은 `text-sm` fg-secondary다 — DS README 「글자」 표의 확인 창 자리다(codex-ds 티켓 03).
// 전체화면 뷰어는 이 모양이 아니라 떠 있는 카드(`floating-card`) 그대로이고, 읽는 창(「LLM이 받는 텍스트」)은 떠 있는 카드에 이 창의
// 모서리 `radius-4xl` · 그림자 `shadow-modal`을 입는다(DS `Dialog` — codex-ds 티켓 23, `dialog.tsx`의 `preview`). 팔레트는 떠 있는 카드에
// 그림자만 이 창의 `shadow-modal`이다(DS 「깊이」 — 팔레트 · 확인 창은 `shadow-2xl`을 더한다, `dialog.tsx`의 `palette`). 제목 조각은 두 부품의 모든 제목이
// 쓴다 — 가운데 창만이 아니라 「LLM이 받는 텍스트」 미리보기의 머리 줄 제목도 16/24다(codex-ds 스펙 「확인 창 · 다이얼로그 … 제목은
// heading-xs」).
export const dialogLook = {
  // 앱의 모든 모달이 쓰는 막(`modal-scrim`) — 뒤를 흐리지 않고 어둡게만 한다.
  overlay:
    "modal-scrim isolate duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
  // 창 상자 — 가로 가운데에 서는 떠 있는 카드. 세로 자리·폭·안쪽은 창마다 정한다.
  popup:
    "fixed left-1/2 z-50 -translate-x-1/2 floating-card text-fg duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
  // 가운데의 작은 창 — 확인 창과 이름 바꾸기 창. 모서리 · 그림자는 떠 있는 카드의 것을 덮는다(코어 유틸리티가 커스텀
  // @utility 뒤에 서서 이긴다 — toggle.tsx 머리말).
  center: "top-1/2 grid w-100 max-w-[calc(100%-4rem)] -translate-y-1/2 gap-5 rounded-4xl p-5 shadow-modal",
  header: "grid gap-2",
  footer: "flex justify-end gap-2",
  title: "text-heading-xs",
  description:
    "text-sm text-fg-secondary *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-fg",
} as const

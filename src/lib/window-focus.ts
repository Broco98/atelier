/**
 * 앱 창이 포커스를 쥐고 있나 — 「봤다」의 한쪽 재료다. 터미널 셸의 「봤다」(terminal-activity-signal 결정 7 · `terminal-store.ts`)와 nav `Processes`의 `●`
 * (프로세스 스펙 S41 — 띠와 같은 규칙 · `looked.ts`의 `useSeeWhileLooking`)가 이 한 판정을 읽는다. 두 자리가 따로 적으면 한쪽만 고친 날 같은 창을
 * 두 판정이 다르게 본다. 이 앱은 창이 하나라 어느 창인지 물을 것이 없다.
 *
 * **`document.hasFocus()`가 판정이고 `focus`/`blur`는 신호일 뿐이다.** 이벤트만으로는 못 가른다 — 분할에서 spec 프레임을 누르면
 * 부모 `window`에 `blur`가 오는데(SpecViewer의 `useFrameFocused`가 그 실측을 들고 있다) 그때도 앱은 앞에 있다. `hasFocus()`는 그
 * 경우에 참이고 다른 앱으로 넘어갔을 때만 거짓이라, 두 경우가 갈린다.
 *
 * **Tauri의 `onFocusChanged`를 안 쓴다.** 값은 더 정확하겠지만 IPC 구독이 하나 더 늘어 픽스처 백엔드가 모르는 호출이 되고(L3의
 * `unknownIpcCalls`), 얻는 것은 이 DOM 이벤트가 이미 주는 사실 하나다.
 *
 * **이 줄에 그물이 걸려 있다.** 여기가 참을 늘 돌려주면 아무도 안 보는 곳에서 「봤다」가 서는데 그 fail-open은 초록이 안 뜨는 것으로만
 * 나타나 화면에서 안 보인다 — 헤드리스 WebKit은 `document.hasFocus()`가 늘 참이라 브라우저에 맡길 수 없어서, L3가 그 함수를 손으로
 * 잡고 「창이 뒤에 있으면 초록 · `●`가 선다」를 잰다(`e2e/terminal-tabs.spec.ts` · `e2e/processes-nav-meta.spec.ts`).
 */
export function windowFocused(): boolean {
  // 문서가 없는 자리(웹뷰 밖)에서는 **거짓**이다.
  return typeof document !== "undefined" && document.hasFocus();
}

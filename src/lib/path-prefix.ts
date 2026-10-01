/**
 * 이 주소가 그 자리이거나 그 아래인가. **정확히 같거나 `자리/`로 시작할 때만** 참이다 —
 * `startsWith(place)` 하나로 두면 `/settingsx` 같은 이웃 주소가 조용히 안으로 든다.
 *
 * 한 자리에 두는 이유: 「설정 안인가」(문의 가드)와 「모드를 안 싣는 주소인가」(`placeModeOf`)가
 * 같은 경계를 묻는다. 각자 적으면 끝의 `/`를 다루는 방식을 한쪽만 고치는 날 가드와 「떠나온
 * 자리」가 같은 주소를 다르게 읽는다.
 *
 * **의존이 없는 잎 모듈이다** — `mode.ts`가 `features/settings/pages.ts`를 이미 가져오므로, 이것이
 * 둘 중 하나에 살면 다른 쪽이 가져오는 순간 순환이 된다.
 */
export function isAtOrUnder(pathname: string, place: string): boolean {
  return pathname === place || pathname.startsWith(`${place}/`);
}

/**
 * 주소가 가리키는 work의 slug. work 목록 주소(`/works`)와 다른 화면에서는 `null`이다.
 *
 * **주소에서 slug를 읽는 자리는 여기 하나다** — 사이드바 강조 · 떠남(`screenOwner`) · 셸로 가는 길 · 설정에서 돌아갈 씨앗이 같은
 * 이것을 딛는다. 각자 적으면 인코딩된 slug(한글)를 한쪽만 푸는 날 같은 주소를 다른 work으로 읽는다. `decodeURIComponent`가
 * 그래서 여기 있다.
 *
 * 첫 칸만 본다 — slug는 경로의 한 칸이고, 뒤에 더 붙은 주소는 그 work의 하위 화면이지 다른 slug가 아니다.
 */
export function workSlugOf(pathname: string): string | null {
  const prefix = "/works/";
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split("/")[0];
  return segment ? decodeURIComponent(segment) : null;
}

/**
 * 이 주소가 그 자리이거나 그 아래인가. **정확히 같거나 `자리/`로 시작할 때만** 참이다 —
 * `startsWith(place)` 하나로 두면 `/settingsx`·`/maisonette` 같은 이웃 주소가 조용히 안으로 든다.
 *
 * 한 자리에 두는 이유: 「설정 안인가」(문의 가드), 「어느 세계인가」(`modeOf`), 「모드를 안
 * 싣는 주소인가」(`placeModeOf`)가 같은 경계를 묻는다. 각자 적으면 끝의 `/`를 다루는 방식을
 * 한쪽만 고치는 날 가드와 「떠나온 세계」가 같은 주소를 다르게 읽는다.
 *
 * **의존이 없는 잎 모듈이다** — `mode.ts`가 `features/settings/pages.ts`를 이미 가져오므로, 이것이
 * 둘 중 하나에 살면 다른 쪽이 가져오는 순간 순환이 된다.
 */
export function isAtOrUnder(pathname: string, place: string): boolean {
  return pathname === place || pathname.startsWith(`${place}/`);
}

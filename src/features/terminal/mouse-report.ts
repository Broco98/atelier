/**
 * 셸로 가는 덩어리에서 **좌표가 수가 아닌 SGR 마우스 보고**만 잘라 낸다(terminal-nan-grid-guard 결정 10). 셸의 `onData`가
 * 쓰기 전에 부른다 — 셸로 가는 바이트는 모두 그 한 자리를 지나므로, 어느 길로 새든 여기서 걸린다.
 *
 * **무엇이 그런 보고를 짓나.** 셸을 누르면 xterm이 끌기 · 놓음 리스너를 document에 달고 놓음이 와야 거둔다. 놓음을 못 받은 채
 * (셸 칸 오른쪽 클릭의 WebKit 기본 메뉴가 가져간다 · 누른 채 탭을 옮긴다) 셸의 집이 떼어지면, 그 뒤 앱 어디서 끌든 떼어진
 * 요소로 좌표를 잰다. 계산 스타일이 빈 문자열이라 좌표가 `NaN`이 되고, xterm의 범위 검사와 같은 사건 거르기는 `NaN`을 못
 * 걸러 움직임마다 `ESC[<32;NaN;NaNM`이 한 줄씩 나간다. 받는 쪽(`claude`)은 그것을 마우스로 못 알아보고 입력 글자로 받는다.
 * xterm을 고치지 않고 여기서 거르는 것은 xterm 내부에 안 기대려는 것이다 — upstream이 같은 가드를 넣어도 이 자리는 해가 없다.
 *
 * **SGR만 본다.** 기본(X10) 인코딩의 보고는 xterm이 `onBinary`로 내는데 아틀리에는 그것을 잇지 않아 원래 셸에 안 간다.
 *
 * **데이터 모양으로 가른다** — 그래서 `shell-input`(DOM 사건으로 가른다)과 따로 산다. `NaN` 놓음(`…m`)도 함께 버려지는데,
 * 받는 쪽이 원래도 못 알아보던 것이라 잃는 동작은 없다.
 */

/**
 * SGR 마우스 보고 한 줄 — `ESC[<버튼;x;y` + 종료(`M` 누름 · 끌기, `m` 놓음). 픽셀 좌표 모드(`?1016h`)도 꼴이 같다.
 *
 * **좌표 자리는 `;` · `M` · `m` · `ESC`를 넘지 않는다**(구현 스펙 S2). 넘으면 끝나지 않은 꼴이 뒤에 오는 키 · 응답까지 한
 * 보고로 읽어 함께 삼킨다. 버튼 자리는 안 본다 — 사건의 `button`에서 오므로 `NaN`이 될 재료가 없다.
 */
const SGR_MOUSE_REPORT = /\x1b\[<\d+;([^;Mm\x1b]*);([^;Mm\x1b]*)[Mm]/g;

/** 수인 좌표. 음수도 수다 — `claude`의 SGR 파서(`-?\d+`)가 받는 꼴과 같다. */
const COORDINATE = /^-?\d+$/;

/**
 * 좌표 둘 중 하나라도 수가 아닌 보고를 잘라 낸 나머지와 잘라 낸 수. 다른 바이트는 순서도 내용도 그대로다. 나머지가 빈
 * 문자열이면 부르는 쪽은 쓰지 않는다.
 */
export function dropBrokenMouseReports(data: string): { data: string; dropped: number } {
  let dropped = 0;
  const kept = data.replace(SGR_MOUSE_REPORT, (report, x: string, y: string) => {
    if (COORDINATE.test(x) && COORDINATE.test(y)) return report;
    dropped += 1;
    return "";
  });
  return { data: kept, dropped };
}

/**
 * 잘라 낸 것을 남기는 **dev 가드 한 곳**이다(terminal-nan-grid-guard 결정 11 — `traceDrag`와 같은 꼴). 조용히 버리면 xterm이
 * 다른 길로 `NaN`을 또 만들어도 아무도 모른다. 릴리스 빌드에서는 Vite가 그 표시(`DEV`)를 거짓 상수로 바꿔 아래가 통째로
 * 빠진다.
 */
export function traceDroppedMouseReports(shellId: number, dropped: number): void {
  if (!import.meta.env.DEV) return;
  console.debug(`atelier: 망가진 마우스 보고 ${dropped}개를 셸 ${shellId}에 안 보냈다`);
}

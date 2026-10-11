// 셸 틀의 **배치 규격** — 탭 줄의 바닥(`TAB_ROW_CARD` · `TAB_ROW_COLUMN`), 그 바닥을 위해 자리를 내주는 접히는
// 패널(사이드바 · 작업 패널)의 트랜지션(`PANEL_MOTION` · `foldingInnerClass` · `panelMotionMs`), 그리고 작업 패널 카드의 기본
// 폭(`WORK_PANEL_WIDTH`). 바닥과 트랜지션이 한 파일인 것은 한쪽이 다른 쪽의 전제라서다: 열이 바닥을 들면 패널이 좁게
// 서고, 좁게 선 패널의 안쪽 열이 잘리지 않게 하는 장치가 아래 `foldingInnerClass`다. 기본 폭은 그 패널 칸의 값이고
// 작업 화면과 spec 레이아웃 편집기 두 기능이 함께 읽어 어느 한쪽 폴더에 두지 않는다.
//
// **기능 폴더 밖에 산다.** 한때 이 바닥이 `features/terminal/ShellTabs`에서 나와 문서 뷰어(`SpecViewer`)가 그것을
// import했다 — 그 바람에 보관함 화면까지 터미널 모듈을 끌어왔다. 이 규격은 탭 줄의 것이 아니라 그 줄을 **이는 카드와 열**의
// 것이다. 줄은 제 머리에 `data-tab-row`를 단다(`ShellTabs`) — 아래 두 규격이 그 표식 하나로 줄을 가른다.

/**
 * 탭 줄(`ShellTabs`)을 **머리에 이는 카드**의 바닥 — 카드가 그 줄의 min-content보다 좁아지지 않는다(codex-ds 스펙 §4 「탭 줄」
 * — 줄이 본문 카드 머리로 내려왔다). work 화면의 본문 카드(문서 · 터미널), 분할의 열 카드, `/terminal`의 카드가 든다.
 *
 * 줄 안에서 줄어드는 것은 셸 칸 상자뿐이고 그 바닥이 칸 하나다(`ShellTabs`의 상자 주석). 그런데 카드가
 * `min-w-0`이면 줄이 그 바닥을 들고 있어도 카드가 먼저 0까지 줄어, 넘치는 몫이 카드 모서리에 잘린다. 그래서
 * 바닥을 **카드에** 건다(`min-w-min`): 카드 줄 안에서는 작업 패널이 제 최소 폭까지 자리를 내주고, 그래도 모자라면 카드
 * 줄의 min-content가 본문 열의 바닥이 되어(`TAB_ROW_COLUMN`) 사이드바가 자리를 내준다 — 사이드바는 줄어들 수 있고 이
 * 카드는 못 준다.
 *
 * **숫자가 아니라 min-content인 것**은 줄의 폭이 화면마다 갈려서다(`spec` 칸이 없는 `/terminal`, 열 닫기 `×`가 서는 분할의
 * 터미널 열, 칸이 없는 줄) — 손으로 더한 합은 이 자리에서 세 번 틀렸다.
 *
 * **카드의 min-content에 줄만 들어가야 한다.** 카드에는 xterm 캔버스와 문서 본문(넓은 표·코드 블록), 탭 줄 아래 경로
 * 줄(`PathBar`)도 사는데 그것들의 min-content까지 세면 소스 보기를 켤 때마다 바닥이 부풀어 패널이 창 밖으로 밀린다. 그래서
 * 줄 아닌 자식은 `contain: inline-size`로 제 내용의 폭을 바깥에 안 알린다 — 그려지는 폭은 그대로다(카드가 늘여 준다).
 * 줄이 없는 카드(분할의 문서 열)도 같은 클래스를 들면 자식이 모두 격리되어 바닥이 없다.
 */
export const TAB_ROW_CARD = "min-w-min [&>:not([data-tab-row])]:contain-inline-size";

/**
 * 공용 틀의 **본문 열**(`Frame`)의 바닥 — 탭 줄을 품은 카드 줄이 열의 min-content를 정한다. 머리 줄(`header`)은 이 열이 아니라
 * 틀 뿌리의 맨 위 줄이라(codex-ds 스펙 §4) 제 min-content를 뿌리에 따로 알린다(`Frame`의 `HeadRow`).
 *
 * 열의 min-width가 min-content이면 옆의 사이드바가 제 최소 폭까지 자리를 내준다. 카드 줄은 **탭 줄을 품었을 때만**
 * 제 min-content를 알린다 — 그 카드 줄 안의 것들이 저마다 제 몫만 알리도록 지어져 있어서다: 탭 줄을 이는 카드는 줄의
 * 바닥(`TAB_ROW_CARD`), 작업 패널은 제 최소 폭(`Frame`의 패널 칸), 덮는 것은 절대 위치라 아무것도. 탭 줄이 없는
 * 카드 줄(Projects · Archive · Processes · Settings)은 통째로 격리되어 목록 · 표의 글자 폭이 사이드바를 밀지 않는다.
 * 하나 예외가 있다 — 옆 칸이 선 카드 줄(편집기)은 이 격리를 벗고 본문 카드의 바닥과 옆 칸 카드의 **머리**를 바닥에 더한다(몸은
 * 카드가 격리한다 — 편집기의 폼 카드는 밖 변경 배너가 선 동안만 바닥이 있다, `Frame`의 `BesideBox`).
 */
export const TAB_ROW_COLUMN = "min-w-min [&>:not(:has([data-tab-row]))]:contain-inline-size";

/**
 * 작업 패널 카드의 기본 폭(px) — 끌어 바꾼 폭이 없을 때 선다(`WorksPage`의 폭 훅). spec 레이아웃 편집기의 트리 카드가 같은 폭으로
 * 고정해 선다 — 작업 화면의 spec 패널과 같은 쪽 · 같은 폭이다(판 06 티켓 07). 한 수를 두 자리에 적으면 한쪽만 고친 날 둘이 갈린다.
 *
 * **값은 DS 패널 폭 `size-panel`(340)이다**(codex-ds 스펙 S4 — 「폭 기본은 DS, 범위는 지금 것」). 그래서 저장된 폭은 범위(260–560)
 * 안이면 그대로 선다 — 기본만 바뀐다. 수로 적는 것은 폭 훅이 수를 받아서다(`--size-panel`과 같은 값 — 그려진 기본 폭을 e2e
 * `frame.spec`이 그 토큰과 맞댄다). 레일의 L3 진열대(`e2e/rail-fixture.tsx`)도 이 수를 읽는다. 앞의 330은 사용자가 끌어서
 * 고른 폭이었다(2026-08-17, 실측 326.38px을 반올림 — 296은 좁아 경로와 파일 이름의 꼬리가 잘렸고, 한 번 420으로 올렸다가 사람이
 * 다시 줄였다). DS 값이 그 자리를 이었다.
 */
export const WORK_PANEL_WIDTH = 340;

/**
 * 접히는 패널 **바깥 상자**의 폭 트랜지션 길이와 곡선 — Atelier 토큰 `duration-panel`(220ms) · `ease-panel`이다(index.css의
 * `@theme static`, DS 「움직임」 — 패널 여닫기는 Codex가 말하지 않아 지금 앱의 값을 이었다).
 *
 * 길이가 아래 `foldingInnerClass`의 `max-width` 지연과 **같은 값이어야 한다** — 다르면 좁게 선 패널을 펼 때
 * 안쪽 열이 폭이 다 오기 전에 잘리거나(지연이 짧다) 다 온 뒤에 한 번 더 되흐른다(길다). 둘이 같은 토큰(`--duration-panel`)을
 * 읽는 것으로 그 같음을 든다(`panel-layout.test.ts`).
 *
 * 패널과 **함께 움직이는** 것도 이 값을 읽는다 — 사이드바 폭을 따라오는 공용 틀의 여백(머리 줄 · 카드 줄)과 분할 열 폭이 훌쩍
 * 뛰는 순간(둘 다 `Frame`), 그리고 전체화면에 들고 날 때 머리 줄의 왼쪽 여백과 함께 옮겨 가는 셸 컨트롤 줄(`ShellControls`)이다.
 * 제 리터럴로 다시 적으면 한쪽만 고친 날 카드 모서리가 사이드바 경계를 지나쳤다 되돌아온다. 분할 열이 뛰는 순간을 끝내는 타이머는
 * CSS가 아니라서 같은 토큰을 `panelMotionMs`로 읽는다.
 */
export const PANEL_MOTION = "duration-panel ease-panel";

/**
 * 패널 여닫기 길이(ms) — `--duration-panel`을 문서 뿌리에서 읽는다. 패널과 같은 박자로 움직인 것이 **언제 끝나는지**를 스크립트가
 * 알아야 하는 자리(분할의 되돌림 — `useSplitRatio`)가 부른다. 그 자리가 수를 따로 들면 토큰을 고친 날 타이머만 옛 길이로 남는다.
 * 토큰이 안 풀리면(스타일시트 없이 그린 자리) 0이다 — 그때는 옮겨 갈 트랜지션도 없다.
 */
export function panelMotionMs(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--duration-panel").trim();
  const time = parseFloat(value);
  if (!Number.isFinite(time)) return 0;
  return value.endsWith("ms") ? time : time * 1000;
}

/**
 * 접히는 패널 **안쪽 열**의 클래스 — 사이드바 · 작업 패널이 같은 장치를 쓴다.
 *
 * 안쪽은 접히는 동안 고정 폭이라 되흐르지 않고, **펴진 뒤에만** 바깥 폭을 상한(`max-w-full`)으로 받는다: 펼 때는
 * 폭 트랜지션이 끝난 뒤 `max-width`가 그 자리로 한 번에 넘어가고(지연 = 바깥 길이 · 길이 0), 접을 때는
 * 곧장 걷힌다. 걷힌 값이 `none`이 아니라 `100vw`인 것은 `none`과 백분율은 보간할 수 없는 쌍이라 지연 자체가
 * 안 걸려서다. 상한이 셋 모두 바깥 폭 그대로인 것은 어느 바깥 상자에도 오른쪽 경계선이 없어서다(ui-refresh 결정 4).
 */
export function foldingInnerClass(open: boolean): string {
  return open
    ? "max-w-full transition-[opacity,max-width] opacity-100 delay-[0s,var(--duration-panel)] duration-[var(--duration-panel),0s]"
    : "max-w-[100vw] opacity-0 transition-opacity duration-basic";
}

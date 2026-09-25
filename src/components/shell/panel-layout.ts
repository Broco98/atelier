// 셸 틀의 **배치 규격** 두 가지 — 탭 줄을 이는 본문 열의 바닥, 그리고 그 바닥을 위해 자리를 내주는 접히는
// 패널(사이드바 · 작업 패널)의 트랜지션. 둘이 한 파일인 것은 한쪽이 다른 쪽의 전제라서다: 열이 바닥을
// 들면 패널이 좁게 서고, 좁게 선 패널의 안쪽 열이 잘리지 않게 하는 장치가 아래 `foldingInnerClass`다.
//
// **기능 폴더 밖에 산다.** 한때 `TAB_ROW_COLUMN`이 `features/terminal/ShellTabs`에서 나와 문서 뷰어
// (`SpecViewer`)가 그것을 import했다 — 그 바람에 보관함 화면까지 터미널 모듈을 끌어왔다. 이 규격은 탭 줄의
// 것이 아니라 그 줄을 **이는 열**의 것이다.

/**
 * 탭 줄(`ShellTabs`)을 **머리에 이는 본문 열**의 바닥 — 열이 그 줄의 min-content보다 좁아지지 않는다.
 *
 * 줄 안에서 줄어드는 것은 셸 칸 상자뿐이고 그 바닥이 칸 하나다(`ShellTabs`의 상자 주석). 그런데 열이
 * `min-w-0`이면 줄이 그 바닥을 들고 있어도 열이 먼저 0까지 줄어, 넘치는 몫이 줄 밖으로 나간다. 그래서
 * 바닥을 **열에** 건다: 열의 min-width가 min-content이면, 옆의 작업 패널과 사이드바가 각자의 최소 폭까지
 * 자리를 내준다 — 그 둘은 줄어들 수 있고 이 열은 못 준다.
 *
 * **숫자가 아니라 min-content인 것**은 조작 묶음의 폭이 화면마다 갈려서다(Maison·Atelier, 패널 펼치기
 * 버튼, 칸이 없는 줄) — 손으로 더한 합은 이 자리에서 세 번 틀렸다.
 *
 * **열의 min-content에 줄만 들어가야 한다.** 열에는 xterm 캔버스와 문서 본문(넓은 표·코드 블록)도 사는데
 * 그것들의 min-content까지 세면 소스 보기를 켤 때마다 바닥이 부풀어 패널이 창 밖으로 밀린다. 그래서 줄
 * 아닌 자식은 `contain: inline-size`로 제 내용의 폭을 바깥에 안 알린다 — 그려지는 폭은 그대로다(열이 늘여
 * 준다). 줄을 `header`로 가르는 것은 `ShellTabs`의 뿌리가 `<header>`여서다(`WorksPage.test`가 머리행을
 * 그 태그로 찾아 이 클래스를 든 열을 잰다).
 */
export const TAB_ROW_COLUMN = "min-w-min [&>:not(header)]:contain-inline-size";

/**
 * 접히는 패널 **바깥 상자**의 폭 트랜지션 길이와 곡선. 곡선은 `--ease-panel`(index.css)이다.
 *
 * 길이가 아래 `foldingInnerClass`의 `max-width` 지연과 **같은 수여야 한다** — 다르면 좁게 선 패널을 펼 때
 * 안쪽 열이 폭이 다 오기 전에 잘리거나(지연이 짧다) 다 온 뒤에 한 번 더 되흐른다(길다). 그 같음은
 * `panel-layout.test.ts`가 두 문자열에서 수를 읽어 든다.
 */
export const PANEL_MOTION = "duration-[220ms] ease-panel";

/**
 * 접히는 패널 **안쪽 열**의 클래스 — 사이드바와 작업 패널이 같은 장치를 쓴다.
 *
 * 안쪽은 접히는 동안 고정 폭이라 되흐르지 않고, **펴진 뒤에만** 바깥 폭을 상한(`cap`)으로 받는다: 펼 때는
 * 폭 트랜지션이 끝난 뒤 `max-width`가 그 자리로 한 번에 넘어가고(지연 = 바깥 길이 · 길이 0), 접을 때는
 * 곧장 걷힌다. 걷힌 값이 `none`이 아니라 `100vw`인 것은 `none`과 백분율은 보간할 수 없는 쌍이라 지연 자체가
 * 안 걸려서다.
 *
 * `cap`은 부르는 쪽이 **리터럴로** 적는다(Tailwind가 소스에서 클래스를 읽는다) — 사이드바는 오른쪽
 * 경계선 밑 1px까지 들어 `max-w-[calc(100%+1px)]`, 작업 패널은 `max-w-full`이다.
 */
export function foldingInnerClass(open: boolean, cap: string): string {
  return open
    ? `${cap} transition-[opacity,max-width] opacity-100 delay-[0s,220ms] duration-[220ms,0s]`
    : "max-w-[100vw] opacity-0 transition-opacity duration-150";
}

import type { TerminalSettings, TerminalTheme } from "@/features/settings/types";

// 셸이 **고르지 않았을 때** 쓰는 값과, 고른 값을 그 자리에 끼우는 규칙. `terminal-store.ts`에서
// 꺼내 왔다 — 설정 화면도 같은 값을 읽어야 하는데(미리보기의 「기본」) 그 모듈을 import하면
// `@xterm/*`와 그 CSS가 함께 온다. 그러면 터미널을 한 번도 안 여는 사람도 앱이 뜨는 순간부터
// 그 무게를 진다: 지금 그 청크는 `/terminal`과 Work 화면에만 붙어 있다.
//
// **이 파일에는 값 import가 하나도 없다 — 타입 둘뿐이다.** 그 성질이 존재 이유이므로, 여기에
// 값 import를 하나라도 들이려면 그 사슬 끝에 무엇이 달려 있는지 다시 세야 한다.
//
// (`vite.config.ts` 주석과 `theme-tokens.test.ts` 머리말이 「셸 쪽에 한 줄이라도 새면 Node에서
// `routeTree.gen.ts`를 import하는 `router.test.ts`가 함께 죽는다」고 적어 뒀지만, 지금 그것은
// **사실이 아니다** — 실측: `@xterm/xterm`도 그 CSS도 vitest의 node 환경에서 그대로 import된다.
// 그래도 값을 여기 두는 이유는 위의 무게 하나다.)

/**
 * 터미널 기본 글꼴의 첫 항목이자 `document.fonts.load`가 **이름으로 청구하는 얼굴**.
 *
 * **결정 33이 여기서 뒤집힌다** — 터미널 기본 글꼴이 `Geist Mono Variable`에서 이것으로 갔다
 * (결정 55). 사용자의 셸 프롬프트와 상태줄이 쓰는 Nerd Font 아이콘이 `Geist Mono`에 없어
 * 앱 안 터미널에서 두부(￿)로 보였다.
 *
 * `index.css`의 `@font-face` `font-family`와 **글자 그대로 같아야 한다.** 어긋나면 아무 소리
 * 없이 폴백으로 흘러 — 번들만 1.9MB 무거워지고 아이콘은 여전히 두부다. 그 짝은
 * `font-bundle.test.ts`가 fail-closed로 지킨다.
 */
export const MONO_FACE = "JetBrainsMonoNL Nerd Font";

/**
 * 폴백 사슬의 꼬리. **끝에서 두 번째가 한글 글꼴이다**(결정 56).
 *
 * 근거는 「깨질까 봐」가 아니라 결정 52다 — 글꼴을 사용자가 고르게 되었으므로 `Menlo`를 고르면
 * 한글이 무엇으로 그려질지가 다시 우연에 맡겨진다. 끝을 못박으면 **고른 글꼴이 무엇이든 한글은
 * 늘 같은 모양**이다. macOS에 한글 고정폭 글꼴은 기본으로 없어서(실측) 비례 글꼴을 적는다.
 */
const FALLBACKS = "ui-monospace, SFMono-Regular, Apple SD Gothic Neo, monospace";

/** 아무것도 안 고른 셸이 받는 목록. 첫 항목이 `MONO_FACE`인 것은 셈이 아니라 이 정의다. */
export const FONT_FAMILY = `${MONO_FACE}, ${FALLBACKS}`;

/** xterm의 기본값과 같은 값이지만 명시한다 — `document.fonts.load`에 같은 크기를 줘야 한다. */
export const FONT_SIZE = 15;

/** 셸 하나를 그리는 데 필요한 것 전부. 색 한 벌은 이름으로만 든다 — 그 이름을 실제 팔레트로 옮기는 곳은 `terminal-theme.ts`다. */
export interface TerminalLook {
  /** xterm의 `fontFamily`. **고른 글꼴이 있어도 꼬리는 늘 붙는다**(결정 56). */
  fontFamily: string;
  /** `document.fonts.load`가 청구할 얼굴 **하나** — 사슬이 아니다. 고른 글꼴을 따라간다(결정 52). */
  monoFace: string;
  fontSize: number;
  theme: TerminalTheme;
}

/**
 * 설정 파일에서 온 것을 셸이 쓸 값으로 옮긴다. **`null`은 「아직 못 읽었거나 영영 못 읽는다」**다 —
 * 앱이 뜨자마자 첫 셸이 뜨는 길과, 파일이 깨져 읽기가 실패한 길(결정 53) 둘이 그리로 온다.
 * 그때도 셸은 떠야 하므로 여기서 멈추지 않고 전부 기본값으로 답한다.
 *
 * 고른 값과 기본값을 합치는 규칙을 **여기 하나에** 둔다. 나눠 두면 「크기는 따라갔는데 글꼴은
 * 안 따라간다」처럼 반쪽만 새는 자리가 생기는데, 그건 화면에서 「원래 그런가 보다」로 읽힌다.
 */
export function terminalLook(terminal: TerminalSettings | null): TerminalLook {
  // 빈 문자열은 「고르지 않음」으로 본다. 화면은 빈 칸을 `null`로 바꿔 적지만 손으로 고친
  // 파일에는 `""`가 있을 수 있고(결정 53이 인정한 파일의 권한), 그것을 사슬 맨 앞에 그대로
  // 끼우면 목록이 통째로 망가진다.
  const picked = terminal?.fontFamily?.trim() || null;
  return {
    fontFamily: picked === null ? FONT_FAMILY : `${picked}, ${FALLBACKS}`,
    monoFace: picked ?? MONO_FACE,
    fontSize: terminal?.fontSize ?? FONT_SIZE,
    // **기본은 어둡게**(결정 54). 파일을 읽을 수 있으면 이 값은 늘 채워져 온다
    // (`settings.rs`의 `TerminalTheme::default`) — 여기 답이 필요한 것은 위의 `null` 둘이다.
    theme: terminal?.theme ?? "dark",
  };
}

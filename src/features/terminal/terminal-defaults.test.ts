import { describe, expect, it } from "vitest";
import { FONT_FAMILY, FONT_SIZE, MONO_FACE, terminalLook } from "./terminal-defaults";
import type { TerminalSettings } from "@/features/settings/types";

// 「고른 값」과 「고르지 않았을 때의 값」을 합치는 규칙 하나가 이 파일의 전부다. 그 규칙이
// 새는 방식이 전부 **조용하다** — 잘못된 글꼴로 그려진 터미널은 오류가 아니라 그냥 다른
// 화면이고, 사용자는 「원래 그런가 보다」로 읽는다. 그래서 여기에 그물을 건다.
//
// 이 파일은 `terminal-store.ts`를 지나지 않는다 — 그 모듈이 값 import 없는 순수 모듈로
// 남아 있는 한 이 검사들이 그대로 돈다(그것이 그 파일을 꺼낸 이유이기도 하다).

const settings = (over: Partial<TerminalSettings> = {}): TerminalSettings => ({
  fontFamily: null,
  fontSize: null,
  theme: "dark",
  ...over,
});

describe("아무것도 안 골랐을 때", () => {
  // 결정 55가 결정 33을 뒤집은 자리다. 이 이름이 `index.css`의 `@font-face`와 갈리면 아무 소리
  // 없이 폴백으로 흐른다 — 그 짝은 `font-bundle.test.ts`가 본다.
  it("번들한 글꼴이 사슬 맨 앞이다", () => {
    expect(FONT_FAMILY.split(",")[0].trim()).toBe(MONO_FACE);
    expect(terminalLook(null).fontFamily).toBe(FONT_FAMILY);
    expect(terminalLook(settings()).fontFamily).toBe(FONT_FAMILY);
  });

  it("크기는 FONT_SIZE다", () => {
    expect(terminalLook(null).fontSize).toBe(FONT_SIZE);
    expect(terminalLook(settings()).fontSize).toBe(FONT_SIZE);
  });

  // **「기본은 어둡게」(결정 54)를 지키는 자리가 여기다.** 예전에는 `terminal-theme.ts`의
  // `terminalTheme` 별칭이 그 답이었고 그 별칭이 다크를 가리키는지를 검사가 봤다. 별칭을
  // 지우면서 그 답이 이리로 왔다 — 파일을 못 읽는 길이 둘 있고(아직 안 읽음 · 깨진 파일),
  // 그때 무엇으로 그리는지는 이 함수만 안다.
  it("테마는 어둡게다 — 파일을 못 읽었을 때도 그렇다", () => {
    expect(terminalLook(null).theme).toBe("dark");
  });
});

describe("고른 값", () => {
  it("고른 글꼴이 사슬 맨 앞에 온다", () => {
    expect(terminalLook(settings({ fontFamily: "Menlo" })).fontFamily).toMatch(/^Menlo, /);
  });

  // **결정 56이 여기 산다.** 고른 글꼴을 그대로 넘기면(`fontFamily ?? FONT_FAMILY`) `Menlo`를
  // 고른 순간 한글이 무엇으로 그려질지가 우연에 맡겨진다 — macOS에 한글 고정폭 글꼴이 기본으로
  // 없어서다(실측). 꼬리를 못박아야 **고른 글꼴이 무엇이든 한글은 늘 같은 모양**이다.
  it("한글 글꼴이 사슬 끝에 못박혀 있다 — 무엇을 골라도", () => {
    for (const picked of [null, "Menlo", "있지도 않은 글꼴"]) {
      const chain = terminalLook(settings({ fontFamily: picked })).fontFamily.split(",");
      const hangul = chain.findIndex((one) => one.trim() === "Apple SD Gothic Neo");
      expect(hangul, `${picked}: 한글 글꼴이 사슬에 없다`).toBeGreaterThan(0);
      // 마지막은 총칭 이름이라 그 앞이 마지막 실제 글꼴이다 — 사슬 중간에 있으면 앞선
      // 글꼴이 한글 자리를 먼저 가져가 「늘 같은 모양」이 깨진다.
      expect(chain.slice(hangul + 1).map((one) => one.trim())).toEqual(["monospace"]);
    }
  });

  // 고른 이름이 사슬이 아니라 **얼굴 하나**로도 필요하다 — `document.fonts.load`가 그것을
  // 이름으로 청구한다. 사슬을 그대로 주면 그 청구가 통째로 실패해 폰트를 안 기다리게 되고,
  // 폰트가 뜨기 전에 잰 셀 폭으로 굳어 TUI 박스 선이 어긋난다(결정 52 · `loadFont` 주석).
  it("청구할 얼굴은 고른 이름 하나다", () => {
    expect(terminalLook(settings({ fontFamily: "Menlo" })).monoFace).toBe("Menlo");
    expect(terminalLook(settings()).monoFace).toBe(MONO_FACE);
  });

  it("크기와 테마는 고른 것이 이긴다", () => {
    const look = terminalLook(settings({ fontSize: 22, theme: "light" }));
    expect(look.fontSize).toBe(22);
    expect(look.theme).toBe("light");
  });

  // 화면은 빈 칸을 `null`로 바꿔 적지만 파일은 손으로 고칠 수 있다(결정 53). `""`가 사슬 맨
  // 앞에 그대로 들어가면 목록이 통째로 망가진다.
  it("빈 이름은 안 고른 것과 같다", () => {
    expect(terminalLook(settings({ fontFamily: "" })).fontFamily).toBe(FONT_FAMILY);
    expect(terminalLook(settings({ fontFamily: "   " })).monoFace).toBe(MONO_FACE);
  });
});

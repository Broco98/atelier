/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankCssComments, blankedSources, placesOf, where } from "./blank-comments";

// **Thread 화면의 움직임은 모션 보드의 토큰으로만 움직인다**(v1 티켓 43 · 구현 스펙 §14 「모션」). 시간 · 곡선은 `index.css`의 모션 보드
// 토큰이고, 움직임은 그 파일 끝 「Thread의 움직임」의 유틸리티다(`word-in` · `stream-tail` · `chip-in` · `card-rise` · `unfold` · `row-in` ·
// `morph-in` · `morph-out` · `jump-in` · `row-flash` · `chat-shimmer` · `think-shimmer` · `typing-dots` · `writing-pulse` · `view-in`). 그 값이 토큰을 읽는지는
// `tokens.test.ts`가 Tailwind를 돌려 잰다. 여기서는 Thread 화면(`src/features/thread`)이 그 길을 비켜 가는 자리를 막는다.
//   - **손으로 고른 시간 · 곡선 · 늦음**(`duration-200` · `duration-[180ms]` · `ease-in-out` · `ease-[cubic-bezier(…)]` · `delay-75`).
//     토큰을 고친 날 그 자리만 옛 박자로 남는다. 토큰 이름(`duration-arrive` · `ease-settle` · DS의 `duration-panel` …)은 된다.
//   - **`animate-*`**(Tailwind의 `animate-pulse` · tw-animate의 `animate-in` …). 그 움직임은 동작 줄이기 갈래가 없고 박자가 토큰이 아니다.
//     회전은 DS `Spinner`가 건다(동작 줄이기면 원).
//   - **인라인 `style`의 움직임**(`transition` · `animation…` 키). 값이 클래스 밖에 숨어 위 둘과 같은 일을 한다.
// 그리고 앱 전체에서 **걷은 움직임 이름**(v1 티켓 41의 `slot-in` · `dot-pop`)을 막는다 — 이름을 걷었으니 쓰면 CSS가 안 나와 그 자리만 조용히
// 멎는다. 지금 이름은 `row-in`이다(`dot-pop`의 뒤 이름 `pop-in`은 부르는 자리가 걷혀 02 티켓 12가 함께 걷었다).
//
// 세는 곳은 소스(테스트 빼고)이고 **주석은 세지 않는다**(`blank-comments.ts`).

const root = fileURLToPath(new URL("..", import.meta.url));
const sources = blankedSources();
const thread = sources.filter((one) => one.file.startsWith("src/features/thread/"));
const stylesheet = { file: "src/index.css", text: blankCssComments(readFileSync(join(root, "src/index.css"), "utf8")) };

// `index.css`의 `--transition-duration-*` · `--ease-*` 이름 — 토큰 이름은 된다.
const themeNames = (pattern: RegExp) =>
  [...stylesheet.text.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) => [...block[1].matchAll(pattern)].map((m) => m[1]));
const durations = new Set(themeNames(/--transition-duration-([a-z0-9-]+):/g));
const eases = new Set(themeNames(/--ease-([a-z0-9-]+):/g));

describe("Thread 화면의 움직임", () => {
  it("검사가 Thread 화면의 소스와 토큰 이름을 실제로 읽는다", () => {
    // 앵커 — 경로가 새서 빈 목록이면 아래가 모두 그냥 통과한다.
    expect(thread.map((one) => one.file)).toEqual(
      expect.arrayContaining(["src/features/thread/ThreadScreen.tsx", "src/features/thread/ThreadComposer.tsx"]),
    );
    // 02가 더한 Codex 움직임(02 구현 스펙 §12)도 토큰 이름이다 — 화면은 `duration-morph` · `ease-spring`처럼 그 이름으로 적는다.
    expect([...durations]).toEqual(expect.arrayContaining(["basic", "panel", "swap", "sidebar", "think", "arrive", "wave", "morph"]));
    expect([...eases]).toEqual(expect.arrayContaining(["default", "panel", "settle", "spring", "shimmer", "arrive", "wave"]));
  });

  it("시간 · 곡선은 토큰 이름이고 늦음을 손으로 적지 않는다", () => {
    const timing = placesOf(/(?<![\w-])(?:[a-z-]+:)*(duration|ease|delay)-(\[[^\]]*\]|\([^)]*\)|[a-z0-9-]+)/g, thread).filter(
      ({ match }) =>
        match[1] === "delay" || !(match[1] === "duration" ? durations : eases).has(match[2]),
    );
    expect(timing.map(where)).toEqual([]);
  });

  it("animate-* 유틸리티를 쓰지 않는다", () => {
    expect(placesOf(/(?<![\w-])(?:[a-z-]+:)*animate-[\w[\]-]+/g, thread).map(where)).toEqual([]);
  });

  // 「생각 중」은 박자를 둔 띠다(Codex cadenced shimmer — 02 구현 스펙 §12 · 스토리 98). 쉬지 않고 도는 반짝임(`chat-shimmer`)은 작업 중 ·
  // 도는 도구 줄의 것이다. 「생각 중」이 서는 자리(흐름의 도는 턴 · 첫 말을 보낸 새 Thread)가 모두 그 띠다.
  it("「생각 중」은 think-shimmer로 선다", () => {
    const thinking = placesOf(/className="([^"]*)"[^>]*>생각 중</g, thread);
    expect(thinking.length, "「생각 중」이 서는 자리").toBeGreaterThanOrEqual(2);
    expect(thinking.filter(({ match }) => !match[1].split(" ").includes("think-shimmer")).map(where)).toEqual([]);
  });

  it("인라인 style에 움직임을 적지 않는다", () => {
    expect(placesOf(/\b(?:transition|animation)\w*\s*:/g, thread).map(where)).toEqual([]);
  });
});

// **열리는 것은 움직이지 않는다**(02 구현 스펙 §12 · Diff-Tokens 「메뉴 · 팝오버 열림」 · 「툴팁」 · 「다이얼로그」 · Motion 보드 「메뉴 · 툴팁 ·
// 다이얼로그 열림」). Codex의 메뉴 · 팝오버 · 셀렉트 · 툴팁 · 다이얼로그는 한 프레임에 나타나고 곧바로 닫힌다 — 열 때마다 기다리지 않는다
// (스토리 94 · 96 · 97). 움직이며 뜨는 메뉴는 모델 피커 하나다(.32s · cubic-bezier(.23,1,.32,1) · 30ms · .98 → 1, 스토리 95). 떠 있는 것의
// 들고남은 부품 한 벌(`components/ui`)이 들므로 거기서 잰다 — tw-animate의 `animate-in` · `animate-out`과 그 짝(`fade-in` · `zoom-in` ·
// `slide-in-from-*` …), 그리고 메뉴 카드의 `animate-menu-*`.
describe("열리는 것의 움직임", () => {
  const ui = sources.filter((one) => one.file.startsWith("src/components/ui/"));
  const POPUPS = ["dropdown-menu.tsx", "context-menu.tsx", "popover.tsx", "select.tsx", "tooltip.tsx", "dialog-look.ts"];

  it("검사가 떠 있는 부품의 소스를 실제로 읽는다", () => {
    // 앵커 — 경로가 새서 빈 목록이면 아래가 그냥 통과한다.
    expect(ui.map((one) => one.file)).toEqual(expect.arrayContaining(POPUPS.map((name) => `src/components/ui/${name}`)));
  });

  it("메뉴 · 팝오버 · 셀렉트 · 툴팁 · 다이얼로그가 들고 날 때 움직이지 않는다", () => {
    const entering =
      /(?<![\w-])(?:[\w[\]=-]+:)*(?:animate-(?:in|out)|(?:fade|zoom)-(?:in|out)(?:-[\w-]+)?|slide-(?:in|out)-from-[\w-]+|animate-menu-exit)(?![\w-])/g;
    expect(placesOf(entering, ui).map(where)).toEqual([]);
  });

  it("움직이며 뜨는 메뉴는 모델 피커 하나다", () => {
    // 메뉴 카드의 열림 움직임은 한 자리(`dropdown-menu.tsx`의 `grows` 갈래)에만 서고, 그 갈래를 고르는 것은 모델 칩뿐이다.
    expect(placesOf(/animate-menu-enter/g, ui).map(({ file }) => file)).toEqual(["src/components/ui/dropdown-menu.tsx"]);
    const growing = placesOf(/<DropdownMenuContent\b[^>]*\bgrows\b/g, sources).map(({ file }) => file);
    expect(growing).toEqual(["src/features/thread/ComposerChips.tsx"]);
  });

  // 툴팁은 멈춘 지 200ms(`--delay-tip`)에 선다(스토리 96 — Codex `delayDuration`). 같은 무리의 호버 카드는 그대로 `--duration-tip`(150)이다
  // (01 결정 「공유 토큰은 새 이름으로」). 두 길이는 문서 뿌리의 토큰을 이름으로 읽는다(`hover-group.ts`의 `durationMs`).
  it("툴팁은 delay-tip 뒤에 서고, 호버 카드는 duration-tip 그대로다", () => {
    const read = (file: string) =>
      placesOf(/durationMs\("(--[\w-]+)"\)/g, sources.filter((one) => one.file === file)).map(({ match }) => match[1]);
    expect(read("src/components/ui/tooltip.tsx")).toEqual(["--delay-tip"]);
    expect(read("src/features/works/SidebarWorkList.tsx")).toEqual(expect.arrayContaining(["--duration-tip"]));
  });
});

describe("걷은 움직임 이름", () => {
  it("v1 티켓 41의 slot-in · dot-pop을 아무 데서도 쓰지 않는다", () => {
    expect(placesOf(/(?<![\w-])(?:slot-in|dot-pop)(?![\w-])/g, [...sources, stylesheet]).map(where)).toEqual([]);
  });
});

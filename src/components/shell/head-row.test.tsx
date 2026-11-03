import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Frame } from "./Frame";
import { PlainHead } from "./PlainFrame";
import ShellControls from "./ShellControls";
import { headButton } from "./ShellHead";

// 머리(이름 · 할 일)는 앱 셸의 머리 줄로 포털을 탄다 — 정적 렌더는 포털을 못 그려, 머리를 이 마크업 안 머리 줄에 곧장 세운다
// (`screen-head-inline`).
vi.mock("@/components/shell/ShellHead", async (actual) =>
  (await import("@/components/shell/screen-head-inline")).inlineScreenHead(actual),
);
// 셸 컨트롤은 라우터의 뒤로 · 앞으로를 읽는다 — 그린 꼴만 보므로 라우터 없이 「갈 곳 없음」으로 둔다.
vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ history: { back: () => {}, forward: () => {} } }),
  useCanGoBack: () => false,
}));
vi.mock("@/can-go-forward", () => ({ useCanGoForward: () => false }));

// **머리 줄은 한 결이다**(02 결정 「머리 줄은 한 결이다(03 뒤)」 · 구현 스펙 §3 「틀 하나」 · §6). 머리 줄은 앱 셸이 그리는 줄 하나라,
// 그 위에 서는 화면 것의 값도 어느 화면이든 같다 — 시안 Main 머리 줄(`.ra-title` · `.ra-crumb` · `.ra-tbtn`)의 값이다: 이름 13/18 · 400 `fg`,
// 흐린 앞 자리 `fg-tertiary`, 아이콘 단추 28 · 글리프 15 `fg-secondary`, 오른쪽 끝 단추 사이 0(이름 쪽과는 적어도 12 — `.ra-grow`), 이름 앞
// 아이콘 없음(restart 03-12a). 한때 Thread 머리 줄(06 — Codex)의 14/500 · 글리프 16 `fg-titlebar` · 사이 2였고, 그 전에는 공용 틀 화면이
// 머리 카드의 값(13/500 · 24 · 6)을 그대로 옮겨 와 두 결이 섰다. seam은 그린 꼴(markup)이다 — 칠해진 상자의 수(28 · x)는 L3(`frame.spec`)가 잰다.

const headOf = (markup: string) => markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];

/** 공용 틀 화면의 머리 — 고른 것이 있는 화면(이름 · 할 일 · 그 너머 · 패널 토글). */
const frameHead = () =>
  headOf(
    renderToStaticMarkup(
      <Frame
        head={{
          name: "atelier",
          actions: (
            <Button variant="ghost" size="top">
              폴더 열기
            </Button>
          ),
        }}
        panelToggle={{ name: "작업공간 패널", open: true, onToggle: () => {}, controls: "work-panel" }}
      >
        <p>본문</p>
      </Frame>,
    ),
  );

/** Thread 화면의 머리. */
const threadHead = () =>
  renderToStaticMarkup(
    <PlainHead title={{ name: "구현" }} end={<button type="button">요약 카드</button>} />,
  );

describe("머리 줄은 한 결이다", () => {
  it("이름은 어느 화면이든 13/18 · 400 fg다", () => {
    const frameName = frameHead().match(/<span[^>]*>(?:<svg[\s\S]*?<\/svg>)?atelier<\/span>/)?.[0] ?? "";
    const threadName = threadHead().match(/<span[^>]*>구현<\/span>/)?.[0] ?? "";
    for (const [where, tag] of [
      ["공용 틀", frameName],
      ["채팅", threadName],
    ] as const) {
      expect(tag, `${where} 이름을 못 찾았다`).not.toBe("");
      expect(classOf(tag), where).toEqual(expect.arrayContaining(["text-chat-meta", "text-fg"]));
      expect(classOf(tag), where).not.toContain("text-sm");
      expect(classOf(tag), where).not.toContain("font-medium");
    }
  });

  it("오른쪽 끝 묶음은 어느 화면이든 단추 사이 0 · 이름 쪽과 12이고, 같은 표식이다", () => {
    const groupOf = (html: string) => html.match(/<div[^>]*\sdata-head-actions[^>]*>/)?.[0] ?? "";
    const frame = groupOf(frameHead());
    const thread = groupOf(threadHead());
    expect(frame, "공용 틀의 오른쪽 끝 묶음").not.toBe("");
    expect(thread, "Thread의 오른쪽 끝 묶음").not.toBe("");
    expect(classOf(frame)).toEqual(expect.arrayContaining(["ml-auto", "pl-3"]));
    expect(classOf(frame).filter((one) => one.startsWith("gap-")), "단추 사이").toEqual([]);
    expect(classOf(frame).sort()).toEqual(classOf(thread).sort());
  });

  it("단추는 28이다 — 아이콘 단추도 글자 단추도", () => {
    const head = frameHead();
    const toggle = head.match(/<button[^>]*aria-label="작업공간 패널 접기"[^>]*>/)?.[0] ?? "";
    expect(toggle, "패널 토글").not.toBe("");
    expect(classOf(toggle)).toContain("icon-button");
    expect(classOf(toggle)).not.toContain("icon-button-xs");
    // 글리프는 셸 컨트롤처럼 15다(시안 `.ra-tbtn`의 `s15` — 「…」 · 요약 단추 · 패널 토글).
    expect(head).toMatch(/<svg[^>]*class="[^"]*lucide-panel-right[^"]*size-3\.75/);
    const text = head.match(/<button[^>]*>폴더 열기<\/button>/)?.[0] ?? "";
    expect(classOf(text), "글자 단추").toContain("h-7");
    // 글자 단추는 시안의 글자 단추처럼 완전히 둥글다(`.ra-opt` · `.ra-no` · `.ra-yes` · `.pl-btn` — `radius-full`).
    expect(classOf(text), "글자 단추").toContain("rounded-full");
  });

  // 시안 Main 머리 줄의 crumb에는 아이콘이 없다(`.ra-crumb` — 「Atelier 앱 / 워처 실패 신호 ⑂ 브랜치」 · 「Processes」 · 「새 채팅」).
  it("이름 앞에 아이콘이 없다", () => {
    const head = frameHead();
    const before = head.slice(0, head.indexOf("atelier"));
    expect(before).not.toMatch(/<svg/);
  });

  // 시안 `.ra-tbtn` — 글리프 `fg-secondary`(라이트 .7 · 다크 흰 .7). 한때 Codex 크롬 글리프 `fg-titlebar`(#898a8b — 다크 값이 없었다)였다.
  it("아이콘 단추의 쉴 때 글리프는 fg-secondary다 — 셸 컨트롤도 화면 것도", () => {
    expect(headButton("rest").split(" ")).toContain("text-fg-secondary");
    expect(headButton("rest")).not.toContain("fg-titlebar");
    const shell = renderToStaticMarkup(<ShellControls sidebarOpen onToggleSidebar={() => {}} onOpenSearch={() => {}} />);
    expect(shell).not.toContain("fg-titlebar");
  });

  // 시안 `.ra-tbtn`(Main 머리 줄 — 사이드바 접기 · 뒤로 · 앞으로 · 검색 · 채팅 메뉴 · 요약 카드 · spec 패널 접기) — 28 · 둥글기 4(`radius-ctl`)다.
  // 셸 컨트롤과 화면 것(⋯ · 요약 카드 · 패널 토글 · 돌아가기)이 한 벌이다(restart 02b-6b). 한때 아이콘 버튼 기본의 10(`radius-lg`)이었다.
  it("아이콘 단추는 둥글기 4다 — 셸 컨트롤도 화면 것도", () => {
    const shell = renderToStaticMarkup(<ShellControls sidebarOpen onToggleSidebar={() => {}} onOpenSearch={() => {}} />);
    const shellButtons = shell.match(/<button[^>]*>/g) ?? [];
    expect(shellButtons.map((tag) => tag.match(/aria-label="([^"]*)"/)?.[1])).toEqual(["사이드바 토글", "뒤로", "앞으로", "검색"]);
    const toggle = frameHead().match(/<button[^>]*aria-label="작업공간 패널 접기"[^>]*>/)?.[0] ?? "";
    for (const [where, tag] of [...shellButtons.map((one) => ["셸 컨트롤", one] as const), ["패널 토글", toggle] as const]) {
      expect(classOf(tag), where).toEqual(expect.arrayContaining(["icon-button", "icon-button-ctl"]));
    }
    for (const state of ["rest", "open", "on"] as const) expect(headButton(state).split(" "), state).toContain("icon-button-ctl");
  });
});

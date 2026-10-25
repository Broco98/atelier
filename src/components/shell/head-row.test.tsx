import { renderToStaticMarkup } from "react-dom/server";
import { Folder } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Frame } from "./Frame";
import { PlainHead } from "./PlainFrame";

// 머리(이름 · 할 일)는 앱 셸의 머리 줄로 포털을 탄다 — 정적 렌더는 포털을 못 그려, 머리를 이 마크업 안 머리 줄에 곧장 세운다
// (`screen-head-inline`).
vi.mock("@/components/shell/ShellHead", async (actual) =>
  (await import("@/components/shell/screen-head-inline")).inlineScreenHead(actual),
);

// **머리 줄은 한 결이다**(02 결정 「머리 줄은 한 결이다(03 뒤)」 · 구현 스펙 §3 「틀 하나」 · §6). 머리 줄은 앱 셸이 그리는 줄 하나라,
// 그 위에 서는 화면 것의 값도 어느 화면이든 같다 — Thread 머리 줄(06)의 값이다: 이름 14/500, 단추 28, 오른쪽 끝 단추 사이 2(이름 쪽과는
// 적어도 12). 한때 공용 틀 화면(Projects · Terminal · Processes · Archive · Settings · Work 화면 · spec 레이아웃 편집기)은 머리 카드의 값
// (13/500 · 24 · 6)을 그대로 옮겨 와 두 결이 섰다. seam은 그린 꼴(markup)이다 — 칠해진 상자의 수(28 · x)는 L3(`frame.spec`)가 잰다.

const headOf = (markup: string) => markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];

/** 공용 틀 화면의 머리 — 고른 것이 있는 화면(이름 · 할 일 · 그 너머 · 패널 토글). */
const frameHead = () =>
  headOf(
    renderToStaticMarkup(
      <Frame
        head={{
          icon: Folder,
          name: "atelier",
          actions: (
            <Button variant="ghost" size="top">
              폴더 열기
            </Button>
          ),
        }}
        panel={{
          label: "작업 패널",
          open: true,
          onToggle: () => {},
          size: { width: 320, min: 240, dragging: false } as never,
          children: <p>패널</p>,
        }}
      >
        <p>본문</p>
      </Frame>,
    ),
  );

/** Thread 화면의 머리. */
const threadHead = () =>
  renderToStaticMarkup(
    <PlainHead title={{ name: "구현" }} end={<button type="button">요약 고정</button>} />,
  );

describe("머리 줄은 한 결이다", () => {
  it("이름은 어느 화면이든 14/500이다", () => {
    const frameName = frameHead().match(/<span[^>]*>(?:<svg[\s\S]*?<\/svg>)?atelier<\/span>/)?.[0] ?? "";
    const threadName = threadHead().match(/<span[^>]*>구현<\/span>/)?.[0] ?? "";
    for (const [where, tag] of [
      ["공용 틀", frameName],
      ["Thread", threadName],
    ] as const) {
      expect(tag, `${where} 이름을 못 찾았다`).not.toBe("");
      expect(classOf(tag), where).toEqual(expect.arrayContaining(["text-sm", "font-medium", "text-fg"]));
      expect(classOf(tag), where).not.toContain("text-chat-meta");
    }
  });

  it("오른쪽 끝 묶음은 어느 화면이든 단추 사이 2 · 이름 쪽과 12이고, 같은 표식이다", () => {
    const groupOf = (html: string) => html.match(/<div[^>]*\sdata-head-actions[^>]*>/)?.[0] ?? "";
    const frame = groupOf(frameHead());
    const thread = groupOf(threadHead());
    expect(frame, "공용 틀의 오른쪽 끝 묶음").not.toBe("");
    expect(thread, "Thread의 오른쪽 끝 묶음").not.toBe("");
    expect(classOf(frame)).toEqual(expect.arrayContaining(["ml-auto", "gap-0.5", "pl-3"]));
    expect(classOf(frame).sort()).toEqual(classOf(thread).sort());
  });

  it("단추는 28이다 — 아이콘 단추도 글자 단추도", () => {
    const head = frameHead();
    const toggle = head.match(/<button[^>]*aria-label="작업 패널 접기"[^>]*>/)?.[0] ?? "";
    expect(toggle, "패널 토글").not.toBe("");
    expect(classOf(toggle)).toContain("icon-button");
    expect(classOf(toggle)).not.toContain("icon-button-xs");
    // 글리프는 Thread 단추처럼 16이다(「…」 · 요약 고정).
    expect(head).toMatch(/<svg[^>]*class="[^"]*lucide-panel-right[^"]*size-4/);
    const text = head.match(/<button[^>]*>폴더 열기<\/button>/)?.[0] ?? "";
    expect(classOf(text), "글자 단추").toContain("h-7");
  });
});

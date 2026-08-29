/// <reference types="node" />
// 소스 스캔이라 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentMarkOf } from "./agent-mark";

// 결정 15. 「도는 것」의 이름(백엔드가 준 원문)을 **단색 실루엣**으로 바꾸는 자리.
// 이 모듈이 앱에서 그 매핑을 아는 유일한 곳이다 — 탭 칸(결정 4)과 사이드바 행이 같은
// 것을 보게 하려면 표가 하나여야 한다.
const draw = (name: string) => {
  const mark = agentMarkOf(name);
  if (!mark) throw new Error(`${name}에 마크가 없다`);
  return renderToStaticMarkup(<mark.Glyph />);
};

describe("도는 것의 마크", () => {
  it("아는 이름에는 마크가 있다", () => {
    expect(agentMarkOf("claude")?.label).toBe("claude");
    expect(agentMarkOf("codex")?.label).toBe("codex");
  });

  // 둘이 같은 그림이면 「어느 칸에서 뭐가 도나」가 안 갈린다 — 이 판의 목적 그 자체다.
  it("claude와 codex는 다른 그림이다", () => {
    expect(draw("claude")).not.toBe(draw("codex"));
  });

  // **모르는 것은 아무것도 안 띄운다.** 물음표를 띄우면 줄이 시끄러워지고, 셸에서 도는
  // 것의 대부분(`node`·`cargo`·`vim`)이 그 자리에 온다.
  it.each(["node", "cargo", "vim", "zsh", ""])("모르는 이름(%s)에는 마크가 없다", (name) => {
    expect(agentMarkOf(name)).toBeNull();
  });

  it("아무것도 안 돌면 마크가 없다", () => {
    expect(agentMarkOf(null)).toBeNull();
  });

  // **브랜드 색을 쓰지 않는다**(결정 15). 글자 색을 따라가므로 다크·라이트 둘 다 살고
  // 대비 바닥 4.5를 저절로 넘는다 — 색을 박으면 한쪽 테마에서 반드시 깨진다.
  it("글자 색으로 칠한다", () => {
    for (const name of ["claude", "codex"]) {
      expect(draw(name)).toContain('fill="currentColor"');
    }
  });

  // 위 검사는 `currentColor`가 **있는가**만 본다 — 색 하나를 더 박아 넣어도 통과한다.
  // 소스에 색 리터럴이 아예 없다는 것을 따로 못박는다(리터럴 스캔이라 파서가 샐 자리가 없다).
  it("소스 어디에도 색 리터럴이 없다", () => {
    const src = readFileSync(fileURLToPath(new URL("./agent-mark.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toContain("rgb(");
    expect(src).not.toContain("oklch(");
  });
});

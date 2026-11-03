import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProcessesNavMeta from "./ProcessesNavMeta";

// 정적 마크업 seam — 위 칸 `Processes` 줄 끝(restart 03-15d · 시안 Main `.ra-sr-row .end` 「13% · 3.3GB」)이 **무엇을 말하는가**. 끝에는 아틀리에
// CPU · 메모리 합계만 선다 — 한때(티켓 29 – 03-14) 손볼 것이 본 뒤 새로 생기면 그 앞에 `●`가 섰다. 값을 묻는 폴러(10초)와 그 줄에 서는 것은
// L3가 본다(`processes-nav-meta.spec.ts`).

/** 태그를 걷은 보이는 글. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("위 칸 Processes 줄 끝", () => {
  it("아틀리에 CPU와 메모리 합계만 선다", () => {
    const html = renderToStaticMarkup(<ProcessesNavMeta meta={{ cpu: 13.2, total: 3_543_348_019 }} />);
    expect(textOf(html)).toBe("13% · 3.3GB");
    expect(html).not.toContain('role="img"');
  });

  // 첫 표본은 CPU를 모른다 — 그 자리는 「—」이고 메모리는 선다.
  it("CPU를 아직 모르면 그 자리가 「—」다", () => {
    expect(textOf(renderToStaticMarkup(<ProcessesNavMeta meta={{ cpu: null, total: 3_543_348_019 }} />))).toBe("— · 3.3GB");
  });

  // macOS 밖 · 첫 답 전 · 다리의 거절 — 「—」를 세우지 않고 끝이 빈다.
  it("합계를 못 읽었으면 아무것도 안 선다", () => {
    expect(renderToStaticMarkup(<ProcessesNavMeta meta={{ cpu: 13.2, total: null }} />)).toBe("");
  });
});

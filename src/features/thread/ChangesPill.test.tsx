import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChangesPill from "./ChangesPill";

// 바뀐 파일 알약의 모양(restart 02b-9b) — 정본은 Cards 보드 「바뀐 파일 알약」 칸 · Thread 보드의 `.ra-pill`이다: 34 알약, 안쪽 왼 14 · 오 6,
// 떠 있는 면(`surface-elevated`)에 0.5 링 + 카드 그림자, 글리프 `file-diff` 14, 셈 사이에 선이 없고 「검토」는 옅은 면(`fill-soft`)의 24 알약 12/18이다.
const draw = () =>
  renderToStaticMarkup(
    <ChangesPill
      changes={{ files: [{ path: "/w/a.rs", added: 40, deleted: 4 }, { path: "/w/b.tsx", added: 1, deleted: 0 }], added: 41, deleted: 4 }}
      onReview={() => {}}
    />,
  );
const classOf = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[^>]*class="([^"]*)"`))?.[1] ?? "").split(" ");

describe("바뀐 파일 알약", () => {
  it("보드의 알약이다 — 34 · 왼 14 · 오 6 · 떠 있는 면과 카드 그림자", () => {
    const pill = classOf(draw(), "div");
    expect(pill).toEqual(expect.arrayContaining(["h-8.5", "pl-3.5", "pr-1.5", "gap-2", "rounded-full", "bg-surface-elevated", "shadow-lifted"]));
  });

  it("글리프는 file-diff 14이고, 셈 사이에 선이 없다", () => {
    const html = draw();
    expect(html).toContain("lucide-file-diff");
    expect(html).not.toContain("w-[0.5px]");
    expect(html.replace(/<[^>]+>/g, "")).toBe("2개 파일 변경됨+41−4검토");
  });

  it("+ · − 셈은 고른 폭 숫자다", () => {
    const html = draw();
    expect(html).toMatch(/class="[^"]*tabular-nums[^"]*text-diff-added|class="[^"]*text-diff-added[^"]*tabular-nums/);
    expect(html).toMatch(/class="[^"]*tabular-nums[^"]*text-diff-deleted|class="[^"]*text-diff-deleted[^"]*tabular-nums/);
  });

  it("「검토」는 옅은 면의 24 알약 12/18이고, 올리면 hover 면과 본문 글자색이다", () => {
    const button = classOf(draw(), "button");
    expect(button).toEqual(
      expect.arrayContaining(["h-6", "px-2", "rounded-full", "bg-fill-soft", "text-xs", "tracking-normal", "text-fg-secondary", "quiet-hover"]),
    );
  });
});

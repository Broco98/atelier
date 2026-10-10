import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkCard } from "./WorkCard";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// 사이드바 행의 hover 카드. **화면에서는 hover로만 마운트돼서** 목록을 그려서는 닿을 수
// 없고, L3의 `getByText`도 마우스를 올린 뒤에야 보이는 것을 안 본다 — 조각을 직접 그리는
// 이 자리가 이 카드의 유일한 그물이다.
//
// 프로바이더를 안 세운다: 이 조각이 스스로 조회하면 여기서 바로 터진다(WorkInfo.test.tsx와
// 같은 계약).

const work: WorkView = workFixture({
  // **값이 실려 있는 채로 잰다.** 값이 비면 칸을 통째로 지워도 초록이다.
  branch: "feat/some-work",
  projects: ["atelier", "notes"],
  ...specDocs(["overview.md", "01-계획/plan.md"]),
});

// 셸의 말 칸(결정 14)은 이 파일이 재는 것과 무관하다 — 칸이 서는지는 L3가 잰다.
const card = () => renderToStaticMarkup(<WorkCard work={work} note={null} />);

describe("hover 카드", () => {
  it("브랜치·프로젝트·spec 셋이 선다", () => {
    const markup = card();
    expect(markup).toContain("브랜치");
    expect(markup).toContain("feat/some-work");
    expect(markup).toContain("프로젝트");
    expect(markup).toContain("atelier, notes");
    expect(markup).toContain("spec");
  });
});

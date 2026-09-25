import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Mode } from "@/mode";
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
  // **값이 실려 있는 채로 잰다.** 「Maison에는 어차피 비어 있다」는 근거가 안 된다 —
  // 코어의 nothing_to_decide는 프로젝트 0개인 Room에도 이름을 주면 브랜치를 확정해
  // 저장하고(works.rs), 목록을 읽는 자리에는 그 검증이 없어 손으로 고친 work.json이
  // 프로젝트까지 실어 온다. 값이 비면 조건을 통째로 지워도 초록이다.
  branch: "feat/some-work",
  projects: ["atelier", "notes"],
  ...specDocs(["overview.md", "01-계획/plan.md"]),
});

const card = (mode: Mode) => renderToStaticMarkup(<WorkCard mode={mode} work={work} />);

describe("hover 카드가 세계를 탄다", () => {
  // **두 세계를 나란히 잰다.** 한쪽만 재면 조건이 어느 쪽으로 누워도 초록이다 — Maison만
  // 보면 두 칸을 통째로 지운 판이, Atelier만 보면 조건을 뒤집은 판이 지나간다.
  it("Atelier에는 브랜치·프로젝트·spec 셋이 선다", () => {
    const markup = card("atelier");
    expect(markup).toContain("브랜치");
    expect(markup).toContain("feat/some-work");
    expect(markup).toContain("프로젝트");
    expect(markup).toContain("atelier, notes");
    expect(markup).toContain("spec");
  });

  // 저 세계에는 프로젝트도 브랜치도 없다(결정 17). 이름과 설명까지 붙여 그리면 사용자는
  // 그 문장에서 「Room에도 프로젝트를 붙이면 브랜치가 생긴다」를 배운다 — 정보 탭·ⓘ
  // 팝오버·아카이브에서 같은 개념을 걷어낸 판(#186)이 이 한 자리에서 뒤집힌다.
  it("Maison에는 그 둘이 없고 spec만 남는다", () => {
    const markup = card("maison");
    expect(markup).not.toContain("브랜치");
    expect(markup).not.toContain("feat/some-work");
    expect(markup).not.toContain("프로젝트");
    // 붙일 수도 없는 것을 기다리라고 말하는 두 문장 — 값이 비어 있을 때 뜨는 쪽이다
    expect(markup).not.toContain("프로젝트가 붙으면 정해져요");
    expect(markup).not.toContain("아직 없어요");
    // **걷히는 것이 둘뿐이다.** 이 줄이 없으면 카드를 통째로 비운 판도 위 검사들이 초록이다.
    expect(markup).toContain("spec");
    expect(markup).toContain("2개");
    expect(markup).toContain("어떤 작업");
  });
});

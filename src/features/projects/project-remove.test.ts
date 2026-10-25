import { describe, expect, it } from "vitest";
import { removeDialog, removedToast, restoreProblem } from "./project-remove";
import type { ProjectUsage } from "./types";

// Project 제거 창의 세 갈래와 지운 뒤(03 구현 스펙 §16 · 스토리 128 · 129 · 131 · 134 · 캔버스 F4-ProjRemoveBlocked · F4-KitProject 「제거 창」).
// 기대 글은 시안의 글자 그대로다.

const usage = (over: Partial<ProjectUsage> = {}): ProjectUsage => ({ spaces: [], works: [], ...over });
const space = (name: string) => ({ slug: name.replace(/ /g, "-"), name });
const KEEP = "폴더와 파일, git 기록은 그대로예요. 언제든 다시 추가할 수 있어요.";

describe("제거 창", () => {
  it("보통 — 목록에서 제거할까요? · 폴더와 파일이 그대로라는 말 · 취소 · 제거", () => {
    expect(removeDialog(usage())).toEqual({
      kind: "ask",
      title: "목록에서 제거할까요?",
      lines: [KEEP],
      works: [],
      cancel: "취소",
      canRemove: true,
    });
  });

  it("Space에 들어 있으면 같은 창에 그 Space에서도 빠진다는 말이 선다", () => {
    expect(removeDialog(usage({ spaces: [space("결제 서비스")] })).lines).toEqual([KEEP, "결제 서비스 Space에서도 빠져요."]);
    expect(removeDialog(usage({ spaces: [space("결제 서비스"), space("사내 도구")] })).lines[1]).toBe(
      "결제 서비스 · 사내 도구 Space에서도 빠져요.",
    );
  });

  it("Space가 셋을 넘으면 셋을 말하고 나머지는 수로 접는다", () => {
    const five = ["결제 서비스", "사내 도구", "정산", "운영", "문서"].map(space);
    expect(removeDialog(usage({ spaces: five })).lines[1]).toBe("결제 서비스 · 사내 도구 · 정산 외 2개 Space에서도 빠져요.");
  });

  it("진행 중인 Work가 고치면 아직 제거할 수 없다 — Work 수 · 보관하면 된다는 말 · Work 줄 · 닫기 · 꺼진 제거", () => {
    const works = [
      { slug: "refund-api", title: "환불 API 버그 수정", branch: "fix/refund-api" },
      { slug: "checkout", title: "결제 페이지 리디자인", branch: "feat/checkout-redesign" },
    ];
    expect(removeDialog(usage({ spaces: [space("결제 서비스")], works }))).toEqual({
      kind: "blocked",
      title: "아직 제거할 수 없어요",
      lines: ["진행 중인 Work 2개가 이 Project를 고치고 있어요. Work를 끝내 보관하면 제거할 수 있어요."],
      works,
      cancel: "닫기",
      canRemove: false,
    });
  });
});

describe("지운 뒤", () => {
  it("토스트는 「목록에서 뺐어요 — 이름」이다", () => {
    expect(removedToast("playground")).toBe("목록에서 뺐어요 — playground");
  });

  it("되돌리지 못한 까닭을 사람의 말로 옮긴다", () => {
    expect(restoreProblem("slug is in use again: playground")).toBe(
      "되돌리지 못했어요 — 그사이 같은 이름의 Project(playground)가 다시 추가됐어요.",
    );
    expect(restoreProblem("already registered as project 'playground-2': ~/MyProjects/playground")).toBe(
      "되돌리지 못했어요 — 그 폴더가 다른 Project(playground-2)로 다시 추가됐어요.",
    );
    expect(restoreProblem("project not found: playground")).toBe("되돌리지 못했어요 — 되돌릴 Project가 없어요.");
    expect(restoreProblem("disk full")).toBe("되돌리지 못했어요 — disk full");
  });
});

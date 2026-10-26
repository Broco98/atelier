import { describe, expect, it } from "vitest";
import { deleteDialog, deletedToast, restoreSpaceProblem } from "./space-delete";
import type { Space } from "./types";

// Space 지우기 확인 창과 지운 뒤(03 구현 스펙 §14 「지우기」 · 스토리 181 · 182 · 캔버스 F4-SpaceDelete · F4-KitSpace 「확인 창」 · 「지운 뒤」).
// 기대 글은 시안의 글자 그대로다.

const space = (over: Partial<Space> = {}): Space => ({
  slug: "결제-서비스",
  name: "결제 서비스",
  projects: ["web-app", "api-server"],
  createdAt: "2026-10-23",
  createdBy: null,
  description: "",
  problems: [],
  ...over,
});

describe("지우기 확인 창", () => {
  it("이은 Thread · Work 수와 그대로인 것을 말한다", () => {
    expect(deleteDialog(space(), { threads: 3, works: 1 })).toEqual({
      title: "결제 서비스 Space를 삭제할까요?",
      name: "결제 서비스",
      projects: "web-app · api-server",
      body: "Thread 3개 · Work 1개가 이 Space에서 빠져 「Space 없음」이 돼요. Project와 파일, 대화 · 문서 · worktree는 그대로예요.",
    });
  });

  it("한쪽만 있으면 그 수만 말한다", () => {
    expect(deleteDialog(space(), { threads: 2, works: 0 }).body).toBe(
      "Thread 2개가 이 Space에서 빠져 「Space 없음」이 돼요. Project와 파일, 대화 · 문서 · worktree는 그대로예요.",
    );
    expect(deleteDialog(space(), { threads: 0, works: 1 }).body).toBe(
      "Work 1개가 이 Space에서 빠져 「Space 없음」이 돼요. Project와 파일, 대화 · 문서 · worktree는 그대로예요.",
    );
  });

  it("쓰는 곳이 없으면 Project와 파일이 그대로라고만 말한다", () => {
    expect(deleteDialog(space(), { threads: 0, works: 0 }).body).toBe("Project와 파일은 그대로예요.");
  });

  it("빈 Space의 카드 줄은 Project가 없다고, 이름이 없는 파일은 slug로 부른다", () => {
    const dialog = deleteDialog(space({ name: "", projects: [] }), { threads: 0, works: 0 });
    expect([dialog.title, dialog.name, dialog.projects]).toEqual(["결제-서비스 Space를 삭제할까요?", "결제-서비스", "Project 없음"]);
  });
});

describe("지운 뒤", () => {
  it("토스트는 「결제 서비스 Space를 지웠어요」다 — 끝에 「되돌리기」가 선다", () => {
    expect(deletedToast("결제 서비스")).toBe("결제 서비스 Space를 지웠어요");
  });

  it("되돌리지 못한 까닭을 사람의 말로 옮긴다", () => {
    expect(restoreSpaceProblem("slug is in use again: 결제-서비스")).toBe(
      "되돌리지 못했어요 — 그사이 같은 파일 이름(결제-서비스)의 Space가 새로 생겼어요.",
    );
    expect(restoreSpaceProblem("Space를 찾지 못했어요: 결제-서비스")).toBe("되돌리지 못했어요 — 되돌릴 Space가 없어요.");
    expect(restoreSpaceProblem("disk full")).toBe("되돌리지 못했어요 — disk full");
  });
});

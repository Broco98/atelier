import { describe, expect, it } from "vitest";
import type { PendingProjectAdd, ProjectAddChoiceEntry } from "./fold";
import { describeProjectAddCard, projectAddChoiceCard } from "./project-add-card";

// Project 추가 카드의 값(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「git이 아닌 폴더를 부탁받음」) — Host가 「Project 추가」로 등록하려는
// 폴더가 git 저장소가 아니거나 저장소 안의 하위 폴더일 때 화면 추가 창과 같은 물음을 짓는 순수 함수다.

const notGit: PendingProjectAdd = {
  card: "project-add",
  requestId: "r1",
  who: "host",
  look: "notGit",
  path: "~/MyProjects/notes",
  folder: "notes",
  root: null,
};

const subfolder: PendingProjectAdd = {
  ...notGit,
  look: "subfolder",
  path: "~/MyProjects/api-server/docs",
  folder: "docs",
  root: "~/MyProjects/api-server",
};

const choice = (card: PendingProjectAdd, picked: ProjectAddChoiceEntry["choice"]): ProjectAddChoiceEntry => ({
  kind: "project-add-choice",
  key: "w9",
  choice: picked,
  look: card.look,
  folder: card.folder,
  root: card.root,
  toolCallId: "toolu_fake_mcp",
});

describe("Project 추가 카드", () => {
  it("git이 아닌 폴더는 「notes는 git 저장소가 아니에요. 어떻게 할까요?」 — 1 git init 하고 추가(추천) · 2 추가하지 않기다(F4-KitChat)", () => {
    expect(describeProjectAddCard(notGit, "Host")).toEqual({
      head: "Host · 질문",
      title: "notes는 git 저장소가 아니에요. 어떻게 할까요?",
      sub: null,
      options: [
        { answer: "init", label: "git init 하고 추가", badge: "추천", note: "빈 레포를 만들고 기준 브랜치 main" },
        { answer: "decline", label: "추가하지 않기", badge: null, note: null },
      ],
      start: 0,
    });
  });

  it("하위 폴더는 「docs는 api-server 저장소 안의 폴더예요」 — 뿌리 폴더로 추가(추천) · 그대로 추가 · 추가하지 않기, 아래 줄이 그 경로다", () => {
    const view = describeProjectAddCard(subfolder, "리뷰어");
    expect(view.head).toBe("리뷰어 · 질문");
    expect(view.title).toBe("docs는 api-server 저장소 안의 폴더예요. 어떻게 할까요?");
    expect(view.options).toEqual([
      { answer: "root", label: "뿌리 폴더로 추가", badge: "추천", note: "~/MyProjects/api-server" },
      { answer: "as-is", label: "그대로 추가", badge: null, note: "~/MyProjects/api-server/docs" },
      { answer: "decline", label: "추가하지 않기", badge: null, note: null },
    ]);
  });

  it("받침 있는 폴더 이름은 「은」이다", () => {
    expect(describeProjectAddCard({ ...notGit, folder: "web-app" }, "Host").title).toBe("web-app은 git 저장소가 아니에요. 어떻게 할까요?");
  });

  it("답하면 「✓ · 물은 제목 · 고른 답」 한 줄로 접힌다", () => {
    expect(projectAddChoiceCard(choice(notGit, "init"))).toEqual({
      asked: "notes는 git 저장소가 아니에요. 어떻게 할까요?",
      said: "git init 하고 추가",
    });
    expect(projectAddChoiceCard(choice(subfolder, "root")).said).toBe("뿌리 폴더로 추가");
    expect(projectAddChoiceCard(choice(subfolder, "as-is")).said).toBe("그대로 추가");
    expect(projectAddChoiceCard(choice(notGit, "decline")).said).toBe("추가하지 않기");
  });
});

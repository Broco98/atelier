import { describe, expect, it } from "vitest";
import {
  blankSpaceText,
  canSave,
  caretLineOf,
  editHint,
  fileNote,
  firstCaretLine,
  lineChanges,
  paintLines,
  pieceOfLine,
  pieceSpan,
  previewOf,
  problemPill,
} from "./space-edit";
import type { SpaceDraft, SpacePieces, SpaceProblem } from "./types";

// 고치기 화면(관계 편집 · 직접 만들기 — 03 구현 스펙 §13)이 그리는 갈래를 값으로 잰다. 문제 · 조각 자리는 core 검사가 준 그대로 쓰고
// (S7), 여기서는 그 값을 화면 말로 옮기는 것만 본다.

/** 「결제 서비스」 파일의 조각 — name 2행, projects 3–6행(머리 + 항목 셋), 본문 10행. */
const PIECES: SpacePieces = { name: 2, projects: { first: 3, last: 6 }, body: { first: 10, last: 12 } };

const problem = (line: number, kind: SpaceProblem["kind"] = "unknownProject"): SpaceProblem => ({
  line,
  kind,
  message: "등록되지 않은 Project예요",
});

describe("커서 줄 → 조각", () => {
  it("커서가 선 줄의 조각 — 조각 밖 줄(---, createdAt, 빈 줄)은 어느 것도 아니다", () => {
    expect([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((line) => pieceOfLine(PIECES, line))).toEqual([
      null,
      "name",
      "projects",
      "projects",
      "projects",
      null,
      null,
      null,
      "body",
      "body",
      "body",
      null,
    ]);
  });

  it("없는 조각은 짝이 없다 — 빈 본문 · projects 칸이 없는 파일", () => {
    expect(pieceOfLine({ name: 2, projects: null, body: null }, 3)).toBeNull();
  });

  it("카드 조각의 꼬리표는 그 조각의 줄이다 — 한 줄이면 「2행」, 여럿이면 「3–6행」", () => {
    expect(pieceSpan(PIECES, "name")).toBe("2행");
    expect(pieceSpan(PIECES, "projects")).toBe("3–6행");
    expect(pieceSpan(PIECES, "body")).toBe("10–12행");
    expect(pieceSpan({ name: null, projects: null, body: null }, "body")).toBe("");
  });

  it("글의 자리(커서) → 1부터 센 줄", () => {
    const text = "---\nname: 결제\nprojects: []\n";
    expect(caretLineOf(text, 0)).toBe(1);
    expect(caretLineOf(text, 4)).toBe(2);
    expect(caretLineOf(text, text.indexOf("[]"))).toBe(3);
    expect(caretLineOf(text, text.length)).toBe(4);
  });
});

describe("처음 커서(S14)", () => {
  it("문제가 있으면 첫 문제 줄이다 — 새 Space든 관계 편집이든", () => {
    expect(firstCaretLine([problem(7), problem(5)], PIECES, "edit")).toBe(5);
    expect(firstCaretLine([problem(2, "noName")], PIECES, "new")).toBe(2);
  });

  it("문제가 없으면 새 Space는 name 줄, 관계 편집은 projects 줄이다", () => {
    expect(firstCaretLine([], PIECES, "new")).toBe(2);
    expect(firstCaretLine([], PIECES, "edit")).toBe(3);
  });

  it("projects 칸이 없는 파일의 관계 편집은 name 줄이다", () => {
    expect(firstCaretLine([], { ...PIECES, projects: null }, "edit")).toBe(2);
  });
});

describe("고친 줄", () => {
  const BASE = "---\nname: 결제\nprojects:\n  - web-app\n  - api-server\n---\n";

  it("고친 것이 없으면 0이다", () => {
    expect(lineChanges(BASE, BASE)).toEqual({ count: 0, added: [] });
  });

  it("한 줄을 넣으면 1이고 그 줄이 새 줄이다", () => {
    const text = BASE.replace("  - api-server\n", "  - api-server\n  - backoffice\n");
    expect(lineChanges(BASE, text)).toEqual({ count: 1, added: [6] });
  });

  it("한 줄을 바꾸면 1이다 — 빼고 넣은 둘이 아니다", () => {
    const text = BASE.replace("name: 결제", "name: 결제 · 환불");
    expect(lineChanges(BASE, text)).toEqual({ count: 1, added: [2] });
  });

  it("한 줄을 지우면 1이다 — 새 줄은 없다", () => {
    const text = BASE.replace("  - web-app\n", "");
    expect(lineChanges(BASE, text)).toEqual({ count: 1, added: [] });
  });

  it("떨어진 두 자리를 고치면 둘이다", () => {
    const text = BASE.replace("name: 결제", "name: 정산").replace("  - api-server\n", "  - ledger\n");
    expect(lineChanges(BASE, text)).toEqual({ count: 2, added: [2, 5] });
  });

  it("파일 칸 머리 — 관계 편집은 고친 것이 있을 때만 「고친 줄 N · 저장 안 함」, 새 Space는 늘 「새 파일 · 아직 없음」", () => {
    expect(fileNote("edit", 0)).toBeNull();
    expect(fileNote("edit", 2)).toBe("고친 줄 2 · 저장 안 함");
    expect(fileNote("new", 0)).toBe("새 파일 · 아직 없음");
    expect(fileNote("new", 3)).toBe("새 파일 · 아직 없음");
  });
});

describe("상태 알약", () => {
  it("문제가 없으면 「문제 없어요」, 있으면 「문제 N개」", () => {
    expect(problemPill([])).toEqual({ ok: true, text: "문제 없어요" });
    expect(problemPill([problem(5), problem(6, "duplicateProject")])).toEqual({ ok: false, text: "문제 2개" });
  });
});

// 스토리 179 · §13 「문제가 있으면 저장이 꺼진다」 · 03 코드 리뷰 P8 — 검사는 고칠 때마다 다시 불러, 답이 오기까지는 앞 글의 답(자리 표시)이 선다.
// 그 답으로 켜면 문제 줄을 적은 직후 누른 저장을 core가 거절한다.
describe("저장 단추", () => {
  const ok = { space: { problems: [] as SpaceProblem[] } };
  const bad = { space: { problems: [problem(5)] } };

  it("고친 것이 있고, 지금 글의 검사 답에 문제가 없으며, 저장하는 중이 아니면 켜진다", () => {
    expect(canSave({ dirty: true, draft: ok, checked: true, saving: false })).toBe(true);
  });

  it("검사 답이 아직 앞 글의 것(자리 표시)이면 꺼진다 — 문제가 없어 보여도", () => {
    expect(canSave({ dirty: true, draft: ok, checked: false, saving: false })).toBe(false);
  });

  it("고친 것이 없거나 · 답이 없거나 · 문제가 있거나 · 저장하는 중이면 꺼진다", () => {
    expect(canSave({ dirty: false, draft: ok, checked: true, saving: false })).toBe(false);
    expect(canSave({ dirty: true, draft: undefined, checked: true, saving: false })).toBe(false);
    expect(canSave({ dirty: true, draft: bad, checked: true, saving: false })).toBe(false);
    expect(canSave({ dirty: true, draft: ok, checked: true, saving: true })).toBe(false);
  });
});

describe("안내 줄", () => {
  const draft = { registered: ["web-app", "api-server", "backoffice"], suffix: null };

  it("관계 편집은 넣을 수 있는 Project와 Host 길이다", () => {
    expect(editHint("edit", draft)).toBe("Project는 web-app · api-server · backoffice 중에서 — Host에게 말로 부탁해도 이 파일이 바뀌어요");
  });

  it("새 Space는 앞에 파일 이름이 이름을 따라온다는 말, 겹치면 -2 말이다", () => {
    expect(editHint("new", draft)).toBe(
      "이름(name)을 적으면 파일 이름이 따라와요 — 만든 뒤엔 바뀌지 않아요 · Project는 web-app · api-server · backoffice 중에서",
    );
    expect(editHint("new", { ...draft, suffix: "-2" })).toBe(
      "같은 이름의 Space가 있어 파일 이름에 -2를 붙였어요 · Project는 web-app · api-server · backoffice 중에서",
    );
  });

  it("등록된 Project가 없으면 그렇다고 말한다 — 빈 Space도 만든다", () => {
    expect(editHint("edit", { registered: [], suffix: null })).toBe(
      "아직 등록된 Project가 없어요 — Host에게 말로 부탁해도 이 파일이 바뀌어요",
    );
  });
});

describe("새 Space의 빈 틀", () => {
  it("name 빈 줄 · projects 빈 목록 · createdAt 오늘 · 빈 본문", () => {
    expect(blankSpaceText(new Date(2026, 9, 6, 23, 59))).toBe("---\nname: \nprojects: []\ncreatedAt: 2026-10-06\n---\n");
  });
});

describe("미리보기 카드", () => {
  const draft: SpaceDraft = {
    space: {
      slug: "결제-서비스",
      name: "결제 서비스",
      projects: ["web-app", "api-server", "backofice"],
      createdAt: "2026-10-23",
      createdBy: null,
      description: "",
      problems: [{ line: 6, kind: "unknownProject", project: "backofice", message: "등록되지 않은 Project예요" }],
    },
    pieces: PIECES,
    shared: [
      { slug: "사내-도구", name: "사내 도구", overlap: ["api-server"], projects: ["api-server", "backoffice"] },
      { slug: "오타", name: "오타", overlap: ["backofice"], projects: ["backofice"] },
    ],
    registered: ["web-app", "api-server", "backoffice"],
    folder: "~/.atelier/spaces",
    suffix: null,
  };

  it("등록되지 않은 Project는 그리지 않고, 함께 쓰는 Space도 그린 Project로만 잇는다", () => {
    const preview = previewOf(draft);
    expect(preview.space.projects).toEqual(["web-app", "api-server"]);
    expect(preview.shared.map((one) => one.slug)).toEqual(["사내-도구"]);
    expect(preview.aside).toBe("Project 2 · 함께 쓰는 Space 1");
    expect(preview.name).toBe("결제 서비스");
  });

  it("이름이 비면 이름이 없다 — 카드가 「이름 없음」을 흐리게 그린다", () => {
    const blank = previewOf({ ...draft, space: { ...draft.space, slug: "", name: "" } });
    expect(blank.name).toBeNull();
    expect(blank.space.name).toBe("이름 없음");
  });
});

describe("편집기 줄 칠하기", () => {
  it("frontmatter의 칸 · 목록 · 주석 · 경계와 본문을 가르고, 문제는 그 줄 끝에 첫 말 하나가 선다", () => {
    const text = "---\nname: 결제\nprojects:\n  - web-app   # 화면\n  - billing\n---\n\n설명";
    const lines = paintLines(text, [
      { line: 5, kind: "unknownProject", project: "billing", message: "등록되지 않은 Project예요" },
      { line: 5, kind: "duplicateProject", project: "billing", message: "같은 Project가 두 번 있어요" },
    ]);
    expect(lines.map((line) => line.tokens.map((token) => [token.tone, token.text]))).toEqual([
      [["mark", "---"]],
      [["key", "name"], ["punct", ":"], ["value", " 결제"]],
      [["key", "projects"], ["punct", ":"]],
      [["plain", "  "], ["punct", "-"], ["plain", " "], ["value", "web-app   "], ["comment", "# 화면"]],
      [["plain", "  "], ["punct", "-"], ["plain", " "], ["value", "billing"]],
      [["mark", "---"]],
      [],
      [["body", "설명"]],
    ]);
    expect(lines.map((line) => line.problem)).toEqual([null, null, null, null, "등록되지 않은 Project예요", null, null, null]);
  });

  it("닫히지 않은 frontmatter는 끝까지 frontmatter로 칠한다", () => {
    expect(paintLines("---\nname: 결제\n설명", []).map((line) => line.tokens[0]?.tone)).toEqual(["mark", "key", "value"]);
  });
});

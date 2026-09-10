import { describe, expect, it } from "vitest";
import { archiveConfirmBody, removeConfirmBody } from "./work-menu-copy";

describe("확인 대화 — Atelier", () => {
  // **한 글자도 안 바뀌어야 한다.** 세계를 가르면서 기존 문구가 함께 다듬어지면 이 판의
  // 리뷰에서 「Maison만 건드렸다」와 화면이 어긋난다. 그래서 글자 그대로 적는다
  // (`archive-copy.test.ts`의 같은 규율).
  it("아카이빙 문구가 그대로다", () => {
    expect(archiveConfirmBody("atelier")).toBe(
      "스펙과 기록은 남고 워크트리 폴더가 정리돼요. 브랜치와 커밋은 그대로예요.\n" +
        "다만 git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)은 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
    );
  });

  it("삭제 문구가 그대로다", () => {
    expect(removeConfirmBody("atelier")).toBe(
      "워크트리 폴더와 스펙 문서가 모두 지워져요. 브랜치와 커밋은 남지만 기록은 안 남아요 —\n" +
        "남길 것이 있다면 아카이빙을 쓰세요.\n" +
        "git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)도 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
    );
  });
});

describe("확인 대화 — Maison", () => {
  // 낱말 하나가 세계를 새게 한다. 지우기 **직전**의 창이라, 여기서 배운 것은 그대로 남는다:
  // 「워크트리 폴더가 정리돼요」를 읽은 사용자는 Room에도 그것이 있다고 믿는다(결정 17).
  it.each([
    ["워크트리", "Room에 없는 것"],
    ["브랜치", "Room에 없는 것"],
    ["커밋", "Room에 없는 것"],
    ["git", "Room에 없는 것"],
    ["작업", "저쪽 세계의 이름"],
  ])("두 문구 어디에도 「%s」가 없다", (word) => {
    expect(archiveConfirmBody("maison")).not.toContain(word);
    expect(removeConfirmBody("maison")).not.toContain(word);
  });

  // **비어 있지 않다.** 위 금칙어 목록만 두면 문구를 빈 문자열로 만든 판이 초록이다 —
  // 그리고 되돌릴 수 없는 동작이라 「되돌릴 수 없어요」가 빠지면 안 된다.
  it("남는 것과 사라지는 것을 여전히 말한다", () => {
    expect(archiveConfirmBody("maison")).toContain("스펙과 기록");
    expect(archiveConfirmBody("maison")).toContain("되돌릴 수 없어요");
    expect(removeConfirmBody("maison")).toContain("Room 폴더");
    expect(removeConfirmBody("maison")).toContain("아카이빙");
    expect(removeConfirmBody("maison")).toContain("되돌릴 수 없어요");
  });

  // 두 세계가 같은 글자를 내면 위 금칙어 검사가 Atelier 문구까지 함께 눕힌 판을 못 가른다.
  it("두 세계의 문구가 같지 않다", () => {
    expect(archiveConfirmBody("maison")).not.toBe(archiveConfirmBody("atelier"));
    expect(removeConfirmBody("maison")).not.toBe(removeConfirmBody("atelier"));
  });
});

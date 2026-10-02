import { describe, expect, it } from "vitest";
import { ARCHIVE_CONFIRM_BODY, REMOVE_CONFIRM_BODY } from "./work-menu-copy";

describe("확인 대화", () => {
  // **한 글자도 안 바뀌어야 한다.** 그래서 글자 그대로 적는다(`archive-copy.test.ts`의 같은 규율).
  it("아카이빙 문구가 그대로다", () => {
    expect(ARCHIVE_CONFIRM_BODY).toBe(
      "스펙과 기록은 남고 워크트리 폴더가 정리돼요. 브랜치와 커밋은 그대로예요.\n" +
        "다만 git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)은 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
    );
  });

  it("삭제 문구가 그대로다", () => {
    expect(REMOVE_CONFIRM_BODY).toBe(
      "워크트리 폴더와 스펙 문서가 모두 지워져요. 브랜치와 커밋은 남지만 기록은 안 남아요 —\n" +
        "남길 것이 있다면 아카이빙을 쓰세요.\n" +
        "git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)도 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
    );
  });
});

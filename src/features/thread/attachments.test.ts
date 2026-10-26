import { describe, expect, it } from "vitest";
import { attachmentKind, attachmentName, attachmentSize, mergeAttachments } from "./attachments";
import type { Attachment } from "./types";

// 입력창 첨부(v1 티켓 06 · S30) — 고르거나 끌어다 놓은 것이 칩 목록에 어떻게 쌓이고, 칩에 무엇이 서나. 칩을 그리는 부품은 이 순수
// 함수들을 그대로 쓴다.

const log: Attachment = { path: "/Users/me/logs/error.log", size: 12_288, folder: false };
const shot: Attachment = { path: "/Users/me/Desktop/재현 화면.png", size: 482_000, folder: false };
const fixtures: Attachment = { path: "/Users/me/api/fixtures", size: null, folder: true };

describe("첨부 칩 목록", () => {
  it("새로 받은 것은 뒤에 붙고, 이미 있는 경로는 다시 들지 않는다", () => {
    expect(mergeAttachments([log], [shot, log, fixtures, shot])).toEqual([log, shot, fixtures]);
  });

  it("아무것도 더해지지 않으면 같은 목록을 돌려준다 — 스토어가 다시 그리지 않게", () => {
    const have = [log, shot];
    expect(mergeAttachments(have, [shot])).toBe(have);
  });
});

describe("첨부 칩의 글", () => {
  it("이름은 경로의 끝 조각이다", () => {
    expect([log, shot, fixtures].map(attachmentName)).toEqual(["error.log", "재현 화면.png", "fixtures"]);
    expect(attachmentName({ path: "/Users/me/api/", size: null, folder: true })).toBe("api");
  });

  it("종류는 폴더 · 그림(확장자) · 파일이다 — 그림도 경로로만 간다", () => {
    expect([log, shot, fixtures].map(attachmentKind)).toEqual(["file", "image", "folder"]);
    expect(attachmentKind({ path: "/a/B.JPEG", size: 1, folder: false })).toBe("image");
    expect(attachmentKind({ path: "/a/png", size: 1, folder: false })).toBe("file");
  });

  it("크기는 파일만 적는다 — 폴더는 잰 크기가 없다", () => {
    expect([log, shot, fixtures].map(attachmentSize)).toEqual(["12.0KB", "470.7KB", null]);
  });
});

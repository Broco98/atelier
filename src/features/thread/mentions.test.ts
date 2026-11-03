import { describe, expect, it } from "vitest";
import { inkOf, insertMention, matchMentions, mentionFiles, mentionQuery, paintMentions, type MentionPlace } from "./mentions";

// 「@」 언급(restart 02b-3 · 시안 Composer 「「@」 언급」 · 「첨부 · 언급」) — 입력칸의 커서 앞 낱말이 `@`로 시작하면 메뉴가 그 뒤의 글자로 파일을
// 찾는다. 고르면 그 낱말이 `@경로`로 바뀌고 언급 칠을 입는다. 보낼 때는 글 그대로 간다.

describe("커서 앞 낱말", () => {
  it("말의 처음이나 빈칸 뒤의 `@`부터 커서까지가 찾는 말이다", () => {
    expect(mentionQuery("@wat", 4)).toEqual({ at: 0, end: 4, query: "wat" });
    expect(mentionQuery("이 파일 봐 줘 @src/wa", 18)).toEqual({ at: 9, end: 18, query: "src/wa" });
    expect(mentionQuery("@", 1)).toEqual({ at: 0, end: 1, query: "" });
  });

  it("커서가 낱말 가운데면 낱말 끝까지를 바꿀 자리로 잡는다", () => {
    expect(mentionQuery("@watcher 봐 줘", 4)).toEqual({ at: 0, end: 8, query: "wat" });
  });

  it("낱말 가운데의 `@`(메일 주소) · 이미 띄어 쓴 뒤 · `@`가 없는 낱말은 찾지 않는다", () => {
    expect(mentionQuery("me@example.com", 14)).toBeNull();
    expect(mentionQuery("@wat ", 5)).toBeNull();
    expect(mentionQuery("watcher", 7)).toBeNull();
  });
});

/** 찾기 명령의 답 — 작업 폴더(이름 없음, 상대 자리) · spec 폴더 · 읽는 범위의 Project(이름, 절대 자리). 경로는 꾸민 값이다. */
const PLACES: MentionPlace[] = [
  { name: null, root: "", files: ["README.md", "src-tauri/src/watcher.rs", "src/features/works/watcher.test.ts", "src/lib/stopwatch.ts"] },
  { name: "spec", root: "/data/works/refund/spec/", files: ["overview.md"] },
  { name: "api-server", root: "/repos/api-server/", files: ["src/watcher.rs", "Cargo.toml"] },
];

describe("넣는 경로", () => {
  it("작업 폴더 안의 파일은 상대 경로, 밖의 파일은 절대 경로이고 메뉴에는 자리 이름이 붙는다", () => {
    const files = mentionFiles(PLACES);
    expect(files.find((file) => file.path === "src-tauri/src/watcher.rs")).toEqual({
      path: "src-tauri/src/watcher.rs",
      shown: "src-tauri/src/watcher.rs",
      place: null,
    });
    expect(files.find((file) => file.shown === "overview.md")).toEqual({ path: "/data/works/refund/spec/overview.md", shown: "overview.md", place: "spec" });
    expect(files.find((file) => file.place === "api-server" && file.shown === "src/watcher.rs")?.path).toBe("/repos/api-server/src/watcher.rs");
  });

  it("worktree가 여럿인 작업 폴더의 파일은 Project 폴더부터 적는다", () => {
    expect(mentionFiles([{ name: null, root: "web-app/", files: ["src/a.ts"] }])).toEqual([
      { path: "web-app/src/a.ts", shown: "web-app/src/a.ts", place: null },
    ]);
  });
});

describe("찾기", () => {
  const found = (query: string) => matchMentions(mentionFiles(PLACES), query).map((file) => (file.place ? `${file.place}: ${file.shown}` : file.shown));

  // Composer 「「@」 언급」 — `@wat`에 watcher.rs · watcher.test.ts가 선다.
  it("이름이 그 글자로 시작하는 것, 이름이 품은 것, 경로가 품은 것 차례이고 같은 차례면 작업 폴더 · 짧은 경로가 먼저다", () => {
    expect(found("wat")).toEqual([
      "src-tauri/src/watcher.rs",
      "src/features/works/watcher.test.ts",
      "api-server: src/watcher.rs",
      "src/lib/stopwatch.ts",
    ]);
    expect(found("works/")).toEqual(["src/features/works/watcher.test.ts"]);
  });

  it("대소문자를 가리지 않고, 자리 이름으로도 찾고, 글자가 띄엄띄엄 들어 있어도 맨 뒤에 선다", () => {
    expect(found("CARGO")).toEqual(["api-server: Cargo.toml"]);
    expect(found("api-server/src")).toEqual(["api-server: src/watcher.rs"]);
    expect(found("swr")).toEqual(["src-tauri/src/watcher.rs", "src/features/works/watcher.test.ts", "api-server: src/watcher.rs"]);
  });

  it("빈 말이면 받은 차례 그대로다", () => {
    expect(found("").slice(0, 2)).toEqual(["README.md", "src-tauri/src/watcher.rs"]);
  });
});

describe("고르기", () => {
  it("찾던 낱말이 `@경로`와 빈칸 하나로 바뀌고 커서가 그 뒤에 선다", () => {
    const draft = "이거 @wat 봐 줘";
    expect(insertMention(draft, mentionQuery(draft, 7)!, "src-tauri/src/watcher.rs")).toEqual({
      draft: "이거 @src-tauri/src/watcher.rs 봐 줘",
      caret: 29,
      mention: "@src-tauri/src/watcher.rs",
    });
    expect(insertMention("@wat", mentionQuery("@wat", 4)!, "/repos/api-server/src/watcher.rs")).toEqual({
      draft: "@/repos/api-server/src/watcher.rs ",
      caret: 34,
      mention: "@/repos/api-server/src/watcher.rs",
    });
  });

  it("커서 뒤로 이어진 낱말까지 바꾼다", () => {
    expect(insertMention("@watcher 봐 줘", mentionQuery("@watcher 봐 줘", 4)!, "src/w.ts").draft).toBe("@src/w.ts 봐 줘");
  });

  it("빈칸이 든 경로는 따옴표로 감싼다 — 언급이 어디서 끝나는지 글로 남는다", () => {
    expect(insertMention("@배너", mentionQuery("@배너", 3)!, "/data/works/refund/spec/배너 시안.png").mention).toBe(
      '@"/data/works/refund/spec/배너 시안.png"',
    );
  });
});

// Composer 「첨부 · 언급」의 `.ra-mention` — 메뉴로 넣은 언급만 칠을 입는다. 찾는 중인 `@wat`(「「@」 언급」 칸)은 칠하지 않는다.
describe("언급 칠", () => {
  const painted = (draft: string, mentions: string[]) =>
    paintMentions(draft, mentions)
      .filter((part) => part.mention)
      .map((part) => part.text);

  it("넣은 언급은 낱말째 칠하고 나머지 글은 그대로 둔다", () => {
    expect(paintMentions("@src/watcher.rs 이 파일에서 재시도 간격도 같이 봐 줘", ["@src/watcher.rs"])).toEqual([
      { text: "@src/watcher.rs", mention: true },
      { text: " 이 파일에서 재시도 간격도 같이 봐 줘", mention: false },
    ]);
    expect(painted("@a.ts 와 @b.ts, 그리고 다시 @a.ts", ["@a.ts", "@b.ts"])).toEqual(["@a.ts", "@b.ts", "@a.ts"]);
  });

  it("찾는 중인 글자 · 고쳐 다른 경로가 된 언급은 칠하지 않는다", () => {
    expect(painted("@wat", ["@src/watcher.rs"])).toEqual([]);
    expect(painted("@src/watcher.rsx 봐 줘", ["@src/watcher.rs"])).toEqual([]);
    expect(painted("@src/watcher.rs.bak", ["@src/watcher.rs"])).toEqual([]);
    expect(painted("x@src/watcher.rs", ["@src/watcher.rs"])).toEqual([]);
  });

  it("바로 붙은 조사 · 문장 부호 앞에서 끝난 언급은 칠한다", () => {
    expect(painted("@src/watcher.rs를 봐 줘", ["@src/watcher.rs"])).toEqual(["@src/watcher.rs"]);
    expect(painted("끝은 @src/watcher.rs.", ["@src/watcher.rs"])).toEqual(["@src/watcher.rs"]);
    expect(painted('@"spec/배너 시안.png" 봐 줘', ['@"spec/배너 시안.png"'])).toEqual(['@"spec/배너 시안.png"']);
  });
});

// 한글 조합 — 입력기는 조합 중인 글자의 밑줄을 입력칸의 글자색으로 긋는다. 칠 층이 글자를 그리는 동안 입력칸 글자는 투명이라 밑줄이 사라진다.
// 그래서 조합 중에는 입력칸이 글자를 그리고 칠 층은 면만 둔다 — 글자 자리는 두 층이 같아 흔들리지 않고, 조합이 끝나면 칠 층이 글자를 되받는다.
describe("누가 글자를 그리나", () => {
  it("언급이 서 있으면 칠 층이 그리고, 조합 중이면 입력칸이 그린다", () => {
    expect(inkOf(true, false)).toBe("paint");
    expect(inkOf(true, true)).toBe("field");
  });

  it("언급이 없으면 늘 입력칸이 그린다", () => {
    expect(inkOf(false, false)).toBe("field");
    expect(inkOf(false, true)).toBe("field");
  });
});

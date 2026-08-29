/// <reference types="node" />
// node: 접두사를 쓰지 않는 이유는 이웃한 tauri-commands.test.ts의 주석과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// `CONTEXT.md`는 **말의 정본**이다 — 코드가 아니라 그 문서가 앱의 낱말을 정한다. 그래서
// 화면이 바뀌면 그 문서가 **거짓말을 하는 상태**가 될 수 있고, 그 거짓말은 아무 층에도
// 안 걸린다: 타입도 테스트도 산문을 안 읽는다. 판 04가 사이드바에서 펼침을 걷어내면서
// 「가지」·「잎」이 가리킬 것이 화면에서 없어졌고 그 자리에 「탭」이 섰다(결정 6·16).
//
// **낱말을 통째로 세지 않는다** — 「네 가지」처럼 이 문서와 무관한 쓰임이 그 그물에 걸린다.
// 보는 것은 **항목 이름**과 **표기 절**이다: 사전에 그 말이 등재돼 있는가, 그리고 표기
// 규칙이 지금 화면의 것을 예로 드는가.
const doc = readFileSync(fileURLToPath(new URL("../CONTEXT.md", import.meta.url)), "utf8");

// 항목은 굵은 낱말 + 콜론 한 줄이다 — `**셸**:`. 본문은 다음 항목 전까지다.
const entries = [...doc.matchAll(/^\*\*(.+?)\*\*:\n([\s\S]*?)(?=\n\*\*|\n## |$)/gm)].map((m) => ({
  name: m[1],
  body: m[2],
}));
const names = entries.map((one) => one.name);
const bodyOf = (name: string) => entries.find((one) => one.name === name)?.body ?? "";
// 표기 절 — 라벨의 대소문자와 문장의 언어를 정하는 자리다.
const notation = doc.slice(doc.indexOf("## 표기"));

describe("말의 사전", () => {
  // **이 한 줄이 위 정규식의 그물이다.** 문서의 모양이 바뀌어 파서가 새면 항목이 0개가
  // 되는데, 그러면 아래 「없다」 검사들이 전부 저절로 초록이 된다 — 없어야 할 것이 없는
  // 게 아니라 아무것도 안 읽은 것이다.
  it("사전이 실제로 읽힌다", () => {
    // **아래에서 본문을 읽는 항목은 여기 이름이 있어야 한다.** `bodyOf`가 없는 항목에
    // 빈 문자열을 주므로, 「터미널」이 이름을 바꾸면 그 항목의 `not.toContain` 단언이
    // 읽은 것 없이 초록이 된다 — 그물이 한 칸 새는 자리가 정확히 거기다.
    expect(names).toEqual(expect.arrayContaining(["셸", "명령", "열", "분할", "터미널"]));
  });

  it("「탭」이 등재돼 있다", () => {
    // 결정 16. 탭은 **화면 위의 자리**이고 셸은 **프로세스**다 — 세는 말은 「셸 8개」이지
    // 「탭 8개」가 아니라, 그 구분이 사전에 있어야 새 문구가 그것을 딛는다.
    expect(names).toContain("탭");
  });

  it("「가지」·「잎」이 없다", () => {
    // 결정 6이 사이드바에서 펼침을 통째로 걷었다. 가리킬 것이 화면에 없는 말을 사전에
    // 남겨 두면, 다음 사람이 그 말로 지금 화면을 설명하려다 없는 구조를 상상하게 된다.
    expect(names).not.toContain("가지");
    expect(names).not.toContain("잎");
  });

  it("「터미널」이 사이드바를 가리키지 않는다", () => {
    // 「화면. 사이드바의 가지 하나」가 거짓이 됐다 — 터미널은 이제 화면 하나다.
    expect(bodyOf("터미널")).not.toContain("사이드바");
  });
});

describe("표기 절은 지금 화면의 것을 예로 든다", () => {
  it("고르는 자리로 탭 줄을 든다", () => {
    // 소문자 라벨이 서는 자리가 사이드바에서 탭 줄로 옮겨 갔다(결정 7·8).
    expect(notation).toContain("탭 줄");
  });

  it("사이드바 가지를 예로 들지 않는다", () => {
    expect(notation).not.toContain("가지");
  });

  it("소문자 `terminal`을 고르는 것으로 들지 않는다", () => {
    // 그 라벨은 사이드바 가지의 머리행이었고 그 행이 사라졌다. 남은 소문자 가족은
    // 탭 줄의 `spec`과 패널 탭의 `spec`·`info`다 — 예시가 늙으면 「대소문자가 층을
    // 가른다」는 규칙 자체가 화면에서 확인되지 않는다.
    expect(notation).not.toContain("`terminal`");
  });
});

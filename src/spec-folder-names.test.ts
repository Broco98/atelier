/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// **앱은 spec 폴더의 이름을 모른다**(spec 레이아웃 결정 13, 구현 스펙 4절). 무엇이 어느 자리에
// 맞는지, 어떤 순서로 설지, 무슨 아이콘을 받을지는 엔진이 레이아웃으로 가른 spec 트리가 이미 정했고,
// 앱은 그것을 그리기만 한다. 이름으로 알아보는 갈래가 하나라도 되살아나면 사용자가 레이아웃을 고쳐도
// 그 이름만 옛 대우를 받는다 — 그리고 규칙이 두 언어에 사는 병(결정 13이 없앤 것)이 돌아온다.
//
// 허용 차이 4(판 밖 `tickets/`, 깊은 자리의 `overview.md`가 아이콘을 잃는다)를 「고치려고」 이름 특례를
// 되살리는 것이 가장 그럴듯한 길이라, 눈이 아니라 여기서 막는다. 결정 4(특수 규칙 0개)를 어기는 일이다.
//
// **fail-closed로 짠다**(refs.test.ts의 「뿌리는 이 파일에 없다」와 같은 관용구). 폴더가 옮겨지거나
// 글롭이 무너져 아무것도 못 읽으면 「금지 글자 0개」는 공허하게 참이다. 그래서 같은 탐지기로
// **알려진 양성**을 함께 센다: 읽은 소스에서는 아카이브가 다시 붙이는 `spec/` 앞머리를, 옛 코드의
// 모양에서는 걷어 낸 규칙들을.

const src = fileURLToPath(new URL(".", import.meta.url));

/** spec 트리를 그리는 기능 폴더 — work 화면의 `spec` 패널 탭과 아카이브의 문서 트리. */
const TREE_FEATURES = ["features/works", "features/archive"];

/** 기능 폴더들의 테스트가 아닌 TS 소스, 경로 → 글자. */
function treeSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const feature of TREE_FEATURES) {
    const names = readdirSync(join(src, feature), { recursive: true, encoding: "utf8" });
    for (const name of names.filter((one) => /\.tsx?$/.test(one) && !/\.test\.tsx?$/.test(one))) {
      sources[`${feature}/${name}`] = readFileSync(join(src, feature, name), "utf8");
    }
  }
  return sources;
}

/** 따옴표 친 문자열 리터럴 하나. 주석이 이름을 말하는 것(`overview.md`)은 규칙이 아니라 잡지 않는다. */
const literal = (text: string) =>
  new RegExp(`["']${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g");

/** 걷어 낸 이름 규칙이 붙들던 이름들(구현 스펙 4절 「걷어 낼 코드」). */
const FOLDER_NAMES = ["overview.md", "tickets", "research", "explanation"];

/** 판 폴더를 번호 접두로 알아보던 정규식(`/^(\d+)-/`)과 그 변형. */
const ITERATION_PATTERN = /(?:\\d|\[0-9\])[+*]\)?-/g;

/** 한 소스에서 이름 규칙의 자국들. */
function nameRules(source: string): string[] {
  return [
    ...FOLDER_NAMES.flatMap((name) => source.match(literal(name)) ?? []),
    ...(source.match(ITERATION_PATTERN) ?? []),
  ];
}

describe("앱에는 spec 폴더의 이름 규칙이 없다", () => {
  const sources = treeSources();

  it("탐지기가 걷어 낸 규칙을 옛 모양 그대로 알아본다", () => {
    // spec 트리 컴포넌트에 있던 모양 그대로다(spec 레이아웃 티켓 06이 걷었다). 탐지기가 이것을
    // 못 보면 아래 「0개」는 아무것도 안 잰다.
    const removed = [
      'const OVERVIEW = "overview.md";',
      "const ITERATION = /^(\\d+)-/; // NN-<이름>/ = 판 하나",
      'const TICKETS = "tickets";',
      '  { name: "research", icon: "search" },',
      '  { name: "explanation", icon: "book-open" },',
    ].join("\n");
    expect(nameRules(removed)).toEqual([
      '"overview.md"',
      '"tickets"',
      '"research"',
      '"explanation"',
      "\\d+)-",
    ]);
  });

  it("기능 폴더의 소스를 읽었다 — 아카이브가 다시 붙이는 spec/ 앞머리가 보인다", () => {
    expect(Object.keys(sources).length, "기능 폴더에서 소스를 하나도 못 읽었다").toBeGreaterThan(0);
    // 트리의 경로는 spec 기준이고 아카이브의 경로는 work 폴더 기준이라, 둘을 잇는 앞머리는 앱에 남는다.
    // 이름 규칙과 같은 탐지기(따옴표 친 리터럴)로 센다.
    const found = Object.entries(sources).filter(([, text]) => literal("spec/").test(text));
    expect(found.map(([path]) => path)).toEqual(["features/archive/archive-tree.ts"]);
  });

  it("폴더 이름 리터럴도 판 정규식도 하나도 없다", () => {
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      nameRules(text).map((hit) => `${path}: ${hit}`),
    );
    expect(offenders).toEqual([]);
  });
});

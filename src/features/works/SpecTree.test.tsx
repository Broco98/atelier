import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpecTree from "./SpecTree";
import type { SpecTreeGroup, SpecTreeItem } from "./types";

// **입력은 손으로 적은 spec 트리다**(구현 스펙 Testing 「앱」). 앱에는 규칙이 없어서 — 무엇을
// 먼저 세울지, 무엇이 번호 묶음인지, 무슨 아이콘을 줄지는 엔진이 정한다 — 여기서 재는 것은
// 「받은 것을 받은 대로 그리는가」뿐이다. 그래서 아래 트리는 일부러 이름순도 번호순도 아니다.

const file = (path: string, icon: string | null = null): SpecTreeItem => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind: "file",
  icon,
  group: null,
  children: [],
});

const folder = (
  path: string,
  children: SpecTreeItem[],
  { icon = null, group = null }: { icon?: string | null; group?: SpecTreeGroup | null } = {},
): SpecTreeItem => ({ ...file(path, icon), kind: "folder", group, children });

// 내장본이 커널 파일 목록을 가른 모양을 닮게 적었다 — `overview.md` 다음에 판 폴더가 최신이 위로
// 서고, 그 뒤에 `research/`와 맞지 않은 것이 선다(구현 스펙 7절 허용 차이 8).
const TREE: SpecTreeItem[] = [
  file("overview.md", "compass"),
  folder("02-둘째-판", [file("02-둘째-판/plan.md")], {
    icon: "layers",
    group: { key: "{n}-{name}", n: 2, latest: true },
  }),
  folder("01-첫째-판", [file("01-첫째-판/지난-계획.md")], {
    icon: "layers",
    group: { key: "{n}-{name}", n: 1, latest: false },
  }),
  folder("research", [file("research/prompt.md")], { icon: "search" }),
  file("잡동사니.md"),
];

function render(
  items: SpecTreeItem[] = TREE,
  onCopy?: (path: string) => void,
  current: string | null = "overview.md",
): string {
  return renderToStaticMarkup(
    <SpecTree items={items} current={current} onSelect={() => {}} onCopy={onCopy} />,
  );
}

/** 행 이름이 마크업에 선 자리. 없으면 -1이다. 행의 글자는 태그 사이에 홀로 선다(`>이름<`). */
const at = (markup: string, name: string) => markup.indexOf(`>${name}<`);

describe("SpecTree는 받은 spec 트리를 그리기만 한다", () => {
  it("구획 머리 없이 받은 순서대로 트리 하나로 그린다", () => {
    const markup = render();
    const shown = ["overview.md", "02-둘째-판", "plan.md", "01-첫째-판", "research", "prompt.md", "잡동사니.md"];
    const positions = shown.map((name) => at(markup, name));
    expect(positions.every((one) => one >= 0), `${shown} → ${positions}`).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // 판 구획과 판 밖 구획의 머리(spec 레이아웃 결정 24) — 폴더가 곧 개념이라 그 위에 이름을 한 번 더
    // 붙이지 않는다
    expect(markup).not.toContain("Iterations");
    expect(markup).not.toContain("Documents");
  });

  it("번호 묶음은 최신 표시가 붙은 것만 펼치고, 묶음 밖 폴더는 펼친 채 선다", () => {
    const markup = render();
    expect(folderRow(markup, "02-둘째-판")).toContain('aria-expanded="true"');
    expect(at(markup, "plan.md")).toBeGreaterThan(0);
    // 지난 판은 접힌 채 선다 — 행은 있고 안의 문서는 안 그려진다
    expect(folderRow(markup, "01-첫째-판")).toContain('aria-expanded="false"');
    expect(at(markup, "지난-계획.md")).toBe(-1);
    // 묶음 밖 폴더(`research/`, 손으로 만든 폴더)는 지금처럼 펼친 채 시작한다
    expect(folderRow(markup, "research")).toContain('aria-expanded="true"');
    expect(at(markup, "prompt.md")).toBeGreaterThan(0);
  });

  it("중첩된 번호 묶음에도 묶음 행이 없다 — 구성원이 그 폴더 안에 최신이 위로 선다", () => {
    // 폴더 항목 안의 `{n}` 항목(spec 레이아웃 결정 4: 「어디에 있든 같은 동작」). 묶음 하나가
    // 폴더 둘이고, 그 위에 묶음을 말하는 행이 따로 서지 않는다.
    const group = (n: number, latest: boolean): SpecTreeGroup => ({
      key: "결정/adr-{n}-{name}",
      n,
      latest,
    });
    const markup = render([
      folder("결정", [
        folder("결정/adr-2-저장", [file("결정/adr-2-저장/본문.md")], { group: group(2, true) }),
        folder("결정/adr-1-엔진", [file("결정/adr-1-엔진/초안.md")], { group: group(1, false) }),
      ]),
    ]);
    // 폴더 행은 셋뿐이다 — 감싼 폴더와 두 구성원. 묶음을 말하는 행이 그 사이에 없다
    expect(folderRows(markup).map((row) => row.match(/>([^<>]+)<\/span><\/button>$/)?.[1])).toEqual([
      "결정",
      "adr-2-저장",
      "adr-1-엔진",
    ]);
    expect(at(markup, "본문.md")).toBeGreaterThan(at(markup, "adr-2-저장"));
    expect(at(markup, "본문.md")).toBeLessThan(at(markup, "adr-1-엔진"));
    expect(at(markup, "초안.md")).toBe(-1);
  });
});

// 확장자 라벨은 글자라 이름 버튼의 **접근성 이름에 들어간다.** 아이콘과 라벨을 함께 그리면
// `overview.md` 행의 이름이 `MD overview.md`가 되어, 이름으로 행을 찾는 L3·L4가 깨진다
// (구현 스펙 4절). 그래서 아이콘을 받은 행은 라벨 **대신** 아이콘이다.
describe("SpecTree 행의 글리프", () => {
  const label = (ext: string) => `>${ext}</span>`;

  it("아이콘을 받은 파일 행에는 확장자 라벨이 없다", () => {
    const row = fileRow(render([file("overview.md", "compass")]), "overview.md");
    expect(row).toContain("lucide-compass");
    expect(row).not.toContain(label("MD"));
  });

  it("아이콘이 없거나 표에 없는 이름인 파일 행에는 라벨이 선다", () => {
    const markup = render([file("개요.md"), file("설계.yaml", "없는-아이콘")]);
    expect(fileRow(markup, "개요.md")).toContain(label("MD"));
    expect(fileRow(markup, "설계.yaml")).toContain(label("YAML"));
    // 표에 없는 이름은 아이콘 없이 그린다 — 이름 버튼 안에 그림이 하나도 없다
    expect(fileRow(markup, "설계.yaml")).not.toContain("<svg");
  });

  it("폴더 행은 받은 아이콘을, 없거나 표에 없으면 지금의 폴더 모양(화살표뿐)을 그린다", () => {
    const markup = render([
      folder("research", [], { icon: "search" }),
      folder("목업", []),
      folder("증거", [], { icon: "constructor" }),
    ]);
    expect(folderRow(markup, "research")).toContain("lucide-search");
    for (const plain of ["목업", "증거"]) {
      const glyphs = folderRow(markup, plain).match(/class="lucide lucide-[^ "]+/g);
      expect(glyphs, plain).toEqual(['class="lucide lucide-chevron-right']);
    }
  });
});

/** 파일 행의 이름 버튼 하나(여는 button부터 닫는 button까지). 못 찾으면 빈 문자열이다. */
function fileRow(markup: string, name: string): string {
  const buttons = markup.match(/<button(?![^>]*aria-)[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((button) => button.includes(`>${name}</span></button>`)) ?? "";
}

/** 폴더 행들(여는 button부터 닫는 button까지), 그려진 순서대로. 접히는 버튼은 폴더 행뿐이다. */
function folderRows(markup: string): string[] {
  return markup.match(/<button[^>]*aria-expanded="[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

/** 이름으로 폴더 행 하나. 못 찾으면 빈 문자열이다. */
function folderRow(markup: string, name: string): string {
  return folderRows(markup).find((row) => row.includes(`>${name}<`)) ?? "";
}

// 경로 복사는 **진짜 button**이어야 하고 파일 이름 선택 버튼의 **형제**여야 한다.
// 이 둘이 깨진 적이 있다: 복사가 이름 버튼 안에 span role="button"으로 들어가 있었고,
// 그러면 Tab으로 도달할 수 없을뿐더러 ARIA의 presentational-children 규칙상
// 스크린리더에는 존재조차 읽히지 않는다. 화면에는 멀쩡히 보이므로 눈으로는 안 잡힌다.
describe("SpecTree 경로 복사 버튼", () => {
  const two = [file("overview.md", "compass"), folder("01-판", [file("01-판/spec.md")])];

  it("파일마다 하나씩, button으로 렌더된다", () => {
    const markup = render(two, () => {});
    expect(markup.match(/aria-label="[^"]*경로 복사"/g)).toHaveLength(2);
    // aria-label을 가진 자리가 button 태그인지 — span role="button"으로 되돌아가면 여기서 걸린다
    expect(markup).toMatch(/<button[^>]*aria-label="overview\.md 경로 복사"/);
  });

  it("이름 선택 버튼 안에 중첩되지 않는다", () => {
    // 중첩 버튼은 HTML에서 허용되지 않는다. 여는 button과 닫는 button 사이에
    // 또 다른 여는 button이 오면 중첩이다.
    const markup = render(two, () => {});
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("onCopy가 없으면 복사 버튼도 없다", () => {
    expect(render(two)).not.toMatch(/경로 복사/);
  });
});

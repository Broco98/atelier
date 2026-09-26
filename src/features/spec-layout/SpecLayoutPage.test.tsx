import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopiedNotice, RevertedNotice, SpecLayoutSection } from "./SpecLayoutPage";
import type { SpecLayoutState } from "./types";

// 설정의 「spec 레이아웃」 페이지(spec 레이아웃 티켓 08). 행은 엔진이 준 상태를 **그리기만** 한다 —
// 고쳤는지, 읽을 수 있는지를 여기서 다시 판정하지 않는다(결정 13). 그래서 이 파일은 상태 셋을 손으로
// 적어 넣고 행의 모양만 잰다. 클릭은 L3가 잰다(jsdom이 없다).

const builtin = (id: SpecLayoutState["id"]): SpecLayoutState => ({
  id,
  folder: `~/.atelier/layouts/${id}`,
  edited: false,
  errors: [],
  fallback: null,
  templateCount: 0,
  otherFileCount: 0,
});

const edited: SpecLayoutState = {
  ...builtin("atelier"),
  edited: true,
  templateCount: 2,
  otherFileCount: 1,
};

const broken: SpecLayoutState = {
  ...builtin("maison"),
  edited: true,
  errors: [{ path: [0], message: 'kind must be "file" or "folder", not "fil"' }],
  fallback: 'root.children[0]: kind must be "file" or "folder", not "fil"',
  templateCount: null,
  otherFileCount: 2,
};

function render(states: SpecLayoutState[]): string {
  return renderToStaticMarkup(
    <SpecLayoutSection states={states} onAsk={() => {}} onReread={() => {}} onRevert={() => {}} />,
  );
}

/** 모드 이름으로 그 행 하나의 마크업을 잘라 낸다 — 두 행이 같은 낱말을 들고 있어 통째로 보면 안 갈린다. */
function rowOf(html: string, name: string): string {
  const rows = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const row = rows.find((one) => one.includes(`>${name}</span>`));
  if (!row) throw new Error(`${name} 행이 없다: ${html}`);
  return row;
}

/** 보이는 글자만 — 태그와 속성(버튼의 `title` 따위)을 걷는다. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** 버튼마다 그 이름 — 보이는 글자가 있으면 그것, 아이콘뿐인 버튼(⋯)이면 접근성 이름이다. */
function buttonsOf(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    (m) => m[2].replace(/<[^>]+>/g, "").trim() || (/aria-label="([^"]*)"/.exec(m[1])?.[1] ?? ""),
  );
}

describe("모드 두 행", () => {
  it("Atelier와 Maison이 한 행씩, 테두리 있는 목록 하나에 선다", () => {
    const html = render([builtin("atelier"), builtin("maison")]);
    expect(html.match(/<ul\b/g)).toHaveLength(1);
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html.indexOf(">Atelier</span>")).toBeLessThan(html.indexOf(">Maison</span>"));
  });

  it("내장본 행은 그대로라고 적고, 고침 표시도 폴더 경로도 없다", () => {
    const row = rowOf(render([builtin("atelier"), builtin("maison")]), "Atelier");
    expect(textOf(row)).toContain("내장본 그대로예요");
    expect(textOf(row)).not.toContain("고침");
    expect(textOf(row)).not.toContain("~/.atelier/layouts/atelier");
    expect(buttonsOf(row)).toEqual(["부탁"]);
  });

  it("고친 행은 가린 폴더 경로와 템플릿 개수를 적는다", () => {
    const row = rowOf(render([edited, builtin("maison")]), "Atelier");
    expect(row).toContain(">고침</span>");
    expect(textOf(row)).toContain("~/.atelier/layouts/atelier/");
    expect(textOf(row)).toContain("템플릿 2개");
    expect(textOf(row)).not.toContain("내장본 그대로");
    expect(buttonsOf(row)).toEqual(["부탁", "Atelier 레이아웃 메뉴"]);
  });

  // 읽지 못한 행도 가린 폴더가 있으므로 고친 행이다(구현 스펙 5절). 앰버 한 줄이 「내장본으로 물러섰다」를
  // 말하고, 이유는 엔진이 준 글 그대로다 — 에이전트가 물러선 안내문에서 받는 것과 같은 까닭이다.
  it("읽지 못한 행은 앰버 한 줄과 이유 한 줄, 그리고 [다시 읽기]를 둔다", () => {
    const row = rowOf(render([builtin("atelier"), broken]), "Maison");
    expect(row).toContain(">고침</span>");
    expect(row).toMatch(/<span class="[^"]*text-amber-[^"]*">읽지 못해 내장본으로 보여 주고 있어요<\/span>/);
    expect(textOf(row)).toContain("~/.atelier/layouts/maison/");
    expect(textOf(row)).toContain(
      "root.children[0]: kind must be &quot;file&quot; or &quot;folder&quot;",
    );
    // 템플릿 개수가 없다 — 무엇이 템플릿인지 모른다
    expect(textOf(row)).not.toContain("템플릿");
    expect(buttonsOf(row)).toEqual(["부탁", "다시 읽기", "Maison 레이아웃 메뉴"]);
  });

  // ⋯의 메뉴에는 「기본값으로 되돌리기」 하나가 있다(티켓 10). 되돌릴 것은 가린 폴더라, 가린 폴더가 없는
  // 내장본 행에는 설 자리가 없다. 읽지 못한 행도 가린 폴더가 있으므로 선다 — 깨진 폴더도 되돌려진다.
  it("⋯는 고친 행과 읽지 못한 행에만 서고, 내장본 행에는 없다", () => {
    const html = render([edited, broken]);
    for (const name of ["Atelier", "Maison"]) {
      const menu = rowOf(html, name).match(/<button\b[^>]*aria-label="[^"]* 레이아웃 메뉴"[^>]*>/g);
      expect(menu, `${name} 행의 ⋯`).toHaveLength(1);
      expect(menu![0]).toContain('aria-haspopup="menu"');
      expect(menu![0]).toContain('aria-expanded="false"');
    }
    const builtins = render([builtin("atelier"), builtin("maison")]);
    expect(builtins).not.toContain("레이아웃 메뉴");
    expect(builtins).not.toContain('aria-haspopup="menu"');
  });

  it("[부탁]은 폴더가 없는 행에도, 읽지 못하는 행에도 있다", () => {
    const html = render([builtin("atelier"), broken]);
    for (const name of ["Atelier", "Maison"]) {
      expect(buttonsOf(rowOf(html, name))).toContain("부탁");
    }
  });
});

describe("부탁 알림", () => {
  it("복사한 참조와, 앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으라는 말을 적는다", () => {
    const html = renderToStaticMarkup(
      <CopiedNotice reference="~/.atelier/layouts/maison/" onClose={() => {}} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("참조를 복사했어요");
    expect(html).toContain("~/.atelier/layouts/maison/");
    expect(html).toContain("앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으세요.");
  });
});

describe("되돌린 알림", () => {
  // 되돌린 것이 어디까지 따라가는지를 적는다 — 지운 폴더, 그리고 spec 패널 탭과 에이전트의 안내문(티켓 10).
  it("지운 폴더와, 내장본으로 돌아가 spec 패널 탭과 에이전트 안내문도 따라간다는 말을 적는다", () => {
    const html = renderToStaticMarkup(
      <RevertedNotice reference="~/.atelier/layouts/atelier/" onClose={() => {}} />,
    );
    expect(html).toContain('role="status"');
    expect(textOf(html)).toContain("되돌렸어요 ~/.atelier/layouts/atelier/");
    expect(textOf(html)).toContain("내장본으로 돌아갔어요. spec 패널 탭과 에이전트 안내문도 따라가요.");
    expect(html).toContain('aria-label="알림 닫기"');
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopiedNotice, RevertedNotice, SpecLayoutSection } from "./SpecLayoutPage";
import type { SpecLayoutState } from "./types";

// 설정의 「spec 레이아웃」 페이지(spec 레이아웃 티켓 08). 행은 엔진이 준 상태를 **그리기만** 한다 —
// 고쳤는지, 읽을 수 있는지를 여기서 다시 판정하지 않는다(결정 13). 그래서 이 파일은 상태 셋을 손으로
// 적어 넣고 행의 모양만 잰다. 클릭은 L3가 잰다(jsdom이 없다).

const builtin: SpecLayoutState = {
  folder: "~/.atelier/layouts/atelier",
  edited: false,
  errors: [],
  fallback: null,
  templateCount: 0,
  otherFileCount: 0,
};

const edited: SpecLayoutState = {
  ...builtin,
  edited: true,
  templateCount: 2,
  otherFileCount: 1,
};

const broken: SpecLayoutState = {
  ...builtin,
  edited: true,
  errors: [{ path: [0], message: 'kind must be "file" or "folder", not "fil"' }],
  fallback: 'root.children[0]: kind must be "file" or "folder", not "fil"',
  templateCount: null,
  otherFileCount: 2,
};

function render(state: SpecLayoutState): string {
  return renderToStaticMarkup(
    <SpecLayoutSection
      state={state}
      onAsk={() => {}}
      onEdit={() => {}}
      onReread={() => {}}
      onRevert={() => {}}
    />,
  );
}

/** 그 행 하나의 마크업 — 행이 하나뿐인지도 함께 본다. */
function rowOf(html: string): string {
  const rows = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0]);
  if (rows.length !== 1) throw new Error(`행이 하나가 아니다(${rows.length}): ${html}`);
  return rows[0];
}

/** 보이는 글자만 — 태그와 속성(버튼의 `aria-description` 따위)을 걷는다. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** 버튼마다 그 이름 — 보이는 글자가 있으면 그것, 아이콘뿐인 버튼(⋯)이면 접근성 이름이다. */
function buttonsOf(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    (m) => m[2].replace(/<[^>]+>/g, "").trim() || (/aria-label="([^"]*)"/.exec(m[1])?.[1] ?? ""),
  );
}

// 레이아웃은 하나라 행도 하나다(ui-refresh 결정 3 · 23). 행의 세 모양(내장본 · 고침 · 읽지 못함)을 그 한 행으로 잰다.
describe("레이아웃 행", () => {
  it("Atelier 한 행이 테두리 있는 목록 하나에 선다", () => {
    const html = render(builtin);
    expect(html.match(/<ul\b/g)).toHaveLength(1);
    expect(html.match(/<li\b/g)).toHaveLength(1);
    expect(rowOf(html)).toContain(">Atelier</span>");
  });

  it("내장본 행은 그대로라고 적고, 고침 표시도 폴더 경로도 없다", () => {
    const row = rowOf(render(builtin));
    expect(textOf(row)).toContain("내장본 그대로예요");
    expect(textOf(row)).not.toContain("고침");
    expect(textOf(row)).not.toContain("~/.atelier/layouts/atelier");
    expect(buttonsOf(row)).toEqual(["부탁", "편집"]);
  });

  it("고친 행은 가린 폴더 경로와 템플릿 개수를 적는다", () => {
    const row = rowOf(render(edited));
    expect(row).toContain(">고침</span>");
    expect(textOf(row)).toContain("~/.atelier/layouts/atelier/");
    expect(textOf(row)).toContain("템플릿 2개");
    expect(textOf(row)).not.toContain("내장본 그대로");
    expect(buttonsOf(row)).toEqual(["부탁", "편집", "Atelier 레이아웃 메뉴"]);
  });

  // 읽지 못한 행도 가린 폴더가 있으므로 고친 행이다(구현 스펙 5절). 앰버 한 줄이 「내장본으로 물러섰다」를
  // 말하고, 이유는 엔진이 준 글 그대로다 — 에이전트가 물러선 안내문에서 받는 것과 같은 까닭이다.
  it("읽지 못한 행은 앰버 한 줄과 이유 한 줄, 그리고 [다시 읽기]를 둔다", () => {
    const row = rowOf(render(broken));
    expect(row).toContain(">고침</span>");
    expect(row).toMatch(/<span class="[^"]*text-amber-[^"]*">읽지 못해 내장본으로 보여 주고 있어요<\/span>/);
    expect(textOf(row)).toContain("~/.atelier/layouts/atelier/");
    expect(textOf(row)).toContain(
      "root.children[0]: kind must be &quot;file&quot; or &quot;folder&quot;",
    );
    // 템플릿 개수가 없다 — 무엇이 템플릿인지 모른다
    expect(textOf(row)).not.toContain("템플릿");
    expect(buttonsOf(row)).toEqual(["부탁", "다시 읽기", "Atelier 레이아웃 메뉴"]);
  });

  // ⋯의 메뉴에는 「기본값으로 되돌리기」 하나가 있다(티켓 10). 되돌릴 것은 가린 폴더라, 가린 폴더가 없는
  // 내장본 행에는 설 자리가 없다. 읽지 못한 행도 가린 폴더가 있으므로 선다 — 깨진 폴더도 되돌려진다.
  //
  // ⋯는 메뉴 부품의 트리거라 「메뉴를 연다」(`aria-haspopup`)를 정적 렌더에서도 단다. 「열렸다/닫혔다」
  // (`aria-expanded`)는 부품이 마운트된 뒤에 달아 여기서는 안 보인다 — 닫힘 → 열림 → 닫힘은 설정 spec
  // (`e2e/spec-layout-page.spec.ts`)의 「⋯ → 「기본값으로 되돌리기」에서 [취소]…」가 잰다.
  it("⋯는 고친 행과 읽지 못한 행에만 서고, 내장본 행에는 없다", () => {
    for (const [name, state] of [
      ["고친 행", edited],
      ["읽지 못한 행", broken],
    ] as const) {
      const menu = rowOf(render(state)).match(/<button\b[^>]*aria-label="Atelier 레이아웃 메뉴"[^>]*>/g);
      expect(menu, `${name}의 ⋯`).toHaveLength(1);
      expect(menu![0]).toContain('aria-haspopup="menu"');
    }
    const builtins = render(builtin);
    expect(builtins).not.toContain("레이아웃 메뉴");
    expect(builtins).not.toContain('aria-haspopup="menu"');
  });

  // [편집]은 편집기(티켓 11)를 연다. 읽지 못하는 레이아웃은 편집기가 열 것이 없다 — 그 행에는 [편집] 대신
  // [다시 읽기]가 선다(위 시나리오). 내장본 행에도 [편집]이 있다: 처음 저장하면 레이아웃 폴더가 생긴다.
  it("[편집]은 읽을 수 있는 행에만 서고, [부탁] 뒤에 선다", () => {
    const edit = rowOf(render(edited)).match(/<button\b[^>]*aria-label="Atelier 레이아웃 편집"[^>]*>/g);
    expect(edit).toHaveLength(1);
    expect(rowOf(render(broken))).not.toContain("레이아웃 편집");
    expect(buttonsOf(rowOf(render(builtin)))).toEqual(["부탁", "편집"]);
  });

  it("[부탁]은 폴더가 없는 행에도, 읽지 못하는 행에도 있다", () => {
    for (const state of [builtin, broken]) {
      expect(buttonsOf(rowOf(render(state)))).toContain("부탁");
    }
  });
});

describe("부탁 메시지", () => {
  it("복사한 참조와, 앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으라는 말을 적는다", () => {
    const html = renderToStaticMarkup(
      <CopiedNotice reference="~/.atelier/layouts/atelier/" onClose={() => {}} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("참조를 복사했어요");
    expect(html).toContain("~/.atelier/layouts/atelier/");
    expect(html).toContain("앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으세요.");
  });
});

describe("되돌린 메시지", () => {
  // 되돌린 것이 어디까지 따라가는지를 적는다 — 지운 폴더, 그리고 spec 패널 탭과 에이전트의 안내문(티켓 10).
  it("지운 폴더와, 내장본으로 돌아가 spec 패널 탭과 에이전트 안내문도 따라간다는 말을 적는다", () => {
    const html = renderToStaticMarkup(
      <RevertedNotice reference="~/.atelier/layouts/atelier/" onClose={() => {}} />,
    );
    expect(html).toContain('role="status"');
    expect(textOf(html)).toContain("되돌렸어요 ~/.atelier/layouts/atelier/");
    expect(textOf(html)).toContain("내장본으로 돌아갔어요. spec 패널 탭과 에이전트 안내문도 따라가요.");
    expect(html).toContain('aria-label="닫기"');
  });
});

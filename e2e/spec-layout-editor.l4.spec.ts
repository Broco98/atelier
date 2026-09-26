import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LayoutPreview } from "@/features/spec-layout/types";
import type { WorkView } from "@/features/works/types";
import type { Page } from "./evidence";
import { askBackend, callCount, installRealBackend, unknownIpcCalls } from "./harness";
import { expect, seedLayout, seedWork, test } from "./l4";

// spec 레이아웃 티켓 11 — **편집기가 다리로 레이아웃을 진짜로 쓰고, 다시 부른 work 목록의 spec 트리가 그
// 레이아웃을 따른다.**
//
// L3의 저장은 fixture가 답해 「쓴 것이 무엇을 바꾸는가」를 못 잰다. 이 층만 그것을 답한다: 편집기의 [저장]
// → `write_spec_layout` → 다리 → 코어의 `save_layout`이 데이터 루트에 레이아웃 폴더를 만들고, 편집기가 연
// 무효화가 `list_works`를 다시 불러 그 레이아웃으로 가른 트리를 받는다. 다리에는 감시자가 없다 — 트리가
// 바뀐다면 그것은 저장한 쪽의 무효화 덕이다. 검증 오류도 진짜 엔진의 답이다: 초안마다 묻는 미리보기(티켓 14)가
// 데이터로 받아 그 자리에 세우고 저장을 잠근다.

const 이름틀 = (page: Page) =>
  page.getByRole("textbox", { name: "이름 틀", exact: true });
const 저장 = (page: Page) => page.getByRole("button", { name: "저장", exact: true });

test("편집기가 저장한 레이아웃이 다리의 데이터 루트에 서고, 다시 부른 work 목록의 spec 트리가 그것을 따른다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  seedWork(home, "첫째", "첫째 작업", "2026-08-03");
  const spec = join(home, "works", "첫째", "spec");
  writeFileSync(join(spec, "overview.md"), "# 개요\n\n첫째 작업의 개요다.\n");
  writeFileSync(join(spec, "plan.md"), "# 계획\n\n계획의 본문이다.\n");
  const folder = join(home, "layouts", "atelier");
  await installRealBackend(page, sandbox);

  // 폴더가 없으니 내장본이다 — `overview.md`가 맨 앞 항목이라 기본 문서다.
  await page.goto("/works/첫째");
  await expect(page.getByText("첫째 작업의 개요다.")).toBeVisible();
  const [before] = (await askBackend(page, "list_works", { mode: "atelier" })) as WorkView[];
  expect(before.specTree.defaultDoc).toBe("overview.md");

  // 앱 안에서 설정으로 간다 — 새로 읽으면 캐시가 사라져 무효화를 잴 수 없다.
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: "Settings", exact: true }).click();
  await aside.getByRole("button", { name: "spec 레이아웃", exact: true }).click();
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await expect(page).toHaveURL("/settings/spec-layout/atelier");
  // 내장본의 첫 최상위 항목을 골라 둔 채로 열린다
  await expect(이름틀(page)).toHaveValue("overview.md");

  // 먼저 엔진이 거절하는 초안 — 빈 이름 틀. 저장을 누르기 전에 미리보기가 데이터로 받아 그 자리에 세우고 저장을
  // 잠근다(티켓 14). 아무것도 쓰지 않는다.
  await 이름틀(page).fill("");
  await expect(page.getByText("`pattern` is empty", { exact: true })).toBeVisible();
  await expect(저장(page)).toBeDisabled();
  expect(existsSync(folder)).toBe(false);

  // 첫 항목의 이름 틀을 `plan.md`로 — 그 자리의 아이콘(나침반)과 기본 문서가 `plan.md`로 옮겨 간다.
  await 이름틀(page).fill("plan.md");
  await expect(page.getByText("`pattern` is empty", { exact: true })).toHaveCount(0);
  const listed = await callCount(page, "list_works");
  await 저장(page).click();

  // 처음 저장이 내장본을 가리는 폴더를 만들었다(결정 7)
  await expect.poll(() => existsSync(join(folder, "layout.json"))).toBe(true);
  const written = JSON.parse(readFileSync(join(folder, "layout.json"), "utf8"));
  expect(written.root.children[0]).toMatchObject({ pattern: "plan.md", kind: "file", icon: "compass" });
  // 감시자 없이도 work 목록이 다시 불렸다 — 저장한 쪽의 무효화다
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(listed);

  const [after] = (await askBackend(page, "list_works", { mode: "atelier" })) as WorkView[];
  expect(after.specTree.defaultDoc).toBe("plan.md");
  expect(after.specTree.items[0]).toMatchObject({ name: "plan.md", kind: "file", icon: "compass" });

  // 설정의 행도 다시 읽은 엔진의 상태다 — 이제 고친 폴더다
  await page.getByRole("button", { name: "설정으로 돌아가기", exact: true }).click();
  const 행 = page.locator("main li").filter({ has: page.getByText("Atelier", { exact: true }) });
  await expect(행).toContainText(`${folder}/ 폴더가 내장본을 가리고 있어요`);

  // 돌아간 work 화면은 그 목록의 트리를 따른다 — `plan.md`가 기본 문서다.
  await aside.getByRole("button", { name: "앱으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL(`/works/${encodeURIComponent("첫째")}`);
  await expect(page.getByText("계획의 본문이다.")).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 레이아웃 폴더 아래 모든 파일과 그 내용 — 미리보기가 무엇이든 쓰면 드러난다. */
function filesIn(folder: string): Record<string, string> {
  const names = readdirSync(folder, { recursive: true, encoding: "utf8" }).sort();
  return Object.fromEntries(names.map((name) => [name, readFileSync(join(folder, name), "utf8")]));
}

// 티켓 14 — **다리의 `render_spec_layout`이 엔진의 미리보기 함수를 진짜로 탄다.** L3의 미리보기는 fixture가 답해
// 「엔진이 이 초안을 어떻게 판정하는가」를 못 잰다. 여기서는 다리의 데이터 루트에 심은 레이아웃을 편집기가 열고,
// 디스크에 없는 템플릿을 가리키는 항목이 저장 전에 그 자리의 오류로 서며, 본문을 적으면 풀려 팝업에 그 `Template:`
// 줄이 선다. 미리보기는 아무것도 쓰지 않는다 — 템플릿 파일은 저장을 눌러야 선다.
test("다리의 미리보기가 누락 템플릿을 저장 전에 그 항목의 오류로 세우고, 본문을 적으면 팝업에 그 템플릿 줄이 서며, 디스크에는 아무것도 쓰지 않는다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  const layout = {
    root: {
      description: "방침 문단.",
      children: [
        { pattern: "decisions.md", kind: "file", description: "정한 것", template: "decisions.md" },
        { pattern: "gone.md", kind: "file", description: "사라진 뼈대", template: "gone.md" },
      ],
    },
  };
  const folder = seedLayout(home, "atelier", layout);
  writeFileSync(join(folder, "decisions.md"), "# 결정\n");
  const before = filesIn(folder);
  await installRealBackend(page, sandbox);
  await page.goto("/settings/spec-layout/atelier");

  // 다리가 엔진의 답을 준다 — 디스크에도 초안에도 본문이 없는 템플릿은 그 항목 자리의 오류이고 글이 없다
  const message = 'template "gone.md" is neither given nor in the layout folder';
  expect(await askBackend(page, "render_spec_layout", { id: "atelier", layout, templates: {} })).toEqual({
    text: null,
    lines: [],
    errors: [{ path: [1], message }],
    warnings: [],
  } satisfies LayoutPreview);
  await expect(askBackend(page, "render_spec_layout", { id: "../..", layout, templates: {} })).rejects.toThrow();

  const 누락행 = page.getByRole("treeitem", { name: /^gone\.md/ });
  await expect(누락행).toContainText("검증 오류");
  await 누락행.click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();

  const 팝업 = page.getByRole("dialog", { name: "LLM이 받는 텍스트", exact: true });
  await page.getByRole("button", { name: "LLM이 받는 텍스트", exact: true }).click();
  await expect(팝업).toContainText("오류를 고치면 보여요");
  await page.keyboard.press("Escape");

  // 본문을 적으면 풀린다 — 저장하면 그 파일이 설 것이라 `Template:` 줄이 실린다
  await page.getByRole("textbox", { name: "템플릿 본문", exact: true }).fill("# 뼈대\n");
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  await expect(저장(page)).toBeEnabled();
  await page.getByRole("button", { name: "LLM이 받는 텍스트", exact: true }).click();
  const shown = await 팝업.locator("[data-line]").allTextContents();
  expect(shown).toContain(`${" ".repeat(16)}Template: ${folder}/gone.md`);
  expect(await 팝업.locator("[data-selected]").allTextContents()).toEqual([
    "  gone.md       사라진 뼈대",
    `${" ".repeat(16)}Template: ${folder}/gone.md`,
  ]);
  await page.keyboard.press("Escape");
  // 묻기만 했다 — 템플릿 파일도 레이아웃 파일도 그대로다
  expect(filesIn(folder)).toEqual(before);

  // 저장하면 그 본문이 디스크에 서고, 이제 본문 없이 물어도 같은 글이다 — 미리보기는 저장하면 받을 글이었다
  await 저장(page).click();
  await expect.poll(() => existsSync(join(folder, "gone.md"))).toBe(true);
  const saved = JSON.parse(readFileSync(join(folder, "layout.json"), "utf8"));
  const after = (await askBackend(page, "render_spec_layout", {
    id: "atelier",
    layout: saved,
    templates: {},
  })) as LayoutPreview;
  expect(after.text!.split("\n")).toEqual(shown);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

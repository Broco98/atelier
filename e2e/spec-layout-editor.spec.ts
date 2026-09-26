import type { SpecLayoutJson, TemplateBodies } from "@/features/spec-layout/types";
import { expect, test, type Page } from "./evidence";
import {
  BROKEN_MAISON_LAYOUT,
  MISSING_TEMPLATE_READ,
  SPEC_LAYOUT_READ,
  SPEC_LAYOUT_STATES,
  UNREADABLE_MAISON_READ,
} from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11 · 결정 11·20·26). 「spec 레이아웃」 설정 페이지의 모드 행에서
// [편집]을 누르면 그 설정 nav 항목 아래의 하위 주소에 편집기가 선다. 두 열의 모양(맨 위 항목의 행이 없다,
// 파일·폴더 항목, 모르는 아이콘, 오류 줄)은 마크업 seam이 잰다(`SpecLayoutEditor.test.tsx`), 필드를 바꾸는
// 규칙은 순수 함수의 seam이 잰다(`draft.test.ts`).
//
// **이 층이 드는 것은 두 명령의 배선이다** — 편집기가 열리면 `read_spec_layout`이 나가고, [저장]을 눌러야만
// `write_spec_layout`이 나가며, 거기에 고친 초안이 모르는 키와 템플릿 전부와 함께 실린다. 두 명령을 태우는
// 시나리오가 여기 있어야 fixture 이름 표에서 빠졌을 때 빨개진다(구현 스펙 3절).

const aside = (page: Page) => page.locator("aside");
const 머리 = (page: Page) => page.locator("main header").first();
const 행 = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true });
const 편집 = (page: Page, name: "Atelier" | "Maison") =>
  page.getByRole("button", { name: `${name} 레이아웃 편집`, exact: true });
const 저장 = (page: Page) => page.getByRole("button", { name: "저장", exact: true });
const 설명 = (page: Page) => page.getByLabel("설명", { exact: true });

/** 편집기에 들어와 트리가 선 뒤까지 — 「spec 레이아웃」 설정 페이지의 모드 행에서 [편집]을 누른다. */
async function openEditor(page: Page) {
  await page.goto("/settings/spec-layout");
  await 편집(page, "Atelier").click();
  await expect(page).toHaveURL("/settings/spec-layout/atelier");
  await expect(행(page, "overview.md")).toBeVisible();
}

type WriteArgs = { id: string; layout: SpecLayoutJson; templates: TemplateBodies };

/** 나간 `write_spec_layout`들의 인자, 나간 순서대로. 모양은 단언이다 — `ipcCallArgs`는 `id` 키만 잰다. */
async function writes(page: Page): Promise<WriteArgs[]> {
  return (await ipcCallArgs(page, "write_spec_layout", "id")).map(({ args }) => args as WriteArgs);
}

test("모드 행의 [편집]을 누르면 편집기 주소가 열리고 읽기 명령이 나가며, 트리에 실제 항목만 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  expect(await callCount(page, "read_spec_layout")).toBe(0);

  await 편집(page, "Atelier").click();
  await expect(page).toHaveURL("/settings/spec-layout/atelier");
  await expect.poll(() => callCount(page, "read_spec_layout")).toBe(1);
  const reads = await ipcCallArgs(page, "read_spec_layout", "id");
  expect(reads.map(({ args }) => args)).toEqual([{ id: "atelier" }]);

  // 위치는 세 칸이다 — `Settings / spec 레이아웃 / Atelier`
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*spec 레이아웃\s*\/\s*Atelier\s*저장$/);
  // 트리는 최상위 항목부터다 — 맨 위 항목의 행이 없다(결정 26)
  await expect(page.getByRole("treeitem")).toHaveText([
    "overview.md",
    "decisions.md",
    "{n}-{name}/",
    "tickets/",
  ]);
  await expect(page.getByRole("button", { name: "spec/", exact: true })).toBeVisible();
  // 처음에는 첫 최상위 항목을 골랐다 — 제목이 곧 이름 틀 칸이다
  await expect(page.getByRole("textbox", { name: "이름 틀", exact: true })).toHaveValue("overview.md");
  // 연 것만으로는 아무것도 쓰지 않는다
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 초안은 읽은 것을 펼쳐 고친다 — fixture에 손으로 적은 키 둘(`owner`, `since`)이 저장에 그대로 실려야 한다.
// 템플릿은 고치지 않았어도 **늘 전부** 넘긴다(구현 스펙 3절).
test("항목을 골라 설명을 고치고 저장하면 고친 초안이 모르는 키, 템플릿 전부와 함께 저장 명령에 실린다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await 행(page, "decisions.md").click();
  await expect(설명(page)).toHaveValue("정한 것과 그 이유");
  await 설명(page).fill("정한 것, 그 이유, 버린 안");
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const { root } = SPEC_LAYOUT_READ.layout;
  expect(await writes(page)).toEqual([
    {
      id: "atelier",
      layout: {
        owner: "사람",
        root: {
          ...root,
          children: [
            root.children![0],
            {
              pattern: "decisions.md",
              kind: "file",
              description: "정한 것, 그 이유, 버린 안",
              template: "decisions.md",
              since: "0.14",
            },
            root.children![2],
          ],
        },
      },
      templates: { "decisions.md": "# 결정\n" },
    },
  ]);
  // 저장한 뒤에도 초안은 그대로다
  await expect(설명(page)).toHaveValue("정한 것, 그 이유, 버린 안");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("항목을 고치기만 하고 저장을 누르지 않으면 저장 명령이 나가지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await 행(page, "{n}-{name}/").click();
  await page.getByRole("textbox", { name: "이름 틀", exact: true }).fill("iter-{n}-{name}");
  await 설명(page).fill("판 하나, 이름을 바꿨다");
  await page.getByRole("radio", { name: "파일", exact: true }).click();
  await expect(행(page, "iter-{n}-{name}")).toBeVisible();

  await page.getByRole("button", { name: "설정으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(2);
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 아이콘은 제목 옆 칸의 팝오버에서 앱의 아이콘 표로 고른다 — 고른 이름이 초안에, 저장에 실린다.
test("아이콘 칸의 팝오버에서 아이콘을 고르면 트리 행이 따라오고 저장에 그 이름이 실린다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await 행(page, "decisions.md").click();
  const 칸 = page.getByRole("button", { name: "아이콘 바꾸기", exact: true });
  await 칸.click();
  const 표 = page.getByRole("radiogroup", { name: "아이콘", exact: true });
  // 이 항목에는 아이콘이 없다 — 「아이콘 없음」이 골라져 있다
  await expect(표.getByRole("radio", { name: "아이콘 없음", exact: true })).toHaveAttribute("aria-checked", "true");
  await 표.getByRole("radio", { name: "scale", exact: true }).click();
  await expect(표).toHaveCount(0);
  await expect(칸).toHaveAttribute("title", "scale");

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout }] = await writes(page);
  expect(layout.root.children![1]).toEqual({
    pattern: "decisions.md",
    kind: "file",
    description: "정한 것과 그 이유",
    template: "decisions.md",
    since: "0.14",
    icon: "scale",
  });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 트리 열의 머리 `spec/`은 항목이 아니다 — 누르면 맨 위 항목의 설명(방침 문단) 칸 하나만 선다(결정 26).
test("머리 `spec/`을 눌러 안내를 고치고 저장하면 저장된 레이아웃의 맨 위 항목 설명이 바뀌어 있다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await page.getByRole("button", { name: "spec/", exact: true }).click();
  const 안내 = page.getByLabel("spec 폴더 안내", { exact: true });
  await expect(안내).toHaveValue("spec 폴더의 방침 문단.");
  await expect(page.getByRole("textbox", { name: "이름 틀" })).toHaveCount(0);
  await 안내.fill("spec 폴더의 방침 문단. 한 줄을 더했다.");

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout }] = await writes(page);
  expect(layout.root.description).toBe("spec 폴더의 방침 문단. 한 줄을 더했다.");
  expect(layout.root.children).toEqual(SPEC_LAYOUT_READ.layout.root.children);
  expect(layout.owner).toBe("사람");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **검증 실패는 데이터로 온다**(구현 스펙 3절) — 문자열 거절(`ipcFailure`)이 아니라 성공 답의 `errors`다.
// 오류는 그 위치의 항목 제목 아래에 붉은 줄로 서고, 초안은 남는다.
test("저장의 답이 오류 데이터면 그 위치의 항목 아래에 오류가 서고 초안이 남는다", async ({ page }) => {
  const message = "two siblings have the pattern `tickets`";
  await installFixtureBackend(page, {
    write_spec_layout: { errors: [{ path: [2, 0], message }] },
  });
  await openEditor(page);

  await 행(page, "tickets/").click();
  await 설명(page).fill("그 판의 티켓, 고쳤다");
  const reads = await callCount(page, "read_spec_layout");
  await 저장(page).click();

  const 오류 = page.getByText(message, { exact: true });
  await expect(오류).toBeVisible();
  await expect(오류).toHaveClass(/text-red-600/);
  await expect(설명(page)).toHaveValue("그 판의 티켓, 고쳤다");
  // 다른 항목에는 서지 않는다
  await 행(page, "overview.md").click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  await page.getByRole("treeitem", { name: /^tickets\// }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(설명(page)).toHaveValue("그 판의 티켓, 고쳤다");
  // 아무것도 쓰이지 않았으니 다시 읽을 것이 없다
  expect(await callCount(page, "read_spec_layout")).toBe(reads);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("편집기 주소에서 설정 nav의 「spec 레이아웃」이 켜져 있고, 뒤로를 누르면 설정 페이지로 돌아간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openEditor(page);

  const nav항목 = aside(page).getByRole("button", { name: "spec 레이아웃", exact: true });
  await expect(nav항목.locator("xpath=..")).toHaveClass(/selected-row/);

  await page.getByRole("button", { name: "설정으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*spec 레이아웃$/);
  await expect(page.locator("main li")).toHaveCount(2);
  await expect(nav항목.locator("xpath=..")).toHaveClass(/selected-row/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 읽지 못하는 레이아웃은 행에 [편집] 대신 [다시 읽기]가 서고(티켓 08), **편집기 주소로 바로 와도** 편집 UI가
// 서지 않는다 — 까닭과 설정으로 돌아가는 길만 보인다.
test("읽지 못하는 레이아웃은 행에 [편집]이 없고, 편집기 주소로 바로 와도 편집 UI가 서지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    spec_layout_states: [SPEC_LAYOUT_STATES[0], BROKEN_MAISON_LAYOUT],
    read_spec_layout: UNREADABLE_MAISON_READ,
  });
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(2);
  await expect(편집(page, "Atelier")).toBeVisible();
  await expect(편집(page, "Maison")).toHaveCount(0);

  await page.goto("/settings/spec-layout/maison");
  await expect(page.getByText("~/.atelier/layouts/maison/ 레이아웃을 읽지 못해 편집할 수 없어요")).toBeVisible();
  await expect(page.getByText('root.children[2]: `kind` is missing ("file" or "folder")')).toBeVisible();
  await expect(page.getByRole("treeitem")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(저장(page)).toHaveCount(0);
  await expect.poll(() => callCount(page, "read_spec_layout")).toBe(1);
  const reads = await ipcCallArgs(page, "read_spec_layout", "id");
  expect(reads.map(({ args }) => args)).toEqual([{ id: "maison" }]);

  await page
    .getByRole("main")
    .getByRole("button", { name: "설정으로 돌아가기", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL("/settings/spec-layout");
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 파일 항목의 템플릿(티켓 12). 모양(파일에만 선다, 있음이면 본문 칸과 경로, 누락이면 경고)은 마크업 seam이,
// 경로를 짓고 켜고 끄는 규칙은 순수 함수의 seam이 잰다. **이 층이 드는 것은 저장에 실리는 것이다** — 켠
// 템플릿의 경로와 본문이 `write_spec_layout`에 실리고, 끈 템플릿은 레이아웃에서도 본문 맵에서도 빠진다.
// 템플릿 파일을 지우는 것은 저장(엔진)이 빠진 템플릿을 지우는 일이다(티켓 07).
const 템플릿 = (page: Page, choice: "없음" | "있음") =>
  page
    .getByRole("radiogroup", { name: "템플릿", exact: true })
    .getByRole("radio", { name: choice, exact: true });
const 템플릿본문 = (page: Page) => page.getByRole("textbox", { name: "템플릿 본문", exact: true });

test("파일 항목의 템플릿을 켜고 본문을 적어 저장하면 저장 명령에 편집기가 지은 경로와 그 본문이 실린다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openEditor(page);

  // 처음에 고른 것은 템플릿이 없는 overview.md다
  await expect(템플릿(page, "없음")).toHaveAttribute("aria-checked", "true");
  await expect(템플릿본문(page)).toHaveCount(0);
  await 템플릿(page, "있음").click();
  await expect(템플릿(page, "있음")).toHaveAttribute("aria-checked", "true");
  // 경로는 사람이 적지 않는다 — 고정 이름이라 같은 이름이고, 레이아웃 폴더 바로 아래다
  await expect(page.getByText("~/.atelier/layouts/atelier/overview.md", { exact: true })).toBeVisible();
  await expect(템플릿본문(page)).toHaveValue("");
  await 템플릿본문(page).fill("# 개요\n\n## 무엇을\n");

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout, templates }] = await writes(page);
  expect(layout.root.children![0]).toEqual({
    pattern: "overview.md",
    kind: "file",
    icon: "compass",
    description: "work의 요약",
    template: "overview.md",
  });
  // 템플릿은 늘 전부 넘긴다 — 고치지 않은 decisions.md의 본문도 실린다
  expect(templates).toEqual({ "decisions.md": "# 결정\n", "overview.md": "# 개요\n\n## 무엇을\n" });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("템플릿을 없음으로 바꿔 저장하면 그 항목의 template이 빠지고 본문 맵에도 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await 행(page, "decisions.md").click();
  await expect(템플릿(page, "있음")).toHaveAttribute("aria-checked", "true");
  await expect(템플릿본문(page)).toHaveValue("# 결정\n");
  await 템플릿(page, "없음").click();
  await expect(템플릿본문(page)).toHaveCount(0);

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout, templates }] = await writes(page);
  // 모르는 키(`since`)는 남는다
  expect(layout.root.children![1]).toEqual({
    pattern: "decisions.md",
    kind: "file",
    description: "정한 것과 그 이유",
    since: "0.14",
  });
  expect(templates).toEqual({});

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 템플릿 파일이 디스크에서 사라진 항목 — 읽기가 누락 경고와 함께 본문 없이 준다. 「있음」 그대로 빈 칸과
// 경고가 서고, 적으면 경고가 풀리며 그 본문이 저장에 실린다(저장이 파일을 다시 만든다).
test("누락 템플릿이 든 레이아웃을 열어 그 항목의 본문을 적고 저장하면 저장 명령에 그 경로와 본문이 실린다", async ({
  page,
}) => {
  await installFixtureBackend(page, { read_spec_layout: MISSING_TEMPLATE_READ });
  await openEditor(page);

  const 누락 = page.getByText("레이아웃 폴더에 이 템플릿 파일이 없어요", { exact: true });
  await expect(누락).toHaveCount(0);
  await 행(page, "decisions.md 템플릿 누락").click();
  await expect(템플릿(page, "있음")).toHaveAttribute("aria-checked", "true");
  await expect(템플릿본문(page)).toHaveValue("");
  await expect(page.getByText("~/.atelier/layouts/atelier/decisions.md", { exact: true })).toBeVisible();
  await expect(누락).toBeVisible();

  await 템플릿본문(page).fill("# 결정\n\n## 다시 쓴 뼈대\n");
  await expect(누락).toHaveCount(0);
  await expect(행(page, "decisions.md")).toBeVisible();

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout, templates }] = await writes(page);
  expect(layout.root.children![1].template).toBe("decisions.md");
  expect(templates).toEqual({ "decisions.md": "# 결정\n\n## 다시 쓴 뼈대\n" });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

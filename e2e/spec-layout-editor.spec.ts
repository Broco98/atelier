import { expect, test, type Page } from "./evidence";
import {
  BROKEN_MAISON_LAYOUT,
  SPEC_LAYOUT_READ,
  SPEC_LAYOUT_STATES,
  UNREADABLE_MAISON_READ,
} from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11 · 결정 11·20·26). 설정 항목 페이지의 모드 행에서 [편집]을
// 누르면 그 항목 아래의 하위 주소에 편집기가 선다. 두 열의 모양(맨 위 항목의 행이 없다, 파일·폴더 항목,
// 모르는 아이콘, 오류 줄)은 마크업 seam이 잰다(`SpecLayoutEditor.test.tsx`), 필드를 바꾸는 규칙은 순수
// 함수의 seam이 잰다(`draft.test.ts`).
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

/** 편집기에 들어와 트리가 선 뒤까지 — 설정 항목 페이지의 모드 행에서 [편집]을 누른다. */
async function openEditor(page: Page) {
  await page.goto("/settings/spec-layout");
  await 편집(page, "Atelier").click();
  await expect(page).toHaveURL("/settings/spec-layout/atelier");
  await expect(행(page, "overview.md")).toBeVisible();
}

/** 나간 `write_spec_layout`들의 인자, 나간 순서대로. */
async function writes(page: Page) {
  return (await ipcCallArgs(page, "write_spec_layout", "id")).map(({ args }) => args);
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
  const [{ layout }] = (await writes(page)) as [{ layout: typeof SPEC_LAYOUT_READ.layout }];
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

  const 항목 = aside(page).getByRole("button", { name: "spec 레이아웃", exact: true });
  await expect(항목.locator("xpath=..")).toHaveClass(/selected-row/);

  await page.getByRole("button", { name: "설정으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(머리(page)).toHaveText(/^Settings\s*\/\s*spec 레이아웃$/);
  await expect(page.locator("main li")).toHaveCount(2);
  await expect(항목.locator("xpath=..")).toHaveClass(/selected-row/);

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

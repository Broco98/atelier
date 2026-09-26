import type { ReadableSpecLayout, SpecLayoutJson, SpecLayoutRead, TemplateBodies } from "@/features/spec-layout/types";
import { expect, test, type Page } from "./evidence";
import { CHANGED_SPEC_LAYOUT_READ, SPEC_LAYOUT_READ, SPEC_LAYOUT_RENDERED, UNREADABLE_ATELIER_READ } from "./fixtures";
import {
  callCount,
  fireEvent,
  hoverRowPoint,
  installFixtureBackend,
  ipcCallArgs,
  pickUpEntry,
  swapAnswer,
  unknownIpcCalls,
} from "./harness";

// 밖에서 바뀐 레이아웃(spec 레이아웃 티켓 15 · 결정 22). 에이전트가 레이아웃을 저장하거나 사람이 손으로 고치면 감시가
// `layouts:changed`를 쏘고, 전역 구독 하나가 레이아웃 읽기를 다시 부른다. 편집기는 따로 듣지 않고 다시 읽힌 답을
// 기준본과 내용으로 견준다 — 초안이 없으면 조용히 따라가고, 있으면 머리 아래의 배너로 한쪽을 고르게 한다.
// 판정 표의 여섯 줄은 L2가 잰다(`outside.test.ts`).
//
// **이 층이 드는 것은 그 줄이 화면까지 이어지는가다.** fixture의 답은 설치할 때 한 번 정해지므로, 편집기가 연 뒤에
// 읽기의 답을 갈아 끼우고(`swapAnswer`) 하네스가 종을 친다(`fireEvent`).

const 행 = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true });
const 설명 = (page: Page) => page.getByLabel("설명", { exact: true });
const 저장 = (page: Page) => page.getByRole("button", { name: "저장", exact: true });
const 배너 = (page: Page) => page.getByRole("alert");
const 배너버튼 = (page: Page, name: "새로 불러오기" | "내 초안 유지") => 배너(page).getByRole("button", { name, exact: true });

const EDITOR = "/settings/spec-layout/atelier";
const [OVERVIEW, DECISIONS] = SPEC_LAYOUT_READ.layout.root.children!;
const [, OUTSIDE_DECISIONS] = CHANGED_SPEC_LAYOUT_READ.layout.root.children!;
/** 사람이 편집기에서 고친 `overview.md`의 설명 — 밖의 변경(`decisions.md`)과 다른 칸이다. */
const MINE = "work의 요약, 사람이 고쳤다";

/** 편집기에 들어와 트리가 선 뒤까지 — 「spec 레이아웃」 설정 페이지의 모드 행에서 [편집]을 누른다. */
async function openEditor(page: Page) {
  await page.goto("/settings/spec-layout");
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await expect(page).toHaveURL(EDITOR);
  await expect(행(page, "overview.md")).toBeVisible();
}

/** 밖에서 레이아웃이 바뀐다 — 읽기의 답을 갈아 끼우고 종을 친 뒤, 읽기가 다시 불리기까지 기다린다. */
async function changeOutside(page: Page, read: SpecLayoutRead) {
  const before = await callCount(page, "read_spec_layout");
  await swapAnswer(page, "read_spec_layout", read);
  await fireEvent(page, "layouts:changed", null);
  await expect.poll(() => callCount(page, "read_spec_layout")).toBeGreaterThan(before);
}

type WriteArgs = { layout: SpecLayoutJson; templates: TemplateBodies };

/** 나간 `write_spec_layout`들의 인자, 나간 순서대로. */
async function writes(page: Page): Promise<WriteArgs[]> {
  return (await ipcCallArgs(page, "write_spec_layout", "id")).map(({ args }) => args as WriteArgs);
}

test("초안이 있을 때 밖에서 바뀌면 바뀜 배너가 서고, [새로 불러오기]는 초안을 버리고 새로 읽은 것을 세운다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await 설명(page).fill(MINE);

  await changeOutside(page, CHANGED_SPEC_LAYOUT_READ);
  await expect(배너(page)).toContainText("밖에서 이 레이아웃이 바뀌었어요");
  // 배너가 선 동안 초안은 그대로다 — 합치지 않는다
  await expect(설명(page)).toHaveValue(MINE);

  await 배너버튼(page, "새로 불러오기").click();
  await expect(배너(page)).toHaveCount(0);
  await expect(설명(page)).toHaveValue(OVERVIEW.description!);
  await 행(page, "decisions.md").click();
  await expect(설명(page)).toHaveValue(OUTSIDE_DECISIONS.description!);
  // 새로 읽은 것이 기준본이 됐다 — 고친 것이 없다
  await expect(저장(page)).toBeDisabled();
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("[내 초안 유지]는 배너를 닫고 초안을 남기며, 저장하면 그 초안이 밖의 변경을 덮는다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await 설명(page).fill(MINE);

  await changeOutside(page, CHANGED_SPEC_LAYOUT_READ);
  await 배너버튼(page, "내 초안 유지").click();
  await expect(배너(page)).toHaveCount(0);
  await expect(설명(page)).toHaveValue(MINE);
  await 행(page, "decisions.md").click();
  await expect(설명(page)).toHaveValue(DECISIONS.description!);

  // 유지는 기준본을 새것으로 바꾼다 — 밖이 처음 것으로 돌아와도 그것은 이제 바뀜이다(기준본이 그대로였다면 1번 무시에
  // 걸려 배너가 안 선다). 배너가 닫힌 것만 보면 기준본이 옮겨졌는지가 갈리지 않으므로 한 번 더 밖에서 바꿔 본다.
  await changeOutside(page, SPEC_LAYOUT_READ);
  await expect(배너(page)).toContainText("밖에서 이 레이아웃이 바뀌었어요");
  await expect(설명(page)).toHaveValue(DECISIONS.description!);
  await 배너버튼(page, "내 초안 유지").click();
  await expect(배너(page)).toHaveCount(0);

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout, templates }] = await writes(page);
  // 합치지 않는다 — 밖에서 고친 `decisions.md`의 설명도 초안의 것으로 덮는다
  expect(layout.root.children).toEqual([{ ...OVERVIEW, description: MINE }, DECISIONS, SPEC_LAYOUT_READ.layout.root.children![2]]);
  expect(templates).toEqual(SPEC_LAYOUT_READ.templates);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 미리보기의 답은 초안에만 달리지 않는다 — 초안에 본문이 없는 템플릿은 엔진이 디스크에 그 파일이 있는지를 본다. 밖에서
// 그 파일이 되살아났는데 고치지 않은 초안을 다시 묻지 않으면, 엔진이 이제 받을 초안의 저장이 옛 오류로 잠긴 채 남는다.
test("밖이 바뀌면 고치지 않은 초안도 미리보기를 다시 묻는다 — [내 초안 유지] 뒤 디스크가 풀어 준 저장이 잠겨 있지 않다", async ({
  page,
}) => {
  const message = 'template "decisions.md" is neither given nor in the layout folder';
  await installFixtureBackend(page, {
    render_spec_layout: { text: null, lines: [], errors: [{ path: [1], message }], warnings: [] },
  });
  await openEditor(page);
  await expect.poll(() => callCount(page, "render_spec_layout")).toBe(1);
  // 고친 초안의 물음이 **답을 갈아 끼우기 전에** 나가야 한다 — 그 뒤에 나가면 새 답을 받아 고침 없이도 초록이 된다.
  await 설명(page).fill(MINE);
  await expect.poll(() => callCount(page, "render_spec_layout")).toBe(2);
  await expect(page.getByRole("treeitem", { name: "decisions.md 검증 오류", exact: true })).toBeVisible();
  await expect(저장(page)).toBeDisabled();

  // 밖에서 템플릿 파일이 되살아났다 — 이제 엔진은 같은 초안에 오류 없이 답한다
  await swapAnswer(page, "render_spec_layout", SPEC_LAYOUT_RENDERED);
  const before = await callCount(page, "render_spec_layout");
  await changeOutside(page, CHANGED_SPEC_LAYOUT_READ);
  await expect(배너(page)).toContainText("밖에서 이 레이아웃이 바뀌었어요");

  await 배너버튼(page, "내 초안 유지").click();
  await expect(배너(page)).toHaveCount(0);
  await expect.poll(() => callCount(page, "render_spec_layout")).toBeGreaterThan(before);
  await expect(행(page, "decisions.md")).toBeVisible();
  await expect(저장(page)).toBeEnabled();

  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [{ layout }] = await writes(page);
  expect(layout.root.children![0]).toEqual({ ...OVERVIEW, description: MINE });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("초안이 없을 때 밖에서 바뀌면 배너 없이 새로 읽은 것으로 바뀐다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await 행(page, "decisions.md").click();
  await expect(설명(page)).toHaveValue(DECISIONS.description!);

  await changeOutside(page, CHANGED_SPEC_LAYOUT_READ);
  // 고르던 항목은 그대로다
  await expect(설명(page)).toHaveValue(OUTSIDE_DECISIONS.description!);
  await expect(배너(page)).toHaveCount(0);
  await expect(저장(page)).toBeDisabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 끄는 도중에는 초안이 없다 — 놓기 전까지 끌기는 초안이 아니다. 그래서 밖 변경이 조용히 트리를 갈아 끼운다(판정
// 3번). 끌리는 항목과 겨눈 자리는 인덱스 경로라, 끌기를 거두지 않으면 놓는 순간 그 자리에 새로 선 다른 항목이 옮겨 간다.
test("끄는 도중 밖 변경이 트리를 조용히 갈아 끼우면 끌기가 거둬져, 놓아도 아무 항목도 옮겨 가지 않는다", async ({ page }) => {
  const root = SPEC_LAYOUT_READ.layout.root;
  const shifted: ReadableSpecLayout = {
    ...SPEC_LAYOUT_READ,
    layout: {
      ...SPEC_LAYOUT_READ.layout,
      root: { ...root, children: [{ pattern: "brief.md", kind: "file", description: "한 줄 요약" }, ...root.children!] },
    },
  };
  await installFixtureBackend(page);
  await openEditor(page);

  await pickUpEntry(page, 행(page, "{n}-{name}/"));
  await changeOutside(page, shifted);
  await expect(행(page, "brief.md")).toBeVisible();
  await hoverRowPoint(page, 행(page, "overview.md"), "upper");
  await page.mouse.up();

  await expect(page.getByRole("treeitem")).toHaveText(["brief.md", "overview.md", "decisions.md", "{n}-{name}/", "tickets/"]);
  await expect(page.locator("[data-entry-drop]")).toHaveCount(0);
  for (const row of await page.getByRole("treeitem").all()) await expect(row).not.toHaveCSS("opacity", "0.4");
  // 새로 읽은 것이 기준본이고 아무것도 옮겨 가지 않았다 — 저장할 것이 없다
  await expect(저장(page)).toBeDisabled();
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("초안이 없을 때 밖에서 깨지면 편집 UI 대신 까닭과 돌아가는 길이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await changeOutside(page, UNREADABLE_ATELIER_READ);
  await expect(page.getByText("~/.atelier/layouts/atelier/ 레이아웃을 읽지 못해 편집할 수 없어요")).toBeVisible();
  await expect(page.getByText('root.children[2]: `kind` is missing ("file" or "folder")')).toBeVisible();
  await expect(page.getByRole("treeitem")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(저장(page)).toHaveCount(0);
  await expect(배너(page)).toHaveCount(0);

  // 초안이 없으니 묻지 않고 돌아간다
  await page.getByRole("main").getByRole("button", { name: "설정으로 돌아가기", exact: true }).last().click();
  await expect(page).toHaveURL("/settings/spec-layout");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("초안이 있을 때 밖에서 깨지면 깨짐 배너가 서고, [새로 불러오기]는 「읽지 못함」 화면이다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await 설명(page).fill(MINE);

  await changeOutside(page, UNREADABLE_ATELIER_READ);
  await expect(배너(page)).toContainText("밖에서 이 레이아웃이 깨졌어요");
  await expect(설명(page)).toHaveValue(MINE);

  await 배너버튼(page, "새로 불러오기").click();
  await expect(page.getByText("~/.atelier/layouts/atelier/ 레이아웃을 읽지 못해 편집할 수 없어요")).toBeVisible();
  await expect(page.getByRole("treeitem")).toHaveCount(0);
  await expect(배너(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **제 저장** — 저장이 되면 기준본이 저장한 것이 된다. 그래서 제 저장 뒤에 다시 읽힌 답이 저장본이면 1번(무시)에
// 걸린다. 배너가 안 서는 것만 보면 「아직 안 그렸다」와 갈리지 않으므로, 그 뒤에 한 번 더 밖에서 바꿔 **조용히**
// 들어오는 것까지 본다: 제 저장을 밖 변경으로 읽었다면 초안이 있는 채라 배너가 서고 새것이 안 들어온다.
test("저장한 뒤 읽기의 답이 저장본으로 바뀌어 종이 울려도 배너가 서지 않고, 그다음 밖의 변경은 조용히 들어온다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await 행(page, "decisions.md").click();
  await 설명(page).fill("정한 것, 그 이유, 사람이 저장했다");
  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  await expect(저장(page)).toHaveText("저장");

  const [{ layout, templates }] = await writes(page);
  const saved: ReadableSpecLayout = { ...SPEC_LAYOUT_READ, layout, templates };
  await changeOutside(page, saved);
  await expect(배너(page)).toHaveCount(0);
  await expect(설명(page)).toHaveValue("정한 것, 그 이유, 사람이 저장했다");

  await changeOutside(page, CHANGED_SPEC_LAYOUT_READ);
  await expect(설명(page)).toHaveValue(OUTSIDE_DECISIONS.description!);
  await expect(배너(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

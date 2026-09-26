import type { SpecLayoutJson } from "@/features/spec-layout/types";
import { expect, test, type Page } from "./evidence";
import { SPEC_LAYOUT_READ, WORKS } from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

// 떠날 때 확인(spec 레이아웃 티켓 15 · 결정 27) — **이 저장소의 첫 「떠날 때 확인」이다.** 저장하지 않은 초안을 두고
// 편집기를 떠나면 앱의 확인 창이 [계속 편집], [버리고 나가기], 그리고 저장할 수 있을 때만 서는 [저장하고 나가기]로
// 묻는다. 물음의 글과 버튼 글자, 포커스를 둘 버튼, 답의 뜻은 L2가 스토어에 선 물음으로 잰다(`leave.test.tsx` — 창은
// 포털로 서서 정적 렌더에 안 그려진다), 언제 초안이 「있는지」는 순수 함수가 잰다.
//
// **이 층이 드는 것은 떠나는 길이 모두 물음에 걸리는가다** — 뒤로, 설정 nav의 다른 항목, 팔레트로 다른 곳 열기,
// 히스토리의 앞으로·뒤로.
// 길마다 따로 걸면 한 길이 잊는 날 그 길로만 초안이 사라진다. 그리고 [저장하고 나가기]가 정말 저장 명령을 부른 뒤에
// 떠나는가, 저장이 거절되면 떠나지 않는가, 저장이 잠겨 있으면 그 버튼이 아예 서지 않는가. 창이 버튼을 그 순서로
// 그리고 포커스가 정말 [계속 편집]에 서는가도 여기서만 보인다. 설정 초안(터미널, 알림)에는 걸지 않는다 — 그
// L3(`settings-save.spec.ts`)는 손대지 않은 채 초록이다.

const 행 = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true });
const 설명 = (page: Page) => page.getByLabel("설명", { exact: true });
const 저장 = (page: Page) => page.getByRole("button", { name: "저장", exact: true });
const 뒤로 = (page: Page) => page.getByRole("button", { name: "설정으로 돌아가기", exact: true });
const 떠날때 = (page: Page) => page.getByRole("alertdialog", { name: "저장하지 않은 변경이 있어요", exact: true });
const 창버튼 = (page: Page, name: "계속 편집" | "버리고 나가기" | "저장하고 나가기") =>
  떠날때(page).getByRole("button", { name, exact: true });

const EDITOR = "/settings/spec-layout/atelier";
const EDITED = "정한 것, 그 이유, 버린 안";

/** 편집기에 들어와 트리가 선 뒤까지 — 「spec 레이아웃」 설정 페이지의 모드 행에서 [편집]을 누른다. */
async function openEditor(page: Page) {
  await page.goto("/settings/spec-layout");
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await expect(page).toHaveURL(EDITOR);
  await expect(행(page, "overview.md")).toBeVisible();
}

/**
 * 저장하지 않은 초안을 만든다 — `decisions.md`의 설명 한 칸. 그 초안의 미리보기 답이 와 저장이 풀리기까지 기다린다:
 * [저장하고 나가기]는 저장 가능 판정이 참일 때만 선다.
 */
async function draftOne(page: Page) {
  await 행(page, "decisions.md").click();
  await 설명(page).fill(EDITED);
  await expect(저장(page)).toBeEnabled();
}

/** 나간 `write_spec_layout`들의 레이아웃, 나간 순서대로. */
async function writtenLayouts(page: Page): Promise<SpecLayoutJson[]> {
  return (await ipcCallArgs(page, "write_spec_layout", "id")).map(({ args }) => (args as { layout: SpecLayoutJson }).layout);
}

test("초안이 있는 채로 뒤로를 누르면 확인 창이 뜨고, [계속 편집]이면 초안과 함께 편집기에 머문다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await draftOne(page);

  await 뒤로(page).click();
  await expect(떠날때(page)).toBeVisible();
  await expect(떠날때(page).getByRole("button")).toHaveText(["계속 편집", "버리고 나가기", "저장하고 나가기"]);

  await 창버튼(page, "계속 편집").click();
  await expect(떠날때(page)).toHaveCount(0);
  await expect(page).toHaveURL(EDITOR);
  await expect(설명(page)).toHaveValue(EDITED);
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 창이 뜨면 포커스는 [계속 편집]에 있다(결정 27) — 떠나려던 손이 반사적으로 친 Enter가 초안을 버리지 않는다(종료
// 확인과 같은 까닭). Esc와 창 바깥 누르기도 [계속 편집]이다. 창이 막 뜬 한 프레임의 키는 창이 삼키므로(S24) 키를
// 치기 전에 포커스가 창 안에 선 것을 먼저 본다.
const dismissals: Array<[string, (page: Page) => Promise<void>]> = [
  ["Enter", (page) => page.keyboard.press("Enter")],
  ["Esc", (page) => page.keyboard.press("Escape")],
  // 창 바깥의 막(`modal-scrim`)을 누른다 — 창은 가운데 400px라 왼쪽 위 모서리는 늘 바깥이다. 창이 떠 있는 동안
  // 뒤는 가려져 역할로 집지 못하므로 자리로 누른다.
  ["바깥 누르기", (page) => page.mouse.click(8, 8)],
];

for (const [label, dismiss] of dismissals) {
  test(`확인 창이 뜨면 포커스가 [계속 편집]이라, ${label}에도 초안과 함께 편집기에 머문다`, async ({ page }) => {
    await installFixtureBackend(page);
    await openEditor(page);
    await draftOne(page);

    await 뒤로(page).click();
    await expect(창버튼(page, "계속 편집")).toBeFocused();

    await dismiss(page);
    await expect(떠날때(page)).toHaveCount(0);
    await expect(page).toHaveURL(EDITOR);
    await expect(설명(page)).toHaveValue(EDITED);
    expect(await callCount(page, "write_spec_layout")).toBe(0);

    // 머문 뒤에도 떠나는 길은 그대로 물음에 걸린다 — 답한 물음이 막기를 풀어 두지 않았다.
    await 뒤로(page).click();
    await expect(떠날때(page)).toBeVisible();
    await 창버튼(page, "버리고 나가기").click();
    await expect(page).toHaveURL("/settings/spec-layout");
    expect(await callCount(page, "write_spec_layout")).toBe(0);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("[버리고 나가기]면 저장하지 않고 떠나고, 다시 열면 읽은 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await draftOne(page);

  await 뒤로(page).click();
  await 창버튼(page, "버리고 나가기").click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(2);
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  // 초안은 버려졌다 — 다시 연 편집기는 읽은 것으로 선다
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await 행(page, "decisions.md").click();
  await expect(설명(page)).toHaveValue("정한 것과 그 이유");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("[저장하고 나가기]면 저장 명령이 초안을 싣고 나간 뒤에 떠난다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  await draftOne(page);

  await 뒤로(page).click();
  await 창버튼(page, "저장하고 나가기").click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  const [layout] = await writtenLayouts(page);
  expect(layout.root.children![1]).toEqual({ ...SPEC_LAYOUT_READ.layout.root.children![1], description: EDITED });
  expect(layout.owner).toBe("사람");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 저장이 잠겨 있으면(미리보기 답에 검증 오류) [저장하고 나가기]가 서지 않는다 — 눌러도 저장이 안 된다. 물음에 그
// 버튼이 실리는지는 L2가 재지만, 편집기의 저장 가능 판정이 창에 닿는지는 이 층에서만 보인다.
test("저장할 수 없는 초안이면 확인 창에 [저장하고 나가기]가 없다", async ({ page }) => {
  await installFixtureBackend(page, {
    render_spec_layout: {
      text: null,
      lines: [],
      errors: [{ path: [2, 0], message: "two siblings have the pattern `tickets`" }],
      warnings: [],
    },
  });
  await openEditor(page);
  // 연 초안의 답이 먼저 와야 한다 — 그래야 아래 셈이 고친 초안의 답 하나만 센다
  await expect(page.getByRole("treeitem", { name: "tickets/ 검증 오류", exact: true })).toBeVisible();
  await 행(page, "decisions.md").click();
  const before = await callCount(page, "render_spec_layout");
  await 설명(page).fill(EDITED);
  await expect.poll(() => callCount(page, "render_spec_layout")).toBe(before + 1);
  await expect(저장(page)).toBeDisabled();

  await 뒤로(page).click();
  await expect(떠날때(page)).toBeVisible();
  await expect(떠날때(page).getByRole("button")).toHaveText(["계속 편집", "버리고 나가기"]);
  await 창버튼(page, "계속 편집").click();
  await expect(page).toHaveURL(EDITOR);
  await expect(설명(page)).toHaveValue(EDITED);
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 저장 가능 판정이 참이어도 저장이 거절될 수 있다 — 미리보기와 저장 사이에 디스크가 바뀌었을 때. 그 거절은 오류
// 데이터로 오고 아무것도 쓰이지 않았다: 떠나면 초안이 사라지므로 편집기에 남아 그 오류를 보인다.
test("[저장하고 나가기]의 답이 오류 데이터면 떠나지 않고 편집기에 남아 그 항목 아래에 오류를 보인다", async ({ page }) => {
  const message = 'template "decisions.md" is neither given nor in the layout folder';
  await installFixtureBackend(page, { write_spec_layout: { errors: [{ path: [1], message }] } });
  await openEditor(page);
  await draftOne(page);

  await 뒤로(page).click();
  await 창버튼(page, "저장하고 나가기").click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(EDITOR);
  await expect(설명(page)).toHaveValue(EDITED);
  expect(await callCount(page, "write_spec_layout")).toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("초안이 있는 채로 설정 nav의 다른 항목을 누르거나 팔레트로 work를 열어도 묻는다", async ({ page }) => {
  const [work] = WORKS;
  await installFixtureBackend(page);
  await openEditor(page);
  await draftOne(page);

  // 설정 nav의 「터미널」 — 머문다
  await page.locator("aside").getByRole("button", { name: "터미널", exact: true }).click();
  await expect(떠날때(page)).toBeVisible();
  await 창버튼(page, "계속 편집").click();
  await expect(page).toHaveURL(EDITOR);
  await expect(설명(page)).toHaveValue(EDITED);

  // 팔레트로 work의 문서 — 버리고 간다
  await page.keyboard.press("Meta+k");
  await page.getByRole("option").first().click();
  await expect(떠날때(page)).toBeVisible();
  await 창버튼(page, "버리고 나가기").click();
  await expect(page).toHaveURL(new RegExp(`^[^?]*/works/${work.slug}\\?`));
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 셸의 앞으로·뒤로와 마우스의 옆 버튼도 떠나는 길이다 — 히스토리를 되감는 이동(pop)이라 주소가 먼저 바뀌고, 막으면
// 라우터가 히스토리를 편집기로 되돌린다. 앞으로 간 것은 뒤로 되돌려야 한다: `@tanstack/history` 1.162.0은 막은 pop을
// 늘 앞으로 한 칸 되돌려, 앞으로 가려다 머물면 화면은 편집기인데 히스토리는 떠난 자리에 섰고 다음 뒤로가 삼켜졌다.
test("앞으로로 떠나려다 [계속 편집]이면 히스토리도 편집기에 남고, 다음 뒤로가 제대로 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);
  // 초안이 없으니 묻지 않고 떠난다 — 돌아오면 앞으로 갈 자리가 생긴다
  await 뒤로(page).click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await page.goBack();
  await expect(page).toHaveURL(EDITOR);
  await draftOne(page);

  await page.goForward();
  await expect(떠날때(page)).toBeVisible();
  await 창버튼(page, "계속 편집").click();
  await expect(떠날때(page)).toHaveCount(0);
  await expect(page).toHaveURL(EDITOR);
  await expect(설명(page)).toHaveValue(EDITED);

  // 히스토리가 편집기에 섰으면 다음 뒤로도 떠나는 길이다 — 묻는다
  await page.goBack();
  await expect(떠날때(page)).toBeVisible();
  await 창버튼(page, "버리고 나가기").click();
  await expect(page).toHaveURL("/settings/spec-layout");
  expect(await callCount(page, "write_spec_layout")).toBe(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 초안이 「있다」는 기준본과 다르다는 뜻이다 — 고친 것이 없거나, 고쳤다가 저장했으면 묻지 않는다.
test("초안이 없으면 묻지 않는다 — 연 그대로도, 저장한 뒤에도", async ({ page }) => {
  await installFixtureBackend(page);
  await openEditor(page);

  await page.locator("aside").getByRole("button", { name: "터미널", exact: true }).click();
  await expect(page).toHaveURL("/settings/terminal");
  await expect(떠날때(page)).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(EDITOR);
  await draftOne(page);
  await 저장(page).click();
  await expect.poll(() => callCount(page, "write_spec_layout")).toBe(1);
  await expect(저장(page)).toHaveText("저장");
  await 뒤로(page).click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(떠날때(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test, type Page } from "./evidence";
import { PROJECTS, WORKS } from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, unknownIpcCalls, 툴팁 } from "./harness";

// 이 프로젝트에서 시작된 work이 하나 있는 짝 — 픽스처가 그렇게 묶어 뒀다(`projects: ["billing"]`).
const project = PROJECTS[0];
const work = WORKS.find((w) => w.projects.includes(project.slug))!;

// 컴포넌트를 격리 마운트하지 않고 실제 엔트리부터 태운다. 라우터가 브라우저 히스토리
// 위에서 돌고 엔트리가 렌더 전에 전역 초기화를 하므로, 부트를 건너뛰면 "브라우저에서
// 실제로 동작한다"가 증명되지 않는다.
test("고정 데이터가 주어지면 목록 화면이 그 데이터를 그린다", async ({ page }) => {
  await installFixtureBackend(page);

  await page.goto("/projects");

  // 행의 접근성 이름은 이름과 경로를 함께 담는다. 이름만으로 찾으면 상세 화면의
  // 제목 버튼과 둘 다 걸린다 — 경로까지 넣어 목록의 행 하나를 정확히 가리킨다.
  for (const project of PROJECTS) {
    await expect(
      page.getByRole("button", { name: `${project.name} ${project.path}` }),
    ).toBeVisible();
  }

  // 무선택 주소가 첫 항목 주소로 정규화된다 — 라우팅이 브라우저에서 실제로 돌았다는 증거다.
  await expect(page).toHaveURL(`/projects/${PROJECTS[0].slug}`);

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **여기서 work을 열어도 그 work의 마지막 자리가 선다**(결정 77·97 — `recallSearch`).
// 이 문만 오래 그 계약 밖에 있었다: `search` 없이 이동해 spec 기본 문서로 떨어졌고, 도착한
// 주소를 적어 두는 effect(`-works-view.tsx`)가 그 기본값으로 **그 work의 기억을 덮어써**
// 다음에 사이드바나 팔레트로 돌아와도 마지막 화면이 안 섰다. 잃는 것이 이 문 하나가 아니라
// **모든 문**이라는 것이 이 검사가 세우는 것이다.
//
// 기억은 모듈 스코프 지도라 **새로고침 한 번이면 통째로 날아간다** — 그래서 여기서 화면을
// 옮기는 길은 전부 앱 안의 클릭이고, `goto`는 맨 처음 한 번뿐이다. 그 왕복이 진짜인 층은
// 여기뿐이라 L2에는 이 검사가 설 자리가 없다.
test("이 프로젝트의 work을 열면 그 work의 마지막 자리가 열린다", async ({ page }) => {
  await installFixtureBackend(page);

  // 터미널을 보다 떠난다 — 결정 77이 없애려는 것이 바로 이 사람이 문서로 떨어지는 것이다.
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toBeVisible();

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.slug}`);

  // 「이 프로젝트에서 시작된 작업」 행. 사이드바 행도 같은 제목을 들고 있어 `main`으로 좁힌다 —
  // 사이드바 쪽은 이미 다른 검사가 든다(works-sidebar.spec.ts).
  await page.locator("main").getByRole("button", { name: work.title }).click();

  await expect(page).toHaveURL(new RegExp(`/works/${work.slug}`));
  await expect(page).toHaveURL(/tab=terminal/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 기준 브랜치 (스토리 67~69, S28 · S32 · S37) ──
// 프로젝트 화면의 기준 브랜치는 로컬 브랜치 목록(Select)에서 고른다. 여는 버튼이 `combobox`이고 목록이
// `listbox`라, 지금 값이 「선택됨」으로 읽힌다. 방향키와 글자 치기로 찾는 것은 부품이 한다. 저장은 **값이 바뀔
// 때만**이다(지금 규칙). 목록은 지금처럼 버튼 **아래로** 뜬다 — registry의 트리거 맞춤(고른 값을 트리거 자리에
// 겹쳐 올린다)을 껐다(S32). 로컬 브랜치가 없는 프로젝트(git 정보가 없다)는 지금처럼 직접 적는 입력칸이다.
//
// 픽스처의 billing은 로컬 브랜치가 `main`(지금 값) · `release` 둘이다. 설정을 바꾸는 IPC(`update_project`)의 답은
// 값을 기억하지 않아, 고른 뒤에도 트리거는 `main`으로 남는다 — 재는 것은 「무엇이 나갔나」다.

const 기준브랜치 = (page: Page) => page.getByRole("combobox", { name: "기준 브랜치" });

test("기준 브랜치를 키로 열면 목록이 버튼 아래에 서고 지금 값이 선택됨이다 — 글자로 다른 가지를 골라 Enter면 설정 IPC가 나가고 닫힌다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const trigger = 기준브랜치(page);
  const list = page.getByRole("listbox");
  // 도움말(툴팁) 「브랜치 목록에서 변경」은 이름보다 더 말하는 하는 일이라 설명으로도 남는다(S28).
  await expect(trigger).toHaveAccessibleDescription("브랜치 목록에서 변경");

  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // 지금 값 **하나만** 선택됨이다 — 지금 것만 재면 「전부 선택됨」도 초록이다.
  await expect(list.getByRole("option")).toHaveText(["main", "release"]);
  await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
  await expect(list.getByRole("option", { name: project.baseBranch })).toHaveAttribute("aria-selected", "true");

  // 머리(「브랜치 N개」)와 바닥 안내는 떠 있는 카드 안에 그대로다. 카드는 버튼 **아래에서** 시작한다(S32) —
  // 열림 애니메이션(앵커 쪽 확대)이 끝난 뒤에 잰다.
  const card = page.locator("[data-popover]");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2개");
  await expect(card).toContainText("baseBranch 설정만 바꿔요 — checkout은 하지 않아요");
  await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const [triggerBox, cardBox] = [await trigger.boundingBox(), await card.boundingBox()];
  expect(cardBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);

  // 글자 치기 — 「r」로 시작하는 가지로 간다.
  await page.keyboard.press("r");
  await expect(list.getByRole("option", { name: "release" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect
    .poll(async () => (await ipcCallArgs(page, "update_project", "slug")).map(({ args }) => args))
    .toEqual([{ slug: project.slug, baseBranch: "release" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("기준 브랜치 목록에서 지금 값을 다시 고르면 닫히기만 하고 설정 IPC는 안 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const trigger = 기준브랜치(page);
  const list = page.getByRole("listbox");

  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list).toBeVisible();
  // 키로 열면 지금 값이 켜진 채로 선다 — 그대로 Enter가 지금 값을 다시 고른다.
  await expect(list.getByRole("option", { name: project.baseBranch })).toBeFocused();
  await page.keyboard.press("Enter");

  // 앵커: 골라서 닫혔다. 그다음에야 「안 나갔다」가 뜻을 갖는다 — 고르는 일이 아예 안 일어나도 0이다.
  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await callCount(page, "update_project")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("로컬 브랜치가 없는 프로젝트의 기준 브랜치는 목록 대신 이름표 「기준 브랜치」가 붙은 입력칸이다", async ({
  page,
}) => {
  const bare = PROJECTS.find((p) => p.git === null)!;
  await installFixtureBackend(page);
  await page.goto(`/projects/${bare.slug}`);

  // 누르기 전에는 지금 값을 적은 버튼이다(지금 규칙) — 누르면 그 자리가 입력칸이 된다. 도움말 「클릭해서 편집」은
  // 툴팁이고 이름(값)보다 더 말하는 하는 일이라 설명으로도 남는다(S28 · S29 — 버튼이라 `title` 예외가 아니다).
  const editSpot = page.getByRole("button", { name: bare.baseBranch, exact: true });
  await expect(editSpot).toHaveAccessibleDescription("클릭해서 편집");
  await editSpot.focus();
  await expect(툴팁(page)).toHaveText("클릭해서 편집");
  await editSpot.click();
  const input = page.getByRole("textbox", { name: "기준 브랜치" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(bare.baseBranch);
  // 앵커(입력칸이 섰다) 뒤에 — 목록을 여는 버튼은 이 프로젝트에 없다.
  await expect(기준브랜치(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 제자리 편집 자리 (S28 · S29) ──
// 프로젝트 제목은 누르면 그 자리가 입력칸이 되는 버튼이다. 버튼이라 `title` 예외(S29 — 버튼이 아닌 자리)가 아니고,
// 도움말 「클릭해서 편집」은 앱 툴팁이다. 툴팁은 스크린리더에 아무것도 주지 않으므로 이름(제목)보다 더 말하는 그 말이
// 버튼의 설명으로도 남는다(S28). 포커스로 뜨는 툴팁은 포인터를 한 번도 안 쓴 검사에서 잰다(「좋은 검사」).

test("프로젝트 제목은 포커스에 툴팁 「클릭해서 편집」을 띄우고 그 말을 설명으로 말한다 — 이름은 제목 그대로다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  // 목록 행도 같은 이름으로 시작한다 — 머리(h1) 안으로 좁힌다.
  const title = page.getByRole("heading", { level: 1 }).getByRole("button", { name: project.name, exact: true });
  const tooltip = 툴팁(page);
  await expect(title).toBeVisible();
  await expect(tooltip).toHaveCount(0);

  await title.focus();

  await expect(tooltip).toHaveText("클릭해서 편집");
  await expect(title).toHaveAccessibleDescription("클릭해서 편집");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

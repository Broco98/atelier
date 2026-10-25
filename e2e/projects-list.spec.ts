import { expect, test, type Page } from "./evidence";
import { PROJECTS, WORKS } from "./fixtures";
import { callCount, installFixtureBackend, ipcArgs, unknownIpcCalls } from "./harness";

// Projects 목록과 상세(03 구현 스펙 §16 · 캔버스 F1-Projects · F1-ProjectDetail · F4-ProjBranch). `/projects`는 목록 표이고(정규화하지
// 않는다 — 03 결정 「10」), 줄을 누르면 상세다. 상세의 기준 브랜치는 그 저장소의 브랜치 목록(로컬 · 원격)에서만 고른다.
//
// 같은 것을 두 번 재지 않는다 — 다른 spec이 재는 것:
//   ⋯ 두 갈래 · 추가 창 · 제거 창과 되돌리기 · 제목 고치기 · 찾을 수 없음 · 끌어 놓기   Projects 흐름 spec(`F4-KitProject` — 03 티켓 13c)
//   머리 줄 「Projects」 · 「Projects / 이름」                                         `frame-sidebar.spec.ts`
//   진짜 core로 추가 · git init · 새로 만들기                                          `projects-create.l4.spec.ts`

const [project, other] = PROJECTS;
const 목록 = (page: Page) => page.getByRole("table", { name: "Project 목록", exact: true });
/** 표의 그 Project 줄 — 머리 줄(이름 · 경로 · 기준 브랜치)을 뺀 몸의 줄이다. */
const 줄 = (page: Page, one: (typeof PROJECTS)[number]) =>
  목록(page).getByRole("row").filter({ has: page.getByRole("link", { name: one.name, exact: true }) });

// 컴포넌트를 격리 마운트하지 않고 실제 엔트리부터 태운다. 라우터가 브라우저 히스토리
// 위에서 돌고 엔트리가 렌더 전에 전역 초기화를 하므로, 부트를 건너뛰면 "브라우저에서
// 실제로 동작한다"가 증명되지 않는다.
test("고정 데이터가 주어지면 목록 표가 그 데이터를 그리고, 줄을 누르면 그 Project의 상세다", async ({ page }) => {
  await installFixtureBackend(page);

  await page.goto("/projects");
  await expect(목록(page)).toBeVisible({ timeout: 20_000 });
  // 목록 화면이다 — 한때 무선택 주소가 첫 항목으로 정규화됐다(03 결정 「10」).
  await expect(page).toHaveURL("/projects");

  // 머리 줄 하나 뒤에 Project마다 한 줄 — 이름(링크) · 경로 · 기준 브랜치 · ⋯.
  await expect(목록(page).getByRole("row").first().getByRole("columnheader")).toHaveText(["이름", "경로", "기준 브랜치"]);
  await expect(목록(page).getByRole("row")).toHaveCount(PROJECTS.length + 1);
  for (const one of PROJECTS) {
    await expect(줄(page, one).getByRole("cell")).toHaveText([one.name, one.path, one.baseBranch, ""]);
    await expect(줄(page, one).getByRole("button", { name: `${one.name} 메뉴`, exact: true })).toBeVisible();
  }

  // 줄의 빈 자리를 눌러도 이름 링크와 같은 상세로 간다.
  await 줄(page, other).getByRole("cell").nth(1).click();
  await expect(page).toHaveURL(`/projects/${other.slug}`);
  await page.goBack();
  await 목록(page).getByRole("link", { name: project.name, exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.slug}`);
  await expect(page.getByRole("complementary", { name: "Project 정보", exact: true })).toBeVisible();

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **상세는 기준 브랜치 · 경로 · 설명이다**(03 구현 스펙 §16 · S21) — 한때 그 Project에서 시작된 Work 묶음(「이 프로젝트에서 시작된 작업」)이
// 섰다. 그 Project를 쓰는 진행 중인 Work는 제거 창이 말한다. Work로 가는 문은 사이드바 · 팔레트다.
test("Project 상세에는 Work 묶음이 없고, 오른쪽 칸에 기준 브랜치와 경로가 선다", async ({ page }) => {
  const work = WORKS.find((one) => one.projects.includes(project.slug))!;
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const rail = page.getByRole("complementary", { name: "Project 정보", exact: true });
  await expect(rail.getByRole("region")).toHaveText([/^기준 브랜치/, /^경로/]);
  await expect(rail.getByRole("region", { name: "경로", exact: true })).toContainText(project.path);
  // 앵커(상세가 섰다) 뒤에 — 본문에 그 Project의 Work가 서지 않는다(사이드바의 같은 이름은 본문 밖이다).
  await expect(page.locator("main").getByText(work.title)).toHaveCount(0);
  await expect(page.locator("main").getByRole("heading", { name: "Works", exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 기준 브랜치 (03 구현 스펙 §15 · §16 · 스토리 119–121 · S19) ──
// 상세 오른쪽 칸의 기준 브랜치는 단추(`combobox`)이고, 누르면 그 저장소의 브랜치 목록(`listbox`)이 「로컬」 · 「원격 — origin」 묶음으로 선다.
// 지금 값이 「선택됨」으로 읽히고, 방향키와 글자 치기로 찾는 것은 부품이 한다. 저장은 **값이 바뀔 때만**이다. 원격 브랜치는 원격 이름을 단
// 그대로 적힌다(S19). 목록 밖 값을 적는 칸은 없다 — 한때 git 정보가 없는 Project는 직접 적는 입력칸이었다.
//
// 픽스처의 billing은 로컬 `main`(지금 값) · `release`와 원격 `origin/main`이다. 설정을 바꾸는 IPC(`update_project`)의 답은 값을 기억하지
// 않아, 고른 뒤에도 단추는 `main`으로 남는다 — 재는 것은 「무엇이 나갔나」다.

const 기준브랜치 = (page: Page) => page.getByRole("combobox", { name: "기준 브랜치" });

test("기준 브랜치를 키로 열면 로컬 · 원격 묶음의 목록이 서고 지금 값이 선택됨이다 — 글자로 다른 가지를 골라 Enter면 설정 IPC가 나가고 닫힌다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const trigger = 기준브랜치(page);
  const list = page.getByRole("listbox");
  await expect(trigger).toContainText(project.baseBranch);
  await expect(page.getByText("새 Work의 브랜치가 여기서 갈라져요", { exact: true })).toBeVisible();

  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // 묶음 둘 — 로컬 브랜치와 원격 이름을 단 원격 브랜치. 지금 값 **하나만** 선택됨이다 — 지금 것만 재면 「전부 선택됨」도 초록이다.
  await expect(list.getByRole("group", { name: "로컬", exact: true }).getByRole("option")).toHaveText(["main", "release"]);
  await expect(list.getByRole("group", { name: "원격 — origin", exact: true }).getByRole("option")).toHaveText(["origin/main"]);
  await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
  await expect(list.getByRole("option", { name: project.baseBranch, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("목록에 있는 브랜치만 고를 수 있어요", { exact: true })).toBeVisible();

  // 글자 치기 — 「r」로 시작하는 가지로 간다.
  await page.keyboard.press("r");
  await expect(list.getByRole("option", { name: "release", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect
    .poll(() => ipcArgs(page, "update_project", "slug"))
    .toEqual([{ slug: project.slug, baseBranch: "release" }]);
  // 바꾼 뒤에는 단추 아래 한 줄이 그 뒤의 일을 말한다(F1-ProjectDetail — 픽스처가 값을 기억하지 않아 이름은 옛 값이다).
  await expect(page.getByText(/^바꿨어요 — 새 Work부터 .+에서 갈라져요$/)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("원격 브랜치를 고르면 원격 이름을 단 그대로 설정 IPC에 실린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  await 기준브랜치(page).click();
  await page.getByRole("listbox").getByRole("option", { name: "origin/main", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect
    .poll(() => ipcArgs(page, "update_project", "slug"))
    .toEqual([{ slug: project.slug, baseBranch: "origin/main" }]);
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
  await expect(list.getByRole("option", { name: project.baseBranch, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  // 앵커: 골라서 닫혔다. 그다음에야 「안 나갔다」가 뜻을 갖는다 — 고르는 일이 아예 안 일어나도 0이다.
  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await callCount(page, "update_project")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("git으로 브랜치를 읽지 못한 Project의 기준 브랜치 목록은 비어 있고, 이름을 적는 칸이 없다", async ({ page }) => {
  const bare = PROJECTS.find((one) => one.git === null)!;
  await installFixtureBackend(page);
  await page.goto(`/projects/${bare.slug}`);
  const trigger = 기준브랜치(page);
  await expect(trigger).toContainText(bare.baseBranch);
  await trigger.click();
  // 앵커: 목록이 열렸다 — 그 안에 고를 것이 없고, 목록 밖 값을 적는 칸도 없다(스토리 119).
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("목록에 있는 브랜치만 고를 수 있어요", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "기준 브랜치" })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

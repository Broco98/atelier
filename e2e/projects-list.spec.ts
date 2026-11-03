import { expect, test, type Page } from "./evidence";
import { PROJECTS, WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// Projects 목록과 상세(03 구현 스펙 §16 · 캔버스 F1-Projects · F1-ProjectDetail). `/projects`는 목록 표이고(정규화하지 않는다 — 03 결정
// 「10」), 줄을 누르면 상세다. 상세의 기준 브랜치는 위 카드의 한 칸이다 — 대화로 고친다(restart 03-15c).
//
// 같은 것을 두 번 재지 않는다 — 다른 spec이 재는 것:
//   ⋯ 두 갈래 · 추가 창 · 제거 창과 되돌리기 · 찾을 수 없음 · 끌어 놓기               Projects 흐름 spec(`F4-KitProject` — 03 티켓 13c)
//   상세 ⋯ 항목 · 제목은 이름 글                                                       `places.spec.ts`
//   머리 줄 「Projects」 · 「Projects / 이름」                                         `frame-sidebar.spec.ts`
//   진짜 core로 추가 · git init · 새로 만들기                                          `projects-create.l4.spec.ts`

const [project, other] = PROJECTS;
const 목록 = (page: Page) => page.getByRole("table", { name: "Project 목록", exact: true });
/** 상세의 이름 — 숨은 목록의 「Projects」 제목은 접근성 나무 밖이라 상세 판의 h1 하나다. */
const 상세제목 = (page: Page) => page.getByRole("main", { name: "Projects 상세", exact: true }).getByRole("heading", { level: 1 });
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

  // 머리 줄 하나 뒤에 Project마다 한 줄 — 이름(폴더 · 이름 링크 · 경로) · 최근 활동 · 오른쪽 동작(restart 03-1 — 공용 목록 틀). 열 머리는
  // 정렬 단추이고 처음은 최근 활동 내림이다. 한때 열이 이름 · 경로 · 기준 브랜치였다.
  const 머리 = 목록(page).getByRole("row").first().getByRole("columnheader");
  await expect(머리).toHaveText(["이름", "최근 활동"]);
  await expect(머리.nth(1)).toHaveAttribute("aria-sort", "descending");
  await expect(머리.first()).not.toHaveAttribute("aria-sort");
  await expect(목록(page).getByRole("row")).toHaveCount(PROJECTS.length + 1);
  for (const one of PROJECTS) {
    await expect(줄(page, one).getByRole("cell")).toHaveText([`${one.name}${one.path}`, /^(—|방금|\d+(분|시간|일|주)|(\d{4}년 )?\d+월 \d+일)$/, ""]);
    await expect(줄(page, one).getByRole("button", { name: `${one.name} 메뉴`, exact: true })).toBeVisible();
  }

  // 줄의 빈 자리(시각 칸)를 눌러도 이름 링크와 같은 상세로 간다.
  await 줄(page, other).getByRole("cell").nth(1).click();
  await expect(page).toHaveURL(`/projects/${other.slug}`);
  await page.goBack();
  await 목록(page).getByRole("link", { name: project.name, exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.slug}`);
  await expect(상세제목(page)).toHaveText(project.name);

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **상세는 위 카드 넷과 묶음이다**(restart 03-2 · 보드 MainProjectDetail · PlaceSheet 「상세 상태」) — 이름 아래 설명 한 줄, 위 카드 경로 · 기준
// 브랜치 · 원격 · 추가한 날, 그 아래 그 Project를 고치는 작업공간 묶음(이름이 그 작업공간으로 가는 링크). 한때(03 · S21) 상세는 제목 · 설명 |
// 오른쪽 칸(기준 브랜치 · 경로) 두 단이었고 Work 묶음이 없었다 — 03-2가 뒤집었다.
test("Project 상세는 설명 · 위 카드 넷(경로 · 기준 브랜치 · 원격 · 추가한 날)이고, 그 Project를 고치는 작업공간 묶음이 선다", async ({ page }) => {
  const works = WORKS.filter((one) => one.projects.includes(project.slug));
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const 상세 = page.getByRole("main", { name: "Projects 상세", exact: true });
  await expect(상세제목(page)).toHaveText(project.name);
  await expect(상세.getByText(project.description, { exact: true })).toBeVisible();
  await expect(상세.getByText("기준 브랜치", { exact: true }).locator("xpath=..")).toHaveText(`기준 브랜치${project.baseBranch}`);
  for (const [label, value] of [
    ["경로", project.path],
    ["원격", project.git!.remoteSlug!],
    ["추가한 날", "2026년 1월 2일"],
  ] as const) {
    await expect(상세.getByText(label, { exact: true })).toBeVisible();
    await expect(상세.getByTitle(value, { exact: true })).toBeVisible();
  }
  // 작업공간 묶음 — 줄마다 이름 링크가 그 작업공간으로 간다. 앞에 「오른쪽 칸」은 없다.
  const 작업공간 = 상세.getByRole("region", { name: "작업공간", exact: true });
  await expect(작업공간.getByRole("heading", { name: "작업공간", exact: true })).toBeVisible();
  await expect(작업공간.getByRole("link")).toHaveCount(works.length);
  expect((await 작업공간.getByRole("link").allInnerTexts()).sort()).toEqual(works.map((one) => one.title).sort());
  await expect(page.getByRole("complementary", { name: "Project 정보", exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 기준 브랜치 (03 구현 스펙 §15 · §16 · 스토리 120) ──
// 상세 위 카드의 기준 브랜치는 경로 · 원격 · 추가한 날과 같은 칸이다(restart 03-15c · 보드 MainProjectDetail — 보드 상세에는 고치는 자리가 없다).
// 고치기는 대화로 한다(MCP `atelier_edit_project` · Runtime의 설정 도구 — core가 그 저장소에 없는 브랜치를 거절한다). 한때(03-2) 그 칸이 단추
// (`combobox`)라 누르면 「로컬」 · 「원격 — origin」 묶음의 목록이 섰고, 고르면 설정 IPC(`update_project`)가 나갔다.

test("상세 위 카드의 기준 브랜치는 다른 칸과 같은 칸이다 — 눌러도 목록이 서지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  await expect(상세제목(page)).toHaveText(project.name);
  const 판 = page.getByRole("main", { name: "Projects 상세", exact: true });
  await expect(판.getByRole("combobox")).toHaveCount(0);
  const 칸 = 판.getByText("기준 브랜치", { exact: true }).locator("xpath=..");
  await expect(칸).toHaveText(`기준 브랜치${project.baseBranch}`);
  await 칸.click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

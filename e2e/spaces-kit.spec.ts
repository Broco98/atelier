import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, PROJECTS, SPACE_DETAILS, SPACE_DRAFT, SPACE_TEXTS, SPACES, WORKS } from "./fixtures";
import {
  fireEvent,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  replaceAnswer,
  unknownIpcCalls,
  칠한값,
  폴더를고른다,
  토큰색,
  사람메뉴로간다,
  떠날때확인,
  떠날때확인버튼,
  화면머리,
} from "./harness";
import { blankSpaceText } from "@/features/spaces/space-edit";
import type { ProjectView } from "@/features/projects/types";
import type { Space, SpaceDetail, SpaceDraft } from "@/features/spaces/types";

// 03 구현 스펙 Testing 「Space(`F4-KitSpace`)」 — Space 흐름 하나. 상황 모음판의 칸이 곧 경우다: 목록 · 「새 Space ⌄」 메뉴 · 상세(그래프 · 넣기 ·
// 빼기와 되돌리기 · 함께 쓰는 Space · Work · 새 Work · Host와 고치기) · 빈 Space · 지우기와 되돌리기, 그리고 파일 고치기 화면(관계 편집 · 직접
// 만들기 — 두 칸 자리 · 커서 줄 ↔ 조각 · 줄 끝 문제 · 알약 · 저장 꺼짐 · slug 따라옴 · -2 · 버릴지 묻기).
//
// 이 층에는 core가 없다 — 고치기(`update_space`)의 답은 값을 기억하지 않고, 검사(`check_space`)는 글마다 시험이 둔 답이다. 그래서 재는 것은
// 「무엇이 나갔나」(IPC와 그 인자)와 「받은 답을 어떻게 그렸나」다. 파일 글이 그대로 남는지 · 검사가 맞는지는 core 단위 표(L1)가 잰다.
//
// 다른 흐름이 재는 칸은 여기서 다시 재지 않는다 — 「입력창에서 고름」(빈 Space 칩 · 범위 줄)은 트레이 흐름, 「대화로 만듦」 결과 카드 · 「그
// Space에 있던 대화」 줄은 대화 속 Space 흐름이 잰다. 「Work 화면에서 붙이기」 칸은 다음 판(Work 화면)이다. 시작 단추(새 Work · Host와
// 고치기 · Host와 만들기)는 여는 주소까지 재고, 그 씨앗이 칩 · 입력 글로 서는 것은 트레이 흐름이 잰다.

const [결제, 원장도구] = SPACES;
const [billing, ledger] = PROJECTS;

const 본문 = (page: Page, name: string) => page.getByRole("main", { name, exact: true });
const 목록 = (page: Page) => page.getByRole("table", { name: "Space 목록", exact: true });
/** 표의 몸 줄 — 머리 줄(칸 이름)은 뺀다. */
const 몸줄 = (table: Locator) => table.getByRole("row").filter({ hasNot: table.page().getByRole("columnheader") });
const 줄 = (page: Page, name: string) => 몸줄(목록(page)).filter({ has: page.getByRole("link", { name, exact: true }) });
const 메뉴 = (page: Page) => page.getByRole("menu");
const 항목 = (page: Page, name: string) => 메뉴(page).getByRole("menuitem", { name, exact: true });
/** 화면마다 하나 서는 토스트 자리(`Toaster` — 「메시지」)의 한 장. 되돌리기 토스트는 제목이 그 이름이다. */
const 토스트 = (page: Page, title: string) =>
  page.getByRole("region", { name: "메시지", exact: true }).getByRole("dialog", { name: title, exact: true });
const 오류창 = (page: Page) => page.getByRole("alertdialog", { name: "오류", exact: true });
/** 첫 화면이 섰다 — 시작 단추가 연 주소를 읽기 전의 닻. */
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
/** 지금 주소의 search — 한글 씨앗을 풀어 읽는다. */
const 씨앗 = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

/** `update_space`로 나간 인자들, 나간 차례대로. */
const 고치기 = async (page: Page) => (await ipcCallArgs(page, "update_space", "slug")).map(({ args }) => args);

/** 파일 문제 하나 — core 검사가 짓는 모양 그대로다(말까지 core가 짓는다). */
const 등록안됨 = (line: number, project: string) =>
  ({ line, kind: "unknownProject", project, message: "등록되지 않은 Project예요" }) as const;

/** 상세의 답 — 픽스처의 상세(`SPACE_DETAILS`)에 이 Space들을 더하거나 갈아 끼운다. */
const 상세답 = (...details: SpaceDetail[]) =>
  answerByArg("slug", { ...SPACE_DETAILS, ...Object.fromEntries(details.map((detail) => [detail.slug, detail])) });

/** 빈 Space — Project가 없는 Space도 된다(스토리 142). 「직접 만듦」이다. */
const 정산: SpaceDetail = {
  slug: "정산",
  name: "정산",
  projects: [],
  createdAt: "2026-10-26",
  createdBy: null,
  description: "",
  problems: [],
  shared: [],
};

test.describe("목록과 만들기", () => {
  test("목록은 이름 · Project · 설명 표이고 문제가 있는 Space는 「문제 있음」이 서며, 찾기는 이름 · Project로 거르고 줄을 누르면 상세다", async ({
    page,
  }) => {
    const 깨진: Space = { ...원장도구, slug: "깨진", name: "깨진 묶음", projects: ["nope"], problems: [등록안됨(3, "nope")] };
    await installFixtureBackend(page, { list_spaces: [...SPACES, 깨진] });
    await page.goto("/spaces");

    // 줄은 이름 링크 · Project 알약 · 설명(두 줄) · ⋯다. 설명이 빈 Space는 그 칸이 빈다.
    await expect(몸줄(목록(page))).toHaveCount(3);
    await expect(줄(page, 결제.name).getByRole("cell")).toHaveText([결제.name, "billingledger", 결제.description, ""]);
    await expect(줄(page, 원장도구.name).getByRole("cell")).toHaveText([원장도구.name, "ledger", "", ""]);
    // 손으로 깨뜨린 파일도 목록에 선다 — 이름 뒤 「문제 있음」(스토리 185). 문제 없는 줄에는 서지 않는다.
    await expect(page.getByRole("link", { name: "깨진 묶음 문제 있음", exact: true })).toBeVisible();
    await expect(목록(page).getByText("문제 있음")).toHaveCount(1);
    await expect(본문(page, "Space").getByText("Space는 Project를 묶어요. Agent는 Space 안의 Project를 함께 읽어요.", { exact: true })).toBeVisible();

    // 찾기 — 이름에도, 적힌 Project에도 걸린다.
    const 찾기 = page.getByRole("searchbox", { name: "Space 찾기", exact: true });
    await 찾기.fill("원장");
    await expect(몸줄(목록(page)).getByRole("link")).toHaveText([원장도구.name]);
    await 찾기.fill("billing");
    await expect(몸줄(목록(page)).getByRole("link")).toHaveText([결제.name]);

    // 줄의 이름 밖(설명 칸)을 눌러도 그 Space 상세다.
    await 줄(page, 결제.name).getByText(결제.description, { exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}`);
    await expect(page.getByRole("heading", { level: 1, name: 결제.name })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Space가 없으면 「아직 Space가 없어요」와 「새 Space」가 서고, 그 메뉴는 「Host와 만들기 · 기본」 · 「직접 만들기」 둘이다", async ({ page }) => {
    await installFixtureBackend(page, { list_spaces: [] });
    await page.goto("/spaces");

    const 본문칸 = 본문(page, "Space");
    await expect(본문칸.getByText("아직 Space가 없어요", { exact: true })).toBeVisible();
    await expect(목록(page)).toHaveCount(0);
    // 머리 줄과 빈 자리에 같은 단추가 선다(S15) — 빈 자리의 것을 누른다.
    const 새Space = 본문칸.getByRole("button", { name: "새 Space", exact: true });
    await expect(새Space).toHaveCount(2);
    await 새Space.last().click();

    await expect(메뉴(page).getByRole("menuitem")).toHaveText([/^Host와 만들기.*기본$/, /^직접 만들기/]);
    // 접근 이름은 머리 글자만, 설명은 따로다(03 코드 리뷰 P13).
    await expect(항목(page, "Host와 만들기")).toHaveAccessibleDescription("Host가 Project를 읽고 초안을 내요 — 승인하면 만들어져요");
    await expect(항목(page, "직접 만들기")).toHaveAccessibleDescription("Space 파일을 빈 틀로 열어요 — 이름과 Project를 적어요");

    // 「Host와 만들기」 — Work 없는 새 대화에 맡기는 말을 넣어 연다(S16). 보내기는 사람이 한다.
    await 메뉴(page).getByRole("menuitem").first().click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({
      new: "thread",
      say: "Space를 만들고 싶어요. 등록된 Project를 읽고 초안(이름 · Project · 설명)을 보여 주세요.",
    });
    expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);

    // 「직접 만들기」 — 빈 틀의 Space 파일을 고치기 화면에 연다.
    await page.goBack();
    await 본문(page, "Space").getByRole("button", { name: "새 Space", exact: true }).first().click();
    await 메뉴(page).getByRole("menuitem").nth(1).click();
    await expect(page).toHaveURL("/spaces/new");
    await expect(page.getByRole("textbox", { name: "Space 파일", exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Space 파일을 바깥에서 고치면 목록과 상세가 곧바로 따라온다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/spaces");
    await expect(몸줄(목록(page))).toHaveCount(2);

    // 감시자가 `spaces:changed`를 울린 것 — core가 다시 읽은 목록이 새 Space를 품었다(스토리 184).
    const 새것: Space = { ...원장도구, slug: "사내-도구", name: "사내 도구", projects: ["billing"] };
    await replaceAnswer(page, "list_spaces", [...SPACES, 새것]);
    await fireEvent(page, "spaces:changed", null);
    await expect(줄(page, "사내 도구")).toBeVisible();

    // 상세도 같은 종을 듣는다 — 설명을 바깥에서 고쳤다.
    await 줄(page, 결제.name).getByRole("link").click();
    await expect(page.getByText(결제.description, { exact: true })).toBeVisible();
    await replaceAnswer(page, "get_space", 상세답({ ...SPACE_DETAILS[결제.slug], description: "편집기에서 고친 설명" }));
    await fireEvent(page, "spaces:changed", null);
    await expect(page.getByText("편집기에서 고친 설명", { exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("상세", () => {
  test("머리 줄은 「Space / 결제」, 제목 아래 만든 이 · 만든 때 · Project 수, 관계 그래프 · 함께 쓰는 Space · Work 묶음이 서고 점선 Space를 누르면 그쪽 상세다", async ({
    page,
  }) => {
    // 「Work」 묶음 — 이 Space에 이은 진행 중인 Work 줄(05). 픽스처 Work 하나를 이 Space에 잇는다.
    const 이은Work = { ...WORKS[1], space: 결제.slug };
    await page.clock.setFixedTime(new Date("2026-10-26T12:00:00"));
    await installFixtureBackend(page, { list_works: [WORKS[0], 이은Work, ...WORKS.slice(2)] });
    await page.goto(`/spaces/${결제.slug}`);

    await expect(화면머리(page)).toHaveText(`Space/${결제.name}`);
    const 본문칸 = 본문(page, "Space 상세");
    await expect(본문칸.getByRole("heading", { level: 1 })).toHaveText(결제.name);
    // 만든 이 줄 — Host가 만들었으면 H 얼굴과 「Host와 만듦」, 만든 때는 날 단위다(파일의 `createdAt`이 날짜).
    await expect(본문칸.getByText("Host와 만듦", { exact: true })).toBeVisible();
    await expect(본문칸.getByText("2일 전", { exact: true })).toBeVisible();
    await expect(본문칸.getByText("Project 2", { exact: true })).toBeVisible();

    // 관계 — Space 가운데, 그 Project 둘레, 같은 Project를 쓰는 다른 Space는 점선으로 그 곁에. 범례와 안내 줄.
    const 관계 = 본문칸.getByRole("region", { name: "관계", exact: true });
    await expect(관계.getByText("함께 쓰는 Space 1", { exact: true })).toBeVisible();
    const 그래프 = 관계.getByRole("img", { name: `${결제.name} Space와 Project 2개의 관계`, exact: true });
    for (const name of [결제.name, billing.slug, ledger.slug, 원장도구.name]) {
      await expect(그래프.getByText(name, { exact: true })).toBeVisible();
    }
    for (const line of ["이 Space에 들어 있음", "다른 Space에서도 씀", "점선 Space를 누르면 그쪽으로 옮겨 가요"]) {
      await expect(그래프.getByText(line, { exact: true })).toBeVisible();
    }

    // 오른쪽 칸 — 함께 쓰는 Space(이름 · 겹치는 Project)와 Work(이 Space에 이은 진행 중인 Work).
    const 정보 = 본문칸.getByRole("complementary", { name: "Space 정보", exact: true });
    await expect(정보.getByRole("button", { name: `${원장도구.name} ledger`, exact: true })).toBeVisible();
    const 묶음Work = 정보.getByRole("region", { name: "Work", exact: true });
    await expect(묶음Work.getByRole("link")).toHaveText([이은Work.title]);

    // 점선 Space를 누르면 그 Space 상세 — 거기서는 이쪽이 점선이고, 그 Space에 없는 Project가 옅게 곁에 선다. Work는 「아직 없음」.
    await 그래프.getByText(원장도구.name, { exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(원장도구.slug)}`);
    await expect(본문칸.getByRole("heading", { level: 1 })).toHaveText(원장도구.name);
    const 저쪽 = 본문칸.getByRole("img", { name: `${원장도구.name} Space와 Project 1개의 관계`, exact: true });
    await expect(저쪽.getByText(결제.name, { exact: true })).toBeVisible();
    await expect(저쪽.getByText(billing.slug, { exact: true })).toBeVisible();
    await expect(본문칸.getByText("직접 만듦", { exact: true })).toBeVisible();
    await expect(정보.getByRole("region", { name: "Work", exact: true }).getByText("아직 없음", { exact: true })).toBeVisible();

    // Work 줄을 누르면 그 Work로.
    await page.goBack();
    await 묶음Work.getByRole("link", { name: 이은Work.title }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${이은Work.slug}`));
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("「넣기」 메뉴는 아직 묶이지 않은 등록된 Project와 「새 Project 추가…」이고, 다 넣었으면 「등록된 Project를 모두 넣었어요」라고 말한다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/spaces/${결제.slug}`);
    const 묶음 = 본문(page, "Space 상세").getByRole("region", { name: "Project", exact: true });

    // 결제는 등록된 둘을 다 품었다.
    await 묶음.getByRole("button", { name: "넣기", exact: true }).click();
    await expect(메뉴(page).getByText("등록된 Project를 모두 넣었어요", { exact: true })).toBeVisible();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["새 Project 추가…"]);
    await page.keyboard.press("Escape");

    // 원장 도구는 ledger 하나 — 후보는 billing(이름 · 경로)이고, 고르면 그 Project를 넣는다.
    await page.goto(`/spaces/${원장도구.slug}`);
    await 묶음.getByRole("button", { name: "넣기", exact: true }).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText([`${billing.name}${billing.path}`, "새 Project 추가…"]);
    await expect(항목(page, billing.name)).toHaveAccessibleDescription(billing.path);
    await 항목(page, billing.name).click();
    await expect.poll(() => 고치기(page)).toEqual([{ slug: 원장도구.slug, add: [billing.slug] }]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("「새 Project 추가…」는 Project 추가 창을 열고, 추가한 Project를 이 Space에도 넣는다 — 창을 닫으면 아무것도 넣지 않는다", async ({ page }) => {
    const webApp: ProjectView = { ...billing, slug: "web-app", name: "web-app", path: "~/MyProjects/web-app", description: "" };
    const 고른곳 = "/Users/tester/MyProjects/web-app";
    await installFixtureBackend(page, {
      inspect_project_folder: answerByArg("folder", {
        [고른곳]: { kind: "repo", path: webApp.path, baseBranch: "main", remotes: ["origin"], git: billing.git! },
      }),
      create_project: webApp,
    });
    await page.goto(`/spaces/${원장도구.slug}`);
    const 넣기 = 본문(page, "Space 상세").getByRole("region", { name: "Project", exact: true }).getByRole("button", { name: "넣기", exact: true });
    const 추가창 = page.getByRole("dialog", { name: "Project 추가", exact: true });

    // 닫으면 끝 — 이 Space는 그대로다.
    await 넣기.click();
    await 항목(page, "새 Project 추가…").click();
    await 추가창.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(추가창).toHaveCount(0);

    await 넣기.click();
    await 항목(page, "새 Project 추가…").click();
    await 폴더를고른다(page, 고른곳);
    await 추가창.getByRole("button", { name: "추가", exact: true }).click();
    await expect(추가창.getByRole("textbox", { name: "Project 이름", exact: true })).toHaveValue(webApp.name);
    await 추가창.getByRole("button", { name: "Project 추가", exact: true }).click();

    // 등록하고, 이 Space에도 넣는다(스토리 154). 화면은 이 Space 상세에 머문다.
    await expect(추가창).toHaveCount(0);
    expect((await ipcCallArgs(page, "create_project", "folder")).map(({ args }) => args)).toEqual([
      { folder: webApp.path, name: webApp.name, initGit: false },
    ]);
    await expect.poll(() => 고치기(page)).toEqual([{ slug: 원장도구.slug, add: [webApp.slug] }]);
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(원장도구.slug)}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Project 표는 이름 · 경로 · 기준 브랜치이고, 줄 ⋯의 「Space에서 빼기」는 그 Project를 빼고 「되돌리기」로 제자리에 다시 넣으며 「Project 보기」는 그 상세다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/spaces/${결제.slug}`);
    const 표 = 본문(page, "Space 상세").getByRole("table", { name: "묶인 Project", exact: true });
    await expect(몸줄(표)).toHaveCount(2);
    await expect(몸줄(표).first().getByRole("cell")).toHaveText([billing.name, billing.path, billing.baseBranch, ""]);

    // 빼기 — 첫 줄(billing)을 빼면 「되돌리기」가 그 뒤에 있던 ledger 앞에 다시 넣는다(제자리).
    await 표.getByRole("button", { name: `${billing.slug} 메뉴`, exact: true }).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["Project 보기", "Space에서 빼기"]);
    await 항목(page, "Space에서 빼기").click();
    await expect.poll(() => 고치기(page)).toEqual([{ slug: 결제.slug, remove: [billing.slug] }]);
    const 뺀뒤 = 토스트(page, `Space에서 뺐어요 — ${billing.slug}`);
    await 뺀뒤.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect
      .poll(() => 고치기(page))
      .toEqual([
        { slug: 결제.slug, remove: [billing.slug] },
        { slug: 결제.slug, add: [billing.slug], before: ledger.slug },
      ]);
    await expect(뺀뒤).toHaveCount(0);

    // 「Project 보기」 — 그 Project 상세로.
    await 표.getByRole("button", { name: `${ledger.slug} 메뉴`, exact: true }).click();
    await 항목(page, "Project 보기").click();
    await expect(page).toHaveURL(`/projects/${ledger.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("설명은 연필 → 저장이면 「저장했어요」가 서고, 제목은 연필로 그 자리에서 바꾼다 — 둘 다 그 칸만 고친다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/spaces/${결제.slug}`);
    const 본문칸 = 본문(page, "Space 상세");

    const 설명 = 본문칸.getByRole("region", { name: "설명", exact: true });
    await expect(설명.getByText("Agent가 이 Space에서 일할 때 처음 읽어요", { exact: true })).toBeVisible();
    await 설명.getByRole("button", { name: "설명 고치기", exact: true }).click();
    await expect(설명.getByRole("textbox", { name: "설명", exact: true })).toBeFocused();
    await 설명.getByRole("textbox", { name: "설명", exact: true }).fill("결제 · 정산 · 환불");
    await 설명.getByRole("button", { name: "저장", exact: true }).click();
    await expect(설명.getByRole("status")).toHaveText("저장했어요");

    await 본문칸.getByRole("button", { name: "이름 바꾸기", exact: true }).click();
    const 이름칸 = 본문칸.getByRole("textbox", { name: "Space 이름", exact: true });
    await expect(이름칸).toBeFocused();
    await 이름칸.fill("결제 서비스");
    await 이름칸.press("Enter");
    await expect
      .poll(() => 고치기(page))
      .toEqual([
        { slug: 결제.slug, description: "결제 · 정산 · 환불" },
        { slug: 결제.slug, name: "결제 서비스" },
      ]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("머리의 「새 Work」는 이 Space를 쥔 「새 Work」로, 「Host와 고치기」는 이 Space를 쥔 Work 없는 대화에 고쳐 달라는 말을 넣어 첫 화면을 연다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/spaces/${결제.slug}`);
    const 본문칸 = 본문(page, "Space 상세");

    await 본문칸.getByRole("button", { name: "새 Work", exact: true }).click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({ new: "work", space: 결제.slug });

    await page.goBack();
    await 본문칸.getByRole("button", { name: "Host와 고치기", exact: true }).click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({ new: "thread", space: 결제.slug, say: `${결제.name} Space를 고치고 싶어요. ` });
    // 시작 단추는 열기만 한다 — 보내기는 사람이 한다.
    expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("문제가 있는 Space는 상세 위에 문제 줄과 「관계 편집에서 고치기」가 서고, 칸 자리를 모르는 파일이면 고치는 단추가 모두 꺼진다", async ({
    page,
  }) => {
    const 깨진: SpaceDetail = {
      ...SPACE_DETAILS[결제.slug],
      problems: [{ line: 1, kind: "unclosedFrontmatter", message: "frontmatter가 닫히지 않았어요" }, 등록안됨(5, "nope")],
    };
    await installFixtureBackend(page, { get_space: 상세답(깨진) });
    await page.goto(`/spaces/${결제.slug}`);
    const 본문칸 = 본문(page, "Space 상세");

    const 문제 = 본문칸.getByRole("region", { name: "문제", exact: true });
    await expect(문제.getByRole("paragraph")).toHaveText("이 Space 파일에 문제가 있어요관계 편집에서 고치기");
    await expect(문제.getByRole("listitem")).toHaveText(["1행 — frontmatter가 닫히지 않았어요", "5행 — 등록되지 않은 Project예요 (nope)"]);
    for (const name of ["이름 바꾸기", "설명 고치기", "넣기"]) {
      await expect(본문칸.getByRole("button", { name, exact: true }).first()).toBeDisabled();
    }
    await 본문칸.getByRole("button", { name: `${billing.slug} 메뉴`, exact: true }).click();
    await expect(항목(page, "Space에서 빼기")).toBeDisabled();
    await page.keyboard.press("Escape");

    // 고치는 길은 관계 편집이다 — 그 파일을 글 그대로.
    await 문제.getByRole("link", { name: "관계 편집에서 고치기", exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}/edit`);
    expect(await 고치기(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("빈 Space는 그래프가 Space 하나와 「아직 Project가 없어요 · 넣기」이고, 표 자리에 「「넣기」로 묶어요」, 함께 쓰는 Space 「없음」이다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { list_spaces: [...SPACES, 정산], get_space: 상세답(정산) });
    await page.goto(`/spaces/${정산.slug}`);
    const 본문칸 = 본문(page, "Space 상세");

    await expect(본문칸.getByText("Project 0", { exact: true })).toBeVisible();
    const 관계 = 본문칸.getByRole("region", { name: "관계", exact: true });
    await expect(관계.getByText("다른 Space와 겹치지 않아요", { exact: true })).toBeVisible();
    const 그래프 = 관계.getByRole("img", { name: `${정산.name} Space와 Project 0개의 관계`, exact: true });
    await expect(그래프.getByText("아직 Project가 없어요")).toBeVisible();
    await expect(그래프.getByText("점선 Space를 누르면 그쪽으로 옮겨 가요", { exact: true })).toHaveCount(0);
    await expect(
      본문칸.getByRole("table", { name: "묶인 Project", exact: true }).getByText("아직 묶인 Project가 없어요 — 「넣기」로 묶어요.", { exact: true }),
    ).toBeVisible();
    await expect(본문칸.getByRole("complementary", { name: "Space 정보", exact: true }).getByText("없음", { exact: true })).toBeVisible();

    // 그래프 안의 「넣기」 — 표 머리의 것과 같은 메뉴다. 등록된 둘이 다 후보다.
    await 관계.getByRole("button", { name: "넣기", exact: true }).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText([`${billing.name}${billing.path}`, `${ledger.name}${ledger.path}`, "새 Project 추가…"]);
    await 메뉴(page).getByRole("menuitem").nth(1).click();
    await expect.poll(() => 고치기(page)).toEqual([{ slug: 정산.slug, add: [ledger.slug] }]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("지우기", () => {
  const 삭제창 = (page: Page, name = 결제.name) => page.getByRole("alertdialog", { name: `${name} Space를 삭제할까요?`, exact: true });

  test("목록 줄 ⋯의 「삭제…」는 쓰임을 말하는 확인 창을 거쳐 지우고, 「… Space를 지웠어요 · 되돌리기」의 되돌리기가 되돌린다", async ({ page }) => {
    await installFixtureBackend(page, { space_usage: answerByArg("slug", { [결제.slug]: { works: 1, threads: 3 } }) });
    await page.goto("/spaces");

    await 줄(page, 결제.name).getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["관계 편집", "삭제…"]);
    await 항목(page, "삭제…").click();

    // 창 — Space 카드 줄(이름 · Project)과 무엇이 바뀌고 무엇이 그대로인지. 첫 포커스는 「삭제」(되돌릴 수 있다).
    const 창 = 삭제창(page);
    await expect(창).toBeVisible();
    expect((await ipcCallArgs(page, "space_usage", "slug")).map(({ args }) => args)).toEqual([{ slug: 결제.slug }]);
    await expect(창.getByText("billing · ledger", { exact: true })).toBeVisible();
    await expect(창).toHaveAccessibleDescription(
      "Thread 3개 · Work 1개가 이 Space에서 빠져 「Space 없음」이 돼요. Project와 파일, 대화 · 문서 · worktree는 그대로예요.",
    );
    await expect(창.getByRole("button", { name: "삭제", exact: true })).toBeFocused();
    await 창.getByRole("button", { name: "삭제", exact: true }).click();

    await expect(창).toHaveCount(0);
    expect((await ipcCallArgs(page, "thread_delete_space", "slug")).map(({ args }) => args)).toEqual([{ slug: 결제.slug }]);
    const 지운뒤 = 토스트(page, `${결제.name} Space를 지웠어요`);
    await 지운뒤.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect.poll(async () => (await ipcCallArgs(page, "thread_restore_space", "slug")).map(({ args }) => args)).toEqual([{ slug: 결제.slug }]);
    await expect(지운뒤).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("쓰는 곳이 없으면 「Project와 파일은 그대로예요.」이고 빈 Space의 카드 줄은 「Project 없음」이며, 「취소」면 지우지 않는다", async ({ page }) => {
    await installFixtureBackend(page, { list_spaces: [...SPACES, 정산] });
    await page.goto("/spaces");

    await 줄(page, 정산.name).getByRole("button", { name: `${정산.name} 메뉴`, exact: true }).click();
    await 항목(page, "삭제…").click();
    const 창 = 삭제창(page, 정산.name);
    await expect(창.getByText("Project 없음", { exact: true })).toBeVisible();
    await expect(창).toHaveAccessibleDescription("Project와 파일은 그대로예요.");
    await 창.getByRole("button", { name: "취소", exact: true }).click();
    await expect(창).toHaveCount(0);
    expect(await ipcCallArgs(page, "thread_delete_space", "slug")).toEqual([]);

    // 같은 ⋯의 「관계 편집」은 그 파일을 고치는 화면이다.
    await 줄(page, 결제.name).getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    await 항목(page, "관계 편집").click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}/edit`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("상세에서 지우면 목록으로 가고 토스트가 목록에 서며, 그사이 같은 slug가 다시 쓰였으면 되돌리기가 그 까닭을 말한다", async ({ page }) => {
    await installFixtureBackend(page, { thread_restore_space: ipcFailure(`slug is in use again: ${결제.slug}`) });
    await page.goto(`/spaces/${결제.slug}`);

    await 본문(page, "Space 상세").getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    await 항목(page, "삭제…").click();
    await 삭제창(page).getByRole("button", { name: "삭제", exact: true }).click();

    await expect(page).toHaveURL("/spaces");
    await expect(목록(page)).toBeVisible();
    await 토스트(page, `${결제.name} Space를 지웠어요`).getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(오류창(page)).toHaveAccessibleDescription(`되돌리지 못했어요 — 그사이 같은 파일 이름(${결제.slug})의 Space가 새로 생겼어요.`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

// ── 파일 고치기 화면(§13 · F1-SpaceEdit · F4-SpaceNew · F4-SpaceEditErr · KitSpace 「파일 이름」) ─────────────────────────────────────

const 편집기 = (page: Page) => page.getByRole("textbox", { name: "Space 파일", exact: true });
const 카드 = (page: Page) => page.getByRole("article", { name: "Space 카드", exact: true });
const 알약 = (page: Page) => page.locator("main").getByRole("status");
const 경로 = (page: Page) => page.getByLabel("파일 경로", { exact: true });
/** 편집기의 그 줄(1부터) — 칠한 줄이다(입력칸 밑). */
const 편집기줄 = (page: Page, line: number) => page.locator(`[data-line="${line}"]`);
/** 편집기 커서가 선 줄(1부터). */
const 커서줄 = (page: Page) =>
  편집기(page).evaluate((field: HTMLTextAreaElement) => field.value.slice(0, field.selectionStart).split("\n").length);
/** 지금 짝을 지은 카드 조각 — 없으면 0개다. */
const 켜진조각 = (page: Page) => 카드(page).locator("section[data-piece-on]");

/** 칠해진 줄 바탕 — 짝지은 조각의 줄은 `piece-soft`, 나머지는 칠하지 않는다. */
async function 짝지은줄(page: Page, lines: number): Promise<number[]> {
  const piece = await 토큰색(page, "--piece-soft");
  const on: number[] = [];
  for (let line = 1; line <= lines; line += 1) {
    const [back] = await 칠한값(편집기줄(page, line), "background-color");
    if (back === piece) on.push(line);
  }
  return on;
}

/** 「결제」 파일 글(`SPACE_TEXTS`) — 11줄이다(끝 줄바꿈 뒤 빈 줄까지). 조각은 name 2 · projects 3–5 · 본문 10. */
const 결제글 = SPACE_TEXTS[결제.slug];
const 결제줄수 = 결제글.split("\n").length;

/** 글 하나의 검사 답 — 이 층은 core가 없어 글마다 답을 둔다(L1이 검사를 잰다). */
const 검사 = (answers: Record<string, SpaceDraft>, otherwise: SpaceDraft = SPACE_DRAFT) =>
  answerByArg("text", answers, { otherwise });

test.describe("파일 고치기 화면", () => {
  test("관계 편집은 「파일 칸 | 미리보기 카드」 두 칸이 판을 꽉 채우고(46 : 54 · 머리 52 · 경계선이 머리까지), 처음 커서는 projects 줄이라 그 조각이 양쪽에 짝지어진다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/spaces/${결제.slug}/edit`);
    await expect(편집기(page)).toHaveValue(결제글);

    // 머리 줄 「결제 / 관계 편집」.
    await expect(화면머리(page)).toHaveText(`${결제.name}/관계 편집`);

    // 두 칸 — 판(본문) 안을 꽉 채우는 격자: 왼쪽 머리 · 오른쪽 머리 · 파일 칸 · 미리보기 칸.
    const 판 = 본문(page, `${결제.name} 관계 편집`);
    const 격자 = 판.locator(":scope > div");
    const [왼머리, 오른머리, 파일칸, 미리칸] = await Promise.all([0, 1, 2, 3].map((n) => 격자.locator(":scope > *").nth(n).boundingBox()));
    const [판상자, 격자상자] = [await 판.boundingBox(), await 격자.boundingBox()];
    expect(격자상자).toEqual(판상자);
    expect(왼머리!.width / 격자상자!.width).toBeCloseTo(0.46, 2);
    expect(왼머리!.height).toBe(52);
    expect(오른머리!.height).toBe(52);
    expect(오른머리!.x).toBeCloseTo(왼머리!.x + 왼머리!.width, 0);
    // 경계선 — 오른쪽 칸의 왼쪽 테두리가 머리 위끝(판 위끝)부터 바닥까지 한 줄이다.
    expect(오른머리!.y).toBe(격자상자!.y);
    expect(미리칸!.x).toBe(오른머리!.x);
    expect(미리칸!.y + 미리칸!.height).toBeCloseTo(격자상자!.y + 격자상자!.height, 0);
    expect(파일칸!.width).toBe(왼머리!.width);
    for (const one of [격자.locator(":scope > *").nth(1), 격자.locator(":scope > *").nth(3)]) {
      expect(await 칠한값(one, "border-left-width", "border-left-style")).toEqual(["1px", "solid"]);
    }

    // 왼쪽 머리: 뒤로 · 파일 경로(고친 것이 없으면 「고친 줄」 말은 없다). 오른쪽 머리: 미리보기 · 알약 · 취소 · 저장(꺼짐).
    await expect(경로(page)).toHaveText("~/.atelier/spaces/결제.md");
    await expect(판.getByText(/^고친 줄/)).toHaveCount(0);
    await expect(알약(page)).toHaveText("문제 없어요");
    await expect(판.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await expect(판.getByText("Project는 billing · ledger 중에서 — Host에게 말로 부탁해도 이 파일이 바뀌어요", { exact: true })).toBeVisible();

    // 처음 커서 — projects 줄(S14). 그 조각의 줄(3–5)과 카드의 관계 그래프 조각이 짝지어지고 꼬리표 「3–5행」이 선다.
    await expect(편집기(page)).toBeFocused();
    await expect(켜진조각(page)).toHaveCount(1);
    await expect(켜진조각(page).getByText("3–5행", { exact: true })).toBeVisible();
    await expect(켜진조각(page).getByRole("img")).toBeVisible();
    expect(await 짝지은줄(page, 결제줄수)).toEqual([3, 4, 5]);
    // 카드는 파일의 세 부분을 모두 그린다 — 이름 · 「Project 2 · 함께 쓰는 Space 1」, 관계 그래프, 설명.
    await expect(카드(page).getByRole("heading", { level: 2 })).toHaveText(결제.name);
    await expect(카드(page).getByText("Project 2 · 함께 쓰는 Space 1", { exact: true })).toBeVisible();
    await expect(카드(page).getByText(결제.description, { exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("커서를 옮기면 그 줄의 조각만 양쪽에 짝지어진다 — name 「2행」 · 본문 「10행」, 조각 밖의 줄이면 아무것도", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/spaces/${결제.slug}/edit`);
    await expect(켜진조각(page).getByText("3–5행", { exact: true })).toBeVisible();

    await 편집기(page).press("ArrowUp");
    await expect(켜진조각(page).getByText("2행", { exact: true })).toBeVisible();
    await expect(켜진조각(page).getByRole("heading", { level: 2 })).toHaveText(결제.name);
    expect(await 짝지은줄(page, 결제줄수)).toEqual([2]);

    // 글 끝(본문 아래 빈 줄)은 조각 밖이다 — 짝이 걷힌다. 한 줄 위가 본문이다.
    await 편집기(page).press("Meta+ArrowDown");
    await expect(켜진조각(page)).toHaveCount(0);
    expect(await 짝지은줄(page, 결제줄수)).toEqual([]);
    await 편집기(page).press("ArrowUp");
    await expect(켜진조각(page).getByText("10행", { exact: true })).toBeVisible();
    await expect(켜진조각(page).getByText(결제.description, { exact: true })).toBeVisible();
    expect(await 짝지은줄(page, 결제줄수)).toEqual([10]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("등록되지 않은 Project를 적으면 그 줄 끝에 붉은 말이 붙고 알약이 「문제 1개」 · 저장이 꺼지며, 고치면 「문제 없어요」로 저장해 상세로 간다(히스토리 갈음)", async ({
    page,
  }) => {
    const 틀린글 = 결제글.replace("  - ledger\n", "  - ledger\n  - nope\n");
    const 고친글 = 결제글.replace("name: 결제\n", "name: 결제 서비스\n");
    const 틀린답: SpaceDraft = {
      ...SPACE_DRAFT,
      space: { ...결제, projects: [...결제.projects, "nope"], problems: [등록안됨(6, "nope")] },
      pieces: { ...SPACE_DRAFT.pieces, projects: { first: 3, last: 6 }, body: { first: 11, last: 11 } },
    };
    const 고친답: SpaceDraft = { ...SPACE_DRAFT, space: { ...결제, name: "결제 서비스" } };
    await installFixtureBackend(page, { check_space: 검사({ [틀린글]: 틀린답, [고친글]: 고친답 }) });
    await page.goto(`/spaces/${결제.slug}`);
    // 들머리 — 상세 「관계」 묶음 머리의 「편집」.
    await 본문(page, "Space 상세").getByRole("link", { name: "편집", exact: true }).click();
    await expect(편집기(page)).toHaveValue(결제글);

    await 편집기(page).fill(틀린글);
    await expect(편집기줄(page, 6)).toContainText("← 등록되지 않은 Project예요");
    await expect(page.locator("[data-line]").filter({ hasText: "←" })).toHaveCount(1);
    await expect(알약(page)).toHaveText("문제 1개");
    const 판 = 본문(page, `${결제.name} 관계 편집`);
    await expect(판.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await expect(판.getByText("고친 줄 1 · 저장 안 함", { exact: true })).toBeVisible();
    // 붉은 말 · 알약은 문제 빨강이다(그 화면에만 쓰는 토큰).
    expect(await 칠한값(알약(page), "color")).toEqual([await 토큰색(page, "--fg-problem")]);
    // 카드는 등록되지 않은 Project를 그리지 않는다.
    await expect(카드(page).getByText("Project 2 · 함께 쓰는 Space 1", { exact: true })).toBeVisible();
    await expect(카드(page).getByText("nope", { exact: true })).toHaveCount(0);

    await 편집기(page).fill(고친글);
    await expect(알약(page)).toHaveText("문제 없어요");
    await expect(page.locator("[data-line]").filter({ hasText: "←" })).toHaveCount(0);
    await expect(카드(page).getByRole("heading", { level: 2 })).toHaveText("결제 서비스");
    await 판.getByRole("button", { name: "저장", exact: true }).click();

    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}`);
    expect((await ipcCallArgs(page, "save_space_text", "text")).map(({ args }) => args)).toEqual([{ slug: 결제.slug, text: 고친글 }]);
    // 저장은 고치기 화면을 히스토리에서 갈음한다 — 뒤로가기가 고치기 화면으로 돌아오지 않는다.
    await page.goBack();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("문제가 있는 파일을 열면 처음 커서가 첫 문제 줄이고 그 조각이 짝지어진다", async ({ page }) => {
    const 깨진글 = 결제글.replace("  - ledger\n", "  - ledger\n  - ledger\n");
    const 깨진답: SpaceDraft = {
      ...SPACE_DRAFT,
      space: { ...결제, problems: [{ line: 6, kind: "duplicateProject", project: "ledger", message: "같은 Project가 두 번 있어요" }] },
      pieces: { ...SPACE_DRAFT.pieces, projects: { first: 3, last: 6 }, body: { first: 11, last: 11 } },
    };
    await installFixtureBackend(page, {
      read_space_text: answerByArg("slug", { ...SPACE_TEXTS, [결제.slug]: 깨진글 }),
      check_space: 검사({ [깨진글]: 깨진답 }),
    });
    await page.goto(`/spaces/${결제.slug}/edit`);

    await expect(편집기줄(page, 6)).toContainText("← 같은 Project가 두 번 있어요");
    await expect(켜진조각(page).getByText("3–6행", { exact: true })).toBeVisible();
    await expect(편집기(page)).toBeFocused();
    expect(await 커서줄(page)).toBe(6);
    await expect(알약(page)).toHaveText("문제 1개");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 스토리 178 · 03 코드 리뷰 P5 — 저장하지 않은 고침은 뒤로 · 취소만이 아니라 사이드바 · 사람 메뉴 · 히스토리로 떠날 때도 묻는다. 길마다 묻지
  // 않고 Spec 레이아웃 편집기와 같은 라우터의 막기 하나가 받으므로, 창도 그 창(「저장하지 않은 변경이 있어요」) 하나다 — 두 번 묻지 않는다.
  test("저장하지 않은 고침이 있으면 취소 · 뒤로 · 사람 메뉴 · 히스토리 뒤로가 떠날지 한 번 묻고, 고친 것이 없거나 저장했으면 묻지 않는다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { save_space_text: SPACES[0] });
    await page.goto(`/spaces/${결제.slug}/edit`);
    const 판 = 본문(page, `${결제.name} 관계 편집`);

    // 고친 것이 없다 — 「취소」는 곧바로 상세다.
    await 판.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}`);
    await expect(떠날때확인(page)).toHaveCount(0);

    // 고친 것이 있다 — 뒤로(왼쪽 머리 「← 결제」)가 묻는다. 「계속 편집」이면 고치던 글 그대로 머문다.
    await 본문(page, "Space 상세").getByRole("link", { name: "편집", exact: true }).click();
    await 편집기(page).fill(`${결제글}더한 줄\n`);
    await 판.getByRole("button", { name: 결제.name, exact: true }).click();
    await expect(떠날때확인(page)).toHaveCount(1);
    await 떠날때확인버튼(page, "계속 편집").click();
    await expect(떠날때확인(page)).toHaveCount(0);
    await expect(편집기(page)).toHaveValue(`${결제글}더한 줄\n`);

    // 사람 메뉴로 다른 화면을 열어도 묻는다 — 머물면 이 화면이다.
    await 사람메뉴로간다(page, "Projects");
    await expect(떠날때확인(page)).toHaveCount(1);
    await 떠날때확인버튼(page, "계속 편집").click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}/edit`);
    await expect(편집기(page)).toHaveValue(`${결제글}더한 줄\n`);

    // 히스토리를 되감아도 묻는다 — 머물면 히스토리도 이 화면으로 돌아온다.
    await page.goBack();
    await expect(떠날때확인(page)).toHaveCount(1);
    await 떠날때확인버튼(page, "계속 편집").click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}/edit`);

    // 「취소」도 묻는다 — 「버리고 나가기」면 상세로 가고 저장은 나가지 않는다.
    await 판.getByRole("button", { name: "취소", exact: true }).click();
    await 떠날때확인버튼(page, "버리고 나가기").click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}`);
    expect(await ipcCallArgs(page, "save_space_text", "text")).toEqual([]);

    // 저장하면 묻지 않고 상세로 간다 — 저장한 뒤의 이동은 막기를 지난다.
    await 본문(page, "Space 상세").getByRole("link", { name: "편집", exact: true }).click();
    await 편집기(page).fill(`${결제글}더한 줄\n`);
    await 판.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(결제.slug)}`);
    await expect(떠날때확인(page)).toHaveCount(0);
    expect(await ipcCallArgs(page, "save_space_text", "text")).toHaveLength(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("직접 만들기는 빈 틀(「문제 1개」 · name 줄 커서)로 열리고, 이름을 적으면 파일 이름이 따라오며 겹치면 -2가 붙고, 「만들기」면 그 Space 상세로 간다", async ({
    page,
  }) => {
    // 빈 틀은 오늘 날짜를 적는다 — 페이지 시계를 세워 그 글을 시험이 안다.
    const 오늘 = new Date("2026-10-26T12:00:00");
    const 빈틀 = blankSpaceText(오늘);
    const 이름 = (name: string) => 빈틀.replace("name: \n", `name: ${name}\n`);
    const 새답 = (slug: string, name: string, suffix: string | null): SpaceDraft => ({
      space: { slug, name, projects: [], createdAt: "2026-10-26", createdBy: null, description: "", problems: [] },
      pieces: { name: 2, projects: { first: 3, last: 3 }, body: null },
      shared: [],
      registered: PROJECTS.map((one) => one.slug),
      folder: "~/.atelier/spaces",
      suffix,
    });
    const 빈답: SpaceDraft = {
      ...새답("", "", null),
      space: { ...새답("", "", null).space, problems: [{ line: 2, kind: "noName", message: "이름(name)이 비어 있어요" }] },
    };
    const 만든것: SpaceDetail = { ...새답("원장-도구-2", "원장 도구", "-2").space, shared: [] };
    await page.clock.setFixedTime(오늘);
    await installFixtureBackend(page, {
      check_space: 검사({ [이름("정산")]: 새답("정산", "정산", null), [이름("원장 도구")]: 새답("원장-도구-2", "원장 도구", "-2") }, 빈답),
      save_space_text: 만든것,
      get_space: 상세답(만든것),
    });
    await page.goto("/spaces/new");

    await expect(화면머리(page)).toHaveText("Space/새 Space");
    const 판 = 본문(page, "새 Space");
    await expect(편집기(page)).toHaveValue(빈틀);
    await expect(판.getByText("새 파일 · 아직 없음", { exact: true })).toBeVisible();
    // 갓 연 틀 — 이름이 비어 「문제 1개」, 경로는 자리표시, 처음 커서는 name 줄(그 줄이 첫 문제 줄이다).
    await expect(경로(page)).toHaveText("~/.atelier/spaces/이름.md");
    await expect(알약(page)).toHaveText("문제 1개");
    await expect(편집기줄(page, 2)).toContainText("← 이름(name)이 비어 있어요");
    await expect(켜진조각(page).getByText("2행", { exact: true })).toBeVisible();
    await expect(판.getByRole("button", { name: "만들기", exact: true })).toBeDisabled();
    const 안내 = (첫말: string) => 판.getByText(`${첫말} · Project는 billing · ledger 중에서`, { exact: true });
    await expect(안내("이름(name)을 적으면 파일 이름이 따라와요 — 만든 뒤엔 바뀌지 않아요")).toBeVisible();

    // 이름을 적으면 경로가 따라온다.
    await 편집기(page).fill(이름("정산"));
    await expect(경로(page)).toHaveText("~/.atelier/spaces/정산.md");
    await expect(알약(page)).toHaveText("문제 없어요");
    await expect(판.getByRole("button", { name: "만들기", exact: true })).toBeEnabled();

    // 같은 이름의 Space가 있으면 -2 — 경로와 안내 줄이 그렇게 말한다.
    await 편집기(page).fill(이름("원장 도구"));
    await expect(경로(page)).toHaveText("~/.atelier/spaces/원장-도구-2.md");
    await expect(안내("같은 이름의 Space가 있어 파일 이름에 -2를 붙였어요")).toBeVisible();
    await expect(판.getByText("새 파일 · 아직 없음", { exact: true })).toBeVisible();

    await 판.getByRole("button", { name: "만들기", exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${encodeURIComponent(만든것.slug)}`);
    expect((await ipcCallArgs(page, "save_space_text", "text")).map(({ args }) => args)).toEqual([{ slug: null, text: 이름("원장 도구") }]);
    await expect(본문(page, "Space 상세").getByRole("heading", { level: 1 })).toHaveText("원장 도구");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

import { expect, test, type Page } from "./evidence";
import { answerByArg, PROJECTS, SCOPE_ALL, SERVICE_DETAILS, SERVICE_DRAFT, SERVICE_TEXTS, SERVICES, WORKS } from "./fixtures";
import {
  fireEvent,
  installFixtureBackend,
  ipcArgs,
  ipcCallArgs,
  ipcFailure,
  replaceAnswer,
  unknownIpcCalls,
  몸줄,
  본문,
  오류창,
  칠한값,
  표줄,
  토큰색,
  가는곳으로간다,
  떠날때확인,
  떠날때확인버튼,
  화면머리,
  화면토스트,
} from "./harness";
import { blankServiceText } from "@/features/services/service-edit";
import type { ReadingScope } from "@/features/services/scope";
import type { Service, ServiceDetail, ServiceDraft } from "@/features/services/types";

// 03 구현 스펙 Testing 「Service(`F4-KitSpace`)」 — Service 흐름 하나. 목록 · 상세는 공용 목록 · 상세 틀이다(restart 03-3 — 보드 MainServices ·
// MainServiceDetail · PlaceSheet): 목록(이름 · 최근 활동) · 「+ 만들기」 메뉴 · 상세(위 카드 · Projects · 작업공간 · 함께 쓰는 Service 묶음 · 「Project
// 넣기」 · 빼기와 되돌리기 · 문제 경고 · ⋯의 고치기) · 빈 Service · 지우기와 되돌리기, 그리고 고치기 화면(파일로 고치기 · 직접 만들기 — 두 칸 자리 ·
// 커서 줄 ↔ 조각 · 줄 끝 문제 · 알약 · 저장 꺼짐 · slug 따라옴 · -2 · 버릴지 묻기). 한때(03) 상세에 관계 그래프 · 오른쪽 칸 · 「넣기」 메뉴 · 「대화로
// 고치기」가 있었다. 목록 ↔ 상세의 돌아옴 · 뒤로 · 앞으로 · ⌘F는 `places.spec.ts`가 잰다.
//
// 이 층에는 core가 없다 — 고치기(`update_service`)의 답은 값을 기억하지 않고, 검사(`check_service`)는 글마다 시험이 둔 답이다. 그래서 재는 것은
// 「무엇이 나갔나」(IPC와 그 인자)와 「받은 답을 어떻게 그렸나」다. 파일 글이 그대로 남는지 · 검사가 맞는지는 core 단위 표(L1)가 잰다.
//
// 다른 흐름이 재는 칸은 여기서 다시 재지 않는다 — 「입력창에서 고름」(빈 범위 칩 · 범위 줄)은 트레이 흐름, 「대화로 만듦」 결과 카드 · 「그
// Service에 있던 대화」 줄은 대화 속 Service 흐름이 잰다. 「작업공간 화면에서 붙이기」 칸은 다음 판(Work 화면)이다. 시작 단추(작업공간 만들기 ·
// 새 채팅 · 대화로 만들기)는 여는 주소까지 재고, 그 씨앗이 칩 · 입력 글로 서는 것은 트레이 흐름이 잰다(「Project 넣기」만 여기서 입력 글 · 칩까지 잰다).

const [결제, 원장도구] = SERVICES;
const [billing, ledger] = PROJECTS;

const 목록 = (page: Page) => page.getByRole("table", { name: "Service 목록", exact: true });
const 줄 = (page: Page, name: string) => 표줄(목록(page), name);
const 메뉴 = (page: Page) => page.getByRole("menu");
const 항목 = (page: Page, name: string) => 메뉴(page).getByRole("menuitem", { name, exact: true });
/** 상세의 판 — 상세가 선 동안 숨은 목록도 `main` 안에 있어(restart 03-3 — `PlaceStage`) 글로 찾으면 두 곳에 걸린다. 상세 판(`article`)으로 좁힌다. */
const 상세판 = (page: Page) => 본문(page, "Services 상세").getByRole("article");
/** 상세 위 카드 넷(보드 `.pl-fact`) — 칸마다 이름과 값(`title`을 단 값)이다. */
const 위카드 = (page: Page) => 상세판(page).locator("div:has(> span[title])");
/** 상세 ⋯의 「파일로 고치기」로 고치기 화면을 연다. */
async function 파일로고친다(page: Page): Promise<void> {
  await 상세판(page).getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
  await 항목(page, "파일로 고치기").click();
  await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}/edit`);
}
/** 첫 화면이 섰다 — 시작 단추가 연 주소를 읽기 전의 닻. */
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
/** 지금 주소의 search — 한글 씨앗을 풀어 읽는다. */
const 씨앗 = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

/** `update_service`로 나간 인자들, 나간 차례대로. */
const 고치기 = (page: Page) => ipcArgs(page, "update_service", "slug");

/** 파일 문제 하나 — core 검사가 짓는 모양 그대로다(말까지 core가 짓는다). */
const 등록안됨 = (line: number, project: string) =>
  ({ line, kind: "unknownProject", project, message: "등록되지 않은 Project예요" }) as const;

/** 상세의 답 — 픽스처의 상세(`SERVICE_DETAILS`)에 이 Service들을 더하거나 갈아 끼운다. */
const 상세답 = (...details: ServiceDetail[]) =>
  answerByArg("slug", { ...SERVICE_DETAILS, ...Object.fromEntries(details.map((detail) => [detail.slug, detail])) });

/** 빈 Service — Project가 없는 Service도 된다(스토리 142). 「직접 만듦」이다. */
const 정산: ServiceDetail = {
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
  test("목록은 이름(Project 수와 이름) · 최근 활동 표이고 문제가 있는 Service도 같은 줄이며, 찾기는 이름 · Project로 거르고 줄을 누르면 상세다", async ({
    page,
  }) => {
    const 깨진: Service = { ...원장도구, slug: "깨진", name: "깨진 묶음", projects: ["nope"], problems: [등록안됨(3, "nope")] };
    await installFixtureBackend(page, { list_services: [...SERVICES, 깨진] });
    await page.goto("/services");

    // 공용 목록 틀(restart 03-3) — 열 머리는 이름 · 최근 활동(처음은 최근 활동 내림)이고, 줄은 이름 링크 옆에 「Project N개 · 이름들」, 시각, 오른쪽
    // 동작(⋯ · 작업공간 만들기 · 새 채팅)이다. 한때 표가 이름 · Project · 설명 세 칸이었고 이름 뒤에 「문제 있음」, 표 아래에 한 줄이 섰다.
    const 머리 = 목록(page).getByRole("row").first().getByRole("columnheader");
    await expect(머리).toHaveText(["이름", "최근 활동"]);
    await expect(머리.nth(1)).toHaveAttribute("aria-sort", "descending");
    await expect(몸줄(목록(page))).toHaveCount(3);
    await expect(줄(page, 결제.name).getByRole("cell")).toHaveText([`${결제.name}Project 2개 · ${billing.name} · ${ledger.name}`, /\S/, ""]);
    await expect(줄(page, 원장도구.name).getByRole("cell")).toHaveText([`${원장도구.name}Project 1개 · ${ledger.name}`, /\S/, ""]);
    // 등록되지 않은 Project는 수에 들지 않는다 — 손으로 깨뜨린 파일도 목록에 선다(스토리 185). 문제는 상세의 경고가 말한다.
    await expect(줄(page, 깨진.name).getByRole("cell").first()).toHaveText(`${깨진.name}Project 없음`);
    await expect(목록(page).getByText("문제 있음")).toHaveCount(0);
    await expect(본문(page, "Services").getByText("Service는 Project를 묶어요. Runtime은 Service 안의 Project를 함께 읽어요.", { exact: true })).toHaveCount(0);
    for (const name of [`${결제.name} 메뉴`, `${결제.name} 범위로 작업공간 만들기`, `${결제.name} 범위로 새 채팅`]) {
      await expect(줄(page, 결제.name).getByRole("button", { name, exact: true })).toBeVisible();
    }

    // 찾기 — 이름에도, 적힌 Project에도 걸린다.
    const 찾기 = page.getByRole("searchbox", { name: "Service 찾기", exact: true });
    await 찾기.fill("원장");
    await expect(몸줄(목록(page)).getByRole("link")).toHaveText([원장도구.name]);
    await 찾기.fill("billing");
    await expect(몸줄(목록(page)).getByRole("link")).toHaveText([결제.name]);
    await 찾기.fill("없는 이름");
    await expect(목록(page).getByText("「없는 이름」와 맞는 Service가 없어요", { exact: true })).toBeVisible();
    await 찾기.fill("billing");

    // 줄의 이름 밖(옆 글)을 눌러도 그 Service 상세다.
    await 줄(page, 결제.name).getByText(`Project 2개 · ${billing.name} · ${ledger.name}`, { exact: true }).click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}`);
    await expect(상세판(page).getByRole("heading", { level: 1 })).toHaveText(결제.name);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Service가 없으면 「아직 Service가 없어요」와 가운데 「만들기」 하나가 서고, 그 메뉴는 「대화로 만들기 · 기본」 · 「직접 만들기」 둘이다", async ({ page }) => {
    await installFixtureBackend(page, { list_services: [] });
    await page.goto("/services");

    // 빈 목록은 찾기 칸 없이 가운데 할 일이다(restart 03-3 · 보드 PlaceSheet 「Service 없음」) — 한때 머리 줄과 빈 자리에 「새 Service」가 함께 섰다(S15).
    const 본문칸 = 본문(page, "Services");
    await expect(본문칸.getByRole("heading", { name: "아직 Service가 없어요", exact: true })).toBeVisible();
    await expect(
      본문칸.getByText("함께 고치는 Project를 하나로 묶으면, 그 묶음을 범위로 채팅과 작업공간을 시작할 수 있어요.", { exact: true }),
    ).toBeVisible();
    await expect(목록(page)).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Service 찾기", exact: true })).toHaveCount(0);
    const 만들기 = 본문칸.getByRole("button", { name: "만들기", exact: true });
    await expect(만들기).toHaveCount(1);
    await 만들기.click();

    await expect(메뉴(page).getByRole("menuitem")).toHaveText([/^대화로 만들기.*기본$/, /^직접 만들기/]);
    // 접근 이름은 머리 글자만, 설명은 따로다(03 코드 리뷰 P13).
    await expect(항목(page, "대화로 만들기")).toHaveAccessibleDescription("Project를 읽고 초안을 내요 — 승인하면 만들어져요");
    await expect(항목(page, "직접 만들기")).toHaveAccessibleDescription("Service 파일을 빈 틀로 열어요 — 이름과 Project를 적어요");

    // 「대화로 만들기」 — Work 없는 새 대화에 맡기는 말을 넣어 연다(S16). 보내기는 사람이 한다.
    await 메뉴(page).getByRole("menuitem").first().click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({
      new: "thread",
      say: "Service를 만들고 싶어요. 등록된 Project를 읽고 초안(이름 · Project · 설명)을 보여 주세요.",
    });
    expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);

    // 「직접 만들기」 — 빈 틀의 Service 파일을 고치기 화면에 연다.
    await page.goBack();
    await 본문(page, "Services").getByRole("button", { name: "만들기", exact: true }).click();
    await 메뉴(page).getByRole("menuitem").nth(1).click();
    await expect(page).toHaveURL("/services/new");
    await expect(page.getByRole("textbox", { name: "Service 파일", exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Service 파일을 바깥에서 고치면 목록과 상세가 곧바로 따라온다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto("/services");
    await expect(몸줄(목록(page))).toHaveCount(2);

    // 감시자가 `services:changed`를 울린 것 — core가 다시 읽은 목록이 새 Service를 품었다(스토리 184).
    const 새것: Service = { ...원장도구, slug: "사내-도구", name: "사내 도구", projects: ["billing"] };
    await replaceAnswer(page, "list_services", [...SERVICES, 새것]);
    await fireEvent(page, "services:changed", null);
    await expect(줄(page, "사내 도구")).toBeVisible();

    // 상세도 같은 종을 듣는다 — 설명을 바깥에서 고쳤다.
    await 줄(page, 결제.name).getByRole("link").click();
    await expect(page.getByText(결제.description, { exact: true })).toBeVisible();
    await replaceAnswer(page, "get_service", 상세답({ ...SERVICE_DETAILS[결제.slug], description: "편집기에서 고친 설명" }));
    await fireEvent(page, "services:changed", null);
    await expect(page.getByText("편집기에서 고친 설명", { exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("상세", () => {
  test("상세는 「← Services」 · 이름 · 설명 · 위 카드 넷과 Projects · 작업공간 · 함께 쓰는 Service 묶음이고, 함께 쓰는 Service 줄을 누르면 그쪽 상세다", async ({
    page,
  }) => {
    // 「작업공간」 묶음 — 이 Service를 쓰는 진행 중인 작업공간 줄. 픽스처 Work 하나를 이 Service에 잇는다.
    const 이은Work = { ...WORKS[1], service: 결제.slug };
    await installFixtureBackend(page, { list_works: [WORKS[0], 이은Work, ...WORKS.slice(2)] });
    await page.goto(`/services/${결제.slug}`);

    await expect(화면머리(page)).toHaveText(`Services/${결제.name}`);
    const 판 = 상세판(page);
    await expect(판.getByRole("heading", { level: 1 })).toHaveText(결제.name);
    await expect(판.getByRole("link", { name: "Services", exact: true })).toHaveAttribute("href", "/services");
    await expect(판.getByText(결제.description, { exact: true })).toBeVisible();
    // 위 카드 넷(restart 03-3 · 보드 MainServiceDetail) — 한때 제목 아래 「대화로 만듦 · 2일 전 · Project 2」 줄과 관계 그래프 · 오른쪽 칸이었다.
    await expect(위카드(page)).toHaveText(["Project2개", "작업공간1개 진행 중", "함께 쓰는 Service1개", "만든 날2026년 10월 24일"]);
    await expect(판.getByRole("region", { name: "관계", exact: true })).toHaveCount(0);
    await expect(판.getByRole("img", { name: /의 관계$/ })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Service 정보", exact: true })).toHaveCount(0);
    await expect(판.getByText("대화로 만듦", { exact: true })).toHaveCount(0);

    // 묶음 — Projects(이름 링크 · 경로), 작업공간(이 Service를 쓰는 진행 중인 작업공간 — 브랜치), 함께 쓰는 Service(겹치는 Project).
    await expect(판.getByRole("region")).toHaveText([/^Projects2개/, /^작업공간1개/, /^함께 쓰는 Service1개/]);
    const 묶음 = (name: string) => 판.getByRole("region", { name, exact: true });
    await expect(묶음("Projects").getByRole("link")).toHaveText([billing.name, ledger.name]);
    await expect(몸줄(묶음("Projects").getByRole("table")).first().getByRole("cell").first()).toHaveText(`${billing.name}${billing.path}`);
    await expect(묶음("작업공간").getByRole("link")).toHaveText([이은Work.title]);
    await expect(몸줄(묶음("함께 쓰는 Service").getByRole("table")).getByRole("cell").first()).toHaveText(
      `${원장도구.name}겹치는 Project · ${ledger.name}`,
    );

    // 다른 Service로 옮기는 길은 「함께 쓰는 Service」 줄의 이름 링크다 — 거기서는 이쪽이 함께 쓰는 Service이고, 이은 작업공간이 없어 그 묶음이 서지 않는다.
    await 묶음("함께 쓰는 Service").getByRole("link", { name: 원장도구.name, exact: true }).click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(원장도구.slug)}`);
    await expect(판.getByRole("heading", { level: 1 })).toHaveText(원장도구.name);
    await expect(위카드(page)).toHaveText(["Project1개", "작업공간없음", "함께 쓰는 Service1개", "만든 날2026년 10월 20일"]);
    await expect(판.getByRole("region")).toHaveText([/^Projects1개/, /^함께 쓰는 Service1개/]);
    await expect(묶음("함께 쓰는 Service").getByRole("link")).toHaveText([결제.name]);

    // 작업공간 줄을 누르면 그 작업공간으로.
    await page.goBack();
    await expect(판.getByRole("heading", { level: 1 })).toHaveText(결제.name);
    await 묶음("작업공간").getByRole("link", { name: 이은Work.title }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${이은Work.slug}`));
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Projects 묶음 머리의 「Project 넣기」는 그 Service를 고친다는 말을 채운 새 채팅을 연다 — 입력칸에 그 말, 범위 칩에 그 Service", async ({ page }) => {
    // 범위 칩은 입력창이 쥔 Service로 센 범위(`reading_scope`의 `service`)의 답으로 선다.
    const 결제범위: ReadingScope = {
      service: { slug: 결제.slug, name: 결제.name, troubled: false },
      project: null,
      projects: 결제.projects.map((slug) => ({ slug, name: slug, why: "service" })),
      worked: [],
      kind: "service",
      registered: PROJECTS.length,
    };
    await installFixtureBackend(page, { reading_scope: answerByArg("service", { [결제.slug]: 결제범위 }, { otherwise: SCOPE_ALL }) });
    await page.goto(`/services/${결제.slug}`);

    // 한때(03) 「넣기」 메뉴가 등록된 Project를 곧바로 넣고 「새 Project 추가…」가 추가 창을 열었다 — 03-3이 걷었다(스토리 117 — 넣는 일은 대화가 한다).
    await 상세판(page).getByRole("region", { name: "Projects", exact: true }).getByRole("button", { name: "Project 넣기", exact: true }).click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({ new: "thread", service: 결제.slug, say: `${결제.name}에 Project를 넣고 싶어요. ` });
    await expect(page.getByRole("textbox", { name: "보낼 말", exact: true })).toHaveValue(`${결제.name}에 Project를 넣고 싶어요. `);
    await expect(page.getByRole("button", { name: `범위: ${결제.name}`, exact: true })).toBeVisible();
    // 시작 단추는 열기만 한다 — 보내기는 사람이 한다.
    expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
    expect(await 고치기(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("Projects 묶음 줄은 이름 링크 · 경로 · 최근 활동이고, 줄을 지날 때 서는 ⋯의 「Service에서 빼기」는 그 Project를 빼고 「되돌리기」로 제자리에 다시 넣는다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/services/${결제.slug}`);
    const 표 = 상세판(page).getByRole("region", { name: "Projects", exact: true }).getByRole("table");
    await expect(몸줄(표)).toHaveCount(2);
    await expect(몸줄(표).first().getByRole("cell")).toHaveText([`${billing.name}${billing.path}`, /\S/, ""]);

    // 줄 끝 ⋯는 쉴 때 보이지 않고 줄을 지나면 선다(보드 상세 줄에는 오른쪽 단추가 없다). 한때 ⋯가 「Project 보기 · Service에서 빼기」였다.
    const 단추 = 표.getByRole("button", { name: `${billing.name} 메뉴`, exact: true });
    expect(await 칠한값(단추, "opacity")).toEqual(["0"]);
    await 몸줄(표).first().hover();
    await expect.poll(async () => (await 칠한값(단추, "opacity"))[0]).toBe("1");
    await 단추.click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["Service에서 빼기"]);
    // 빼기 — 첫 줄(billing)을 빼면 「되돌리기」가 그 뒤에 있던 ledger 앞에 다시 넣는다(제자리).
    await 항목(page, "Service에서 빼기").click();
    await expect.poll(() => 고치기(page)).toEqual([{ slug: 결제.slug, remove: [billing.slug] }]);
    const 뺀뒤 = 화면토스트(page, `Service에서 뺐어요 — ${billing.slug}`);
    await 뺀뒤.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect
      .poll(() => 고치기(page))
      .toEqual([
        { slug: 결제.slug, remove: [billing.slug] },
        { slug: 결제.slug, add: [billing.slug], before: ledger.slug },
      ]);
    await expect(뺀뒤).toHaveCount(0);

    // 이름 링크 — 그 Project 상세로.
    await 표.getByRole("link", { name: ledger.name, exact: true }).click();
    await expect(page).toHaveURL(`/projects/${ledger.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("설명 · 이름은 ⋯의 「설명 고치기」 · 「이름 바꾸기」로 그 자리에서 고치고(Esc는 그만두기), 둘 다 그 칸만 고친다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/services/${결제.slug}`);
    const 판 = 상세판(page);
    const 상세메뉴 = 판.getByRole("button", { name: `${결제.name} 메뉴`, exact: true });

    // 한때(03) 설명은 「설명」 묶음의 연필 · 「저장했어요」였고 제목 끝에 연필이 섰다 — 이제 ⋯가 이름 아래 그 자리를 칸으로 바꾼다(restart 03-3).
    await 상세메뉴.click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["이름 바꾸기", "설명 고치기", "파일로 고치기", "경로 복사", "삭제…"]);
    await 항목(page, "설명 고치기").click();
    const 설명 = 판.getByRole("textbox", { name: "설명", exact: true });
    await expect(설명).toBeFocused();
    await expect(판.getByText("Runtime이 이 Service에서 일할 때 처음 읽어요", { exact: true })).toBeVisible();
    // Esc는 그만두기다 — 친 글을 버리고 아무것도 고치지 않는다(Project 상세의 설명 칸과 같은 칸 — 03 코드 리뷰 D1). 아래 「그 칸만 고친다」가
    // 나간 고치기를 모두 센다.
    await 설명.fill("버릴 글");
    await 설명.press("Escape");
    await expect(설명).toHaveCount(0);
    await expect(판.getByText(결제.description, { exact: true })).toBeVisible();
    await 상세메뉴.click();
    await 항목(page, "설명 고치기").click();
    await expect(설명).toBeFocused();
    await 설명.fill("결제 · 정산 · 환불");
    await 판.getByRole("button", { name: "저장", exact: true }).click();
    await expect(설명).toHaveCount(0);

    await 상세메뉴.click();
    await 항목(page, "이름 바꾸기").click();
    const 이름칸 = 판.getByRole("textbox", { name: "Service 이름", exact: true });
    await expect(이름칸).toBeFocused();
    await 이름칸.fill("결제 서비스");
    await 이름칸.press("Enter");
    await expect
      .poll(() => 고치기(page))
      .toEqual([
        { slug: 결제.slug, description: "결제 · 정산 · 환불" },
        { slug: 결제.slug, name: "결제 서비스" },
      ]);
    // 제목을 눌러도 그 칸이다.
    await 판.getByRole("button", { name: `${결제.name} — 이름 바꾸기`, exact: true }).click();
    await expect(이름칸).toBeFocused();
    await 이름칸.press("Escape");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("머리의 「작업공간 만들기」 · 「+ 새 채팅」은 이 Service를 범위로 고른 새 작업공간 · 새 채팅을 연다", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/services/${결제.slug}`);
    const 판 = 상세판(page);

    await 판.getByRole("button", { name: "작업공간 만들기", exact: true }).click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({ new: "work", service: 결제.slug });

    // 한때(03) 머리에 「대화로 고치기」(「… Service를 고치고 싶어요.」)가 있었다 — 03-3이 걷었다.
    await page.goBack();
    await expect(판.getByRole("button", { name: "대화로 고치기", exact: true })).toHaveCount(0);
    await 판.getByRole("button", { name: "새 채팅", exact: true }).click();
    await expect(첫화면(page)).toBeVisible();
    expect(씨앗(page)).toEqual({ new: "thread", service: 결제.slug });
    // 시작 단추는 열기만 한다 — 보내기는 사람이 한다.
    expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("문제가 있는 Service는 위 카드 앞에 몇째 줄인지 말하는 경고와 「파일로 고치기」가 서고, 등록되지 않은 Project는 줄로 서지 않는다", async ({ page }) => {
    const 깨진: ServiceDetail = { ...SERVICE_DETAILS[결제.slug], projects: [...결제.projects, "nope"], problems: [등록안됨(6, "nope")] };
    await installFixtureBackend(page, { get_service: 상세답(깨진) });
    await page.goto(`/services/${결제.slug}`);
    const 판 = 상세판(page);

    // 경고 한 줄(보드 PlaceSheet 「문제가 있는 Service」) — 한때 「이 Service 파일에 문제가 있어요」 상자 · 문제 목록 · 「관계 편집에서 고치기」 링크였다.
    const 경고문 = 판.getByText("등록되지 않은 Project가 있어요. Service 파일 6번째 줄 · nope", { exact: true });
    await expect(경고문).toBeVisible();
    await expect(경고문.locator("xpath=..")).toHaveText("등록되지 않은 Project가 있어요. Service 파일 6번째 줄 · nope파일로 고치기");
    await expect(판.getByRole("region", { name: "문제", exact: true })).toHaveCount(0);
    await expect(판.getByRole("region", { name: "Projects", exact: true }).getByRole("link")).toHaveText([billing.name, ledger.name]);
    // 칸 자리를 아는 파일이라 고치는 문은 그대로 선다.
    await expect(판.getByRole("button", { name: `${결제.name} — 이름 바꾸기`, exact: true })).toBeVisible();

    await 경고문.locator("xpath=..").getByRole("button", { name: "파일로 고치기", exact: true }).click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}/edit`);
    expect(await 고치기(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("칸 자리를 모르는 파일이면 고치는 문(제목 · ⋯의 고치기 둘 · 줄 ⋯)이 꺼지는 게 아니라 서지 않고, 경고가 다른 문제의 수까지 말한다", async ({ page }) => {
    const 깨진: ServiceDetail = {
      ...SERVICE_DETAILS[결제.slug],
      problems: [{ line: 1, kind: "unclosedFrontmatter", message: "frontmatter가 닫히지 않았어요" }, 등록안됨(5, "nope")],
    };
    await installFixtureBackend(page, { get_service: 상세답(깨진) });
    await page.goto(`/services/${결제.slug}`);
    const 판 = 상세판(page);

    await expect(판.getByText("frontmatter가 닫히지 않았어요. Service 파일 1번째 줄 · 다른 문제 1개", { exact: true })).toBeVisible();
    await expect(판.getByRole("heading", { level: 1 })).toHaveText(결제.name);
    await expect(판.getByRole("heading", { level: 1 }).getByRole("button")).toHaveCount(0);
    await expect(판.getByRole("button", { name: `${billing.name} 메뉴`, exact: true })).toHaveCount(0);
    await 판.getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["파일로 고치기", "경로 복사", "삭제…"]);
    await 항목(page, "파일로 고치기").click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}/edit`);
    expect(await 고치기(page)).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("빈 Service는 위 카드가 「없음」이고 Projects 묶음이 「넣은 Project가 없어요」로 서며, 작업공간 · 함께 쓰는 Service 묶음은 서지 않는다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { list_services: [...SERVICES, 정산], get_service: 상세답(정산) });
    await page.goto(`/services/${정산.slug}`);
    const 판 = 상세판(page);

    await expect(위카드(page)).toHaveText(["Project없음", "작업공간없음", "함께 쓰는 Service없음", "만든 날2026년 10월 26일"]);
    // Projects 묶음은 넣은 것이 없어도 선다 — 그 머리의 +가 「Project 넣기」의 문이다. 한때 그래프 · 「「넣기」로 묶어요」 · 「없음」이었다.
    await expect(판.getByRole("region")).toHaveText(["Projects0개넣은 Project가 없어요"]);
    await expect(판.getByRole("region", { name: "Projects", exact: true }).getByRole("button", { name: "Project 넣기", exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe("지우기", () => {
  const 삭제창 = (page: Page, name = 결제.name) => page.getByRole("alertdialog", { name: `${name} Service를 삭제할까요?`, exact: true });

  test("목록 줄 ⋯의 「삭제…」는 쓰임을 말하는 확인 창을 거쳐 지우고, 「… Service를 지웠어요 · 되돌리기」의 되돌리기가 되돌린다", async ({ page }) => {
    await installFixtureBackend(page, { service_usage: answerByArg("slug", { [결제.slug]: { works: 1, threads: 3 } }) });
    await page.goto("/services");

    await 줄(page, 결제.name).getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    // 줄 ⋯는 「파일로 고치기 · 경로 복사 · 삭제…」다(restart 03-3 — 한때 「관계 편집 · 삭제…」).
    await expect(메뉴(page).getByRole("menuitem")).toHaveText(["파일로 고치기", "경로 복사", "삭제…"]);
    await 항목(page, "삭제…").click();

    // 창 — Service 카드 줄(이름 · Project)과 무엇이 바뀌고 무엇이 그대로인지. 첫 포커스는 「삭제」(되돌릴 수 있다).
    const 창 = 삭제창(page);
    await expect(창).toBeVisible();
    expect(await ipcArgs(page, "service_usage", "slug")).toEqual([{ slug: 결제.slug }]);
    await expect(창.getByText("billing · ledger", { exact: true })).toBeVisible();
    await expect(창).toHaveAccessibleDescription(
      "채팅 3개 · 작업공간 1개가 이 Service에서 빠져 「Service 없음」이 돼요. Project와 파일, 대화 · 문서 · worktree는 그대로예요.",
    );
    await expect(창.getByRole("button", { name: "삭제", exact: true })).toBeFocused();
    await 창.getByRole("button", { name: "삭제", exact: true }).click();

    await expect(창).toHaveCount(0);
    expect(await ipcArgs(page, "thread_delete_service", "slug")).toEqual([{ slug: 결제.slug }]);
    const 지운뒤 = 화면토스트(page, `${결제.name} Service를 지웠어요`);
    await 지운뒤.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect.poll(() => ipcArgs(page, "thread_restore_service", "slug")).toEqual([{ slug: 결제.slug }]);
    await expect(지운뒤).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("쓰는 곳이 없으면 「Project와 파일은 그대로예요.」이고 빈 Service의 카드 줄은 「Project 없음」이며, 「취소」면 지우지 않는다 — 「파일로 고치기」는 그 파일의 고치기 화면이다", async ({ page }) => {
    await installFixtureBackend(page, { list_services: [...SERVICES, 정산] });
    await page.goto("/services");

    await 줄(page, 정산.name).getByRole("button", { name: `${정산.name} 메뉴`, exact: true }).click();
    await 항목(page, "삭제…").click();
    const 창 = 삭제창(page, 정산.name);
    await expect(창.getByText("Project 없음", { exact: true })).toBeVisible();
    await expect(창).toHaveAccessibleDescription("Project와 파일은 그대로예요.");
    await 창.getByRole("button", { name: "취소", exact: true }).click();
    await expect(창).toHaveCount(0);
    expect(await ipcCallArgs(page, "thread_delete_service", "slug")).toEqual([]);

    // 같은 ⋯의 「파일로 고치기」는 그 파일을 고치는 화면이다(한때 「관계 편집」).
    await 줄(page, 결제.name).getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    await 항목(page, "파일로 고치기").click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}/edit`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("상세에서 지우면 목록으로 가고 토스트가 목록에 서며, 그사이 같은 slug가 다시 쓰였으면 되돌리기가 그 까닭을 말한다", async ({ page }) => {
    await installFixtureBackend(page, { thread_restore_service: ipcFailure(`slug is in use again: ${결제.slug}`) });
    await page.goto(`/services/${결제.slug}`);

    await 본문(page, "Services 상세").getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
    await 항목(page, "삭제…").click();
    await 삭제창(page).getByRole("button", { name: "삭제", exact: true }).click();

    await expect(page).toHaveURL("/services");
    await expect(목록(page)).toBeVisible();
    await 화면토스트(page, `${결제.name} Service를 지웠어요`).getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(오류창(page)).toHaveAccessibleDescription(`되돌리지 못했어요 — 그사이 같은 파일 이름(${결제.slug})의 Service가 새로 생겼어요.`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

// ── 파일 고치기 화면(§13 · F1-SpaceEdit · F4-SpaceNew · F4-SpaceEditErr · KitSpace 「파일 이름」) ─────────────────────────────────────

const 편집기 = (page: Page) => page.getByRole("textbox", { name: "Service 파일", exact: true });
const 카드 = (page: Page) => page.getByRole("article", { name: "Service 카드", exact: true });
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

/** 「결제」 파일 글(`SERVICE_TEXTS`) — 11줄이다(끝 줄바꿈 뒤 빈 줄까지). 조각은 name 2 · projects 3–5 · 본문 10. */
const 결제글 = SERVICE_TEXTS[결제.slug];
const 결제줄수 = 결제글.split("\n").length;

/** 글 하나의 검사 답 — 이 층은 core가 없어 글마다 답을 둔다(L1이 검사를 잰다). */
const 검사 = (answers: Record<string, ServiceDraft>, otherwise: ServiceDraft = SERVICE_DRAFT) =>
  answerByArg("text", answers, { otherwise });

test.describe("파일 고치기 화면", () => {
  test("파일로 고치기는 「파일 칸 | 미리보기 카드」 두 칸이 판을 꽉 채우고(46 : 54 · 머리 52 · 경계선이 머리까지), 처음 커서는 projects 줄이라 그 조각이 양쪽에 짝지어진다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/services/${결제.slug}/edit`);
    await expect(편집기(page)).toHaveValue(결제글);

    // 머리 줄 「결제 / 파일로 고치기」(restart 03-12b — 한때 「관계 편집」).
    await expect(화면머리(page)).toHaveText(`${결제.name}/파일로 고치기`);

    // 두 칸 — 판(본문) 안을 꽉 채우는 격자: 왼쪽 머리 · 오른쪽 머리 · 파일 칸 · 미리보기 칸.
    const 판 = 본문(page, `${결제.name} 파일로 고치기`);
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
    await expect(경로(page)).toHaveText("~/.atelier/services/결제.md");
    await expect(판.getByText(/^고친 줄/)).toHaveCount(0);
    await expect(알약(page)).toHaveText("문제 없어요");
    await expect(판.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await expect(판.getByText("Project는 billing · ledger 중에서 — 대화로 부탁해도 이 파일이 바뀌어요", { exact: true })).toBeVisible();

    // 처음 커서 — projects 줄(S14). 그 조각의 줄(3–5)과 카드의 관계 그래프 조각이 짝지어지고 꼬리표 「3–5행」이 선다.
    await expect(편집기(page)).toBeFocused();
    await expect(켜진조각(page)).toHaveCount(1);
    await expect(켜진조각(page).getByText("3–5행", { exact: true })).toBeVisible();
    await expect(켜진조각(page).getByRole("img")).toBeVisible();
    expect(await 짝지은줄(page, 결제줄수)).toEqual([3, 4, 5]);
    // 카드는 파일의 세 부분을 모두 그린다 — 이름 · 「Project 2 · 함께 쓰는 Service 1」, 관계 그래프, 설명.
    await expect(카드(page).getByRole("heading", { level: 2 })).toHaveText(결제.name);
    await expect(카드(page).getByText("Project 2 · 함께 쓰는 Service 1", { exact: true })).toBeVisible();
    await expect(카드(page).getByText(결제.description, { exact: true })).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("커서를 옮기면 그 줄의 조각만 양쪽에 짝지어진다 — name 「2행」 · 본문 「10행」, 조각 밖의 줄이면 아무것도", async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/services/${결제.slug}/edit`);
    await expect(켜진조각(page).getByText("3–5행", { exact: true })).toBeVisible();

    await 편집기(page).press("ArrowUp");
    await expect(켜진조각(page).getByText("2행", { exact: true })).toBeVisible();
    await expect(켜진조각(page).getByRole("heading", { level: 2 })).toHaveText(결제.name);
    expect(await 짝지은줄(page, 결제줄수)).toEqual([2]);

    // 글 끝(본문 아래 빈 줄)은 조각 밖이다 — 짝이 걷힌다. 한 줄 위가 본문이다. 끝 줄에는 ↓로 한 줄씩 내려가 선다 — 「글 끝으로」 키는
    // 플랫폼마다 달라(macOS ⌘↓ · 리눅스 ⌃End), 한쪽 키는 다른 쪽 WebKit에서 커서를 그 자리에 둔다(리눅스 CI가 ⌘↓로 빨갰다). ↓는 두 쪽에서
    // 한 줄 아래다. 줄 수만큼만 눌러 보고 끝 줄에 섰는지를 먼저 잰다.
    for (let 남은 = 결제줄수; 남은 > 0 && (await 커서줄(page)) < 결제줄수; 남은 -= 1) await 편집기(page).press("ArrowDown");
    expect(await 커서줄(page), "앵커: 커서가 글 끝 줄에 섰다").toBe(결제줄수);
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
    const 틀린답: ServiceDraft = {
      ...SERVICE_DRAFT,
      service: { ...결제, projects: [...결제.projects, "nope"], problems: [등록안됨(6, "nope")] },
      pieces: { ...SERVICE_DRAFT.pieces, projects: { first: 3, last: 6 }, body: { first: 11, last: 11 } },
    };
    const 고친답: ServiceDraft = { ...SERVICE_DRAFT, service: { ...결제, name: "결제 서비스" } };
    await installFixtureBackend(page, { check_service: 검사({ [틀린글]: 틀린답, [고친글]: 고친답 }) });
    await page.goto(`/services/${결제.slug}`);
    // 들머리 — 상세 ⋯의 「파일로 고치기」(restart 03-3 — 한때 「관계」 묶음 머리의 「편집」).
    await 파일로고친다(page);
    await expect(편집기(page)).toHaveValue(결제글);

    await 편집기(page).fill(틀린글);
    await expect(편집기줄(page, 6)).toContainText("← 등록되지 않은 Project예요");
    await expect(page.locator("[data-line]").filter({ hasText: "←" })).toHaveCount(1);
    await expect(알약(page)).toHaveText("문제 1개");
    const 판 = 본문(page, `${결제.name} 파일로 고치기`);
    await expect(판.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await expect(판.getByText("고친 줄 1 · 저장 안 함", { exact: true })).toBeVisible();
    // 붉은 말 · 알약은 문제 빨강이다(그 화면에만 쓰는 토큰).
    expect(await 칠한값(알약(page), "color")).toEqual([await 토큰색(page, "--fg-problem")]);
    // 카드는 등록되지 않은 Project를 그리지 않는다.
    await expect(카드(page).getByText("Project 2 · 함께 쓰는 Service 1", { exact: true })).toBeVisible();
    await expect(카드(page).getByText("nope", { exact: true })).toHaveCount(0);

    await 편집기(page).fill(고친글);
    await expect(알약(page)).toHaveText("문제 없어요");
    await expect(page.locator("[data-line]").filter({ hasText: "←" })).toHaveCount(0);
    await expect(카드(page).getByRole("heading", { level: 2 })).toHaveText("결제 서비스");
    await 판.getByRole("button", { name: "저장", exact: true }).click();

    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}`);
    expect(await ipcArgs(page, "save_service_text", "text")).toEqual([{ slug: 결제.slug, text: 고친글 }]);
    // 저장은 고치기 화면을 히스토리에서 갈음한다 — 뒤로가기가 고치기 화면으로 돌아오지 않는다.
    await page.goBack();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("문제가 있는 파일을 열면 처음 커서가 첫 문제 줄이고 그 조각이 짝지어진다", async ({ page }) => {
    const 깨진글 = 결제글.replace("  - ledger\n", "  - ledger\n  - ledger\n");
    const 깨진답: ServiceDraft = {
      ...SERVICE_DRAFT,
      service: { ...결제, problems: [{ line: 6, kind: "duplicateProject", project: "ledger", message: "같은 Project가 두 번 있어요" }] },
      pieces: { ...SERVICE_DRAFT.pieces, projects: { first: 3, last: 6 }, body: { first: 11, last: 11 } },
    };
    await installFixtureBackend(page, {
      read_service_text: answerByArg("slug", { ...SERVICE_TEXTS, [결제.slug]: 깨진글 }),
      check_service: 검사({ [깨진글]: 깨진답 }),
    });
    await page.goto(`/services/${결제.slug}/edit`);

    await expect(편집기줄(page, 6)).toContainText("← 같은 Project가 두 번 있어요");
    await expect(켜진조각(page).getByText("3–6행", { exact: true })).toBeVisible();
    await expect(편집기(page)).toBeFocused();
    expect(await 커서줄(page)).toBe(6);
    await expect(알약(page)).toHaveText("문제 1개");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 스토리 178 · 03 코드 리뷰 P5 — 저장하지 않은 고침은 뒤로 · 취소만이 아니라 사이드바 · 위 칸 · 히스토리로 떠날 때도 묻는다. 길마다 묻지
  // 않고 Spec 레이아웃 편집기와 같은 라우터의 막기 하나가 받으므로, 창도 그 창(「저장하지 않은 변경이 있어요」) 하나다 — 두 번 묻지 않는다.
  test("저장하지 않은 고침이 있으면 취소 · 뒤로 · 위 칸 · 히스토리 뒤로가 떠날지 한 번 묻고, 고친 것이 없거나 저장했으면 묻지 않는다", async ({
    page,
  }) => {
    await installFixtureBackend(page, { save_service_text: SERVICES[0] });
    await page.goto(`/services/${결제.slug}/edit`);
    const 판 = 본문(page, `${결제.name} 파일로 고치기`);

    // 고친 것이 없다 — 「취소」는 곧바로 상세다.
    await 판.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}`);
    await expect(떠날때확인(page)).toHaveCount(0);

    // 고친 것이 있다 — 뒤로(왼쪽 머리 「← 결제」)가 묻는다. 「계속 편집」이면 고치던 글 그대로 머문다.
    await 파일로고친다(page);
    await 편집기(page).fill(`${결제글}더한 줄\n`);
    await 판.getByRole("button", { name: 결제.name, exact: true }).click();
    await expect(떠날때확인(page)).toHaveCount(1);
    await 떠날때확인버튼(page, "계속 편집").click();
    await expect(떠날때확인(page)).toHaveCount(0);
    await expect(편집기(page)).toHaveValue(`${결제글}더한 줄\n`);

    // 위 칸으로 다른 화면을 열어도 묻는다 — 머물면 이 화면이다.
    await 가는곳으로간다(page, "Projects");
    await expect(떠날때확인(page)).toHaveCount(1);
    await 떠날때확인버튼(page, "계속 편집").click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}/edit`);
    await expect(편집기(page)).toHaveValue(`${결제글}더한 줄\n`);

    // 히스토리를 되감아도 묻는다 — 머물면 히스토리도 이 화면으로 돌아온다.
    await page.goBack();
    await expect(떠날때확인(page)).toHaveCount(1);
    await 떠날때확인버튼(page, "계속 편집").click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}/edit`);

    // 「취소」도 묻는다 — 「버리고 나가기」면 상세로 가고 저장은 나가지 않는다.
    await 판.getByRole("button", { name: "취소", exact: true }).click();
    await 떠날때확인버튼(page, "버리고 나가기").click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}`);
    expect(await ipcCallArgs(page, "save_service_text", "text")).toEqual([]);

    // 저장하면 묻지 않고 상세로 간다 — 저장한 뒤의 이동은 막기를 지난다.
    await 파일로고친다(page);
    await 편집기(page).fill(`${결제글}더한 줄\n`);
    await 판.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(결제.slug)}`);
    await expect(떠날때확인(page)).toHaveCount(0);
    expect(await ipcCallArgs(page, "save_service_text", "text")).toHaveLength(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("직접 만들기는 빈 틀(「문제 1개」 · name 줄 커서)로 열리고, 이름을 적으면 파일 이름이 따라오며 겹치면 -2가 붙고, 「만들기」면 그 Service 상세로 간다", async ({
    page,
  }) => {
    // 빈 틀은 오늘 날짜를 적는다 — 페이지 시계를 세워 그 글을 시험이 안다.
    const 오늘 = new Date("2026-10-26T12:00:00");
    const 빈틀 = blankServiceText(오늘);
    const 이름 = (name: string) => 빈틀.replace("name: \n", `name: ${name}\n`);
    const 새답 = (slug: string, name: string, suffix: string | null): ServiceDraft => ({
      service: { slug, name, projects: [], createdAt: "2026-10-26", createdBy: null, description: "", problems: [] },
      pieces: { name: 2, projects: { first: 3, last: 3 }, body: null },
      shared: [],
      registered: PROJECTS.map((one) => one.slug),
      folder: "~/.atelier/services",
      suffix,
    });
    const 빈답: ServiceDraft = {
      ...새답("", "", null),
      service: { ...새답("", "", null).service, problems: [{ line: 2, kind: "noName", message: "이름(name)이 비어 있어요" }] },
    };
    const 만든것: ServiceDetail = { ...새답("원장-도구-2", "원장 도구", "-2").service, shared: [] };
    await page.clock.setFixedTime(오늘);
    await installFixtureBackend(page, {
      check_service: 검사({ [이름("정산")]: 새답("정산", "정산", null), [이름("원장 도구")]: 새답("원장-도구-2", "원장 도구", "-2") }, 빈답),
      save_service_text: 만든것,
      get_service: 상세답(만든것),
    });
    await page.goto("/services/new");

    await expect(화면머리(page)).toHaveText("Services/새 Service");
    const 판 = 본문(page, "새 Service");
    await expect(편집기(page)).toHaveValue(빈틀);
    await expect(판.getByText("새 파일 · 아직 없음", { exact: true })).toBeVisible();
    // 갓 연 틀 — 이름이 비어 「문제 1개」, 경로는 자리표시, 처음 커서는 name 줄(그 줄이 첫 문제 줄이다).
    await expect(경로(page)).toHaveText("~/.atelier/services/이름.md");
    await expect(알약(page)).toHaveText("문제 1개");
    await expect(편집기줄(page, 2)).toContainText("← 이름(name)이 비어 있어요");
    await expect(켜진조각(page).getByText("2행", { exact: true })).toBeVisible();
    await expect(판.getByRole("button", { name: "만들기", exact: true })).toBeDisabled();
    const 안내 = (첫말: string) => 판.getByText(`${첫말} · Project는 billing · ledger 중에서`, { exact: true });
    await expect(안내("이름(name)을 적으면 파일 이름이 따라와요 — 만든 뒤엔 바뀌지 않아요")).toBeVisible();

    // 이름을 적으면 경로가 따라온다.
    await 편집기(page).fill(이름("정산"));
    await expect(경로(page)).toHaveText("~/.atelier/services/정산.md");
    await expect(알약(page)).toHaveText("문제 없어요");
    await expect(판.getByRole("button", { name: "만들기", exact: true })).toBeEnabled();

    // 같은 이름의 Service가 있으면 -2 — 경로와 안내 줄이 그렇게 말한다.
    await 편집기(page).fill(이름("원장 도구"));
    await expect(경로(page)).toHaveText("~/.atelier/services/원장-도구-2.md");
    await expect(안내("같은 이름의 Service가 있어 파일 이름에 -2를 붙였어요")).toBeVisible();
    await expect(판.getByText("새 파일 · 아직 없음", { exact: true })).toBeVisible();

    await 판.getByRole("button", { name: "만들기", exact: true }).click();
    await expect(page).toHaveURL(`/services/${encodeURIComponent(만든것.slug)}`);
    expect(await ipcArgs(page, "save_service_text", "text")).toEqual([{ slug: null, text: 이름("원장 도구") }]);
    await expect(본문(page, "Services 상세").getByRole("heading", { level: 1 })).toHaveText("원장 도구");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

import { expect, test, type Page } from "./evidence";
import { ARCHIVE, ARCHIVED_DOCS } from "./fixtures";
import {
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  readIpcRecord,
  recordClipboard,
  replaceAnswer,
  unknownIpcCalls,
  화면머리,
  시계를세운다,
  토큰색,
  흰판안,
} from "./harness";

const [shipped, bare] = ARCHIVE;
const [RECORD, IMAGE, HTML, TICKET] = ARCHIVED_DOCS[shipped.slug].docs;

/** 문서 | 목록 카드의 오른쪽 칸 — 목록 머리 · 찾기 칸 · 날짜 소제목 · 두 줄 행. */
const 목록 = (page: Page) => page.getByRole("region", { name: "아카이브 목록", exact: true });
/** 오른쪽 spec 목록 패널의 카드 — 고른 아카이브의 문서 트리가 선다(둘째 `aside` 안). */
const 패널 = (page: Page) => page.getByRole("region", { name: "spec 목록", exact: true });

// 아카이브 화면이 문서를 그리는 규칙은 **Works와 같은 표**다(결정 11) — `doc-refs`의 그것.
// 여기까지 그물이 없어서 그 표의 세 갈래가 아카이브에서만 갈렸다: 판 02가 표를 옮겨 올 때
// 잠김의 항 하나가 안 따라왔고, 「안 태운 자리」와 「거기서 난 결함」이 같은 판에 있었다
// (spec-html.spec.ts가 「아카이브 픽스처는 다음 판이 세운다」고 미뤄 둔 자리다).
//
// **이 층에서만 보인다.** 아카이브 훅을 가로챈 정적 렌더로도 본문 갈래는 볼 수 있지만,
// 「고를 때마다 무엇을 읽는가」(그림은 안 읽는다)는 진짜 IPC 기록이 있어야 갈린다.
test("아카이브도 같은 표로 본문을 세운다 — 그림은 자리표시고, 읽지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);

  // 기본 문서는 목록의 첫 항목이다 — 기록이 있으면 코어가 그것을 맨 앞에 얹는다.
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  // 그림 — **뜨지는 않고** 자리표시가 선다. 아카이브 목록이 경량이라 문서 위치를 안 담기
  // 때문이고(`ImageDoc path={null}`), 자리표시가 드는 이름은 경로 그대로다.
  await page.getByRole("button", { name: "PNG 샷.png", exact: true }).click();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.getByText(IMAGE, { exact: true })).toBeVisible();

  // `.html` — Works와 **같은 `HtmlDoc`**이 선다(결정 18). 프레임 안까지 들어가 보는 것은
  // 껍데기가 아카이브 쪽 내용으로 정말 섰는지가 밖에서는 안 보이기 때문이다.
  await page.getByRole("button", { name: "HTML 조각.html", exact: true }).click();
  const frameEl = page.locator(`iframe[title="${HTML}"]`);
  await expect(frameEl).toBeVisible();
  await expect(frameEl).toHaveAttribute("sandbox", "allow-scripts");
  const frame = await (await frameEl.elementHandle())?.contentFrame();
  if (!frame) throw new Error("프레임 안으로 들어가지 못했다");
  await expect
    .poll(() => frame.evaluate(() => document.querySelector("p")?.textContent ?? null))
    .toBe("껍데기 없는 아티팩트 조각");

  // **읽을지 말지도 그 표가 정한다**(결정 15). 그림을 읽으면 읽기 바닥이 `read_to_string`이라
  // 고를 때마다 UTF-8 실패가 재시도까지 달고 나간다 — 화면에는 아무 자국도 안 남는 실패다.
  // (픽스처에 그 경로의 답이 없어서 아래 화이트리스트 검사도 함께 빨개진다.)
  const reads = ((await readIpcRecord(page))?.calls ?? []).filter((call) =>
    call.startsWith("read_archived_file"),
  );
  expect(reads.filter((call) => call.includes(IMAGE))).toEqual([]);
  expect(reads.some((call) => call.includes(HTML))).toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 잠김은 두 사람이 나눠 든다: **파일 종류로 갈리는 것은 표가**, **누를 것이 있느냐는 화면이**
// (`doc-refs`의 표 머리말 — 「잠그는 것은 화면의 사정이다」). 그 둘째 항이 아카이브에서
// 빠져 있었고, 두 칸이 멀쩡히 눌리는데 본문은 그대로였다(결정 21이 없애려던 그 어긋남).
test("`[소스]` 잠김 — 파일 종류가 잠그고, 남은 문서가 없어도 잠긴다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}?file=${encodeURIComponent(RECORD)}`);

  const doc = page.getByRole("button", { name: "문서로 보기" });
  const source = page.getByRole("button", { name: "원문 보기" });
  // 예쁜 보기에서만 제목이 선다 — 값만 보면 「칩만 뒤집히고 본문은 그대로」가 통과한다.
  const heading = page.getByRole("heading", { name: "기록 — 치운 일" });

  // `.md`는 두 칸이 살아 있고 왕복한다
  await expect(heading).toHaveCount(1);
  await source.click();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(0);
  await doc.click();
  await expect(heading).toHaveCount(1);

  // 그림에서는 표가 잠근다 — 본문이 토글을 안 따르는 파일이다
  await page.getByRole("button", { name: "PNG 샷.png", exact: true }).click();
  await expect(doc).toBeDisabled();
  await expect(source).toBeDisabled();

  // **여기서 한 번 센다** — IPC 기록은 페이지에 사는 값이라 아래 이동이 그것을 비운다.
  // 마지막 한 줄에만 맡기면 위 두 자리를 아무도 안 본 채로 초록이 된다.
  expect(await unknownIpcCalls(page)).toEqual([]);

  // 남은 문서가 하나도 없는 아카이브. 표는 마크다운으로 떨어지지만 그 기본값은 본문
  // 분기를 위한 것이라 여기서는 아무것도 안 뜻한다 — 본문이 빈 상태에 고정이므로
  // 화면이 `current === null`을 얹어 잠근다(Works의 `!currentSpec`과 같은 항).
  await page.goto(`/archive/${bare.slug}`);
  await expect(page.locator("main").getByText("남은 문서가 없어요")).toBeVisible();
  await expect(doc).toBeDisabled();
  await expect(source).toBeDisabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// spec 레이아웃 티켓 06 — **아카이브의 `spec/` 아래는 받은 spec 트리를 그린다.** 트리의 경로는 spec
// 기준이고 아카이브의 경로는 work 폴더 기준이라, 화면이 `spec/`를 다시 붙이지 않으면 고른 문서를
// 못 읽고 복사한 참조가 없는 파일을 가리킨다. 그 둘이 이 층에서만 보인다: 정적 렌더에는 누를 손이 없다.
test("아카이브의 spec/ 아래는 받은 트리대로 서고, 읽기와 복사에는 spec/가 다시 붙는다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/archive/${shipped.slug}`);
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  // 트리는 spec 목록 패널에, 고른 문서는 문서 칸(`main`)에 선다 — 그 자리로 좁혀 집는다(같은 이름이 다른 자리에 서도 초록이 되지 않게).
  //
  // 최상위 `tickets/`는 레이아웃의 자리 밖이라 아이콘이 없다(허용 차이 4) — 폴더 행에 그려진 그림이
  // 여닫이 화살표 하나뿐이다. 이름으로 알아보던 앱은 여기 `list-checks`를 그렸다.
  const tickets = 패널(page).getByRole("button", { name: "tickets", exact: true });
  await expect(tickets).toHaveAttribute("aria-expanded", "true");
  await expect(tickets.locator("svg")).toHaveCount(1);
  await expect(tickets.locator("svg.lucide-chevron-right")).toHaveCount(1);

  // 문서 읽기 IPC의 경로에 `spec/`가 붙는다 — 트리의 경로(`tickets/할일.md`) 그대로 나가면 기록과 같은
  // 자리(work 폴더)에서 찾아 없는 파일이 된다.
  const ticket = 패널(page).getByRole("button", { name: "MD 할일.md", exact: true });
  await ticket.click();
  await expect(main.getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  expect((await ipcCallArgs(page, "read_archived_file", "path")).map(({ args }) => args.path)).toContain(TICKET);
  expect(TICKET).toBe("spec/tickets/할일.md");

  // 경로를 복사하면 `spec/`가 붙은 아카이브 참조가 클립보드에 적히고(S35의 기록기), 「메시지」 토스트도 같은
  // 참조를 적는다.
  await ticket.hover();
  await 패널(page).getByRole("button", { name: "할일.md 경로 복사", exact: true }).click();
  await expect
    .poll(() => clipboardWrites(page))
    .toEqual(["~/.atelier/archive/shipped-work/spec/tickets/할일.md"]);
  await expect(page.getByRole("region", { name: "메시지", exact: true })).toHaveText(
    "~/.atelier/archive/shipped-work/spec/tickets/할일.md 복사됨",
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 3 · codex-ds 티켓 21 — **정렬 · 프로젝트 거르기는 목록 머리의 아이콘 버튼 하나가 여는 라디오 메뉴다**(codex-ds 스펙 S11 · 스토리 54,
// 판 3 스토리 46~49 · 51 · 52, S33 · S37). 한때 목록 머리 아래 줄에 정렬 버튼(「치운 날」)과 거르개가 따로 섰다. 버튼의 이름은
// 「정렬 · 거르기」이고 메뉴는 그 이름을 받는다. 묶음은 둘이다 — 정렬(치운 날의 두 방향)과 프로젝트(「모든 프로젝트」 다음에 프로젝트들).
// 지금 값은 `menuitemradio`의 `aria-checked`로 읽히고, 고르면 닫힌다(라디오 항목의 부품 기본은 안 닫힘이다). Esc로도 닫히고 포커스가
// 버튼으로 돌아온다. 거르는 동안 버튼은 켜진 면(`fill-active`)과 본문 글자색이고 hover해도 그대로다 — 거른 값이 글자로 안 보여 목록이
// 좁혀져 있다는 것을 면이 말한다. 귀에는 버튼의 설명이 지금 값(정렬 · 거르기)을 말한다.
test("정렬 · 거르기는 목록 머리의 아이콘 버튼 메뉴다 — 지금 값이 선택됨이고, Esc면 버튼으로 돌아오며, 고르면 닫히고 목록이 바뀐다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  const head = 목록(page).locator('[data-slot="list-head"]');
  const trigger = head.getByRole("button", { name: "정렬 · 거르기", exact: true });
  const menu = page.getByRole("menu", { name: "정렬 · 거르기", exact: true });
  const sorts = menu.getByRole("group", { name: "정렬", exact: true }).getByRole("menuitemradio");
  const projects = menu.getByRole("group", { name: "프로젝트", exact: true }).getByRole("menuitemradio");
  const rows = 목록(page).getByRole("button", { name: new RegExp(`^(${shipped.title}|${bare.title}) `) });
  const [project] = shipped.projects;
  // 옛 자리의 조작은 없다 — 정렬 글자 버튼과 따로 선 거르개.
  await expect(page.getByRole("button", { name: "치운 날", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "프로젝트 거르기", exact: true })).toHaveCount(0);

  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAccessibleDescription("최근에 치운 순 · 모든 프로젝트");

  // 키보드로 열고 Esc로 닫는다.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // 지금 값 — 최근에 치운 순(백엔드 차례), 모든 프로젝트.
  await expect(sorts).toHaveText(["최근에 치운 순", "먼저 치운 순"]);
  await expect(projects).toHaveText(["모든 프로젝트", project]);
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveText(["최근에 치운 순", "모든 프로젝트"]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // 정렬 — 고르면 닫히고 차례가 뒤집힌다. 날짜가 없는 폴더는 날짜순의 한쪽 끝이다(백엔드와 같다).
  await expect(rows).toHaveText([new RegExp(`^${shipped.title}`), new RegExp(`^${bare.title}`)]);
  await trigger.click();
  await sorts.filter({ hasText: "먼저 치운 순" }).click();
  await expect(menu).toHaveCount(0);
  await expect(rows).toHaveText([new RegExp(`^${bare.title}`), new RegExp(`^${shipped.title}`)]);

  // 거르기 — 고르면 닫히고 목록이 좁혀진다. 프로젝트가 없는 아카이브가 빠진다(위에서 서 있던 것이 앵커다).
  // 버튼의 면과 글자색은 색 전이(`transition-colors`)가 멎은 뒤에 읽는다 — 도는 동안의 값은 어느 쪽도 아니다. 전이는 스타일을 다시
  // 셀 때 서므로 `getAnimations()`가 그것을 세우고 센다.
  const 칠 = async () => {
    await expect.poll(() => trigger.evaluate((el) => el.getAnimations().length)).toBe(0);
    return trigger.evaluate((el) => ({ 면: getComputedStyle(el).backgroundColor, 글자: getComputedStyle(el).color }));
  };
  const 켜짐 = { 면: await 토큰색(page, "--fill-active"), 글자: await 토큰색(page, "--fg") };
  const 꺼진칠 = await 칠();
  await trigger.click();
  await projects.filter({ hasText: project }).click();
  await expect(menu).toHaveCount(0);
  await expect(rows).toHaveText([new RegExp(`^${shipped.title}`)]);
  await page.mouse.move(0, 0);
  expect(await 칠(), "거르는 동안은 켜진 면 · 본문 글자").toEqual(켜짐);
  expect(꺼진칠.면).not.toBe(켜짐.면);
  // 켜진 채 hover해도 켜짐 그대로다 — 버튼 hover(`fill-hover` 8%)가 켜진 면(12%)을 덮으면 포인터 아래에서 꺼진 것으로 읽힌다.
  await trigger.hover();
  expect(await 칠(), "켜진 채 hover").toEqual(켜짐);
  // 스크린리더에는 지금 값이 설명으로 간다 — 켜진 면은 눈에만 보여, 목록이 좁혀져 있다는 것을 귀로는 메뉴를 열어야 안다(S28 · S37).
  await expect(trigger).toHaveAccessibleDescription(`먼저 치운 순 · ${project}`);

  // 다시 열면 고른 것들이 선택됨이다.
  await trigger.click();
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveText(["먼저 치운 순", project]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 스펙 S11 — **날짜 소제목이 날짜순 목록을 끊는다**(DS `.at-label` — 「이번 주 · 8월 …」). 오늘이 든 주(월요일부터)는 「이번 주」,
// 올해의 그 밖은 달 이름, 지난해부터는 해와 달이고, 치운 날이 없는 폴더는 「날짜 없음」으로 모인다. 정렬은 둘 다 치운 날 순이라 두
// 방향 모두 소제목이 서고, 차례만 뒤집힌다. 「오늘」은 페이지의 시계로 세운다(수요일 2026-08-12).
test("날짜순 목록에 날짜 소제목(이번 주 · 달 · 해와 달 · 날짜 없음)이 서고, 정렬을 뒤집으면 소제목 차례도 뒤집힌다", async ({ page }) => {
  const entry = (slug: string, title: string, archivedAt: string | null) => ({
    slug,
    title,
    status: "done",
    archivedAt,
    projects: [],
  });
  // 백엔드 차례(치운 날 내림차순 — 날짜가 없는 것은 맨 뒤)로 답한다.
  await installFixtureBackend(page, {
    list_archive: [
      shipped,
      entry("early-august", "8월 초에 치운 것", "2026-08-03"),
      entry("july", "7월에 치운 것", "2026-07-30"),
      entry("last-year", "지난해 치운 것", "2025-12-20"),
      bare,
    ],
  });
  await page.clock.setFixedTime(new Date(2026, 7, 12, 12));
  await page.goto(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  /** 목록 칸에 보이는 소제목과 행 제목을 위에서부터 — 소제목이 그 아래 행들의 머리인지가 차례로 보인다. */
  const 줄 = async () => {
    const known = ["이번 주", "8월", "7월", "2025년 12월", "날짜 없음", shipped.title, "8월 초에 치운 것", "7월에 치운 것", "지난해 치운 것", bare.title];
    return (await 목록(page).innerText()).split("\n").filter((line) => known.includes(line.trim())).map((line) => line.trim());
  };
  await expect.poll(줄).toEqual([
    "이번 주",
    shipped.title,
    "8월",
    "8월 초에 치운 것",
    "7월",
    "7월에 치운 것",
    "2025년 12월",
    "지난해 치운 것",
    "날짜 없음",
    bare.title,
  ]);

  // 소제목은 행 글자와 한 세로줄이다(DS 「행 글자 16」 — 칸 + 16).
  const 글자x = (target: ReturnType<Page["getByText"]>) =>
    target.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().x;
    });
  expect(await 글자x(목록(page).getByText("이번 주", { exact: true }))).toBe(
    await 글자x(목록(page).getByText(shipped.title, { exact: true })),
  );

  const trigger = 목록(page).getByRole("button", { name: "정렬 · 거르기", exact: true });
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "먼저 치운 순" }).click();
  await expect.poll(줄).toEqual([
    "날짜 없음",
    bare.title,
    "2025년 12월",
    "지난해 치운 것",
    "7월",
    "7월에 치운 것",
    "8월",
    "8월 초에 치운 것",
    "이번 주",
    shipped.title,
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 3 — **복사하면 짧은 토스트가 선다**(스토리 88 · 91, 결정 11, S14 · S26 · S37). 토스트는 이름 「메시지」를 단
// `region`(라이브 영역)에 서고, 1.6초 뒤 사라진다. 그 영역은 복사 전부터 서 있다 — 라이브 영역은 글자가 들기 전에
// 있어야 읽힌다. 「그 글자」는 앱이 클립보드로 넘긴 값 그대로다(하네스의 쓰기 기록, S35).
//
// **시계는 페이지를 열기 전에 건다**(`page.clock`). 복사 직전에 세워 두고 손으로 돌린다 — 저절로 흐르게 두면
// 1.6초가 아니라 5초(Base UI 기본)여도 기다리다 보면 사라져 초록이다. 그래서 1.5초에는 남아 있고, 1.6초를 넘기면
// 곧바로 사라지는 것까지 본다. Base UI는 포인터가 토스트 위에 있거나 창이 포커스를 잃으면 시계를 세우므로(S27),
// 누른 뒤 포인터를 치운다. 사라지는 전이는 프레임(rAF)을 타서 마지막에는 시계를 다시 흐르게 둔다.
//
// **누르기 전에 문서 트리가 선 자리가 가라앉기를 기다린다.** 움직이는 도중에 누르면 Playwright가 잘린 버튼을 보이려고 안쪽
// 칸(`overflow-hidden`)을 굴리고, 움직임이 끝나면 그 굴림이 0으로 돌아와 버튼이 포인터 밑에서 미끄러진다 — 누름과 뗌이 다른
// 곳에 떨어져 클릭이 버튼에 안 닿는다. 펼치는 행 안에 트리가 서던 때 부하 아래 가끔 빨갰고, 누름과 뗌 사이를 200ms 벌리면
// 80번에 5번 빨갰다(실측 2026-10-11). 트리는 이제 행 안이 아니라 둘째 `aside`인 spec 목록 패널에 서므로(codex-ds 티켓 21) 그
// 패널 안의 전이를 기다린다. 전이는 CSS라 세운 시계와 상관없이 돈다.
test("문서 경로를 복사하면 「메시지」 영역에 그 글자가 서고, 1.6초가 지나면 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.clock.install();
  await page.goto(`/archive/${shipped.slug}`);
  const messages = page.getByRole("region", { name: "메시지", exact: true });
  const copy = page.getByRole("button", { name: "샷.png 경로 복사", exact: true });
  await expect(copy).toBeAttached();
  await expect(messages).toHaveText("");
  await expect
    .poll(() => page.locator("aside").nth(1).evaluate((el) => el.getAnimations({ subtree: true }).length))
    .toBe(0);

  await 시계를세운다(page);
  await copy.click();
  await page.mouse.move(0, 0);

  await expect.poll(() => clipboardWrites(page)).toHaveLength(1);
  const [copied] = await clipboardWrites(page);
  await expect(messages).toHaveText(`${copied} 복사됨`);

  await page.clock.runFor(1500);
  await expect(messages).toHaveText(`${copied} 복사됨`);

  await page.clock.runFor(100);
  await page.clock.resume();
  await expect(messages).toHaveText("", { timeout: 1000 });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 목록 행 · spec 목록 패널 (codex-ds 티켓 21 — 스펙 §7 「Archive」 · 결정 28 · 32) ──
// 목록 행은 펼치지 않는 두 줄 행이다(제목 / 치운 날 · 상태) — 누르면 그 아카이브를 고른다. 고른 아카이브의 문서 트리는 행 안이 아니라
// 오른쪽에 따로 여닫는 spec 목록 패널에 선다. 그 패널은 작업 패널과 같은 자리 · 같은 칸이라 문서의 둘째 `aside`다(스펙 §11).

test("목록 행은 펼치지 않는 두 줄 행이고, 고른 아카이브의 문서 트리는 둘째 aside인 spec 목록 패널에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  // 행 — 첫 줄은 제목, 둘째 줄은 치운 날과 치운 때의 상태다. 날짜가 없는 폴더(손으로 옮긴 것)는 상태만 선다. 펼치지 않는다.
  const rows = 목록(page).getByRole("button", { name: new RegExp(`^(${shipped.title}|${bare.title}) `) });
  await expect(rows).toHaveText([`${shipped.title}8월 10일 · done`, `${bare.title}active`]);
  for (const row of await rows.all()) await expect(row).not.toHaveAttribute("aria-expanded");
  // 보고 있는 아카이브의 행이 고른 행이다.
  await expect(rows.first()).toHaveClass(/selected-row/);
  await expect(rows.last()).not.toHaveClass(/selected-row/);
  // 목록 칸에는 문서 줄이 없다.
  await expect(목록(page).getByRole("button", { name: "MD record.md", exact: true })).toHaveCount(0);

  // 문서 트리는 spec 목록 패널 — 사이드바 다음 둘째 `aside` — 안이다. 머리는 「spec」과 spec 폴더 열기다.
  await expect(page.locator("aside")).toHaveCount(2);
  expect(await 패널(page).evaluate((el) => el.closest("aside") === document.querySelectorAll("aside")[1])).toBe(true);
  const head = 패널(page).locator('[data-slot="card-head"]');
  await expect(head.getByText("spec", { exact: true })).toBeVisible();
  await expect(head.getByRole("button", { name: "spec 폴더 열기", exact: true })).toBeVisible();
  await expect(패널(page).getByRole("button", { name: "MD record.md", exact: true })).toBeVisible();
  await expect(패널(page).getByRole("button", { name: "spec", exact: true })).toHaveAttribute("aria-expanded", "true");

  // 다른 행을 누르면 그 아카이브를 고른다 — 주소가 옮겨 가고, 패널은 그 아카이브의 트리(여기는 비었다)를 든다.
  await rows.last().click();
  await expect(page).toHaveURL(new RegExp(`/archive/${bare.slug}$`));
  await expect(rows.last()).toHaveClass(/selected-row/);
  await expect(패널(page).getByText("남은 문서가 없어요", { exact: true })).toBeVisible();
  await expect(패널(page).getByRole("button", { name: "MD record.md", exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **보고 있는 아카이브의 행을 다시 누르면 아무 일도 없다.** 행은 그 아카이브로 옮겨 가는 이동이고 이동은 문서를 딸려 보내지 않는다 —
// 같은 아카이브로도 그렇게 옮기면 보던 문서를 버리고(`?file=`이 빠진다) 그 아카이브의 기본 문서로 떨어지며, 주소가 바뀌어 히스토리가
// 한 칸 쌓인다(뒤로가기가 같은 아카이브를 한 번 더 지난다).
test("보고 있는 아카이브의 행을 다시 눌러도 보던 문서가 그대로고 히스토리가 쌓이지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  await 패널(page).getByRole("button", { name: "MD 할일.md", exact: true }).click();
  await expect(main.getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  const url = page.url();
  expect(url).toContain("file=");
  const depth = await page.evaluate(() => window.history.length);

  const row = 목록(page).getByRole("button", { name: new RegExp(`^${shipped.title} `) });
  await expect(row).toHaveClass(/selected-row/);
  await row.click();
  // 「아무 일도 안 났다」는 곧바로 초록이라, 누름이 부른 이동이 주소와 화면에 닿을 두 프레임을 넘긴 뒤 잰다.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.history.length)).toBe(depth);
  await expect(main.getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **⌘Enter와 머리 줄의 spec 목록 토글이 패널을 여닫는다**(codex-ds 결정 32 — 「⌘Enter는 그 화면의 오른쪽 패널」, 스토리 56 · 57). 토글은
// 머리 줄 오른쪽 끝, 세로선 너머다(⋯ | spec 목록 토글). 이름이 누르면 일어날 일을 말하고 `aria-expanded` · `aria-controls`가 패널을
// 가리킨다. 닫힌 패널은 폭이 0으로 접혀(작업 패널과 같은 칸) 문서 | 목록 칸이 흰 판 오른쪽 끝까지 넓어진다(02 티켓 03 — 한때 창 오른쪽
// 틈 앞까지였다). 찾기 칸에서의 ⌘Enter는 입력칸의 몫이라 패널을 안 건드린다(작업 화면과 한 판정).
test("⌘Enter와 머리 줄의 spec 목록 토글이 spec 목록 패널을 여닫는다 — 닫히면 문서 | 목록 칸이 흰 판 오른쪽 끝까지 넓어진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  const head = 화면머리(page);
  const card = page.locator('[data-slot="card"]', { has: 목록(page) });
  const aside = page.locator("aside").nth(1);
  await expect(패널(page)).toBeVisible();

  // 토글 — 머리 줄 화면 자리 안, 세로선 너머 맨 끝이다. 열려 있으면 「spec 목록 접기」다.
  const close = head.getByRole("button", { name: "spec 목록 접기", exact: true });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect(close).toHaveAttribute("aria-controls", (await aside.getAttribute("id"))!);
  await expect(close).toHaveAttribute("aria-keyshortcuts", "Meta+Enter");
  const line = await head.getByRole("separator").boundingBox();
  expect((await close.boundingBox())!.x, "토글은 세로선 너머").toBeGreaterThan(line!.x);

  // 칸이 넓어지는 끝은 흰 판의 안쪽 오른쪽 끝이다(창 끝에서 5.5 — 판의 띄움 5와 테두리 0.5).
  const 판끝 = (await 흰판안(page)).right;
  const cardRight = async () => (await card.boundingBox())!.x + (await card.boundingBox())!.width;
  const asideWidth = async () => (await aside.boundingBox())!.width;
  expect(await cardRight(), "열린 동안은 패널이 곁에 선다").toBeLessThan(판끝 - 200);

  // ⌘Enter로 접는다.
  await page.keyboard.press("Meta+Enter");
  await expect.poll(asideWidth).toBe(0);
  await expect.poll(cardRight).toBe(판끝);
  const open = head.getByRole("button", { name: "spec 목록 펼치기", exact: true });
  await expect(open).toHaveAttribute("aria-expanded", "false");

  // 찾기 칸에 포커스가 있으면 ⌘Enter는 입력칸의 몫이다 — 패널이 그대로 닫혀 있다.
  await page.getByRole("textbox", { name: "아카이브 검색", exact: true }).focus();
  await page.keyboard.press("Meta+Enter");
  await expect(open).toHaveAttribute("aria-expanded", "false");
  expect(await asideWidth()).toBe(0);

  // 토글로 편다 — 패널이 다시 서고 트리가 그대로다. ⌘Enter로 다시 접힌다.
  await open.click();
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect(패널(page).getByRole("button", { name: "MD record.md", exact: true })).toBeVisible();
  await expect.poll(cardRight).toBeLessThan(판끝 - 200);
  await page.locator("main").click();
  await page.keyboard.press("Meta+Enter");
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect.poll(asideWidth).toBe(0);

  // 거꾸로도 그렇다 — ⌘Enter로 펴고 토글로 접는다. 두 길이 저마다 여닫기를 다 한다(한쪽만 뒤집으면 위 흐름이 그대로 초록이다).
  await page.keyboard.press("Meta+Enter");
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect.poll(cardRight).toBeLessThan(판끝 - 200);
  await close.click();
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect.poll(asideWidth).toBe(0);
  await expect.poll(cardRight).toBe(판끝);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **머리 줄의 ⋯는 아카이브 메뉴다**(codex-ds 결정 16 「Archive 목록 행」 · 결정 31). 줄은 Finder에서 열기 · 경로 복사 둘이고 되살리기는
// 없다 — 지금 앱에 그 동작이 없어 숨긴다. Finder 열기는 work 메뉴와 한 가족인 명령(`open_archived_spec_folder`)을 slug로 부르고(경로는
// 백엔드가 푼다 — S6), 경로 복사는 그 폴더의 참조를 클립보드에 쓴다. spec 목록 패널 머리의 「spec 폴더 열기」도 같은 명령이다. 못 열면
// 백엔드의 문장이 「못 한 일」 토스트로 선다(work 메뉴의 Finder 열기와 같은 말).
test("머리 줄의 ⋯ 아카이브 메뉴는 Finder에서 열기 · 경로 복사뿐이고, 각각 명령 · 클립보드를 부른다 — 패널 머리의 spec 폴더 열기도 같은 명령이다", async ({
  page,
}) => {
  const reason = `~/.atelier/archive/${shipped.slug}/spec 폴더가 없어요`;
  await installFixtureBackend(page);
  await recordClipboard(page);
  // 토스트(1.6초)를 느린 기계에서도 놓치지 않게 시계를 건다 — 마지막 누르기 직전에 세운다(위 토스트 절).
  await page.clock.install();
  await page.goto(`/archive/${shipped.slug}`);
  const trigger = 화면머리(page).getByRole("button", { name: "아카이브 메뉴", exact: true });
  const menu = page.getByRole("menu");
  const messages = page.getByRole("region", { name: "메시지", exact: true });
  const 부른slug = async () =>
    (await ipcCallArgs(page, "open_archived_spec_folder", "slug")).map(({ args }) => args.slug);

  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await trigger.click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Finder에서 열기", "경로 복사"]);
  await expect(page.getByRole("menuitem", { name: "되살리기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "되살리기" })).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Finder에서 열기", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(부른slug).toEqual([shipped.slug]);

  await trigger.click();
  await menu.getByRole("menuitem", { name: "경로 복사", exact: true }).click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/archive/${shipped.slug}/spec/`]);

  // 패널 머리의 「spec 폴더 열기」 — 같은 명령, 같은 slug다.
  const openFolder = 패널(page).getByRole("button", { name: "spec 폴더 열기", exact: true });
  await openFolder.click();
  await expect.poll(부른slug).toEqual([shipped.slug, shipped.slug]);
  expect(await unknownIpcCalls(page)).toEqual([]);

  // 못 열면 — 백엔드의 문장을 「Finder에서 열지 못했어요: 」 뒤에 붙인 토스트가 「메시지」에 선다.
  await replaceAnswer(page, "open_archived_spec_folder", ipcFailure(reason));
  await 시계를세운다(page);
  await openFolder.click();
  await expect(messages).toHaveText(`Finder에서 열지 못했어요: ${reason}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test, type Page } from "./evidence";
import { ARCHIVE, ARCHIVED_DOCS, ARCHIVED_FILE_BODIES, answerByArg } from "./fixtures";
import {
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  ipcFailure,
  readIpcRecord,
  recordClipboard,
  replaceAnswer,
  unknownIpcCalls,
  몸줄,
  검색팔레트를연다,
  화면머리,
  시계를세운다,
} from "./harness";
import type { ArchiveEntry } from "@/features/archive/types";
import type { SearchResults } from "@/features/search/types";

const [shipped, bare] = ARCHIVE;
const [RECORD, IMAGE, HTML, TICKET] = ARCHIVED_DOCS[shipped.slug].docs;

// **Archive는 목록과 상세 두 화면이다**(restart 03-4 · 스펙 「03 — 목록과 상세」 · 보드 MainArchive · MainArchiveDetail · PlaceSheet) — 공용 목록 틀의
// 표(이름 · 보관한 날)와, 상세 판의 위 카드 · 문서(왼쪽 글 | 오른쪽 「문서」 트리). 한때(codex-ds 결정 28 · 32) 문서 | 목록 한 카드와 오른쪽 spec
// 목록 패널(⌘Enter · 머리 줄 토글)이었고, 목록은 두 줄 행 · 날짜 소제목 · 정렬 · 거르기 아이콘 메뉴였으며 머리에 경로 줄이 섰다.
//
// 같은 것을 두 번 재지 않는다 — 다른 spec이 재는 것:
//   목록 ↔ 상세의 돌아옴(찾는 글 · 정렬 · 스크롤) · 창의 뒤로 · 앞으로 · ⌘F · 「← Archive」   `places.spec.ts`
//   문서 글의 우클릭 메뉴(복사 · 원문으로 보기 · 경로 복사) · 트리 파일 행의 메뉴             `target-menus.spec.ts`

/** 목록 표 — 상세에 가 있는 동안은 숨은 채 `main` 안에 남는다(`PlaceStage`). */
const 목록 = (page: Page) => page.getByRole("table", { name: "Archive 목록", exact: true });
const 줄 = (page: Page, entry: ArchiveEntry) => 몸줄(목록(page)).filter({ has: page.getByRole("link", { name: entry.title, exact: true }) });
/** 상세의 판 — 숨은 목록도 `main` 안이라 글로 찾으면 두 곳에 걸린다. 상세 판(`article`)으로 좁힌다. */
const 상세판 = (page: Page) => page.getByRole("main", { name: "Archive 상세", exact: true }).locator("article").first();
/** 상세의 「문서」 트리 — 판 안의 `nav`다(한때 둘째 `aside`의 spec 목록 패널). */
const 트리 = (page: Page) => 상세판(page).getByRole("navigation", { name: "문서", exact: true });
/** 트리의 그 파일 행 — 촘촘한 트리라 이름 앞의 확장자 글자는 이름에 들지 않는다(restart 03-12a — 한때 「MD record.md」). */
const 트리줄 = (page: Page, name: string) => 트리(page).getByRole("button", { name, exact: true });
/** 고른 트리 행의 경로 — 고름은 `aria-current`로 읽힌다. */
const 고른문서 = (page: Page) => 트리(page).locator('[aria-current="page"]').evaluateAll((rows) => rows.map((row) => row.closest("[data-spec-file]")?.getAttribute("data-spec-file")));
/** 위 카드 넷 — 칸마다 이름과 값(`title`을 단 값)이다. */
const 위카드 = (page: Page) => 상세판(page).locator("div:has(> span[title])");
/** 상세 판의 구르는 상자. */
const 판상자 = (page: Page) => 상세판(page).locator("xpath=..");

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
  await expect(상세판(page).getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();
  expect(await 고른문서(page)).toEqual([RECORD]);

  // 그림 — **뜨지는 않고** 자리표시가 선다. 아카이브 목록이 경량이라 문서 위치를 안 담기
  // 때문이고(`ImageDoc path={null}`), 자리표시가 드는 이름은 경로 그대로다.
  await 트리줄(page, "샷.png").click();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(상세판(page).getByText(IMAGE, { exact: true })).toBeVisible();

  // `.html` — Works와 **같은 `HtmlDoc`**이 선다(결정 18). 프레임 안까지 들어가 보는 것은
  // 껍데기가 아카이브 쪽 내용으로 정말 섰는지가 밖에서는 안 보이기 때문이다.
  await 트리줄(page, "조각.html").click();
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
  const reads = ((await readIpcRecord(page))?.calls ?? []).filter((call) => call.startsWith("read_archived_file"));
  expect(reads.filter((call) => call.includes(IMAGE))).toEqual([]);
  expect(reads.some((call) => call.includes(HTML))).toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 잠김은 두 사람이 나눠 든다: **파일 종류로 갈리는 것은 표가**, **누를 것이 있느냐는 화면이**(`doc-refs`의 표 머리말 — 「잠그는 것은 화면의
// 사정이다」). 보기 머리(경로 줄의 「문서로 보기 · 원문 보기」)가 없어진 뒤(restart 03-4) 원문 보기는 문서 글의 우클릭 메뉴 하나다 — 그림에서는
// 그 줄이 서지 않고(경로 복사만), 남은 문서가 없으면 글 상자 자체가 없다.
test("원문 보기는 문서 글의 우클릭 메뉴다 — 파일 종류가 잠그면 그 줄이 없고, 남은 문서가 없으면 글 상자가 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}?file=${encodeURIComponent(RECORD)}`);
  const 글 = 상세판(page).locator("[data-doc-text]");
  const 메뉴 = page.getByRole("menu");
  // 예쁜 보기에서만 제목이 선다 — 메뉴 글만 보면 「글자만 뒤집히고 본문은 그대로」가 통과한다.
  const heading = 상세판(page).getByRole("heading", { name: "기록 — 치운 일" });

  // `.md`는 두 갈래를 왕복한다.
  await expect(heading).toHaveCount(1);
  await 글.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(메뉴.getByRole("menuitem")).toHaveText(["원문으로 보기", "경로 복사"]);
  await 메뉴.getByRole("menuitem", { name: "원문으로 보기", exact: true }).click();
  await expect(heading).toHaveCount(0);
  await 글.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(메뉴.getByRole("menuitem")).toHaveText(["문서로 보기", "경로 복사"]);
  await 메뉴.getByRole("menuitem", { name: "문서로 보기", exact: true }).click();
  await expect(heading).toHaveCount(1);

  // 그림에서는 표가 잠근다 — 본문이 보기를 안 따르는 파일이라 그 줄이 서지 않는다.
  await 트리줄(page, "샷.png").click();
  await expect(상세판(page).getByText(IMAGE, { exact: true })).toBeVisible();
  await 글.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(메뉴.getByRole("menuitem")).toHaveText(["경로 복사"]);
  await page.keyboard.press("Escape");

  // **여기서 한 번 센다** — IPC 기록은 페이지에 사는 값이라 아래 이동이 그것을 비운다.
  expect(await unknownIpcCalls(page)).toEqual([]);

  // 남은 문서가 하나도 없는 아카이브 — 글 상자가 없고 「남은 문서가 없어요」 한 줄이다(트리도 없다).
  await page.goto(`/archive/${bare.slug}`);
  await expect(상세판(page).getByText("남은 문서가 없어요", { exact: true })).toBeVisible();
  await expect(글).toHaveCount(0);
  await expect(트리(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// spec 레이아웃 티켓 06 — **아카이브의 `spec/` 아래는 받은 spec 트리를 그린다.** 트리의 경로는 spec
// 기준이고 아카이브의 경로는 work 폴더 기준이라, 화면이 `spec/`를 다시 붙이지 않으면 고른 문서를
// 못 읽고 복사한 참조가 없는 파일을 가리킨다. 그 둘이 이 층에서만 보인다: 정적 렌더에는 누를 손이 없다.
test("아카이브의 spec/ 아래는 받은 트리대로 서고, 읽기와 복사에는 spec/가 다시 붙는다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(상세판(page).getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  // 트리는 상세 판의 「문서」 트리에, 고른 문서는 그 왼쪽 글에 선다 — 그 자리로 좁혀 집는다.
  //
  // 최상위 `tickets/`는 레이아웃의 자리 밖이라 아이콘이 없다(허용 차이 4) — 폴더 행에 그려진 그림이
  // 여닫이 화살표 하나뿐이다. 이름으로 알아보던 앱은 여기 `list-checks`를 그렸다.
  const tickets = 트리(page).getByRole("button", { name: "tickets", exact: true });
  await expect(tickets).toHaveAttribute("aria-expanded", "true");
  await expect(tickets.locator("svg")).toHaveCount(1);
  await expect(tickets.locator("svg.lucide-chevron-right")).toHaveCount(1);

  // 문서 읽기 IPC의 경로에 `spec/`가 붙는다 — 트리의 경로(`tickets/할일.md`) 그대로 나가면 기록과 같은
  // 자리(work 폴더)에서 찾아 없는 파일이 된다.
  const ticket = 트리줄(page, "할일.md");
  await ticket.click();
  await expect(상세판(page).getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  expect((await ipcCallArgs(page, "read_archived_file", "path")).map(({ args }) => args.path)).toContain(TICKET);
  expect(TICKET).toBe("spec/tickets/할일.md");

  // 경로를 복사하면 `spec/`가 붙은 아카이브 참조가 클립보드에 적히고(S35의 기록기), 「메시지」 토스트도 같은
  // 참조를 적는다.
  await ticket.hover();
  await 트리(page).getByRole("button", { name: "할일.md 경로 복사", exact: true }).click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["~/.atelier/archive/shipped-work/spec/tickets/할일.md"]);
  await expect(page.getByRole("region", { name: "메시지", exact: true })).toHaveText("~/.atelier/archive/shipped-work/spec/tickets/할일.md 복사됨");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **목록은 공용 목록 틀의 표다**(restart 03-4 · 보드 MainArchive · PlaceSheet 「세 화면」) — 열 머리 이름 · 보관한 날(정렬 단추 — 처음 보관한 날
// 내림), 줄은 보관함 글리프 · 이름 링크 · 상태와 Project, 보관한 날, ⋯. 날이 없는 폴더(손으로 옮긴 것)는 「—」이고 어느 방향으로 정렬해도
// 끝이다. 주 단추는 없다(작업공간을 아카이브하면 쌓인다). 한때 두 줄 행 · 날짜 소제목 · 「정렬 · 거르기」 아이콘 메뉴(Project 거르기)였다.
test("목록은 이름(상태 · Project) · 보관한 날 표이고, 열 머리를 누르면 그 칸 기준으로 줄이 바뀐다 — 날이 없는 폴더는 어느 방향이든 끝이다", async ({
  page,
}) => {
  const entry = (slug: string, title: string, archivedAt: string | null, status: ArchiveEntry["status"] = "done"): ArchiveEntry => ({
    slug,
    title,
    status,
    archivedAt,
    projects: [],
    branch: null,
  });
  const 지난해 = entry("last-year", "가 지난해 치운 것", "2025-12-20T03:04:05Z", "review");
  // 받은 차례가 정렬과 다르게 — 표가 스스로 센 차례인지 보인다.
  await installFixtureBackend(page, { list_archive: [bare, 지난해, shipped] });
  await page.clock.setFixedTime(new Date(2026, 7, 12, 12));
  await page.goto("/archive");
  const 머리 = 목록(page).getByRole("row").first().getByRole("columnheader");
  await expect(머리).toHaveText(["이름", "보관한 날"]);
  await expect(머리.nth(1)).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("button", { name: "정렬 · 거르기", exact: true })).toHaveCount(0);

  // 줄 — 이름 옆에 치운 때의 상태와 Project, 시각 칸에 보관한 날(올해면 「M월 D일」, 지난해면 해까지, 없으면 「—」).
  const 링크들 = 몸줄(목록(page)).getByRole("link");
  await expect(링크들).toHaveText([shipped.title, 지난해.title, bare.title]);
  await expect(줄(page, shipped).getByRole("cell")).toHaveText([`${shipped.title}완료 · billing`, "8월 10일", ""]);
  await expect(줄(page, 지난해).getByRole("cell")).toHaveText([`${지난해.title}검토`, "2025년 12월 20일", ""]);
  await expect(줄(page, bare).getByRole("cell")).toHaveText([`${bare.title}진행 중`, "—", ""]);

  // 보관한 날을 다시 누르면 오름 — 날이 없는 폴더는 그대로 끝이다.
  await 머리.nth(1).getByRole("button").click();
  await expect(머리.nth(1)).toHaveAttribute("aria-sort", "ascending");
  await expect(링크들).toHaveText([지난해.title, shipped.title, bare.title]);
  // 이름을 누르면 이름 차례다.
  await 머리.first().getByRole("button").click();
  await expect(머리.first()).toHaveAttribute("aria-sort", /ending$/);
  await expect(머리.nth(1)).not.toHaveAttribute("aria-sort");
  const 이름차례 = await 링크들.allInnerTexts();
  expect([...이름차례].sort((a, b) => a.localeCompare(b, "ko"))).toEqual(
    (await 머리.first().getAttribute("aria-sort")) === "ascending" ? 이름차례 : [...이름차례].reverse(),
  );
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
// **누르기 전에 상세 판의 움직임이 멎기를 기다린다.** 움직이는 도중에 누르면 버튼이 포인터 밑에서 미끄러져 누름과 뗌이 다른 곳에 떨어진다
// (한때 트리가 서던 패널의 전이에서 부하 아래 가끔 빨갰다 — 2026-10-11). 주소로 곧장 연 상세는 움직이지 않지만(restart 03-1 — `PlaceStage`)
// 그 판단이 바뀌어도 이 검사가 흔들리지 않게 기다린다. 전이는 CSS라 세운 시계와 상관없이 돈다.
test("문서 경로를 복사하면 「메시지」 영역에 그 글자가 서고, 1.6초가 지나면 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.clock.install();
  await page.goto(`/archive/${shipped.slug}`);
  const messages = page.getByRole("region", { name: "메시지", exact: true });
  const copy = 트리(page).getByRole("button", { name: "샷.png 경로 복사", exact: true });
  await expect(copy).toBeAttached();
  await expect(messages).toHaveText("");
  await expect.poll(() => 상세판(page).evaluate((el) => el.closest("main")!.getAnimations({ subtree: true }).length)).toBe(0);

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

// **상세는 판 하나다**(restart 03-4 · 보드 MainArchiveDetail) — 「← Archive」 · 이름 · 「Finder에서 열기」 · ⋯, 위 카드(상태 · 보관한 날 · Project ·
// 브랜치 — 빈 값은 「—」), 그 아래 왼쪽 글 | 오른쪽 240 「문서」 트리. 이 화면들에는 패널 · 둘째 `aside`가 없다 — 한때 트리가 둘째 `aside`의 spec 목록
// 패널에 섰고 ⌘Enter · 머리 줄 「spec 목록 접기」가 여닫았다. 머리 줄은 「Archive / 이름」(앞 칸을 누르면 목록)이고 할 일이 없다.
test("상세는 위 카드와 왼쪽 글 | 오른쪽 「문서」 트리이고, 패널 · 둘째 aside · 머리 줄의 할 일이 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(상세판(page).getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  await expect(화면머리(page)).toHaveText(`Archive/${shipped.title}`);
  await expect(화면머리(page).getByRole("button")).toHaveText(["Archive"]);
  // 판의 이름 — 문서 글의 제목(마크다운 h1)도 같은 판 안이라 처음 것이 판의 이름이다.
  await expect(상세판(page).getByRole("heading", { level: 1 }).first()).toHaveText(shipped.title);
  await expect(위카드(page)).toHaveText(["상태완료", "보관한 날2026년 8월 10일", "Projectbilling", `브랜치${shipped.branch}`]);

  // 트리 — 판 안의 `nav`이고 글의 오른쪽 240이다. 사이드바 다음의 `aside`는 작업공간 도구 기둥의 접힌 상자 하나(폭 0)뿐이다(restart 02a-14).
  const 글 = await 상세판(page).locator("[data-doc-text]").boundingBox();
  const 트리상자 = await 트리(page).boundingBox();
  expect(트리상자!.width).toBe(240);
  expect(트리상자!.x).toBeGreaterThan(글!.x + 글!.width);
  await expect(page.getByRole("region", { name: "spec 목록", exact: true })).toHaveCount(0);
  for (const aside of await page.locator("aside:not([data-sidebar])").all()) expect((await aside.boundingBox())?.width ?? 0).toBe(0);
  await expect(page.getByRole("button", { name: /^spec 목록/ })).toHaveCount(0);
  // ⌘Enter는 이 화면에서 아무것도 여닫지 않는다 — 트리는 그대로다.
  await 상세판(page).locator("[data-doc-text]").click();
  await page.keyboard.press("Meta+Enter");
  await expect(트리(page)).toBeVisible();
  expect((await 트리(page).boundingBox())!.width).toBe(240);

  // 날 · Project · 브랜치가 없는 폴더의 위 카드는 「—」다.
  await page.goto(`/archive/${bare.slug}`);
  await expect(위카드(page)).toHaveText(["상태진행 중", "보관한 날—", "Project—", "브랜치—"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **「문서」 트리는 보드 Places `.pl-tree`의 줄이다**(restart 03-12b) — 줄 24 · 줄 간격 27(사이 3 — 한때 촘촘한 줄 그대로 26), 한 단 18(자식 줄이
// 부모보다 18 들어간다 — 한때 12), 고른 줄은 면만 서고 굵기 400이다(시안 `.ra-tree-row.on` — 한때 500. 공용 트리 줄이라 spec 패널도 400).
test("「문서」 트리는 줄 24 · 간격 27 · 한 단 18이고, 고른 줄은 굵어지지 않는다(400)", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(트리줄(page, "record.md")).toBeVisible();
  // 뿌리의 기록 · `spec` 폴더 · 그 자식 `tickets` · 손자 `할일.md`가 위에서 차례로 선다.
  const 줄들 = ["record.md", "spec", "tickets", "할일.md"].map((name) => 트리줄(page, name));
  const 상자들 = await Promise.all(줄들.map(async (row) => (await row.boundingBox())!));
  expect(상자들.map(({ height }) => height), "줄 높이").toEqual([24, 24, 24, 24]);
  expect(상자들.slice(1).map((box, at) => Math.round((box.y - 상자들[at].y) * 10) / 10), "줄 간격").toEqual([27, 27, 27]);
  // 줄 안 첫 그림(여닫이 화살표 · 확장자 글자 · 아이콘)이 서는 자리 — 뿌리 8, 자식 26, 손자 44(보드 `pad: child ? 26 : 8`과 한 단 18).
  const 들여 = (row: (typeof 줄들)[number]) =>
    row.evaluate((el) => {
      const left = el.getBoundingClientRect().x;
      const xs = [...el.querySelectorAll("*")].map((one) => one.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.x);
      return Math.round((Math.min(...xs) - left) * 10) / 10;
    });
  expect(await Promise.all(줄들.map(들여)), "줄 안 첫 그림 — 뿌리 · 뿌리 · 자식 · 손자").toEqual([8, 8, 26, 44]);
  // 고른 줄(처음 선 문서 — 기록)은 면만 서고 굵기는 다른 줄과 같다.
  expect(await 고른문서(page)).toEqual([RECORD]);
  const 굵기 = (row: (typeof 줄들)[number]) => row.evaluate((el) => getComputedStyle(el).fontWeight);
  expect([await 굵기(줄들[0]), await 굵기(줄들[3])], "고른 줄 · 쉬는 줄 굵기").toEqual(["400", "400"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **트리로 고르면 주소만 갈아 쓴다**(훑기 — 히스토리를 만들지 않는다, Works의 트리와 같다). **문서 안 링크는 돌아올 자리를 남긴다**(push) — 창의
// 뒤로가 앞 문서로 돌아온다. 한때 같은 아카이브의 목록 행을 다시 누르면 보던 문서를 버렸다(그 행은 이제 없다 — 목록과 상세가 갈렸다).
test("트리로 고르면 주소만 갈아 쓰고 히스토리가 늘지 않으며, 문서 안 링크는 히스토리를 남겨 창의 뒤로가 앞 문서로 돌아온다", async ({ page }) => {
  await installFixtureBackend(page, {
    read_archived_file: answerByArg("path", { ...ARCHIVED_FILE_BODIES, [RECORD]: "# 기록 — 치운 일\n\n[할 일 보기](spec/tickets/할일.md)\n" }),
  });
  await page.goto(`/archive/${shipped.slug}`);
  await expect(상세판(page).getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();
  const 깊이 = () => page.evaluate(() => window.history.length);
  const 처음 = await 깊이();

  await 트리줄(page, "할일.md").click();
  await expect(page).toHaveURL(`/archive/${shipped.slug}?file=${encodeURIComponent(TICKET)}`);
  await expect(상세판(page).getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  await 트리줄(page, "record.md").click();
  await expect(page).toHaveURL(`/archive/${shipped.slug}?file=${encodeURIComponent(RECORD)}`);
  expect(await 깊이()).toBe(처음);
  expect(await 고른문서(page)).toEqual([RECORD]);

  await 상세판(page).getByRole("link", { name: "할 일 보기", exact: true }).click();
  await expect(page).toHaveURL(`/archive/${shipped.slug}?file=${encodeURIComponent(TICKET)}`);
  await expect(상세판(page).getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  expect(await 깊이()).toBe(처음 + 1);
  expect(await 고른문서(page)).toEqual([TICKET]);
  await page.goBack();
  await expect(page).toHaveURL(`/archive/${shipped.slug}?file=${encodeURIComponent(RECORD)}`);
  await expect(상세판(page).getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **트리는 판이 굴러도 위에 붙어 서고**(`sticky`), 긴 글을 굴린 뒤 다른 문서를 고르면 새 글의 첫 줄이 보이게 판이 그 위끝으로 굴러간다 — 그대로면
// 새 글의 한가운데나 그 아래 빈자리가 선다. 처음 선 문서는 굴리지 않는다.
test("긴 글을 굴린 뒤 트리로 다른 문서를 고르면 판이 새 글의 첫 줄로 굴러가고, 트리는 판 위에 붙어 선다", async ({ page }) => {
  const 긴글 = `# 기록 — 치운 일\n\n${Array.from({ length: 120 }, (_, n) => `줄 ${n + 1}.`).join("\n\n")}\n`;
  await installFixtureBackend(page, { read_archived_file: answerByArg("path", { ...ARCHIVED_FILE_BODIES, [RECORD]: 긴글 }) });
  await page.goto(`/archive/${shipped.slug}`);
  await expect(상세판(page).getByText("줄 120.", { exact: true })).toBeAttached();
  const 판 = 판상자(page);
  expect(await 판.evaluate((el) => el.scrollTop), "처음 선 문서는 굴리지 않는다").toBe(0);

  await 판.evaluate((el) => el.scrollTo(0, 2000));
  await expect.poll(() => 판.evaluate((el) => el.scrollTop)).toBe(2000);
  const 판위 = (await 판.boundingBox())!.y;
  // 트리는 판 위에 붙어 있다.
  expect((await 트리(page).boundingBox())!.y).toBeCloseTo(판위, 0);

  // 새 글은 짧아 판이 더 굴러 올라갈 자리가 없다 — 판의 위끝까지 붙지는 않고, 새 글의 제목이 판 안에 들면 된다(`시안-비교/03-4/앱-history.txt`).
  await 트리줄(page, "할일.md").click();
  const 제목 = 상세판(page).getByRole("heading", { name: "치운 일의 할 일" });
  await expect(제목).toBeVisible();
  const 판아래 = 판위 + (await 판.boundingBox())!.height;
  await expect.poll(async () => (await 제목.boundingBox())!.y).toBeGreaterThanOrEqual(판위);
  expect((await 제목.boundingBox())!.y + (await 제목.boundingBox())!.height).toBeLessThanOrEqual(판아래);
  expect(await 판.evaluate((el) => el.scrollTop)).toBeLessThan(2000);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ⌘K의 아카이브 문서 줄 — 그 아카이브 상세의 `?file=`로 와서 그 문서가 열리고 트리에서 골라진다(`hitTarget` — 이슈 #25).
test("⌘K의 아카이브 문서 줄을 고르면 그 아카이브 상세에 그 문서가 열리고 트리에서 골라진다", async ({ page }) => {
  const 답: SearchResults = { hits: [{ kind: "doc", slug: shipped.slug, title: shipped.title, path: TICKET, archived: true }] };
  await installFixtureBackend(page, { search: 답 });
  await page.goto("/projects");
  await expect(page.getByRole("table", { name: "Project 목록", exact: true })).toBeVisible();
  await 검색팔레트를연다(page);
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(`/archive/${shipped.slug}?file=${encodeURIComponent(TICKET)}`);
  await expect(상세판(page).getByRole("heading", { name: "치운 일의 할 일" })).toBeVisible();
  expect(await 고른문서(page)).toEqual([TICKET]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **상세 머리의 할 일**(restart 03-4 · 보드 MainArchiveDetail) — 「Finder에서 열기」(그 아카이브의 spec 폴더)와 ⋯(Finder에서 열기 · 경로 복사). 되살리기는
// 앱에 없어 그리지 않는다. Finder 열기는 work 메뉴와 한 가족인 명령(`open_archived_spec_folder`)을 slug로 부르고(경로는 백엔드가 푼다 — S6), 경로 복사는
// 그 폴더의 참조를 클립보드에 쓴다. 못 열면 백엔드의 문장이 「못 한 일」 토스트로 선다. 한때 이 메뉴는 머리 줄의 「아카이브 메뉴」였고, spec 목록 패널
// 머리에 「spec 폴더 열기」가 섰다.
test("상세 머리의 「Finder에서 열기」와 ⋯(Finder에서 열기 · 경로 복사)는 그 아카이브의 spec 폴더를 부르고, 못 열면 그 까닭을 토스트로 말한다", async ({
  page,
}) => {
  const reason = `~/.atelier/archive/${shipped.slug}/spec 폴더가 없어요`;
  await installFixtureBackend(page);
  await recordClipboard(page);
  // 토스트(1.6초)를 느린 기계에서도 놓치지 않게 시계를 건다 — 마지막 누르기 직전에 세운다(위 토스트 절).
  await page.clock.install();
  await page.goto(`/archive/${shipped.slug}`);
  const trigger = 상세판(page).getByRole("button", { name: `${shipped.title} 메뉴`, exact: true });
  const finder = 상세판(page).getByRole("button", { name: "Finder에서 열기", exact: true });
  const menu = page.getByRole("menu");
  const messages = page.getByRole("region", { name: "메시지", exact: true });
  const 부른slug = async () => (await ipcCallArgs(page, "open_archived_spec_folder", "slug")).map(({ args }) => args.slug);

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

  // 머리 단추 「Finder에서 열기」 — 같은 명령, 같은 slug다.
  await finder.click();
  await expect.poll(부른slug).toEqual([shipped.slug, shipped.slug]);
  expect(await unknownIpcCalls(page)).toEqual([]);

  // 못 열면 — 백엔드의 문장을 「Finder에서 열지 못했어요: 」 뒤에 붙인 토스트가 「메시지」에 선다.
  await replaceAnswer(page, "open_archived_spec_folder", ipcFailure(reason));
  await 시계를세운다(page);
  await finder.click();
  await expect(messages).toHaveText(`Finder에서 열지 못했어요: ${reason}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

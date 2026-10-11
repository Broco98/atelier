import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// git-integration 판 01 티켓 09(#482) — **이미지 · 바이너리 · 큰 파일이 종류대로 보인다.**
//
// 파일 탭의 몸은 코어 답의 갈래(`kind`)를 따른다(구현 스펙 「화면 — 코드 보기 › 종류별 몸」). 그림은 spec의 그림 보기와 같은 길로
// 그린다 — 워크트리 절대 경로를 asset URL로. 글이 아닌 나머지는 깨진 글자 대신 가운데 안내(제목 + 크기)다(스토리 74–76).
// `.md`와 svg는 렌더된 문서나 그림이 아니라 원문 코드다(결정 36).

// 워크트리가 하나(`billing`)인 work.
const [work] = WORKS;

const codeUrl = (ref: string) => `/works/${work.slug}?tab=code&code=${encodeURIComponent(ref)}`;
/** 코드 카드 — 접근 이름이 그 파일의 경로다(스토리 89). */
const 코드카드 = (page: Page, ref: string) => page.getByRole("main", { name: ref, exact: true });

test("그림 파일은 워크트리 절대 경로의 asset URL로 그림이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/shots/home.png"));

  const card = 코드카드(page, "billing/shots/home.png");
  const image = card.getByRole("img", { name: "shots/home.png", exact: true });
  await expect(image).toBeVisible();
  // 홈(`/Users/tester`)으로 편 워크트리 자리 + 워크트리 기준 경로를 asset 프로토콜로 건다 — spec 그림과 같은 길이다. 그림
  // 바이트는 이 층에 오지 않는다(진짜 웹뷰가 아니다) — 거는 자리가 맞는지를 잰다.
  await expect(image).toHaveAttribute(
    "src",
    `asset://localhost/${encodeURIComponent("/Users/tester/.atelier/works/pinned-work/trees/billing/shots/home.png")}`,
  );
  // 몸은 그림 하나다 — 글로 읽은 깨진 원문(줄 번호 붙은 보기)이 함께 서지 않는다.
  await expect(card.locator("img")).toHaveCount(1);
  await expect(card).toHaveText("billingshotshome.png");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("바이너리 · UTF-8 아님 · 너무 큼은 탭 안에 각 안내와 크기가 선다", async ({ page }) => {
  await installFixtureBackend(page);
  const cases = [
    { ref: "billing/build/app.wasm", title: "바이너리 파일", size: "1.5KB" },
    { ref: "billing/legacy.txt", title: "UTF-8이 아닌 파일", size: "300B" },
    { ref: "billing/logs/huge.log", title: "너무 큰 파일", size: "7.5MB" },
  ];
  for (const { ref, title, size } of cases) {
    await page.goto(codeUrl(ref));
    const card = 코드카드(page, ref);
    // spec으로 조용히 돌아가지 않는다 — 탭은 서고 본문이 무엇인지를 말한다.
    await expect(page.locator(`[data-tab="code"][data-code="${ref}"]`)).toHaveCount(1);
    await expect(card).toContainText(title);
    await expect(card).toContainText(size);
    await expect(card.locator("img")).toHaveCount(0);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`.md`와 svg는 렌더된 문서나 그림이 아니라 원문 코드로 선다", async ({ page }) => {
  await installFixtureBackend(page);

  // `.md` — 렌더된 문서는 spec 칸의 몫이다(스토리 73). `#`이 글자로 서고 줄 번호가 붙는다.
  await page.goto(codeUrl("billing/README.md"));
  const md = 코드카드(page, "billing/README.md");
  await expect(md).toContainText(/1\s*# 빌링/);
  await expect(md.getByRole("heading")).toHaveCount(0);

  // svg — 그림 확장자이기도 하지만 원문을 읽는다(스토리 72). 그림으로 걸리지 않는다.
  await page.goto(codeUrl("billing/icon.svg"));
  const svg = 코드카드(page, "billing/icon.svg");
  await expect(svg).toContainText(/1\s*<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">\s*2\s*<circle r="4"\/>\s*3\s*<\/svg>/);
  await expect(svg.locator("img")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

const [work] = WORKS;
const HTML_FILE = "목업/조각.html";
const JSON_FILE = "메타.json";

// spec 트리에서 `.html`을 고르면 렌더된 페이지가 본문에 선다 — `srcdoc` 프레임 하나가
// 그 통로다(결정 1).
//
// **이 층에서만 보인다.** 정적 마크업 seam(SpecViewer.test.tsx)은 껍데기 문자열과 sandbox
// 값을 문자열로 고정하지만, 그 껍데기가 **정말 섰는지**는 진짜 파서가 있어야 한다.
// 스크립트가 돌았는지와 부모 DOM이 막혔는지도 같다.
//
// 이 통로에서 `compatMode`는 안 갈린다 — 실물 목업으로 재 봤다(2026-08-29, WebKit·뷰포트
// 1000px): 껍데기가 있든 없든 `CSS1Compat`이고, 행 폭 264px·첫 줄 32px·테이블 셀 47.08px은
// **전부 그대로다.** 그 목업은 배경·글자색·글꼴을 자기가 정하므로 껍데기에서 얻는 것이
// `body` 여백 한 줄뿐이었다 — 그래서 **껍데기에 기대는 조각**(픽스처의 그것)으로 나머지
// 세 줄까지 함께 잰다. 그 셋이 처음 판에서 발행본과 어긋나 있었고, 화소 대조가 그것을
// 잡았다(`SpecViewer.tsx`의 상수 주석).
//
// 아카이브 화면은 여기 안 들어간다 — **이제 자기 파일에서 탄다**(archive-docs.spec.ts).
// 「픽스처의 아카이브 목록이 비어 있어 그 층에는 그물이 없다」던 것이 거짓이 됐다: 그 판이
// 미뤄 둔 스텁 둘(`list_archived_docs`·`read_archived_file`)이 섰고, 갈리던 세 갈래
// (그림 · `.html` · 잠김)를 그 파일이 태운다. 여기 남는 것은 Works 쪽 한 벌이다.
test("`.html`은 껍데기를 쓴 프레임으로 서고, 그 안에서 스크립트가 돈다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent(HTML_FILE)}`);

  // 프레임의 접근성 이름은 **파일 경로**다 — 그림 본문이 `alt`에 넣는 그 값이다.
  const frameEl = page.locator(`iframe[title="${HTML_FILE}"]`);
  await expect(frameEl).toBeVisible();
  // 값에 조건이 없다(결정 5). `allow-same-origin`이 함께 오면 세 겹이 통째로 무너진다.
  await expect(frameEl).toHaveAttribute("sandbox", "allow-scripts");

  const frame = await (await frameEl.elementHandle())?.contentFrame();
  if (!frame) throw new Error("프레임 안으로 들어가지 못했다");

  // 프레임 안에서 스크립트가 돌았다 — `allow-scripts`가 빠지면 여기가 `null`이다.
  // 파싱이 끝나기 전에 물으면 `document.body`가 아직 없으므로 던지지 않고 기다린다.
  await expect
    .poll(() => frame.evaluate(() => document.body?.dataset.ran ?? null))
    .toBe("1");

  // **껍데기가 정말 칠했는가.** 픽스처의 조각은 배경도 글자색도 글꼴도 자기가 안 정하므로
  // 이 네 값이 곧 껍데기다 — 여백이 없으면 UA 기본 8px, 배경이 없으면 캔버스가 흰색,
  // 글자색이 없으면 검정이 선다. 문자열 검사(`SpecViewer.test.tsx`)는 **우리가 무엇을
  // 적었는지**만 알고, 그 바이트가 파서를 통과해 실제로 칠하는지는 여기서만 보인다
  // (발행본에서 그대로 떠 온 `charset=utf8`·`[hidden]:not([hidden=until-found])`처럼
  // 눈으로는 오타처럼 읽히는 조각이 그 안에 있다).
  expect(
    await frame.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { margin: cs.marginTop, bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily };
    }),
  ).toEqual({
    margin: "0px",
    bg: "rgb(250, 249, 245)",
    color: "rgb(20, 20, 19)",
    font: "-apple-system, BlinkMacSystemFont, sans-serif",
  });
  // 이쪽은 **껍데기를 가르지 못한다.** `srcdoc` 문서는 doctype이 없어도 quirks mode로
  // 안 떨어지기 때문이다(HTML 파싱 규칙이 srcdoc을 예외로 둔다 — 실측으로 확인했다).
  // 그래도 고정한다: 이 값이 `BackCompat`으로 바뀌면 렌더 통로가 `srcdoc`이 아닌 다른
  // 것으로 갈아탔다는 뜻이고, 그때는 위 여백 한 줄이 지키던 것이 통째로 흔들린다.
  expect(await frame.evaluate(() => document.compatMode)).toBe("CSS1Compat");

  // sandbox가 걸렸다는 증거 — 불투명 출처라 부모 문서에 닿지 못한다(결정 4의 첫 겹).
  expect(
    await frame.evaluate(() => {
      try {
        return String(parent.document.title);
      } catch (error) {
        return (error as Error).name;
      }
    }),
  ).toBe("SecurityError");

  // 프레임은 **자기 안에서** 구른다(결정 9) — 바깥 스크롤 상자는 안 넘치므로 막대가
  // 한 개만 산다. 넘치면 같은 화면에 세로 막대가 둘 생긴다.
  const outer = page.locator("main > div.scroll-quiet");
  await expect(outer).toHaveCount(1);
  expect(await outer.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 표의 새 줄은 **두 칸이 함께** 들어왔다(결정 7) — 렌더만 켜고 토글을 잠그면 소스를 볼
// 길이 사라진다. 그 옆에서 `.json`이 「나머지는 지금 그대로」를 받쳐 준다.
test("`.html`은 토글이 안 잠기고, `.json`은 지금 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}`);

  const doc = page.getByRole("button", { name: "문서로 보기" });
  const source = page.getByRole("button", { name: "원문 보기" });
  const frameEl = page.locator(`iframe[title="${HTML_FILE}"]`);

  // `.md`에서 원문을 켜 둔 채 `.html`로 옮긴다 — **소스가 선다**(결정 8). 「선 칸은 사람이
  // 정한 값이다」가 원칙이라, 파일을 옮겼다고 그 값이 저 혼자 뒤집히면 원칙이 깨진다.
  await source.click();
  await expect(source).toHaveAttribute("aria-pressed", "true");

  // 트리의 잎을 누른다 — 이름 앞의 `HTML`은 확장자 배지다(복사 버튼과 갈리려면 정확히 센다)
  await page.getByRole("button", { name: "HTML 조각.html", exact: true }).click();
  await expect(frameEl).toHaveCount(0);
  await expect(page.getByText("껍데기 없는 아티팩트 조각")).toBeVisible();

  // 토글이 **안 잠긴다** — 누르면 렌더가 서고 다시 누르면 원문으로 온다.
  await expect(doc).toBeEnabled();
  await doc.click();
  await expect(frameEl).toHaveCount(1);
  await source.click();
  await expect(frameEl).toHaveCount(0);
  await expect(page.getByText("껍데기 없는 아티팩트 조각")).toBeVisible();

  // 나머지 비-md는 지금과 똑같다 — 소스 고정, 두 칸 함께 잠김.
  await page.getByRole("button", { name: `JSON ${JSON_FILE}`, exact: true }).click();
  await expect(page.getByText("소스 고정")).toBeVisible();
  await expect(doc).toBeDisabled();
  await expect(source).toBeDisabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

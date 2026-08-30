import { expect, test } from "./evidence";
import { ARCHIVE, ARCHIVED_DOCS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

const [shipped, bare] = ARCHIVE;
const [RECORD, IMAGE, HTML] = ARCHIVED_DOCS[shipped.slug];

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

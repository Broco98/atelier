import { expect, test } from "./evidence";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// 결정 32 — 스크롤 막대는 **콘텐츠 위에 떠서 자리를 안 먹고**, 구르는 동안만 보인다.
//
// 이 층에서만 보인다. 값 쪽(어느 상자가 클래스를 다는가)은 `src/scroll-overlay.test.ts`가
// 소스로 세지만, **정말로 폭을 안 먹는가**와 **정말로 뜨고 사라지는가**는 진짜 레이아웃과
// 진짜 시간이 있어야 한다. 그 둘이 이 결정의 전부다.
test("막대는 자리를 안 먹고 떠서 뜨고, 멎으면 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  // 목록이 넘치도록 창을 낮춘다 — 고정 데이터의 work은 넷이라 기본 높이로는 안 넘친다.
  await page.setViewportSize({ width: 1280, height: 240 });
  await page.goto("/projects");

  const list = page.locator("aside .scroll-quiet");
  await expect(list).toHaveCount(1);

  const box = await list.evaluate((el) => ({
    over: el.scrollHeight > el.clientHeight,
    client: el.clientWidth,
    offset: (el as HTMLElement).offsetWidth,
  }));
  // 넘치지 않으면 아래가 전부 공허하게 통과한다.
  expect(box.over).toBe(true);
  // **자리를 안 먹는다.** 11px 커스텀 막대가 돌아오면 여기가 빨개진다.
  expect(box.client).toBe(box.offset);

  const bar = page.locator('[data-scrollbar="vertical"]');
  // 구르기 전에는 아예 없다 — 먼저 세지 않으면 아래가 「원래 있던 것」으로도 초록이 된다.
  await expect(bar).toHaveCount(0);

  await list.evaluate((el) => el.scrollBy(0, 40));
  await expect(bar).toHaveAttribute("data-on", "");

  // 상자 **안쪽** 오른쪽 끝에 선다. 밖에 그리면 옆 화면을 덮는다.
  const listBox = (await list.boundingBox())!;
  const thumb = (await bar.boundingBox())!;
  expect(thumb.x + thumb.width).toBeLessThanOrEqual(listBox.x + listBox.width);
  expect(thumb.x).toBeGreaterThan(listBox.x + listBox.width - 20);

  // 멎으면 사라진다.
  await expect(bar).not.toHaveAttribute("data-on", "", { timeout: 4000 });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 32의 **못 적혀 있던 절반** — 막대가 자리를 안 먹는다면, 그 자리를 콘텐츠가 대신
// 차지하지 않아야 한다. 막대는 상자 안쪽 3~9px에 뜨므로(`lib/scroll-quiet.ts`의 EDGE·
// THICKNESS) 그 9px 안에 보이는 것이 서면 막대가 그 위에 얹힌다.
//
// **이 규칙이 어디에도 없어서 병이 두 목록에 자랐다.** 사이드바 work 목록과 아카이브 목록은
// 거터(`px-2`·`px-3`)가 스크롤 상자 **바깥**에 있어, 막대가 패널 경계에서 11~17px 안쪽 —
// 행 한가운데로 들어왔다. 핀·셸 메타 상자를 5px 침범했고 아카이브의 날짜와는 0px까지
// 붙었다(실측). 사람이 실물에서 그것을 보고 「스크롤이 아직도 좀 이상한대?」라고 했다.
// 고친 방법은 상자마다 `-mx-* px-*`로 거터를 뚫고 나갔다 되돌리는 것이다 — 보이는 것은
// 하나도 안 움직이고 막대만 가장자리로 간다.
//
// **소스로는 못 센다.** 「거터가 상자 밖인가」는 부모의 클래스와 자식의 클래스를 함께 읽어야
// 나오고, 진짜 답은 픽셀이다. 그래서 이 층이 든다.
test("막대가 서는 9px에 콘텐츠가 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 300 });

  // 세 화면을 도는 것은 목록마다 오른쪽 끝에 서는 것이 다르기 때문이다 — 사이드바는 핀과
  // 셸 메타, 아카이브는 날짜, 프로젝트는 그 행의 배지다.
  for (const url of ["/projects", "/archive"]) {
    await page.goto(url);
    // **목록이 실제로 넘칠 때까지 기다린다.** 안 넘치는 상자는 아래에서 건너뛰므로, 데이터가
    // 오기 전에 재면 볼 것이 하나도 없는 채로 초록이 된다 — 실제로 그렇게 났다.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll(".scroll-quiet")).filter(
            (el) => el.scrollHeight > el.clientHeight + 1,
          ).length,
        ),
      )
      .toBeGreaterThan(0);

    const 침범 = await page.evaluate(() => {
      const THICKNESS = 6;
      const EDGE = 3;
      const bad: string[] = [];
      for (const box of Array.from(document.querySelectorAll(".scroll-quiet"))) {
        const r = box.getBoundingClientRect();
        if (r.width === 0 || box.scrollHeight <= box.clientHeight + 1) continue;
        const barLeft = r.left + box.clientLeft + box.clientWidth - THICKNESS - EDGE;
        for (const el of Array.from(box.querySelectorAll("*"))) {
          // **보이는 것만 센다.** 폭을 꽉 채우는 빈 상자는 막대 아래로 지나가도 아무것도
          // 가리지 않는다 — 글자를 담은 잎과 아이콘만이 이 규칙의 대상이다.
          const 잎 = el.children.length === 0 && (el.textContent ?? "").trim().length > 0;
          if (!잎 && el.tagName !== "svg") continue;
          const kr = el.getBoundingClientRect();
          if (kr.width === 0 || kr.height === 0) continue;
          if (kr.right > r.right + 1 || kr.left < r.left - 1) continue; // 상자 밖(떠 있는 카드)
          // **막대에 닿기 전에 `EDGE`만큼 멎어야 한다.** 막대가 상자 안쪽 끝에서 EDGE를
          // 띄우고 서듯 콘텐츠 쪽으로도 같은 값을 띄운다 — 대칭이라 임의로 고른 수가 아니다.
          //
          // 「겹치지만 않으면 된다」로 두면 고치기 전 화면이 초록으로 들어온다. 두 목록이
          // 정확히 **0.0px**에서 멎어 있었고(헤더 개수 263 · 막대 263~269, 아카이브 날짜
          // 619 · 막대 619~625), 겹치진 않는데 딱 붙은 그 모양이 사람 눈에 걸린 것이다.
          // 되돌려 확인했다 — `>` 비교로는 그 화면이 통과한다.
          if (kr.right > barLeft - EDGE) {
            bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 12)}" right=${kr.right.toFixed(1)} > ${(barLeft - EDGE).toFixed(1)}`);
          }
        }
      }
      return bad;
    });
    expect(침범, `${url}에서 콘텐츠가 막대 자리를 침범한다`).toEqual([]);
  }

  expect(await unknownIpcCalls(page)).toEqual([]);
});

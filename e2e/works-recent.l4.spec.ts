import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installRealBackend, unknownIpcCalls } from "./harness";
import { expect, test } from "./l4";
import type { Page } from "./evidence";

// 결정 12·13·14. **work 화면을 열면 진짜 파일이 써진다** — `~/.atelier/recent.json`.
//
// 이 층만 답할 수 있는 것이 그것이다: 화면의 effect → IPC → 커맨드 → 코어 → 파일까지가
// 한 번에 걸린다. 배선이 도는지는 L3가 보고(`works-recent.spec.ts`), 파일 규칙은 코어
// 단위가 본다 — 여기서만 그 둘이 **같은 파일 한 장**에서 만난다.
//
// **work을 손으로 심는다.** sandbox에는 work이 하나도 없고 **앱에도 다리에도 work을 만드는
// 커맨드가 없다**(work 생성은 MCP 전용이다). 씨를 안 뿌리면 목록이 비어 주소가 정규화되고
// effect가 아예 안 도는데, 실패는 「파일이 안 생겼다」로만 나와 원인이 엉뚱한 곳을 가리킨다.
//
// **터미널 탭을 안 연다** — 다리는 PTY를 거절한다(`in_app_only`).

/** 만든 날까지 못 박아 심는다 — 기본 순서(만든 순)가 이 값에서 나온다. */
function seedWork(home: string, slug: string, title: string, createdAt: string) {
  const dir = join(home, "works", slug);
  mkdirSync(join(dir, "spec"), { recursive: true });
  writeFileSync(
    join(dir, "work.json"),
    JSON.stringify({ title, status: "active", createdAt, projects: [], pinned: false }),
  );
  writeFileSync(join(dir, "spec", "overview.md"), "# 개요\n\n한 줄.\n");
}

/** 이력 파일에 적힌 slug들. 아직 없으면 빈 목록이다 — poll이 다시 부른다. */
function recentSlugs(home: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(home, "recent.json"), "utf8")) as {
      works?: { slug: string }[];
    };
    return (raw.works ?? []).map((work) => work.slug);
  } catch {
    return [];
  }
}

test("work 화면을 열면 이력 파일에 그 work이 적힌다", async ({ page, sandbox }) => {
  const { home } = sandbox;
  seedWork(home, "나중것", "나중에 만든 작업", "2026-08-05");
  seedWork(home, "먼저것", "먼저 만든 작업", "2026-08-01");
  await installRealBackend(page, sandbox);

  // **아직 아무것도 없다.** 읽기가 파일을 만들지 않는다는 것이 이 한 줄이다 — 앱을 켜고
  // 사이드바가 목록을 읽는 것만으로는 이력이 안 생긴다.
  await page.goto("/projects");
  await expect(page.getByText("등록된 프로젝트가 없어요")).toBeVisible();
  expect(recentSlugs(home)).toEqual([]);

  await page.goto("/works/먼저것");
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  // 다리를 타고 파일시스템까지 다녀오므로 즉시가 아니다.
  await expect.poll(() => recentSlugs(home)).toEqual(["먼저것"]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 팔레트의 작업 줄들 — 「가는 곳」 넷 뒤부터다. 제목으로 읽는다. */
async function workRows(page: Page): Promise<string[]> {
  const names = await page.getByRole("option").evaluateAll((els) =>
    els.map((el) => el.textContent?.trim() ?? ""),
  );
  return names.filter((name) => name.endsWith("작업"));
}

// 결정 11. **마지막으로 연 것이 위다** — 이력 파일을 쓰는 쪽과 읽어 순서를 세우는 쪽이
// 여기서 처음 만난다.
//
// **work을 둘 심는다.** 하나만 심으면 MRU가 통째로 안 구현돼도 초록이다 — 줄이 하나면
// 첫 줄인 것이 자명하다. 그리고 **기본 순서를 먼저 확인한다**: 그것을 안 보면 「원래부터
// 그 순서였다」와 「연 것이 올라왔다」가 구별되지 않는다.
test("마지막으로 연 work이 빈 팔레트의 첫 작업 줄이다", async ({ page, sandbox }) => {
  const { home } = sandbox;
  seedWork(home, "나중것", "나중에 만든 작업", "2026-08-05");
  seedWork(home, "먼저것", "먼저 만든 작업", "2026-08-01");
  await installRealBackend(page, sandbox);

  // 이력이 비어 있을 때의 기본 순서 — 만든 순이다.
  await page.goto("/projects");
  await expect(page.getByText("등록된 프로젝트가 없어요")).toBeVisible();
  await page.keyboard.press("Meta+k");
  await expect.poll(() => workRows(page)).toEqual(["나중에 만든 작업", "먼저 만든 작업"]);
  await page.keyboard.press("Escape");

  // 만든 순으로는 아래인 쪽을 연다.
  await page.goto("/works/먼저것");
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();
  await expect.poll(() => recentSlugs(home)).toEqual(["먼저것"]);

  await page.keyboard.press("Meta+k");
  await expect.poll(() => workRows(page)).toEqual(["먼저 만든 작업", "나중에 만든 작업"]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

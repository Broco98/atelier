import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkView } from "@/features/works/types";
import type { Page } from "./evidence";
import { askBackend, callCount, installRealBackend, unknownIpcCalls } from "./harness";
import { expect, seedWork, test } from "./l4";

// spec 레이아웃 티켓 11 — **편집기가 다리로 레이아웃을 진짜로 쓰고, 다시 부른 work 목록의 spec 트리가 그
// 레이아웃을 따른다.**
//
// L3의 저장은 fixture가 답해 「쓴 것이 무엇을 바꾸는가」를 못 잰다. 이 층만 그것을 답한다: 편집기의 [저장]
// → `write_spec_layout` → 다리 → 코어의 `save_layout`이 데이터 루트에 레이아웃 폴더를 만들고, 편집기가 연
// 무효화가 `list_works`를 다시 불러 그 레이아웃으로 가른 트리를 받는다. 다리에는 감시자가 없다 — 트리가
// 바뀐다면 그것은 저장한 쪽의 무효화 덕이다. 검증 거절도 진짜 엔진의 답이다: 데이터로 와서 그 자리에 선다.

const 이름틀 = (page: Page) =>
  page.getByRole("textbox", { name: "이름 틀", exact: true });

test("편집기가 저장한 레이아웃이 다리의 데이터 루트에 서고, 다시 부른 work 목록의 spec 트리가 그것을 따른다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  seedWork(home, "첫째", "첫째 작업", "2026-08-03");
  const spec = join(home, "works", "첫째", "spec");
  writeFileSync(join(spec, "overview.md"), "# 개요\n\n첫째 작업의 개요다.\n");
  writeFileSync(join(spec, "plan.md"), "# 계획\n\n계획의 본문이다.\n");
  const folder = join(home, "layouts", "atelier");
  await installRealBackend(page, sandbox);

  // 폴더가 없으니 내장본이다 — `overview.md`가 맨 앞 항목이라 기본 문서다.
  await page.goto("/works/첫째");
  await expect(page.getByText("첫째 작업의 개요다.")).toBeVisible();
  const [before] = (await askBackend(page, "list_works", { mode: "atelier" })) as WorkView[];
  expect(before.specTree.defaultDoc).toBe("overview.md");

  // 앱 안에서 설정으로 간다 — 새로 읽으면 캐시가 사라져 무효화를 잴 수 없다.
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: "Settings", exact: true }).click();
  await aside.getByRole("button", { name: "spec 레이아웃", exact: true }).click();
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await expect(page).toHaveURL("/settings/spec-layout/atelier");
  // 내장본의 첫 최상위 항목을 골라 둔 채로 열린다
  await expect(이름틀(page)).toHaveValue("overview.md");

  // 먼저 엔진이 거절하는 초안 — 빈 이름 틀. 거절은 데이터로 와서 그 자리에 서고, 아무것도 쓰지 않는다.
  await 이름틀(page).fill("");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("`pattern` is empty", { exact: true })).toBeVisible();
  expect(existsSync(folder)).toBe(false);

  // 첫 항목의 이름 틀을 `plan.md`로 — 그 자리의 아이콘(나침반)과 기본 문서가 `plan.md`로 옮겨 간다.
  await 이름틀(page).fill("plan.md");
  const listed = await callCount(page, "list_works");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("`pattern` is empty", { exact: true })).toHaveCount(0);

  // 처음 저장이 내장본을 가리는 폴더를 만들었다(결정 7)
  await expect.poll(() => existsSync(join(folder, "layout.json"))).toBe(true);
  const written = JSON.parse(readFileSync(join(folder, "layout.json"), "utf8"));
  expect(written.root.children[0]).toMatchObject({ pattern: "plan.md", kind: "file", icon: "compass" });
  // 감시자 없이도 work 목록이 다시 불렸다 — 저장한 쪽의 무효화다
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(listed);

  const [after] = (await askBackend(page, "list_works", { mode: "atelier" })) as WorkView[];
  expect(after.specTree.defaultDoc).toBe("plan.md");
  expect(after.specTree.items[0]).toMatchObject({ name: "plan.md", kind: "file", icon: "compass" });

  // 설정의 행도 다시 읽은 엔진의 상태다 — 이제 고친 폴더다
  await page.getByRole("button", { name: "설정으로 돌아가기", exact: true }).click();
  const 행 = page.locator("main li").filter({ has: page.getByText("Atelier", { exact: true }) });
  await expect(행).toContainText(`${folder}/ 폴더가 내장본을 가리고 있어요`);

  // 돌아간 work 화면은 그 목록의 트리를 따른다 — `plan.md`가 기본 문서다.
  await aside.getByRole("button", { name: "앱으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL(`/works/${encodeURIComponent("첫째")}`);
  await expect(page.getByText("계획의 본문이다.")).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

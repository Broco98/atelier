import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpecLayoutState } from "@/features/spec-layout/types";
import { askBackend, callCount, installRealBackend, unknownIpcCalls } from "./harness";
import { expect, seedLayout, seedWork, test } from "./l4";

// spec 레이아웃 티켓 08 — **설정의 모드 두 행이 엔진의 상태를 그린다.**
//
// L3의 행은 손으로 적은 fixture라 「엔진이 정말 그렇게 판정하는가」를 못 잰다. 이 층만 그것을 답한다:
// `spec_layout_states` → 다리 → 코어의 `layout_states`가 데이터 루트의 레이아웃 폴더를 읽는다. 참조도
// 엔진이 준 폴더 경로로 지어지므로, 옮긴 데이터 루트(임시 폴더)에서는 그 절대 경로가 화면 아래 메시지에 선다.

test("다리의 상태가 고친 폴더와 깨진 폴더를 가르고, 설정의 행과 [부탁]의 참조가 그것을 따른다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  // Atelier — 템플릿 하나를 가리키고 디스크에 있다. 레이아웃이 모르는 메모 하나와 점 파일 하나가 곁에 있다.
  const atelier = seedLayout(home, "atelier", {
    root: {
      children: [
        { pattern: "decisions.md", kind: "file", template: "decisions.md" },
        { pattern: "gone.md", kind: "file", template: "gone.md" },
      ],
    },
  });
  writeFileSync(join(atelier, "decisions.md"), "# 결정\n");
  writeFileSync(join(atelier, "메모.md"), "사람이 둔 메모\n");
  writeFileSync(join(atelier, ".DS_Store"), "x");
  // Maison — 셋째 항목에 `kind`가 없다. 엔진은 물러서고 까닭을 준다.
  seedLayout(home, "maison", {
    root: { children: [{ pattern: "a.md", kind: "file" }, { pattern: "b", kind: "folder" }, { pattern: "c.md" }] },
  });
  await installRealBackend(page, sandbox);

  // 다리의 `read_settings`는 앱에만 있어 거절한다 — 여기서 행이 서는 것도 이 페이지가 설정 파일 읽기
  // 게이트 밖이라서다(그것을 따로 재는 것은 L3의 시나리오다).
  await page.goto("/settings/spec-layout");
  const [atelierState, maisonState] = (await askBackend(page, "spec_layout_states", {})) as SpecLayoutState[];
  expect(atelierState).toEqual({
    id: "atelier",
    folder: `${home}/layouts/atelier`,
    edited: true,
    errors: [],
    fallback: null,
    templateCount: 1,
    otherFileCount: 1,
  });
  expect(maisonState.id).toBe("maison");
  expect(maisonState.edited).toBe(true);
  expect(maisonState.fallback).toBe('root.children[2]: `kind` is missing ("file" or "folder")');
  expect(maisonState.templateCount).toBeNull();

  const 행 = (name: string) =>
    page.locator("main li").filter({ has: page.getByText(name, { exact: true }) });
  await expect(행("Atelier")).toContainText(`${home}/layouts/atelier/ 폴더가 내장본을 가리고 있어요`);
  await expect(행("Atelier")).toContainText("템플릿 1개");
  await expect(행("Maison")).toContainText("읽지 못해 내장본으로 보여 주고 있어요");
  await expect(행("Maison")).toContainText(maisonState.fallback!);

  await page.getByRole("button", { name: "Maison 레이아웃을 에이전트에게 부탁", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "참조를 복사했어요" })).toContainText(
    `${home}/layouts/maison/`,
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// spec 레이아웃 티켓 10 — **되돌리기가 다리의 데이터 루트에서 폴더를 진짜로 지우고, 무효화가 다시 부른
// work 목록의 spec 트리가 내장본을 따른다.**
//
// 다리에는 감시자가 없다 — `layouts:changed`가 오지 않는다. 그래서 여기서 work 화면이 내장본으로 돌아온다면
// 그것은 되돌린 쪽이 스스로 연 무효화(`invalidateSpecLayout`) 덕이다. work 목록의 캐시는 30초 동안 신선하므로
// (`worksQuery`의 `staleTime`) 무효화가 없으면 돌아온 화면은 심은 레이아웃의 트리를 그대로 든다.
test("되돌리면 다리가 레이아웃 폴더를 지우고, 무효화가 다시 부른 work 목록의 spec 트리가 내장본을 따른다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  seedWork(home, "첫째", "첫째 작업", "2026-08-03");
  const spec = join(home, "works", "첫째", "spec");
  writeFileSync(join(spec, "overview.md"), "# 개요\n\n첫째 작업의 개요다.\n");
  writeFileSync(join(spec, "plan.md"), "# 계획\n\n계획의 본문이다.\n");
  // 사람이 둔 레이아웃 — `plan.md`가 맨 앞이라 기본 문서다. 템플릿 하나와 레이아웃이 모르는 메모 하나가 곁에 있다.
  const atelier = seedLayout(home, "atelier", {
    root: { children: [{ pattern: "plan.md", kind: "file", icon: "scale", template: "plan.md" }] },
  });
  writeFileSync(join(atelier, "plan.md"), "# 계획 템플릿\n");
  writeFileSync(join(atelier, "메모.md"), "사람이 둔 메모\n");
  await installRealBackend(page, sandbox);

  await page.goto("/works/첫째");
  await expect(page.getByText("계획의 본문이다.")).toBeVisible();

  // 앱 안에서 설정으로 간다 — 새로 읽으면 캐시가 사라져 무효화를 잴 수 없다.
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: "Settings", exact: true }).click();
  await aside.getByRole("button", { name: "spec 레이아웃", exact: true }).click();
  await expect(page).toHaveURL("/settings/spec-layout");
  const 행 = page.locator("main li").filter({ has: page.getByText("Atelier", { exact: true }) });
  await expect(행).toContainText("템플릿 1개");

  await page.getByRole("button", { name: "Atelier 레이아웃 메뉴", exact: true }).click();
  await page.getByRole("menuitem", { name: "기본값으로 되돌리기", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Atelier 레이아웃을 기본값으로 되돌릴까요?" });
  // 수는 엔진이 센 그대로다 — 가리키고 디스크에 있는 템플릿 하나와, 레이아웃이 모르는 메모 하나
  await expect(dialog).toContainText(`${home}/layouts/atelier/ 폴더를 지워요.`);
  await expect(dialog).toContainText("템플릿 1개와 그 밖의 파일 1개가 함께 사라져요.");
  expect(existsSync(atelier)).toBe(true);
  const listed = await callCount(page, "list_works");
  await dialog.getByRole("button", { name: "되돌리기", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: "되돌렸어요" })).toBeVisible();
  expect(existsSync(atelier)).toBe(false);
  expect(existsSync(join(home, "works", "첫째", "spec", "plan.md"))).toBe(true);
  // 행은 다시 읽은 엔진의 상태다
  await expect(행).toContainText("내장본 그대로예요");
  await expect(행).not.toContainText("고침");
  // 감시자 없이도 work 목록이 다시 불렸다 — 되돌린 쪽의 무효화다
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(listed);

  // 돌아간 work 화면은 그 목록의 트리를 따른다 — `overview.md`가 다시 기본 문서다.
  await aside.getByRole("button", { name: "앱으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL(`/works/${encodeURIComponent("첫째")}`);
  await expect(page.getByText("첫째 작업의 개요다.")).toBeVisible();
  await expect(page.getByText("계획의 본문이다.")).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

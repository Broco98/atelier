import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpecLayoutState } from "@/features/spec-layout/types";
import { askBackend, installRealBackend, unknownIpcCalls } from "./harness";
import { expect, seedLayout, test } from "./l4";

// spec 레이아웃 티켓 08 — **설정의 모드 두 행이 엔진의 상태를 그린다.**
//
// L3의 행은 손으로 적은 fixture라 「엔진이 정말 그렇게 판정하는가」를 못 잰다. 이 층만 그것을 답한다:
// `spec_layout_states` → 다리 → 코어의 `layout_states`가 데이터 루트의 레이아웃 폴더를 읽는다. 참조도
// 엔진이 준 폴더 경로로 지어지므로, 옮긴 데이터 루트(임시 폴더)에서는 그 절대 경로가 알림에 선다.

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

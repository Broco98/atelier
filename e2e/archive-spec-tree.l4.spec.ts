import type { ArchivedDocs } from "@/features/archive/types";
import { askBackend, installRealBackend, unknownIpcCalls } from "./harness";
import { expect, seedArchivedWork, seedLayout, test } from "./l4";

// spec 레이아웃 티켓 06 — **아카이브의 문서 트리도 spec 트리를 그린다.**
//
// L3의 트리는 손으로 적은 fixture라 「엔진이 정말 그렇게 가르는가」를 못 잰다. 이 층만 그것을 답한다:
// `list_archived_docs` → 다리 → 코어의 아카이브 쪽 트리 덧붙이기(`with_archived_spec_tree`)가 데이터
// 루트의 레이아웃으로 `spec/` 아래를 가른다.

const SLUG = "치운-일";

// 치운 work과 레이아웃 폴더를 손으로 심는 이유와 모양은 `l4.ts`의 `seedArchivedWork`·`seedLayout`
// 머리말에 있다.

test("다리의 아카이브 문서 답이 모드의 레이아웃으로 spec/ 아래를 가르고, 화면이 그것을 그린다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  seedArchivedWork(home, SLUG, "치운 일", {
    "record.md": "# 기록 — 치운 일\n\n한 줄.\n",
    "spec/overview.md": "# 개요\n\n개요의 본문이다.\n",
    "spec/plan.md": "# 계획\n\n계획의 본문이다.\n",
    "spec/tickets/할일.md": "# 할 일\n",
  });
  // 모드의 레이아웃 폴더 — 내장본이면 `overview.md`가 나침반을 받는다. 이것을 심어야 앱이 이름이
  // 아니라 엔진의 답을 그리는지가 갈린다: 이름으로 알아보던 앱은 여기서도 `overview.md`에 나침반을 준다.
  seedLayout(home, "atelier", {
    root: { children: [{ pattern: "plan.md", kind: "file", icon: "scale", description: "계획" }] },
  });
  await installRealBackend(page, sandbox);

  // 기본 문서는 지금 규칙 그대로 목록의 첫 문서다 — 기록이 있으면 코어가 그것을 맨 앞에 얹는다.
  await page.goto(`/archive/${SLUG}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  const answer = (await askBackend(page, "list_archived_docs", {
    mode: "atelier",
    slug: SLUG,
  })) as ArchivedDocs;
  // 문서 목록은 커널이 준 그대로 곁에 선다 — work 폴더 기준이고 기록이 맨 앞이다.
  expect(answer.docs).toEqual(["record.md", "spec/overview.md", "spec/plan.md", "spec/tickets/할일.md"]);
  // 트리는 `spec/` 아래만, spec 기준 경로로 — 심은 레이아웃의 자리를 받은 `plan.md`가 먼저 선다.
  expect(answer.specTree.layoutId).toBe("atelier");
  expect(answer.specTree.items.map(({ name, path, icon }) => ({ name, path, icon }))).toEqual([
    { name: "plan.md", path: "plan.md", icon: "scale" },
    { name: "overview.md", path: "overview.md", icon: null },
    { name: "tickets", path: "tickets", icon: null },
  ]);

  // 화면이 그 답을 그린다. 아이콘을 받은 행은 확장자 라벨 대신 아이콘이라 이름이 `plan.md` 그대로고,
  // 자리를 못 받은 `overview.md`는 라벨이 붙는다.
  await expect(page.getByRole("button", { name: "plan.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "MD overview.md", exact: true })).toBeVisible();
  // 뿌리의 기록 행과 접히는 `spec/` 행은 지금 그대로다.
  await expect(page.getByRole("button", { name: "MD record.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "spec", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // 고른 문서는 `spec/`가 다시 붙은 경로로 읽힌다 — 코어의 읽기 창구가 work 폴더 기준이다.
  await page.getByRole("button", { name: "plan.md", exact: true }).click();
  await expect(page.getByText("계획의 본문이다.")).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

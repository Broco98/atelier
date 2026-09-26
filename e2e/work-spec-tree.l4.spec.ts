import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkView } from "@/features/works/types";
import {
  askBackend,
  callCount,
  dragRowOnto,
  installRealBackend,
  shownWorkOrder,
  unknownIpcCalls,
  workRow,
} from "./harness";
import { expect, seedLayout, seedWork, test } from "./l4";

// spec 레이아웃 티켓 04 — **앱의 work 응답에 spec 트리가 실리고, 기본 문서가 그것을 따른다.**
//
// L3의 트리는 손으로 적은 fixture라 「엔진이 정말 그렇게 가르는가」를 못 잰다. 이 층만 그것을 답한다:
// `list_works`·`get_work`·`move_work` → 다리 → 코어의 트리 덧붙이기(`with_spec_trees`)가 데이터 루트의
// 레이아웃으로 가른다. 그래서 트리의 모양(이름·아이콘·기본 문서)은 `askBackend`로 답을 그대로 견준다 —
// 행이 받은 아이콘이 무엇인지는 글리프에 이름이 없어 화면으로 못 읽고, `get_work`는 화면이 부르지 않는다.
// 화면으로는 그 답을 따른 **열린 기본 문서**를 본다. 트리의 행을 그리는 일은 L3(`spec-panel-tree.spec.ts`)가 잰다.
//
// work을 손으로 심는 이유와 모양은 `l4.ts`의 `seedWork` 머리말에 있다.

/** spec 문서 한 장을 쓴다 — `seedWork`가 심은 `overview.md`를 덮어쓰는 데도 쓴다. */
function plantDoc(home: string, slug: string, name: string, body: string) {
  const dir = join(home, "works", slug, "spec");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

/** 문서의 본문 한 줄 — 머리말은 문서마다 같아(`# 개요`) 어느 것이 열렸는지 못 가른다. */
const overviewOf = (title: string) => `${title}의 개요다.`;

test("작업 행을 끌어 놓은 뒤에도 그 세계의 work을 열면 기본 문서가 열린다", async ({ page, sandbox }) => {
  const { home } = sandbox;
  const works = [
    { slug: "셋째", title: "셋째 작업", createdAt: "2026-08-01" },
    { slug: "둘째", title: "둘째 작업", createdAt: "2026-08-02" },
    { slug: "첫째", title: "첫째 작업", createdAt: "2026-08-03" },
  ];
  for (const { slug, title, createdAt } of works) {
    seedWork(home, slug, title, createdAt);
    plantDoc(home, slug, "overview.md", `# 개요\n\n${overviewOf(title)}\n`);
  }
  await installRealBackend(page, sandbox);

  await page.goto("/works/첫째");
  await expect(page.getByText(overviewOf("첫째 작업"))).toBeVisible();
  await expect.poll(() => shownWorkOrder(page)).toEqual(["첫째", "둘째", "셋째"]);

  // **옮기기의 답이 목록 캐시를 갈아 끼운다**(`moveWorkOptions`의 3) — 감시자가 없는 이 층에서는 그
  // 답이 곧 화면이다. 그 답에 트리가 없으면 이 세계의 work이 전부 기본 문서를 잃는다.
  const listed = await callCount(page, "list_works");
  await dragRowOnto(page, "셋째", workRow(page, "첫째"), "upper");
  await expect.poll(() => shownWorkOrder(page)).toEqual(["셋째", "첫째", "둘째"]);

  // 보고 있던 work도, 새로 여는 work도 기본 문서로 선다.
  await expect(page.getByText(overviewOf("첫째 작업"))).toBeVisible();
  await workRow(page, "둘째").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/works/${encodeURIComponent("둘째")}`);
  await expect(page.getByText(overviewOf("둘째 작업"))).toBeVisible();

  // 그 문서가 **옮기기의 답에서** 왔다 — 목록을 다시 읽었다면 이 검사는 `list_works`를 잰 것이다.
  expect(await callCount(page, "list_works")).toBe(listed);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("데이터 루트에 레이아웃 폴더를 심고 다시 읽으면 spec 트리와 기본 문서가 그것을 따른다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  seedWork(home, "첫째", "첫째 작업", "2026-08-03");
  plantDoc(home, "첫째", "overview.md", `# 개요\n\n${overviewOf("첫째 작업")}\n`);
  plantDoc(home, "첫째", "plan.md", "# 계획\n\n계획의 본문이다.\n");
  await installRealBackend(page, sandbox);

  const treeOf = async (cmd: string, args: Record<string, unknown>) => {
    const answer = (await askBackend(page, cmd, { mode: "atelier", ...args })) as WorkView | WorkView[];
    const [work] = Array.isArray(answer) ? answer : [answer];
    return {
      defaultDoc: work.specTree.defaultDoc,
      top: work.specTree.items.map(({ name, icon }) => ({ name, icon })),
    };
  };

  // 레이아웃 폴더가 없으면 내장본이다 — `overview.md`가 나침반을 받고 기본 문서다.
  await page.goto("/works/첫째");
  await expect(page.getByText(overviewOf("첫째 작업"))).toBeVisible();
  const builtin = {
    defaultDoc: "overview.md",
    top: [
      { name: "overview.md", icon: "compass" },
      { name: "plan.md", icon: null },
    ],
  };
  expect(await treeOf("list_works", {})).toEqual(builtin);

  // 사람이 손으로 두는 것과 같다 — 다리에는 감시자가 없으니 다시 읽어야 따라온다.
  seedLayout(home, "atelier", {
    root: { children: [{ pattern: "plan.md", kind: "file", icon: "scale", description: "계획" }] },
  });
  await page.reload();

  await expect(page.getByText("계획의 본문이다.")).toBeVisible();
  await expect(page.getByText(overviewOf("첫째 작업"))).toHaveCount(0);

  // 셋 다 **같은 입구**를 탄다 — 하나라도 옛 모양이면 그 명령의 답만 트리가 없거나 내장본이다.
  const planted = {
    defaultDoc: "plan.md",
    top: [
      { name: "plan.md", icon: "scale" },
      { name: "overview.md", icon: null },
    ],
  };
  expect(await treeOf("list_works", {})).toEqual(planted);
  expect(await treeOf("get_work", { slug: "첫째" })).toEqual(planted);
  expect(await treeOf("move_work", { slug: "첫째", pinned: false, before: null })).toEqual(planted);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

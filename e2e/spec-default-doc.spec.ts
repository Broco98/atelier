import { expect, test } from "./evidence";
import { ROOMS, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

const [pinnedWork, plainWork] = WORKS;
const [, room] = ROOMS;

// spec 레이아웃 티켓 04 — **주소에 문서가 없으면 work 화면은 spec 트리의 기본 문서를 연다**(결정 14).
// 이 두 fixture(pinned-work는 `overview.md`가 있고 reading-room은 `개요.md` 하나뿐)는 옛 이름
// 규칙(`overview.md`, 없으면 첫 파일)으로도 같은 문서가 나온다 — 여기서 재는 것은 두 세계에서 화면이
// `specTree.defaultDoc`을 열고 그것 하나만 읽는다는 것까지다. 트리 규칙과 이름 규칙을 가르는 것은
// L2(`WorksPage.test.tsx` 「기본 문서가 overview.md가 아닌 트리를 넣으면 그 문서가 열린다」)와
// L4(`work-spec-tree.l4.spec.ts`의 레이아웃 폴더 심기)다. 트리는 fixture가 손으로 적은 것이고
// (`fixtures.ts`의 `specFile` 머리말), 엔진이 그것을 정말 그렇게 가르는지는 L4가 잰다.
//
// 열린 문서는 **읽기가 나간 경로**로 본다 — 본문 한 줄은 폴백 답(`SPEC_FALLBACK_BODY`)과 같을 수
// 있어 「그 문서를 읽었다」를 못 가른다.
test("work 화면이 spec 트리의 기본 문서로 선다", async ({ page }) => {
  await installFixtureBackend(page);

  for (const [path, work] of [
    [`/works/${pinnedWork.slug}`, pinnedWork],
    [`/maison/rooms/${room.slug}`, room],
  ] as const) {
    await page.goto(path);
    const defaultDoc = work.specTree.defaultDoc;
    expect(defaultDoc, `${work.slug}: fixture 트리에 기본 문서가 없다`).not.toBeNull();
    await expect
      .poll(async () => (await ipcCallArgs(page, "read_spec_file", "path")).map(({ args }) => args.path))
      .toEqual([defaultDoc]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  }
});

// 빈 spec 폴더의 work — 트리가 비고 기본 문서가 없다. 아무것도 읽지 않고 빈 화면이 선다.
test("빈 spec 폴더의 work은 문서를 읽지 않고 빈 화면으로 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await expect(page.getByText("아직 spec이 없어요")).toBeVisible();
  expect(await ipcCallArgs(page, "read_spec_file", "path")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

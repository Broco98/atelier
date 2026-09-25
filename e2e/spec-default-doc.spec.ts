import { expect, test } from "./evidence";
import { ROOMS, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

const [pinnedWork, plainWork] = WORKS;
const [, room] = ROOMS;

// spec 레이아웃 티켓 04 — **주소에 문서가 없으면 work 화면은 spec 트리의 기본 문서를 연다**(결정 14).
// 화면은 파일 목록에서 이름으로 고르지 않는다. 트리는 fixture가 손으로 적은 것이고(`fixtures.ts`의
// `specFile` 머리말), 엔진이 그것을 정말 그렇게 가르는지는 L4(`work-spec-tree.l4.spec.ts`)가 잰다.
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

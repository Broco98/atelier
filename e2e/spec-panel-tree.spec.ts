import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

const [pinnedWork, , multiWork] = WORKS;

/**
 * work를 옮길 때 나가도 되는 명령 — **어느 것도 spec 트리를 답하지 않는다.** 여는 문서의 본문을
 * 읽고(`read_spec_file`), 최근에 연 work을 적는다(`touch_recent_work`). 이벤트 구독(`plugin:`)은
 * 화면이 다시 설 때마다 오가는 배관이라 세지 않는다.
 *
 * 이 표에 무언가를 더해야 한다면, 그것이 트리를 따로 묻는 명령이 아닌지 먼저 본다. 트리는 work
 * 응답(`list_works`·`get_work`·`move_work`)에만 실린다(구현 스펙 3절).
 */
const SWITCH_COMMANDS = ["read_spec_file", "touch_recent_work"];

// spec 레이아웃 티켓 05 — **캐시의 주인은 work 목록 자신이다**(구현 스펙 3절). spec 트리는 work와
// 함께 목록의 답으로 도착하므로, work를 옮겨도 트리를 묻는 호출이 따로 나가지 않는다. 그래서 옮긴
// 순간 그 work의 트리가 서고, 남의 트리가 한 프레임이라도 비칠 틈이 없다.
//
// **이 층에서만 보인다.** 트리를 그리는 규칙은 L2가 손으로 적은 트리로 재지만, 「화면이 무엇을
// 묻는가」는 진짜 IPC 기록이 있어야 갈린다. 트리는 fixture가 손으로 적은 것이다(`fixtures.ts`의
// `specFile` 머리말).
test("work를 옮겨 다니는 동안 spec 트리를 따로 묻지 않는다 — 트리는 work 목록의 답에서 온다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  // 나침반을 받은 행은 확장자 라벨이 없어 이름이 파일 이름 그대로다
  await expect(page.getByRole("button", { name: "overview.md", exact: true })).toBeVisible();
  const settled = (await readIpcRecord(page))?.calls.length ?? 0;

  const sidebar = page.locator("aside");
  await sidebar.getByRole("button", { name: multiWork.title, exact: true }).click();
  await expect(page.getByRole("button", { name: "MD 넓은.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "overview.md", exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: pinnedWork.title, exact: true }).click();
  await expect(page.getByRole("button", { name: "overview.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "MD 넓은.md", exact: true })).toHaveCount(0);

  const sent = ((await readIpcRecord(page))?.calls ?? [])
    .slice(settled)
    .map((call) => call.split(" ")[0])
    .filter((command) => !command.startsWith("plugin:"));
  // 옮겼다는 증거 — 두 work의 기본 문서가 모두 읽혔다. 이것이 없으면 아래 거름이 빈 기록에서 초록이다.
  expect(sent).toContain("read_spec_file");
  expect(sent.filter((command) => !SWITCH_COMMANDS.includes(command))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

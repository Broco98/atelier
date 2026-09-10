import { expect, test, type Page } from "./evidence";
import { FIXTURE_BY_MODE, ROOMS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// **이 층의 백엔드는 픽스처 표다.** 실물은 `mode`를 필수로 받아 빠뜨린 호출을 거절하지만
// (#187 — 다리 계약 테스트가 L1에서 잰다) 그 거절은 여기까지 안 온다: L3에서 답하는 것은
// 하네스이고, 하네스가 이름만 보고 답하면 `mode`가 없거나 모르는 값인 호출도 조용히 Atelier
// 데이터를 받는다. 그러면 「Maison 화면인데 저쪽 것이 떴다」가 이 층에서 통째로 안 걸린다.
//
// 그래서 하네스는 모드로 갈리는 커맨드를 **못 찾으면 문다**(`harness.ts`의 `byMode` 갈래).
// **그 물림을 여기서 실제로 일으킨다** — 표의 배치가 맞는지는 `src/tauri-commands.test.ts`가
// 소스에서 파생해 보지만, 그것은 배치일 뿐이라 하네스의 갈래가 통째로 없어져도 초록이다.
//
// 화면을 거치지 않고 **하네스에 직접 말을 건다.** 앱을 통해서는 이 호출을 만들 수 없다 —
// 래퍼 넷이 `mode`를 필수 위치 인자로 받아(`features/*/api.ts`) 빠뜨린 코드가 `tsc`를 못
// 지나기 때문이다. 그 두 그물은 같은 것을 다른 층에서 든다: L0는 **쓸 수 없게** 하고,
// 여기는 **그래도 들어온 호출이 답을 못 받는 것**을 든다.
const [, room] = ROOMS;
const [ROOM_DOC] = room.specFiles;

/**
 * 모르는 세계. **`Mode`에 없는 값**이면 무엇이든 좋고, 글자가 뒤집힌 오타로 둔 것은 실제로
 * 그 모양으로 들어오기 때문이다 — 와이어에서 온 `mode`는 아무 문자열일 수 있다(`harness.ts`).
 */
const UNKNOWN_MODE = "masion";

/**
 * 브라우저 안에서 IPC를 한 번 부르고 **답이든 거절이든 그대로 들고 나온다.** 거절을
 * `page.evaluate` 밖으로 던지게 두면 테스트가 그 자리에서 죽어, 「물렸다」와 「엉뚱한 데서
 * 터졌다」가 갈리지 않는다.
 */
async function ask(page: Page, cmd: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ cmd, args }: { cmd: string; args: Record<string, unknown> }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { answer: await internals.invoke(cmd, args), error: null as string | null };
      } catch (error) {
        return { answer: null as unknown, error: String(error) };
      }
    },
    { cmd, args },
  );
}

test("모드로 갈리는 커맨드는 mode가 없거나 모르는 값이면 답을 못 받는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${room.slug}`);
  // 화면이 다 설 때까지 기다린다 — 부팅 중에 아직 날아다니는 호출이 있으면 아래 기준선이
  // 그것을 이 테스트가 만든 물림으로 잘못 센다.
  await expect(page.getByRole("button", { name: `MD ${ROOM_DOC}`, exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page), "기준선: 화면이 뜨는 동안은 아무것도 안 물렸다").toEqual([]);

  // **대조군이 먼저다.** 아래가 전부 거절이므로, 하네스가 그냥 다 던지고 있어도 이 파일은
  // 초록이 된다 — 그때 이 검사는 아무것도 안 재는 것이다. 아는 세계로 물으면 그 세계의 답이
  // 온다는 것을 여기서 못 박는다.
  expect(await ask(page, "list_works", { mode: "maison" })).toEqual({ answer: ROOMS, error: null });

  // **표를 그대로 훑는다** — 줄이 늘면 이 검사가 저절로 그것도 본다. 손으로 적은 목록은
  // 새로 옮겨 온 커맨드를 조용히 빼놓는다(그 실패가 이 파일이 막으려는 것과 같은 종류다).
  //
  // 「저절로」가 성립하는 것은 **표가 전수라는 것을 다른 층이 잠가서다**:
  // `src/tauri-commands.test.ts`가 `commands.rs`에서 모드를 받는 명령을 뽑아 이 표에 다
  // 있는지 본다. 그 단언이 없으면 새 명령이 어느 표에도 안 적힌 채 초록이 되고, 여기 음성
  // 케이스는 그것을 한 번도 안 재고 지나간다.
  const commands = Object.keys(FIXTURE_BY_MODE);
  expect(commands.length, "모드로 갈리는 표가 비었다 — 이 검사가 읽는 표가 맞나").toBeGreaterThan(0);
  for (const cmd of commands) {
    expect((await ask(page, cmd, {})).error, `${cmd}: mode가 없는데 답이 왔다`).toContain(cmd);
    expect(
      (await ask(page, cmd, { mode: UNKNOWN_MODE })).error,
      `${cmd}: 모르는 세계인데 답이 왔다`,
    ).toContain(cmd);
  }

  // 그리고 **그 물림이 전부 기록에 남는다.** 거절만 보면 「하네스가 물었다」와 「앱 어딘가가
  // 던졌다」가 갈리지 않는다 — 화이트리스트 탐지기에 남는 것이 하네스가 문 자리의 증거다.
  // 인자가 없는 호출은 이름만 적힌다(`harness.ts`의 `detail`).
  expect(await unknownIpcCalls(page)).toEqual(
    commands.flatMap((cmd) => [cmd, `${cmd} {"mode":"${UNKNOWN_MODE}"}`]),
  );
});

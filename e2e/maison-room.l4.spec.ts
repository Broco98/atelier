import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "./evidence";
import { installRealBackend, unknownIpcCalls } from "./harness";
import { expect, test } from "./l4";

// 판 01이 관통이라고 부르는 것. **두 세계가 한 홈 안에서 갈리는 것을 진짜 파일로** 본다 —
// 심은 Room은 Maison 목록에만 서고, 아카이빙하면 `maison/archive/`로 옮겨진다.
//
// **다리 계약 테스트(`crates/atelier-test-bridge/tests/mode_contract.rs`)와 무엇이 다른가.**
// 저쪽은 커맨드를 직접 부르므로 「명령이 어느 루트를 읽는가」까지만 든다. 여기서 더 드는 것은
// 그 사이에 있는 것 전부다: 프런트 래퍼가 `mode`를 실었는가 · 화면이 자기 세계의 목록을
// 물었는가 · 세그먼트가 데려다 놓은 곳에서 목록이 정말 갈렸는가 · ⋯ 메뉴의 아카이빙이
// **그 세계의** 아카이브로 쓰는가. 한 자리가 `mode`를 빠뜨려도 L0·L2는 그대로 초록이고,
// L3는 하네스가 물어 주지만 그 하네스가 곧 백엔드 노릇을 하는 층이라 「진짜 코어가 그렇게
// 읽는다」는 여기서만 나온다.

/** 심을 Room. slug는 **디렉터리 이름이 원천이다** — work.json에 적는 필드가 아니다. */
const ROOM = { slug: "reading-room", title: "읽는 방" };
/**
 * 같은 홈에 나란히 세우는 Atelier work. **반대쪽 증거가 없으면 그물이 반쪽이다** —
 * Maison 쪽만 재면 목록 호출이 통째로 죽어 양쪽이 다 비어도 「Room이 Atelier에 없다」가
 * 참이 된다(다리 계약 테스트의 `maison_검색은_프로젝트_등록부를_안_걷는다`와 같은 이유).
 */
const WORK = { slug: "spec-search", title: "spec 검색" };

/** Room이 실제로 가진 문서. 목록과 읽기가 **다른 명령**이라 둘을 함께 재야 한다. */
const ROOM_DOC = "overview.md";
/**
 * 그 문서의 문단 한 줄. 머리말을 안 쓰는 것은 Room의 머리말이 제목과 같은 글자라
 * 「본문이 섰다」와 「제목이 섰다」가 안 갈리기 때문이다(`maison-rooms.spec.ts`와 같은 규칙).
 */
const ROOM_BODY = "이 방의 문서는 Maison 루트에서 온다.";

/**
 * 세그먼트의 한 칸. 그룹으로 좁히는 것은 `Atelier`·`Maison`이 다른 자리에도 적힐 수 있어서다
 * (`mode-switch.spec.ts`의 같은 헬퍼).
 */
const modeButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });

test("심은 Room은 Maison 목록에만 서고, 아카이빙하면 Maison 아카이브로 간다", async ({
  page,
  sandbox,
}) => {
  const { home } = sandbox;
  plant(home, join("maison", "rooms", ROOM.slug), ROOM.title);
  plant(home, join("works", WORK.slug), WORK.title);
  plantDoc(home, join("maison", "rooms", ROOM.slug), ROOM_DOC, `# ${ROOM.title}\n\n${ROOM_BODY}\n`);

  await installRealBackend(page, sandbox);

  // **무선택 주소로 들어간다.** 정규화가 고르는 slug가 곧 「Maison 목록이 진짜 왔다」는
  // 증거다 — 목록이 비었으면 여기 머물러 있고, 저쪽 세계의 목록이 왔으면 `spec-search`로 간다.
  await page.goto("/maison/rooms");
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/maison/rooms/${ROOM.slug}`);

  const aside = page.locator("aside");
  // 머리의 개수까지 센다 — 줄 하나만 보면 저쪽 것이 함께 서 있어도 초록이다.
  await expect(aside.getByRole("button", { name: "Rooms 1", exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: ROOM.title, exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: WORK.title, exact: true })).toHaveCount(0);

  // 그리고 **읽기도** 이 세계로 나간다. 목록이 맞아도 읽기가 Atelier로 나가면 트리는 그대로인
  // 채 본문만 빈다 — 코어에는 Maison 문서를 못 찾았을 때의 폴백이 없다.
  //
  // **이름 앞에 `MD `가 안 붙는다.** L3의 형제 검사(`maison-rooms.spec.ts`)는 그 접두사로
  // 집는데, 거기 픽스처의 문서는 `개요.md`이고 여기 심은 것은 `overview.md`다 —
  // 트리는 그 한 이름만 확장자 라벨 대신 **진입점 글리프**로 그린다(`SpecTree`의 `FileGlyph`).
  // 접두사를 되살리면 이 줄은 영영 안 맞는다.
  await expect(page.getByRole("button", { name: ROOM_DOC, exact: true })).toBeVisible();
  await expect(page.getByText(ROOM_BODY)).toBeVisible();

  // 세그먼트 한 번에 목록이 통째로 저쪽 세계가 된다. 도착지가 `/works/<slug>`인 것 자체가
  // Atelier 목록이 자기 루트를 읽었다는 뜻이다(정규화가 그 목록에서 고른다).
  await modeButton(page, "Atelier").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/works/${WORK.slug}`);
  await expect(aside.getByRole("button", { name: "작업 1", exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: WORK.title, exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: ROOM.title, exact: true })).toHaveCount(0);

  // 돌아오는 길은 **기억된 주소**다(`modeSwitchTarget`) — 방금 보던 Room으로 곧장 선다.
  await modeButton(page, "Maison").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/maison/rooms/${ROOM.slug}`);

  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  await page.getByRole("button", { name: "아카이빙", exact: true }).click();
  // 확인 창은 **앱의 것**이다(OS 시트가 아니다) — 제목이 그 Room을 이름하는지까지 본다.
  // 이 창이 저쪽 세계의 문구를 띄우는지는 `work-menu-copy` 쪽이 따로 재므로 여기서는 안 센다.
  const dialog = page.getByRole("alertdialog", { name: `'${ROOM.title}' 아카이빙` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "아카이빙", exact: true }).click();

  // **파일을 먼저 보고 그 다음 화면을 본다**(`projects-create.l4.spec.ts`와 같은 순서).
  // 파일이 안 옮겨졌으면 쓰는 다리가 끊긴 것이고, 옮겨졌는데 목록이 그대로면 읽는 다리가
  // 끊긴 것이다 — 고칠 곳이 다르다.
  //
  // `record.md`를 기다리는 것은 그것이 **이동이 끝났다는 신호**여서다: 코어는 기록을 아직
  // 작업 루트에 있는 폴더에 쓰고 그 폴더를 통째로 옮긴다(`works.rs`의 「순서가 계약이다」).
  // 목적지에서 이 파일이 보이면 rename이 이미 성립한 것이다.
  const archived = join(home, "maison", "archive", ROOM.slug);
  await expect.poll(() => existsSync(join(archived, "record.md"))).toBe(true);
  expect(existsSync(join(home, "maison", "rooms", ROOM.slug))).toBe(false);
  // 저쪽 세계의 아카이브는 안 건드린다. 이 줄이 없으면 **두 곳 다에 쓰는** 변형이 안 잡힌다.
  expect(existsSync(join(home, "archive", ROOM.slug))).toBe(false);
  // 그리고 Atelier work은 그대로다 — 치우는 명령이 루트를 틀리게 골랐다면 여기서 사라진다.
  expect(existsSync(join(home, "works", WORK.slug))).toBe(true);

  await expect(aside.getByRole("button", { name: "Rooms 0", exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: ROOM.title, exact: true })).toHaveCount(0);

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  //
  // **이것을 「모든 호출이 제대로 답해졌다」로 읽지 마라.** L4에서 다리가 거절한 호출은
  // (`read_settings`처럼 앱 프로세스에만 있는 것) 다리 갈래로 갔다가 던진 것이라 이 기록에
  // 안 남는다. 여기서 드는 것은 「하네스가 답할 줄 모르는 커맨드가 나갔나」 하나다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/**
 * work.json 한 장을 **손으로 심는다.** 다리에도 앱에도 work를 만드는 명령이 없다 — Room을
 * 만드는 길은 MCP뿐이라, 다리 계약 테스트가 쓰는 것과 같은 준비 방식이다.
 *
 * **키 이름은 camelCase다**(`createdAt`). snake_case로 적으면 코어가 `InvalidFile`로 떨어지고
 * 목록에서 그 항목이 조용히 빠져 — 화면에서는 「목록이 비었다」로만 보여 원인이 안 잡힌다.
 * `slug`는 **적지 않는다**: 디렉터리 이름이 원천이고 `FileWork`에 그 필드가 없어, 적으면
 * `extra`로 흘러들어가 응답에 이물이 섞인다.
 */
function plant(home: string, relative: string, title: string): void {
  const dir = join(home, relative);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "work.json"),
    JSON.stringify({
      title,
      // `active`여야 상주 목록에 선다 — `draft`는 접힌 초안 구획으로 간다.
      status: "active",
      createdAt: "2026-09-08T00:00:00Z",
      // **프로젝트 0개다.** 워크트리가 없어야 아카이빙이 git을 안 탄다(임시 홈에는 저장소가
      // 없다). Room에는 어차피 프로젝트가 없고(결정 17), Atelier 쪽도 여기서 재는 것은
      // 「어느 루트인가」뿐이라 붙일 이유가 없다.
      projects: [],
    }),
  );
}

/** spec 문서 한 장. 폴더 이름(`spec/`)은 코어가 정한다 — 여기서 고를 것이 없다. */
function plantDoc(home: string, relative: string, name: string, body: string): void {
  const dir = join(home, relative, "spec");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

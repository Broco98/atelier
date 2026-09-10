import { expect, test } from "./evidence";
import { ROOMS, ROOM_SPEC_FILE_BODIES, SPEC_FALLBACK_BODY } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 목록의 첫 줄은 **초안 Room**이다(픽스처의 `ROOMS`) — 정규화가 그것을 건너뛰는지를 아래
// 둘째 검사가 본다. 여기서 여는 것은 문서를 가진 둘째다.
const [, room] = ROOMS;
const [ROOM_DOC] = room.specFiles;

/**
 * 픽스처 마크다운의 **문단** 한 줄. 머리말은 안 쓴다 — Room의 머리말(`# 읽는 방`)이 제목과
 * 같은 글자라, 그것으로 찾으면 「본문이 섰다」와 「제목이 섰다」가 갈리지 않는다.
 */
const paragraphOf = (markdown: string) => markdown.split("\n\n")[1].trim();

const ROOM_BODY = paragraphOf(ROOM_SPEC_FILE_BODIES[ROOM_DOC]);
// Atelier가 경로별 답이 없을 때 내는 한 줄. **이 글자가 화면에 있으면 Maison 화면이 Atelier
// 문서를 읽어 온 것이다** — 프런트가 한 자리에서 **저쪽 세계의 값**을 실으면 그것은 어디서도
// 오류가 아니다(#187이 닫은 것은 빠뜨린 호출이지 틀린 값이 아니다).
const ATELIER_BODY = paragraphOf(SPEC_FALLBACK_BODY);

// `/maison/...`이 **브라우저에서** 산다.
//
// **이 층에서만 보인다.** 라우터 테스트(`src/router.test.ts`)는 커밋된 `routeTree.gen.ts`를
// 그대로 import해 메모리 히스토리에서 도는데, 그 파일은 **vite가 생성하는 것**이다
// (`vite.config.ts`의 `tanstackRouter`) — 생성기가 안 돌거나 플러그인 순서가 어긋나면
// 커밋된 표만 맞고 실제 번들에는 이 주소가 없다. 그때 L0도 L2도 초록인 채 앱만 빈 화면이
// 된다. 여기서는 dev 서버가 실제로 만든 번들을 연다.
//
// 사이드바는 이제 이 세계의 목록(`Rooms`)을 든다(#183). **여기서는 그것을 안 잰다** — 이
// 파일이 보는 것은 「Maison 주소가 번들에 실려 그 Room의 문서가 선다」 하나이고, 세그먼트로
// 건너가 목록이 갈리는 것은 자기 시나리오를 가진 `mode-switch.spec.ts`의 몫이다.
test("`/maison/rooms/<slug>`로 가면 그 Room의 문서가 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${room.slug}`);

  // 트리에 선 것이 **그 Room 자신의 문서 목록**이다 — `list_works`가 Maison으로 안 나갔다면
  // 이 slug는 Atelier 목록에 없어서 트리에 아무것도 안 선다.
  await expect(page.getByRole("button", { name: `MD ${ROOM_DOC}`, exact: true })).toBeVisible();

  // 그리고 본문이 **그 문서의 것**이다. 위 트리만으로는 부족하다: 목록이 맞아도 읽기가
  // Atelier로 나가면 트리는 그대로인 채 본문만 저쪽 것이 된다(목록과 읽기가 다른 명령이다).
  await expect(page.getByText(ROOM_BODY)).toBeVisible();
  // 두 세계의 답이 실제로 갈렸다는 반대쪽 증거. 이 줄이 없으면 픽스처가 두 세계에 같은 것을
  // 답하도록 퇴화해도 위 두 줄이 그대로 초록이다.
  await expect(page.getByText(ATELIER_BODY)).toHaveCount(0);

  // **프로젝트를 읽지도 않는다**(US 29). 이 화면에서 `list_projects`를 부르는 자리가 셋인데
  // (본문의 빈 화면 갈래 · 작업 패널의 base · 헤더 ⓘ) 셋 다 조회를 Atelier에서만 켠다.
  //
  // **호출 기록으로만 증명된다.** 픽스처의 `FIXTURE_COMMANDS`는 이 명령에 **이름만 보고**
  // 답하므로(모드로 갈리는 표가 아니다) 호출이 나가도 화면은 멀쩡하고 `unknownIpcCalls`도
  // 비어 있다 — 한 자리가 `mode`를 빠뜨려 저 세계의 등록부를 읽어도 아무것도 안 빨개진다.
  //
  // **`startsWith`다 — 완전 일치가 아니다.** 하네스가 기록하는 값은 이름이 아니라
  // `` `${cmd}${detail}` ``이라(harness.ts), 이 명령에 인자가 붙는 날에도 이 줄이 그대로
  // 잡도록 앞머리로 본다.
  //
  // 한때 여기에 **「#187이 이 줄을 죽인다」**고 적혀 있었다 — 래퍼가 `mode`를 싣기 시작하면
  // 기록이 `list_projects {…}`가 되어 이름만 세는 검사가 영영 초록이 된다는 경고였다. 그 판이
  // 왔고, 이 명령은 **모드를 안 받는 채로 남았다**: Maison에는 프로젝트 등록부가 없어 물을
  // 세계가 없다(`commands.rs`의 `shared_projects_root`). 그래서 기록은 여전히 이름뿐이고
  // 이 줄은 살아 있다. 인자가 붙는 날에도 위 `startsWith`가 그대로 든다.
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("list_projects"))).toEqual([]);

  // `mode`를 빠뜨린 호출은 하네스가 문다(harness.ts의 `byMode`) — 그 신호가 여기 모인다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 무선택 주소의 정규화도 Atelier와 **같은 몸통**을 탄다(`routes/-list-slug.ts`). 메모리
// 히스토리에서 이미 재지만, 그쪽은 캐시를 손으로 심는다 — 진짜 `queryClient`가 IPC로
// Maison 목록을 받아 와 그것으로 고르는 길은 여기서만 돈다.
test("`/maison/rooms`는 초안을 건너뛴 첫 Room으로 정규화된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/maison/rooms");

  // 리다이렉트는 번들이 뜬 **뒤** 일어나므로 `goto`가 돌아온 시점에는 아직 목록 주소다.
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/maison/rooms/${room.slug}`);
  await expect(page.getByText(ROOM_BODY)).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 정보 탭에 **프로젝트 자리가 통째로 없다**(US 27·30). 마크업 seam(`WorkInfo.test.tsx`)은 이
// 조각에 `mode`를 손으로 넘겨 그리므로, 화면에서 그 값이 실제로 저 안까지 내려가는지는 이
// 층에서만 보인다 — `WorksPage` → `WorkPanel` → `WorkInfo` 세 층 중 하나만 빠뜨려도 앞의
// 두 층은 그대로 초록이다(그 셋에 `mode` prop이 생긴 것이 이 판이다).
//
// 참조 뿌리를 **글자로** 함께 재는 자리이기도 하다. `refs.ts`가 세계별 앞머리를 `mode.ts`의
// 표에서 꺼내 오는데, 그 인자를 한 자리에서 빠뜨리면 화면은 멀쩡한 채 복사되는 경로만 남의
// 세계를 가리킨다 — 붙여 넣기 전에는 아무도 모른다.
test("Room의 정보 탭에는 프로젝트 자리가 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${room.slug}`);

  await page.getByRole("button", { name: "info", exact: true }).click();

  // **탭이 정말 섰다**는 앵커. 없으면 아래 「없다」 넷은 탭이 안 열려서도 전부 초록이다.
  await expect(
    page.getByRole("button", { name: `slug ${room.slug}`, exact: true }),
  ).toBeVisible();

  // 폴더 줄이 **Room 뿌리**를 그대로 적는다(결정 7). 여기가 `refs.ts`의 모드 인자가 화면에
  // 드러나는 유일한 자리다 — 빠뜨리면 `~/.atelier/works/…`가 뜬다.
  await expect(
    page.getByRole("button", {
      // 이름표도 이 세계의 말이다 — 저 세계에서는 `작업 폴더`다(`itemNameOf`).
      name: `Room 폴더 ~/.atelier/maison/rooms/${room.slug}/`,
      exact: true,
    }),
  ).toBeVisible();
  // 그 반대쪽. 화면 어디에도 저쪽 세계의 뿌리가 없어야 한다 — spec 행은 그 폴더 기준으로
  // 접혀 있어 위 한 줄만으로는 그 행이 어느 뿌리로 지어졌는지 안 보인다.
  await expect(page.getByText("~/.atelier/works/")).toHaveCount(0);

  // 프로젝트 구획이 **없다** — 「아직 프로젝트가 없어요」라는 빈 구획도 아니다(US 27).
  // 브랜치 행도 같은 이유로 없다: Room에는 그 개념이 없는데 코어는 이름을 준 채로 만들어진
  // Room에 브랜치를 실어 보낼 수 있다.
  await expect(page.getByText("프로젝트", { exact: true })).toHaveCount(0);
  await expect(page.getByText("아직 프로젝트가 없어요")).toHaveCount(0);
  await expect(page.getByText("브랜치", { exact: true })).toHaveCount(0);

  // 탭을 연 뒤에도 **프로젝트를 읽지 않는다.** 위 첫 검사는 마운트 시점만 보는데, 정보 탭의
  // base 조회는 그 탭을 실제로 여는 사람 쪽에서 나갈 수도 있는 자리다.
  // 인자가 붙어도 문다 — 근거는 위 검사의 주석과 같다.
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("list_projects"))).toEqual([]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test } from "./evidence";
import { ROOMS, ROOM_SPEC_FILE_BODIES, SPEC_FALLBACK_BODY } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

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
// 문서를 읽어 온 것이다** — 백엔드에서 `mode`가 아직 선택 인자라(#187) 프런트가 한 자리에서
// 빠뜨려도 오류가 아니라 조용히 저쪽 데이터가 온다.
const ATELIER_BODY = paragraphOf(SPEC_FALLBACK_BODY);

// `/maison/...`이 **브라우저에서** 산다.
//
// **이 층에서만 보인다.** 라우터 테스트(`src/router.test.ts`)는 커밋된 `routeTree.gen.ts`를
// 그대로 import해 메모리 히스토리에서 도는데, 그 파일은 **vite가 생성하는 것**이다
// (`vite.config.ts`의 `tanstackRouter`) — 생성기가 안 돌거나 플러그인 순서가 어긋나면
// 커밋된 표만 맞고 실제 번들에는 이 주소가 없다. 그때 L0도 L2도 초록인 채 앱만 빈 화면이
// 된다. 여기서는 dev 서버가 실제로 만든 번들을 연다.
//
// 사이드바는 아직 Atelier 목록을 든다(`SidebarWorkList`의 `useWorks("atelier")`) — 이 티켓의
// 범위가 아니라 여기서 아무것도 안 잰다. 다음 티켓이 세그먼트와 모드별 목록을 얹는다.
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

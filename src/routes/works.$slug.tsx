import { createFileRoute } from "@tanstack/react-router";
import { worksQuery } from "@/features/works/hooks";
import WorksView from "./-works-view";
import { codeOf, opensWork, threadOf, validateWorkSearch, viewTab } from "./-work-search";

export const Route = createFileRoute("/works/$slug")({
  component: WorkRoute,
  // 공용 `validateFileSearch`가 아니라 Works 전용이다 — `tab`은 아카이브와 나누지 않는다(결정 14).
  validateSearch: validateWorkSearch,
  // **목록을 받아 둔 뒤에 선다**(restart 02a-15c). 앱을 이 주소에서 켜면 목록이 아직 없어, 화면이 먼저 서면 고른 작업공간이 없는 빈 화면이
  // 그려지고 앱 셸의 작업공간 도구 기둥(레일 · spec 패널)이 접힌 채 그려졌다가 목록이 오면 0에서 자랐다 — 본문 폭이 움직여 붙은 셸이
  // `pty_resize`를 거듭 받았다. 기다리면 화면과 기둥이 한 커밋에 선다(`WorkTools`). 목록이 이미 있으면(앱이 도는 동안의 이동) 곧바로
  // 돌려준다 — 방금 만든 작업공간을 목록이 아직 몰라도 다시 읽지 않는다(그 어긋남은 화면이 맡는다 — `-works-view`). 못 읽으면 기다리지 않고
  // 선다 — 무선택 주소의 정규화(`pickWorkSlug`)와 같다.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(worksQuery()).catch(() => undefined);
  },
});

function WorkRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  // 모르는 값을 눕히는 자리는 `viewTab`·`codeOf`·`threadOf` 셋뿐이다 — 검증기가 주소를 청소하지 않는다. 옛 `split`은 읽지 않는다(restart
  // 02a-13 — 분할이 걷혔다).
  const tab = viewTab(search);
  return (
    <WorksView
      slug={slug}
      file={search.file ?? null}
      tab={tab}
      // 파일 탭은 본문(`tab=code`)에 선다(git-integration S12). 그 밖의 `code`는 뜻이 없다.
      code={tab === "code" ? codeOf(search) : null}
      // 채팅 탭도 같다(restart 02a-4) — 본문(`tab=chat`)에 선다.
      thread={tab === "chat" ? threadOf(search) : null}
      // 탭도 채팅도 적지 않은 주소 — 작업공간을 처음 여는 규칙이 탭을 세운다. `tab=chat`만 적은 주소는 새 채팅 탭이다(restart 02a-8).
      opening={opensWork(search)}
    />
  );
}

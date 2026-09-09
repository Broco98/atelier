import { createFileRoute, redirect } from "@tanstack/react-router";
import { pickWorkSlug } from "./-list-slug";
import WorksView from "./-works-view";

// 항목이 지정되지 않은 주소는 실제로 보여줄 작업까지 고쳐 쓴다. 예전처럼 목록 첫 항목을
// 조용히 골라 띄우면 주소와 화면이 어긋나, 주소를 복사해 줘도 상대가 다른 걸 본다.
// 어느 항목으로 고쳐 쓰는지는 두 세계가 같은 규칙이라 `-list-slug.ts`가 든다.
//
// beforeLoad에서 던진 redirect는 라우터가 사용자 옵션과 무관하게 항상 REPLACE로 커밋하므로
// 히스토리가 늘지 않는다 — 탭을 한 번 눌렀는데 되돌리는 데 뒤로가기를 두 번 눌러야 하는
// 일이 없다는 뜻이다. 이 성질은 라이브러리 내부 규칙이라 router.test.ts가 고정한다.
export const Route = createFileRoute("/works/")({
  beforeLoad: async ({ context }) => {
    const slug = await pickWorkSlug("atelier", context.queryClient);
    if (slug) throw redirect({ to: "/works/$slug", params: { slug } });
  },
  component: WorksIndexRoute,
});

// 진입 시점에 목록이 비어 있었을 때 도달한다. 머무는 동안 목록이 채워지면 beforeLoad는
// 다시 돌지 않으므로, 그때의 정규화는 WorksView의 효과가 맡는다.
function WorksIndexRoute() {
  return <WorksView mode="atelier" slug={null} />;
}

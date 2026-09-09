import { createFileRoute, redirect } from "@tanstack/react-router";
import { pickWorkSlug } from "./-list-slug";
import WorksView from "./-works-view";

// Maison 라우트 다섯은 **몸통이 없다** — 기존 view에 `mode`를 넘기는 껍데기다(스펙 「라우트
// 파일은 Maison 벌을 따로 둔다」). 화면을 두 벌로 베끼면 한쪽만 고치는 날이 오고, 그날
// 어긋난 쪽은 「Maison에서만 다르게 군다」로만 보인다.
//
// 정규화 규칙도 Atelier와 같은 몸통(`-list-slug.ts`)을 쓴다: 이번 세션 마지막 Room →
// 초안 아닌 첫 Room → 비어 있으면 머문다.
export const Route = createFileRoute("/maison/rooms/")({
  beforeLoad: async ({ context }) => {
    const slug = await pickWorkSlug("maison", context.queryClient);
    if (slug) throw redirect({ to: "/maison/rooms/$slug", params: { slug } });
  },
  component: MaisonRoomsIndexRoute,
});

function MaisonRoomsIndexRoute() {
  return <WorksView mode="maison" slug={null} />;
}

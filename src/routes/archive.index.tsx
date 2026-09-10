import { createFileRoute, redirect } from "@tanstack/react-router";
import { pickArchiveSlug } from "./-list-slug";
import ArchiveView from "./-archive-view";

// works.index.tsx와 같은 규칙 — 근거는 그쪽 주석에 적었다.
// 목록 패널이 늘 곁에 있으므로 항목 주소로 고쳐 써도 목록을 볼 방법이 사라지지 않는다.
export const Route = createFileRoute("/archive/")({
  beforeLoad: async ({ context }) => {
    const slug = await pickArchiveSlug("atelier", context.queryClient);
    if (slug) throw redirect({ to: "/archive/$slug", params: { slug } });
  },
  component: ArchiveIndexRoute,
});

// 아카이브가 하나도 없을 때 도달한다 — 그때는 빈 상태 화면이 맞다
function ArchiveIndexRoute() {
  return <ArchiveView mode="atelier" slug={null} />;
}

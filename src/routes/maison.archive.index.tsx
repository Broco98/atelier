import { createFileRoute, redirect } from "@tanstack/react-router";
import { pickArchiveSlug } from "./-list-slug";
import ArchiveView from "./-archive-view";

// archive.index.tsx와 같은 규칙 — 근거는 그쪽 주석에 적었다.
export const Route = createFileRoute("/maison/archive/")({
  beforeLoad: async ({ context }) => {
    const slug = await pickArchiveSlug("maison", context.queryClient);
    if (slug) throw redirect({ to: "/maison/archive/$slug", params: { slug } });
  },
  component: MaisonArchiveIndexRoute,
});

function MaisonArchiveIndexRoute() {
  return <ArchiveView mode="maison" slug={null} />;
}

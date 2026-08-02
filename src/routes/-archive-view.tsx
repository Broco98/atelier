import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import ArchivePage from "@/features/archive/ArchivePage";
import { useArchive } from "@/features/archive/hooks";
import { pickSlug, selectArchive, shellStore } from "@/components/shell/shell-store";

// /archive와 /archive/$slug가 그리는 화면은 같다 — works·projects 쪽과 같은 구조다
// (근거는 -works-view.tsx 주석). 파일명의 "-" 접두사는 라우트 생성기가 이 파일을
// 라우트로 취급하지 않게 한다.
function ArchiveView({ slug }: { slug: string | null }) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: entries = [], isPending, isFetching } = useArchive();

  const exists = slug !== null && entries.some((entry) => entry.slug === slug);

  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({ to: "/archive/$slug", params: { slug: next }, replace })
      : navigate({ to: "/archive", replace }));

  useEffect(() => {
    if (slug !== null && exists) {
      selectArchive(slug);
      return;
    }
    if (isPending || isFetching) return;
    const next = pickSlug(shellStore.state.archiveSlug, entries);
    if (next === slug) return;
    goTo(next, true);
    // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [slug, exists, isPending, isFetching, entries]);

  return (
    <ArchivePage
      sidebarOpen={sidebarOpen}
      selectedSlug={exists ? slug : null}
      onSelect={(next) => goTo(next, next === null)}
    />
  );
}

export default ArchiveView;

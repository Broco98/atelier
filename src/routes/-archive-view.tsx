import { useCallback, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import ArchivePage from "@/features/archive/ArchivePage";
import { useArchive } from "@/features/archive/hooks";
import { pickSlug, selectArchive, shellStore } from "@/components/shell/shell-store";

// /archive와 /archive/$slug가 그리는 화면은 같다 — works·projects 쪽과 같은 구조다
// (근거는 -works-view.tsx 주석). 파일명의 "-" 접두사는 라우트 생성기가 이 파일을
// 라우트로 취급하지 않게 한다.
function ArchiveView({ slug, file = null }: { slug: string | null; file?: string | null }) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: entries = [], isPending, isFetching } = useArchive();

  const exists = slug !== null && entries.some((entry) => entry.slug === slug);

  // 아카이브를 옮길 때 문서를 딸려 보내지 않는다 — 경로는 그 아카이브 안에서만 뜻이 있고,
  // 이름이 같은 문서(record.md·overview.md)가 어디에나 있어 남으면 엉뚱한 것이 열린다.
  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({ to: "/archive/$slug", params: { slug: next }, search: {}, replace })
      : navigate({ to: "/archive", replace }));

  // 목록에서 문서를 고르는 것은 **아카이브를 고르는 것이기도 하다.** 둘을 한 번의 이동으로
  // 옮겨야 주소가 바뀌는 프레임에 선택이 깜빡이지 않는다. 훑기이므로 히스토리는 만들지
  // 않는다 — Works의 트리와 같은 규칙이다.
  const selectDoc = useCallback(
    (docSlug: string, path: string) =>
      void navigate({
        to: "/archive/$slug",
        params: { slug: docSlug },
        search: { file: path },
        replace: true,
      }),
    [navigate],
  );

  // 본문 링크는 지금 아카이브 안에서 움직이고, 따라 들어간 만큼 돌아올 자리를 남긴다(push).
  const followLink = useCallback(
    (path: string) => {
      if (slug === null) return;
      void navigate({ to: "/archive/$slug", params: { slug }, search: { file: path } });
    },
    [navigate, slug],
  );

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
      currentFile={file}
      onSelectDoc={selectDoc}
      onFollowLink={followLink}
    />
  );
}

export default ArchiveView;

import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import ArchivePage from "@/features/archive/ArchivePage";
import { shellStore } from "@/components/shell/shell-store";

// /archive와 /archive/$slug가 그리는 화면은 같다 — 다른 것은 무엇이 선택됐는지뿐이다.
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다 (works와 같다).
//
// Works와 달리 **무선택을 정규화하지 않는다.** 그쪽에서 무선택은 주소와 화면의 어긋남이지만,
// 여기서 무선택은 그 자체로 목록 화면이다. 되돌리는 것은 반대 방향 하나뿐이다 —
// 없는 slug를 가리킬 때(ArchivePage의 효과).
function ArchiveView({ slug }: { slug: string | null }) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);

  return (
    <ArchivePage
      sidebarOpen={sidebarOpen}
      selectedSlug={slug}
      onSelect={(next, replace = false) =>
        void (next
          ? navigate({ to: "/archive/$slug", params: { slug: next }, replace })
          : navigate({ to: "/archive", replace }))
      }
    />
  );
}

export default ArchiveView;

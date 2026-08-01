import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import WorksPage from "@/features/works/WorksPage";
import { isDefaultSelectable, useWorks } from "@/features/works/hooks";
import { pickSlug, selectWork, shellStore } from "@/components/shell/shell-store";

// /works와 /works/$slug가 그리는 화면은 같다 — 다른 것은 어떤 작업이 선택됐는지뿐이다.
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.
function WorksView({ slug }: { slug: string | null }) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: works = [], isPending, isFetching } = useWorks();

  const exists = slug !== null && works.some((work) => work.slug === slug);

  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({ to: "/works/$slug", params: { slug: next }, replace })
      : navigate({ to: "/works", replace }));

  // 주소와 화면을 목록 변화에 맞춰 계속 붙여 둔다.
  // beforeLoad는 이동할 때만 돌기 때문에, 머물러 있는 동안 목록이 바뀌어 생기는 어긋남은
  // 여기서만 고칠 수 있다 (react-query 무효화는 라우터를 다시 돌리지 않는다).
  useEffect(() => {
    // 실제로 띄운 작업을 기억해 둔다 — /works로 돌아왔을 때 여기로 정규화된다
    if (slug !== null && exists) {
      selectWork(slug);
      return;
    }
    // 목록이 아직 오는 중이면 판단을 미룬다. 방금 만들어진 항목이 목록에 반영되기 전에
    // "사라졌다"고 오판하면 사용자를 엉뚱한 데로 보낸다.
    if (isPending || isFetching) return;
    // 주소가 실제 화면과 어긋나 있다. 둘 중 하나다 —
    //  (a) 무선택 주소인데 목록이 뒤늦게 채워졌다 (빈 상태로 열어둔 채 밖에서 작업을 시작한 경우)
    //  (b) 주소가 가리키는 작업이 사라졌다 (지워졌거나 잘못된 링크)
    const next = pickSlug(shellStore.state.workSlug, works, isDefaultSelectable);
    if (next === slug) return; // 목록이 비어 여전히 무선택 — 고칠 것이 없다
    goTo(next, true);
    // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [slug, exists, isPending, isFetching, works]);

  return (
    <WorksPage
      sidebarOpen={sidebarOpen}
      selectedSlug={exists ? slug : null}
      // 선택 해제는 replace다 — 근거는 -projects-view.tsx의 같은 자리
      onSelect={(next) => goTo(next, next === null)}
      onOpenProject={(project) =>
        void navigate({ to: "/projects/$slug", params: { slug: project } })
      }
    />
  );
}

export default WorksView;

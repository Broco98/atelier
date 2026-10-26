import { createFileRoute } from "@tanstack/react-router";
import LibraryScreen from "@/features/library/LibraryScreen";
import { readLibrarySearch, validateLibrarySearch } from "./-library-search";

// `/library`는 Library 화면이다(v1 구현 스펙 §13 · §16 · 티켓 19) — Agent 목록과 파일 읽기. 목록 화면이지만 정규화가 없다: 고른 Agent가
// 없으면 화면이 첫 줄을 읽는다(`pickedAgent`). search 둘은 **지금 Work**(`work` — 그 Work의 Project 안 Agent를 따로 묶는다, S35)와 **고른
// Agent**(`agent` — 부르는 이름)다(`-library-search.ts`). 사이드바의 Library 줄이 지금 선 자리의 Work를 싣는다(`workOfPlace`).

export const Route = createFileRoute("/library")({
  validateSearch: validateLibrarySearch,
  component: LibraryRoute,
});

// 틀(머리 줄 · 흰 판)은 앱 셸이 그려 화면이 사이드바 상태를 읽지 않는다(02 구현 스펙 §3).
function LibraryRoute() {
  const { work, agent } = readLibrarySearch(Route.useSearch());
  const navigate = Route.useNavigate();
  return (
    <LibraryScreen
      work={work}
      agent={agent}
      // 다른 Agent를 고르면 칸이 하나 는다 — 뒤로가기가 앞 Agent로 간다(목록 화면들의 항목 고르기와 같다).
      onPick={(call) => void navigate({ search: { ...(work !== null && { work }), agent: call } })}
    />
  );
}

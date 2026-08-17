import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import SessionsPage from "@/features/sessions/SessionsPage";
import { shellStore } from "@/components/shell/shell-store";

// 세션은 아직 **주소를 갖지 않는다** — 어느 세션을 보고 있는지가 화면 안의 state다.
// projects·works·archive는 그 선택이 `/{kind}/$slug`로 올라가 있고 새로고침·뒤로가기가
// 성립하는데 세션만 그렇지 않다. 여기서 그것까지 바꾸지 않는 이유는, 이 파일이 하는 일이
// **라우터 셸에 자리를 잡아주는 것**이기 때문이다. 세션 화면이 만들어지던 때의 셸은
// 키로 화면을 고르는 표였고, 그 표가 사라지면서 갈 곳을 잃었을 뿐이다.
// `/sessions/$id`로 끌어올리는 것은 다른 화면과 같은 규칙을 세우는 별도의 일이다.
export const Route = createFileRoute("/sessions/")({
  component: SessionsRoute,
});

function SessionsRoute() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  return <SessionsPage sidebarOpen={sidebarOpen} />;
}

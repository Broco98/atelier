import { createFileRoute, redirect } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import SpecLayoutEditor from "@/features/spec-layout/SpecLayoutEditor";
import { modeFrom } from "@/mode";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11). 설정 한 열(620px)의 본문이 아니라 이 하위 주소의
// 별도 화면이다 — 설정 nav는 그대로 서고 「spec 레이아웃」이 켜져 있다(`settingsItemOf`).
//
// **id는 모드 이름 둘뿐이다**(spec 레이아웃 결정 25). 모르는 id는 부를 레이아웃이 없어 「spec 레이아웃」
// 페이지로 치환한다 — 동기 `beforeLoad`의 REPLACE다(`settings.index.tsx`와 같은 관용구).
export const Route = createFileRoute("/settings/spec-layout/$id")({
  beforeLoad: ({ params }) => {
    if (modeFrom(params.id) === null) throw redirect({ to: "/settings/spec-layout" });
  },
  component: EditorRoute,
});

// 셸 상태를 읽는 것은 라우트 층의 일이다(`-settings-view.tsx`와 같다).
function EditorRoute() {
  const { id } = Route.useParams();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const mode = modeFrom(id);
  return mode && <SpecLayoutEditor key={mode} id={mode} sidebarOpen={sidebarOpen} />;
}

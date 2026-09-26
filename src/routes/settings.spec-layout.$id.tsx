import { createFileRoute, redirect } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shellStore } from "@/components/shell/shell-store";
import SpecLayoutEditor from "@/features/spec-layout/SpecLayoutEditor";
import { ALL_MODES, type Mode } from "@/mode";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11). 설정 한 열(620px)의 본문이 아니라 이 하위 주소의
// 별도 화면이다 — 설정 nav는 그대로 서고 「spec 레이아웃」이 켜져 있다(`settingsItemOf`).
//
// **id는 모드 이름 둘뿐이다**(spec 레이아웃 결정 25). 모르는 id는 부를 레이아웃이 없어 「spec 레이아웃」
// 페이지로 치환한다 — 동기 `beforeLoad`의 REPLACE다(`settings.index.tsx`와 같은 관용구).
export const Route = createFileRoute("/settings/spec-layout/$id")({
  beforeLoad: ({ params }) => {
    if (layoutIdOf(params.id) === null) throw redirect({ to: "/settings/spec-layout" });
  },
  component: EditorRoute,
});

/** 주소의 id가 가리키는 모드 — 모르는 글자면 `null`이다. */
function layoutIdOf(raw: string): Mode | null {
  return ALL_MODES.find((mode) => mode === raw) ?? null;
}

// 셸 상태를 읽는 것은 라우트 층의 일이다(`-settings-view.tsx`와 같다).
function EditorRoute() {
  const { id } = Route.useParams();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const mode = layoutIdOf(id);
  return mode && <SpecLayoutEditor key={mode} id={mode} sidebarOpen={sidebarOpen} />;
}

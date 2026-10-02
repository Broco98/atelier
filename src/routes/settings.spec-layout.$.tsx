import { createFileRoute, redirect } from "@tanstack/react-router";

// 「spec 레이아웃」 아래의 **모르는 하위 주소**. 하위 주소는 편집기(`edit`) 하나뿐이라 그 밖에는 부를 화면이 없다 —
// 「spec 레이아웃」 페이지로 치환한다. 레이아웃 id를 실었던 옛 편집기 주소(`/settings/spec-layout/atelier`)도 여기로
// 온다(ui-refresh 결정 23). 동기 `beforeLoad`의 REPLACE다(`settings.index.tsx`와 같은 관용구).
export const Route = createFileRoute("/settings/spec-layout/$")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/spec-layout" });
  },
});

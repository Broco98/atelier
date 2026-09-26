import { createFileRoute } from "@tanstack/react-router";

// 설정 항목 「spec 레이아웃」의 라우트. 그리는 것이 없다 — 자식 둘(「spec 레이아웃」 페이지 `index`, 편집기
// `$id`)이 그대로 선다(Outlet). 평면 라우트에서 이 파일 아래의 동적 라우트는 이것의 **자식**이 되므로,
// 여기서 페이지를 그리면 편집기 주소에서도 이 페이지가 서고 편집기는 설 자리가 없다(spec 레이아웃 티켓 11).
export const Route = createFileRoute("/settings/spec-layout")({});

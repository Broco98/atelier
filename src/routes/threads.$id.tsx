import { createFileRoute } from "@tanstack/react-router";
import { ThreadScreen } from "@/features/thread/ThreadScreen";

// `/threads/<id>`는 그 Thread다(v1 구현 스펙 §13). 목록 화면이 아니라 정규화가 없다 — 들어온 주소 그대로 서고, 없는 id면 화면이 그렇게
// 말한다(엔진의 「Thread를 찾을 수 없어요」). id는 엔진이 지은 시각 꼴(`20261010-100000`)이다.
export const Route = createFileRoute("/threads/$id")({
  component: ThreadRoute,
});

function ThreadRoute() {
  const { id } = Route.useParams();
  // Thread마다 새로 선다 — 굴린 자리 · 펼친 줄이 다른 Thread로 따라가지 않게. 틀(머리 줄 · 흰 판)은 앱 셸이 그린다.
  return <ThreadScreen key={id} thread={id} />;
}

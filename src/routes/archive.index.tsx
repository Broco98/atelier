import { createFileRoute } from "@tanstack/react-router";
import ArchiveView from "./-archive-view";

// 항목이 지정되지 않은 주소를 고쳐 쓰지 않는다 — Works의 index와 다른 점이다.
// 아카이브에서 무선택은 목록 화면이라, 첫 항목으로 보내면 목록을 볼 방법이 사라진다.
export const Route = createFileRoute("/archive/")({ component: ArchiveIndexRoute });

function ArchiveIndexRoute() {
  return <ArchiveView slug={null} />;
}

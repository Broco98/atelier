import { createFileRoute } from "@tanstack/react-router";
import SpaceEditor from "@/features/spaces/SpaceEditor";

// `/spaces/new`는 새 Space — 「직접 만들기」다(03 구현 스펙 §13 · §14). 빈 틀의 Space 파일을 고치기 화면에 연다. 저장하면 그 글의 이름에서
// slug가 서고 그 상세로 간다. 상세(`/spaces/$slug`)보다 이 주소가 먼저라 core는 새 Space의 slug로 `new`를 쓰지 않는다(`new_space_slug`).
export const Route = createFileRoute("/spaces/new")({ component: () => <SpaceEditor slug={null} /> });

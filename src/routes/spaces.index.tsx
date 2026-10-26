import { createFileRoute } from "@tanstack/react-router";
import SpaceList from "@/features/spaces/SpaceList";

// `/spaces`는 Space 목록이다(03 구현 스펙 §14) — 사람 메뉴 「Space」가 여기로 온다. 목록 화면이지만 고른 것으로 넘기지 않는다: 줄을
// 눌러야 상세(`/spaces/$slug`)다. 틀(머리 줄 · 흰 판)은 앱 셸이 그린다.
export const Route = createFileRoute("/spaces/")({ component: SpaceList });

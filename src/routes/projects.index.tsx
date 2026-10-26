import { createFileRoute } from "@tanstack/react-router";
import ProjectsPage from "@/features/projects/ProjectsPage";

// `/projects`는 Projects 목록이다(03 구현 스펙 §16) — 사람 메뉴 「Projects」가 여기로 온다. 목록과 상세가 같은 자리를 번갈아 쓰므로 마지막
// Project로 넘기지 않는다(넘기면 목록을 볼 길이 없다): 줄을 눌러야 상세(`/projects/$slug`)다. 틀(머리 줄 · 흰 판)은 앱 셸이 그린다.
export const Route = createFileRoute("/projects/")({ component: ProjectsPage });

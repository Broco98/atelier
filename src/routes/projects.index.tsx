import { createFileRoute } from "@tanstack/react-router";

// `/projects/` — 목록이다. 목록은 틀(`projects.tsx` — `ProjectsPlace`)이 늘 그리므로 이 자리는 비어 있다: 상세가 서지 않은 것이 곧 목록이다.
export const Route = createFileRoute("/projects/")({ component: () => null });

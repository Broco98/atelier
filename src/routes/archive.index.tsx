import { createFileRoute } from "@tanstack/react-router";

// `/archive/` — 목록이다. 목록은 틀(`archive.tsx` — `ArchivePlace`)이 늘 그리므로 이 자리는 비어 있다: 상세가 서지 않은 것이 곧 목록이다. 한때 마지막으로
// 보던 아카이브(없으면 목록 첫 줄)로 고쳐 썼다 — 목록 칸이 곁에 늘 서던 판의 규칙이다(restart 03-4가 걷었다).
export const Route = createFileRoute("/archive/")({ component: () => null });

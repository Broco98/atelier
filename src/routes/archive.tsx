import { createFileRoute } from "@tanstack/react-router";
import ArchivePlace from "@/features/archive/ArchivePage";

// `/archive`는 Archive의 틀이다(restart 03-4 · 스펙 「03 — 목록과 상세」) — 사이드바 위 칸 「Archive」가 여기로 온다. 목록과 상세(`/archive/$slug`)가 한
// 자리를 번갈아 쓴다: 목록은 이 틀이 늘 그리고(상세가 선 동안에는 숨는다 — 찾는 글 · 정렬 · 스크롤이 남는다), 상세는 자식 라우트가 그린다. 마지막
// 아카이브로 넘기지 않는다(넘기면 목록을 볼 길이 없다): 줄을 눌러야 상세다. 머리 줄 · 카드 자리는 앱 셸이 그린다.
export const Route = createFileRoute("/archive")({ component: ArchivePlace });

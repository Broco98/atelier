import { placeDay } from "@/components/catalog/place-list";
import type { WorkStatus } from "@/features/works/types";
import { archivedDay } from "./archive-days";
import type { ArchiveEntry } from "./types";

// **Archive 목록 줄과 상세 위 카드의 값**(restart 03-4 · 스펙 「03 — 목록과 상세」 · 보드 PlaceSheet 「세 화면」 · Places `DATA.archive` · `DETAILS`) — 렌더 없이
// L2가 잰다. 줄은 이름 옆에 상태와 Project, 시각 칸에 보관한 날(`placeDate`)이고, 상세 위 카드는 상태 · 보관한 날 · Project · 브랜치다.

/**
 * 치운 때의 상태를 부르는 말(보드 「완료」 · 「검토」 · 「초안」). 아카이브는 치운 시점의 상태를 그대로 든다 — 보관했다고 완료가 아니다. `active`는
 * 보드에 없어 작업 상태 표의 설명(`STATUS_META.active.desc`)과 같은 「진행 중」이다.
 */
const STATUS_WORD: Record<WorkStatus, string> = { draft: "초안", active: "진행 중", review: "검토", done: "완료" };

/** 줄의 이름 옆 글 — 상태와 그 work가 걸쳤던 Project(보드 「완료 · atelier」 · 「검토 · backend · front」 · 「초안」). */
export function archiveDesc(entry: ArchiveEntry): string {
  return [STATUS_WORD[entry.status], ...entry.projects].join(" · ");
}

/** 상세 위 카드 한 칸 — 이름과 값. */
export interface ArchiveFact {
  label: string;
  value: string;
}

/**
 * 상세 위 카드 넷(보드 `DETAILS['process-manager'].facts`) — 상태 · 보관한 날(해까지 적은 그날 — `placeDay`) · Project(여럿이면 「 · 」) · 브랜치. 손으로 옮긴
 * 폴더처럼 날이 없거나, Project · 브랜치가 없으면 「—」다.
 */
export function archiveFacts(entry: ArchiveEntry): ArchiveFact[] {
  const day = archivedDay(entry.archivedAt);
  return [
    { label: "상태", value: STATUS_WORD[entry.status] },
    { label: "보관한 날", value: day === null ? "—" : placeDay(day) },
    { label: "Project", value: entry.projects.join(" · ") || "—" },
    { label: "브랜치", value: entry.branch ?? "—" },
  ];
}

/** 찾기 칸이 거른 줄 — 이름 · slug · 줄의 옆 글(상태 · Project)에서 대소문자 없이 찾는다(보드 `name + desc`). 받은 차례 그대로다. */
export function shownArchive(entries: readonly ArchiveEntry[], query: string): ArchiveEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...entries];
  return entries.filter((entry) => [entry.title, entry.slug, archiveDesc(entry)].some((one) => one.toLowerCase().includes(needle)));
}

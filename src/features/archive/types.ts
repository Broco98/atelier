import type { WorkStatus } from "@/features/works/types";

// 목록 한 줄. **경량이다** — spec 파일 목록도 워크트리도 담지 않는다 (코어 ArchiveEntry와 같은 모양).
// 아카이브는 쌓이기만 하므로 목록이 무거워지면 갈수록 나빠진다. 문서가 필요하면 상세에서 따로 읽는다.
export interface ArchiveEntry {
  slug: string;
  title: string;
  // 치운 시점의 상태를 그대로 보존한다 — 아카이브가 done을 뜻하지는 않는다
  status: WorkStatus;
  // 손으로 옮겨 둔 폴더에는 없다. 없는 것을 지어내지 않는다.
  archivedAt: string | null;
  projects: string[];
}

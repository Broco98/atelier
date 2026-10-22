import type { SpecTree, WorkStatus } from "@/features/works/types";

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

/**
 * 아카이브 하나의 문서 — 커널의 문서 목록과, 그중 `spec/` 아래를 엔진이 가른 spec 트리가 **한
 * 응답으로** 온다(코어 `ArchivedDocs`). spec 목록 패널은 둘을 한 트리로 잇는다 — 기록 행 곁에
 * `spec/` 행을 세우고 그 아래에 받은 트리를 얹는다(`archiveTreeItems`). 따로 오면 트리가 기록 행만으로
 * 먼저 섰다가 `spec/` 행이 늦게 끼어들며 튄다.
 */
export interface ArchivedDocs {
  /** work 폴더 기준 경로(`record.md`, `spec/…`). 기록이 맨 앞이고, 첫 문서가 기본 문서다. */
  docs: string[];
  /** `spec/` 아래만 가른 트리. 경로는 **spec 기준**이라 화면이 `spec/`를 다시 붙여 쓴다. */
  specTree: SpecTree;
}

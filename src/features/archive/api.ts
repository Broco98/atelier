import { invoke } from "@tauri-apps/api/core";
import type { ArchivedDocs, ArchiveEntry } from "./types";

// 인자 객체가 평평한 것은 works 쪽과 같은 이유다 (`works/api.ts`).
export const archiveApi = {
  list: () => invoke<ArchiveEntry[]>("list_archive"),
  // 경로는 work 루트 기준이다 — 기록(`record.md`)과 spec(`spec/…`)이 한 목록에 함께 온다. 그중
  // `spec/` 아래를 엔진이 가른 spec 트리가 같은 답에 실린다
  docs: (slug: string) => invoke<ArchivedDocs>("list_archived_docs", { slug }),
  read: (slug: string, path: string) =>
    invoke<string>("read_archived_file", { slug, path }),
  /**
   * 아카이브된 work의 spec 폴더를 Finder에서 연다 — work 메뉴의 Finder 열기(`worksApi.openFolder`)와 한 가족이다(codex-ds 스펙 S6).
   * **경로를 넘기지 않는다** — 백엔드가 slug로 푼다(`archived_spec_folder`). 폴더가 없으면 어느 폴더인지 말하며 거절한다.
   */
  openSpecFolder: (slug: string) => invoke<void>("open_archived_spec_folder", { slug }),
};

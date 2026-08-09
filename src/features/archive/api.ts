import { invoke } from "@tauri-apps/api/core";
import type { ArchiveEntry } from "./types";

export const archiveApi = {
  list: () => invoke<ArchiveEntry[]>("list_archive"),
  // 경로는 work 루트 기준이다 — 기록(`record.md`)과 spec(`spec/…`)이 한 목록에 함께 온다
  docs: (slug: string) => invoke<string[]>("list_archived_docs", { slug }),
  read: (slug: string, path: string) => invoke<string>("read_archived_file", { slug, path }),
};

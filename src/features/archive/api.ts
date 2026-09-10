import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "@/mode";
import type { ArchiveEntry } from "./types";

// `mode`가 맨 앞인 것도, 인자 객체가 평평한 것도 works 쪽과 같은 이유다 (`works/api.ts`).
export const archiveApi = {
  list: (mode: Mode) => invoke<ArchiveEntry[]>("list_archive", { mode }),
  // 경로는 work 루트 기준이다 — 기록(`record.md`)과 spec(`spec/…`)이 한 목록에 함께 온다
  docs: (mode: Mode, slug: string) => invoke<string[]>("list_archived_docs", { mode, slug }),
  read: (mode: Mode, slug: string, path: string) =>
    invoke<string>("read_archived_file", { mode, slug, path }),
};

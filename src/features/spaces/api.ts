import { invoke } from "@tauri-apps/api/core";
import type { ReadingScope, ScopeOf } from "./scope";
import type { Space, SpaceDetail, SpaceDraft, SpacePatch } from "./types";

export const spacesApi = {
  list: () => invoke<Space[]>("list_spaces"),
  get: (slug: string) => invoke<SpaceDetail>("get_space", { slug }),
  update: (slug: string, patch: SpacePatch) => invoke<Space>("update_space", { slug, ...patch }),
  // 고치기 화면(03 구현 스펙 §13) — `slug`가 없으면 새 Space다.
  readText: (slug: string) => invoke<string>("read_space_text", { slug }),
  check: (slug: string | null, text: string) => invoke<SpaceDraft>("check_space", { slug, text }),
  saveText: (slug: string | null, text: string) => invoke<Space>("save_space_text", { slug, text }),
  /** 읽는 범위(§7) — Thread가 있으면 그 Thread의 것, 없으면 보내기 전의 새 Thread(입력창이 쥔 Work · Space)의 것이다. */
  scope: ({ thread, work, space }: ScopeOf) =>
    invoke<ReadingScope>("reading_scope", { thread: thread ?? null, work: work ?? null, space: space ?? null }),
};

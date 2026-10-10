/** 워크트리 트리 항목의 종류. 심링크는 따라가지 않고 그 자리의 항목이다. 하위 모듈은 다른 저장소라 펼치지 않는다. */
export type WorktreeEntryKind = "file" | "folder" | "symlink" | "submodule";

/**
 * 워크트리 트리의 항목 하나 — 코어 「워크트리 읽기」(`crates/atelier-core/src/worktree.rs`)의 `WorktreeEntry`와 필드 이름이
 * 한 글자도 다르지 않아야 한다.
 */
export interface WorktreeEntry {
  name: string;
  /** 워크트리 기준 상대 경로 — 조각은 `/`로 잇는다. */
  path: string;
  kind: WorktreeEntryKind;
  /** gitignore에 걸렸는가. 걸린 폴더 안의 것은 모두 걸린 것이다. */
  ignored: boolean;
  /**
   * 폴더의 자식 — 코어가 폴더 먼저 · 이름순으로 세워 보낸다(화면은 받은 순서 그대로 그린다). **`null`이면 아직 안 읽은
   * 폴더다**(걸린 폴더 — 펼칠 때 한 겹 읽는다). 폴더가 아니면 빈 목록이다.
   */
  children: WorktreeEntry[] | null;
}

/**
 * 워크트리 하나의 트리 목록. **워크트리가 없거나 읽지 못한 것도 답이다** — 오류가 아니라 구획이 그리는 갈래라서 코어가
 * `kind`로 갈라 보낸다(Rust `#[serde(tag = "kind")]`와 짝).
 */
export type WorktreeTree =
  | { kind: "listed"; entries: WorktreeEntry[] }
  | { kind: "worktreeMissing" }
  | { kind: "unreadable"; reason: string };

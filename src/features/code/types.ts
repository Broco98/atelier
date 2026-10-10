/**
 * 워크트리 파일 하나의 답 — 코어 `WorktreeFile`(`#[serde(tag = "kind")]`)과 짝이다. 파일이 없거나 워크트리가 없는 것은 실패가
 * 아니라 **답의 갈래**라, 파일 탭은 spec으로 조용히 돌아가지 않고 탭 안에 그 까닭을 보인다(git-integration 스토리 61).
 *
 * 이미지 · 바이너리 · UTF-8 아님 · 너무 큼은 다음 장(09)이 갈래를 더한다 — 지금 UTF-8로 못 읽는 것은 「읽지 못함」이다.
 */
export type WorktreeFile =
  | { kind: "text"; content: string; lines: number }
  | { kind: "missing" }
  | { kind: "worktreeMissing" }
  /** 워크트리 밖을 가리키는 심링크 — 코어가 읽지 않는다. 대상은 `~` 축약 표기다. */
  | { kind: "outsideLink"; target: string }
  | { kind: "unreadable"; reason: string };

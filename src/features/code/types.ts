/**
 * 워크트리 파일 하나의 답 — 코어 `WorktreeFile`(`#[serde(tag = "kind")]`)과 짝이다. 파일이 없거나 워크트리가 없는 것은 실패가
 * 아니라 **답의 갈래**라, 파일 탭은 spec으로 조용히 돌아가지 않고 탭 안에 그 까닭을 보인다(git-integration 스토리 61).
 *
 * 글이 아닌 것(그림 · 바이너리 · UTF-8 아님 · 너무 큼)은 내용 없이 크기(바이트)만 온다 — 그림은 화면이 워크트리 절대 경로로
 * asset URL을 지어 건다.
 */
export type WorktreeFile =
  | { kind: "text"; content: string; lines: number }
  /**
   * 그림(확장자 png · jpg · jpeg · gif · webp · bmp · ico). svg는 텍스트다. `realPath`는 거는 자리 — 워크트리 기준, 링크를 푼
   * 실제 경로다(링크가 아니면 부른 경로 그대로). asset 프로토콜이 상대 링크를 앱의 현재 폴더 기준으로 풀어 막아서다.
   */
  | { kind: "image"; size: number; realPath: string }
  /** 앞 8KB에 NUL이 있다. */
  | { kind: "binary"; size: number }
  /** 내용이 UTF-8로 풀리지 않는다. */
  | { kind: "notUtf8"; size: number }
  /** 5MB를 넘는다 — 코어가 열지 않았다. */
  | { kind: "tooLarge"; size: number }
  | { kind: "missing" }
  | { kind: "worktreeMissing" }
  /** 워크트리 밖을 가리키는 심링크 — 코어가 읽지 않는다. 대상은 `~` 축약 표기다. */
  | { kind: "outsideLink"; target: string }
  | { kind: "unreadable"; reason: string };

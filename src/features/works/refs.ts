// 참조 생성기 — 클립보드로 나가는 모든 경로 참조는 여기서 만든다.
// 이 형식은 MCP 서버 지침(crates/atelier-cli/src/mcp/instructions.rs)의 "블록 참조
// 해석" 규약과 한 몸이다: 형식을 바꾸면 반드시 같은 커밋에서 규약도 함께 갱신할 것.
// instructions.rs의 refs_ts_still_emits_the_same_reference_shape 테스트가 이 결합을 지킨다.
// `~` 축약은 Rust collapse_home(crates/atelier-core/src/paths.rs)과 같은 표기다.

/** 작업 폴더: `~/.atelier/works/<slug>/` */
export function workDirRef(slug: string): string {
  return `~/.atelier/works/${slug}/`;
}

/** 워크트리: Rust가 내려준 `~` 축약 경로(`worktrees[].path`)에 트레일링 `/`만 보장한다 */
export function worktreeDirRef(worktreePath: string): string {
  return worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;
}

/** 줄범위 꼬리표. 형식이 한 곳에만 있어야 spec 참조와 아카이브 참조가 갈라지지 않는다. */
function withLines(base: string, start?: number, end?: number): string {
  if (start === undefined) return base;
  return end !== undefined && end > start ? `${base}:L${start}-${end}` : `${base}:L${start}`;
}

/** spec 파일(+줄범위): `~/.atelier/works/<slug>/spec/<path>[:L<n>[-<m>]]` */
export function specRef(slug: string, path: string, start?: number, end?: number): string {
  const base = `${workDirRef(slug)}spec/${path}`;
  return withLines(base, start, end);
}

/** 아카이브 문서(+줄범위): `~/.atelier/archive/<slug>/<path>[:L<n>[-<m>]]`.
 *  path는 **work 루트 기준**이라 기록(`record.md`)과 spec(`spec/…`)이 한 형식으로 나온다 —
 *  아카이브에서 복사한 참조를 에이전트에게 그대로 넘길 수 있어야 한다. */
export function archiveRef(slug: string, path: string, start?: number, end?: number): string {
  const base = `~/.atelier/archive/${slug}/${path}`;
  return withLines(base, start, end);
}

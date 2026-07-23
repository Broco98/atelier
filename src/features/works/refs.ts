// 참조 생성기 — 클립보드로 나가는 모든 경로 참조는 여기서 만든다.
// 이 형식은 CLI 스킬 문서(crates/atelier-cli/assets/SKILL.md)의 "블록 참조 해석"
// 규약과 한 몸이다: 형식을 바꾸면 반드시 같은 커밋에서 규약도 함께 갱신할 것.
// `~` 축약은 Rust collapse_home(crates/atelier-core/src/paths.rs)과 같은 표기다.

/** 작업 폴더: `~/.atelier/works/<slug>/` */
export function workDirRef(slug: string): string {
  return `~/.atelier/works/${slug}/`;
}

/** 워크트리: Rust가 내려준 `~` 축약 경로에 트레일링 `/`만 보장한다 */
export function treeDirRef(treePath: string): string {
  return treePath.endsWith("/") ? treePath : `${treePath}/`;
}

/** spec 파일(+줄범위): `~/.atelier/works/<slug>/spec/<path>[:L<n>[-<m>]]` */
export function specRef(slug: string, path: string, start?: number, end?: number): string {
  const base = `${workDirRef(slug)}spec/${path}`;
  if (start === undefined) return base;
  return end !== undefined && end > start ? `${base}:L${start}-${end}` : `${base}:L${start}`;
}

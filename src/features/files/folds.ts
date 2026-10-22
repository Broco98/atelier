/** 폴더 경로 → 손으로 펼쳤는가. 기억에 없는 폴더는 접힌 채다 — 처음에는 프로젝트 루트만 펼친다(스토리 8). */
export type Folds = Readonly<Record<string, boolean>>;

const NONE: Folds = {};

// files 트리의 접힘 — **work · 프로젝트별로 세션 동안 기억한다**(git-integration 구현 스펙 S14 · 결정 37). 화면 밖(모듈)에 두는 것은
// 그 수명 때문이다: 작업을 옮겨도 패널은 같은 인스턴스라 컴포넌트 상태로는 work마다 따로 들 수 없고, 작업 화면을 떠났다
// 돌아와도(언마운트) 남아야 한다. spec 트리처럼 패널 접기(「트리 세대」)에 리셋되지도 않는다. 앱을 다시 켜면 없다.
const remembered = new Map<string, Folds>();

const keyOf = (slug: string, project: string) => JSON.stringify([slug, project]);

export const foldsOf = (slug: string, project: string): Folds => remembered.get(keyOf(slug, project)) ?? NONE;

export function rememberFolds(slug: string, project: string, folds: Folds): void {
  remembered.set(keyOf(slug, project), folds);
}

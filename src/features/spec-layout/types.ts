import type { Mode } from "@/mode";

// spec 레이아웃의 응답 모양. **정본은 엔진이다**(`crates/atelier-core/src/layout/`) — 여기는 그
// 응답의 타입이고, 규칙은 한 줄도 없다(결정 13).

/**
 * 레이아웃 검증 오류 하나 — 엔진의 `LayoutError`. `path`는 맨 위 항목에서부터의 인덱스 경로이고
 * (`[]`이 맨 위 항목), `null`이면 항목이 아니라 문서 전체의 오류다(JSON 문법, `layout.json` 없음).
 */
export interface LayoutError {
  path: number[] | null;
  message: string;
}

/**
 * 모드 하나의 레이아웃 상태 — 엔진의 `layout_states`가 준 그대로다(`spec_layout_states`). 설정 화면은
 * resolve 규칙을 다시 계산하지 않고 이것을 그리기만 한다.
 */
export interface SpecLayoutState {
  id: Mode;
  /** 레이아웃 폴더 — 홈은 `~`로 줄였고 끝에 `/`가 없다. 폴더가 없어도 온다: 참조가 그 자리다. */
  folder: string;
  /** 내장본을 가린 폴더가 있는가. 읽지 못하는 폴더도 가린 것이다. */
  edited: boolean;
  /** 읽기 오류 전부. 읽을 수 있으면 빈 목록이다. */
  errors: LayoutError[];
  /** 읽지 못해 내장본으로 물러섰다면 그 까닭 — 에이전트가 받는 물러선 안내문의 것과 같은 글이다. */
  fallback: string | null;
  /** 가리키고 디스크에 있는 템플릿 파일의 수. 읽지 못하면 `null`이다. */
  templateCount: number | null;
  /** 폴더 안에서 `layout.json`과 세어진 템플릿을 뺀 파일의 수(점 파일 제외). */
  otherFileCount: number;
}

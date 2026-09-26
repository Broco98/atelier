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

/**
 * 레이아웃 항목 하나의 디스크 형식(`layout.json`의 한 칸). 엔진이 준 그대로다 — 이름 붙은 키 말고도
 * **모르는 키가 실려 오고**, 편집기는 그것을 펼쳐 고쳐 저장에 그대로 돌려준다(결정 3의 「열어 둠」).
 * 빠진 키는 「없음」이다: 빈 설명, 아이콘 없음, 템플릿 없음, 자식 없음. 맨 위 항목에는 이름 틀도
 * 종류도 없다.
 */
export interface LayoutEntryJson {
  pattern?: string;
  kind?: "file" | "folder";
  description?: string;
  icon?: string;
  template?: string;
  children?: LayoutEntryJson[];
  [key: string]: unknown;
}

/** 레이아웃 한 장의 디스크 형식 — 맨 위 항목(`root`, spec 폴더 자신)과 모르는 키. */
export interface SpecLayoutJson {
  root: LayoutEntryJson;
  [key: string]: unknown;
}

/** 템플릿 본문 — 레이아웃 폴더 기준 경로 → 본문. */
export type TemplateBodies = Record<string, string>;

/** 읽을 수 있는 레이아웃(`read_spec_layout`). 폴더가 없으면 그 모드의 내장본이다(`edited: false`). */
export interface ReadableSpecLayout {
  id: Mode;
  /** 레이아웃 폴더 — 홈은 `~`로 줄였고 끝에 `/`가 없다. 폴더가 없어도 온다: 처음 저장하면 거기 선다. */
  folder: string;
  edited: boolean;
  layout: SpecLayoutJson;
  /** 가리키고 디스크에 있으며 읽을 수 있는 템플릿의 본문. 편집기는 저장에 이것을 **전부** 돌려준다. */
  templates: TemplateBodies;
  /** 엔진의 경고(누락 템플릿, 읽을 수 없는 템플릿). */
  warnings: string[];
}

/** 읽지 못하는 레이아웃 — 까닭(오류 전부)과 원문. 편집기는 이때 편집 UI를 세우지 않는다. */
export interface UnreadableSpecLayout {
  id: Mode;
  folder: string;
  edited: boolean;
  errors: LayoutError[];
  /** `layout.json`의 원문. 파일이 없거나 읽을 수 없으면 `null`이다. */
  raw: string | null;
}

export type SpecLayoutRead = ReadableSpecLayout | UnreadableSpecLayout;

/**
 * 저장의 답(`write_spec_layout`). **검증 실패는 거절이 아니라 이 데이터다** — 위치가 붙은 오류가 오고
 * 아무것도 쓰이지 않았다. 쓰면 빈 목록이다. 쓰다가 실패한 것(IO)만 문자열로 거절된다.
 */
export interface SaveAnswer {
  errors: LayoutError[];
}

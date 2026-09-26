import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "@/mode";
import type { SpecLayoutState } from "./types";

// 레이아웃은 `settings.json`이 아니라 데이터 루트의 레이아웃 폴더에 산다(spec 레이아웃 결정 25) —
// 경로를 여기서 말하지 않는 이유는 설정의 `api.ts`와 같다: 그 자리를 아는 곳은 코어 하나다.
export const specLayoutApi = {
  /** 모드 둘(Atelier, Maison 순서)의 레이아웃 상태. 아무것도 쓰지 않는다. */
  states: () => invoke<SpecLayoutState[]>("spec_layout_states"),
  /**
   * 모드의 레이아웃을 기본값으로 되돌린다 — 그 모드의 레이아웃 폴더를 지운다. 깨진 폴더도 지운다.
   * **확인을 거친 뒤에만 부른다**(`askRevert`). 인자 이름이 `mode`가 아니라 `id`인 것은 레이아웃 id를
   * 받는 명령이라서다(구현 스펙 3절) — 모드 명령의 계약에 들지 않는다.
   */
  revert: (id: Mode) => invoke<null>("revert_spec_layout", { id }),
};

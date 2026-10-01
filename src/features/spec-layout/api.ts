import { invoke } from "@tauri-apps/api/core";
import { modeFrom, type Mode } from "@/mode";
import type {
  LayoutPreview,
  SaveAnswer,
  SpecLayoutJson,
  SpecLayoutRead,
  SpecLayoutState,
  TemplateBodies,
} from "./types";

/** 백엔드가 준 레이아웃 상태 한 줄 — id가 아직 `Mode`로 검증되지 않았다(아래 `states`). */
type WireLayoutState = Omit<SpecLayoutState, "id"> & { id: string };

// 레이아웃은 `settings.json`이 아니라 데이터 루트의 레이아웃 폴더에 산다(spec 레이아웃 결정 25) —
// 경로를 여기서 말하지 않는 이유는 설정의 `api.ts`와 같다: 그 자리를 아는 곳은 코어 하나다.
export const specLayoutApi = {
  /**
   * 레이아웃 상태. 아무것도 쓰지 않는다.
   *
   * **받은 줄 가운데 id가 `Mode`인 것만 남긴다**(ui-refresh 결정 22). 백엔드는 아직 지운 모드의 줄을 함께
   * 주는데, 그 id로 화면이 이름을 찾으면 표에 없는 키라 행이 무너진다. 줄 수가 아니라 값으로 거른다 —
   * 백엔드가 줄을 줄이거나 순서를 바꿔도 같은 답이다. 레이아웃 id가 사라지는 판 02의 05에서 이 거르기도 지운다.
   */
  states: async (): Promise<SpecLayoutState[]> => {
    const states = await invoke<WireLayoutState[]>("spec_layout_states");
    return states.flatMap((state) => {
      const id = modeFrom(state.id);
      return id === null ? [] : [{ ...state, id }];
    });
  },
  /**
   * 모드의 레이아웃을 기본값으로 되돌린다 — 그 모드의 레이아웃 폴더를 지운다. 깨진 폴더도 지운다.
   * **확인을 거친 뒤에만 부른다**(`askRevert`). 인자 이름이 `mode`가 아니라 `id`인 것은 레이아웃 id를
   * 받는 명령이라서다(구현 스펙 3절) — 모드 명령의 계약에 들지 않는다.
   */
  revert: (id: Mode) => invoke<void>("revert_spec_layout", { id }),
  /**
   * 편집기가 여는 모드의 레이아웃 — 디스크 형식 그대로의 레이아웃, 템플릿 본문, 경고. 깨졌으면 오류와
   * 원문이다. 아무것도 쓰지 않는다.
   */
  read: (id: Mode) => invoke<SpecLayoutRead>("read_spec_layout", { id }),
  /**
   * 편집기의 저장. **템플릿은 늘 전부 넘긴다.** 검증이 거절하면 거절이 아니라 답의 `errors`다(아무것도
   * 쓰지 않았다) — 이 promise가 거절되는 것은 쓰다가 실패했을 때뿐이다.
   */
  write: (id: Mode, layout: SpecLayoutJson, templates: TemplateBodies) =>
    invoke<SaveAnswer>("write_spec_layout", { id, layout, templates }),
  /**
   * 편집기의 미리보기(티켓 14) — 저장하지 않은 초안을 저장하면 에이전트가 받을 글, 그 안의 항목의 줄, 검증 오류,
   * 경고. 인자는 저장과 같다(템플릿은 늘 전부). **아무것도 쓰지 않는다.** 오류가 있으면 글이 없다.
   */
  render: (id: Mode, layout: SpecLayoutJson, templates: TemplateBodies) =>
    invoke<LayoutPreview>("render_spec_layout", { id, layout, templates }),
};

import { invoke } from "@tauri-apps/api/core";
import type { SearchHit } from "./types";

export const searchApi = {
  /** 지금은 「최근 고쳐진 문서」 하나를 답한다. 질의는 다음 판이 인자로 얹는다. */
  run: () => invoke<SearchHit[]>("search"),
};

import { invoke } from "@tauri-apps/api/core";
import type { SearchResults } from "./types";

export const searchApi = {
  /**
   * 질의 하나에 답 하나. **디바운스가 없다**(결정 29) — 실측 10~20ms짜리 일에 지연을 얹으면
   * 「치는 동안 즉시 따라온다」를 스스로 깨는 것이다. 질의가 비면 최근 고쳐진 문서가 온다.
   */
  run: (query: string) => invoke<SearchResults>("search", { query }),
};

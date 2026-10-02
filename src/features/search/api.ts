import { invoke } from "@tauri-apps/api/core";
import type { Destination, SearchResults } from "./types";

export const searchApi = {
  /**
   * 질의 하나에 답 하나. **디바운스가 없다**(결정 29) — 그만큼 싼 일에 지연을 얹으면 「치는
   * 동안 즉시 따라온다」를 스스로 깨는 것이다. 얼마나 싼지는 코어 주석 한 자리에 있다
   * (`search.rs`의 `search`). 질의가 비면 최근 고쳐진 문서가 온다.
   *
   * **`mode`는 이 층의 상수 `"atelier"`다** — 근거도, 인자 객체가 평평한 것도 works 쪽과 같다(`works/api.ts`).
   *
   * **목적지를 함께 보낸다**(결정 21) — 프런트가 「무엇이 있는가」를, 코어가 「어떻게
   * 맞추는가」를 가진다. 나중에 CLI·MCP가 부를 때는 빈 목록을 넘긴다.
   */
  run: (query: string, destinations: Destination[]) =>
    invoke<SearchResults>("search", { mode: "atelier", query, destinations }),
};

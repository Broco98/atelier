import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "@/mode";
import type { Destination, SearchResults } from "./types";

export const searchApi = {
  /**
   * 질의 하나에 답 하나. **디바운스가 없다**(결정 29) — 그만큼 싼 일에 지연을 얹으면 「치는
   * 동안 즉시 따라온다」를 스스로 깨는 것이다. 얼마나 싼지는 코어 주석 한 자리에 있다
   * (`search.rs`의 `search`). 질의가 비면 최근 고쳐진 문서가 온다.
   *
   * **어느 세계를 뒤지는가가 맨 앞이다** — 코어가 그 값으로 works·아카이브·프로젝트 루트를
   * 고르므로(`commands.rs`의 `search`), 질의보다 앞선 물음이다. 자리도 인자 객체가 평평한
   * 것도 works 쪽과 같은 이유다(`works/api.ts`) — 백엔드에서도 필수라(#187) 빠뜨리면
   * 명령이 거절하지만, 그 거절은 버튼을 누른 뒤에야 보인다.
   *
   * **목적지를 함께 보낸다**(결정 21) — 프런트가 「무엇이 있는가」를, 코어가 「어떻게
   * 맞추는가」를 가진다. 나중에 CLI·MCP가 부를 때는 빈 목록을 넘긴다.
   */
  run: (mode: Mode, query: string, destinations: Destination[]) =>
    invoke<SearchResults>("search", { mode, query, destinations }),
};

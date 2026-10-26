import { invoke } from "@tauri-apps/api/core";

// Library 화면이 부르는 core 명령(v1 티켓 11 · 19). 목록(`list_agents`)은 @ 메뉴와 같은 `threadApi.agents`를 쓴다. 둘 다 경로가 아니라
// 부르는 이름(`call`)으로 범위 안에서 고른다 — 화면이 범위 밖 파일을 읽거나 열 길이 없다. `work`가 없으면(`null`) Library만이다.
export const libraryApi = {
  /** 그 Agent 파일의 원문 — 깨진 파일도 준다. */
  readFile: (work: string | null, call: string) => invoke<string>("read_agent_file", { work, call }),
  /** 그 Agent 파일을 Finder에서 골라 보인다 — 외부 편집기로 고치는 길(§16). */
  reveal: (work: string | null, call: string) => invoke<void>("reveal_agent_file", { work, call }),
};

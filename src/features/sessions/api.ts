import { invoke } from "@tauri-apps/api/core";
import type { Envelope, SessionView } from "./types";

export const sessionsApi = {
  list: () => invoke<SessionView[]>("list_sessions"),
  create: (projectSlug: string) => invoke<SessionView>("create_session", { projectSlug }),
  // 턴이 끝날 때까지 돌아오지 않는다. 그동안의 조각은 session:update 이벤트로 온다.
  prompt: (sessionId: string, text: string) =>
    invoke<void>("prompt_session", { sessionId, text }),
  // 돌고 있는 턴을 멈춘다. 곧바로 돌아오고, 턴이 끝나는 것은 prompt 쪽이 돌아오는 것으로 안다.
  cancel: (sessionId: string) => invoke<void>("cancel_session", { sessionId }),
  // 고른 선택지 id를 그대로 보낸다 — 선택지는 에이전트가 준 목록뿐이다.
  answerPermission: (sessionId: string, requestId: string, optionId: string) =>
    invoke<void>("answer_permission", { sessionId, requestId, optionId }),
  readUpdates: (sessionId: string) =>
    invoke<Envelope[]>("read_session_updates", { sessionId }),
};

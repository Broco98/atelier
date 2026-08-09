import { invoke } from "@tauri-apps/api/core";
import type { SessionView } from "./types";

export const sessionsApi = {
  list: () => invoke<SessionView[]>("list_sessions"),
  create: (projectSlug: string) => invoke<SessionView>("create_session", { projectSlug }),
};

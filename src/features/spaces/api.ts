import { invoke } from "@tauri-apps/api/core";
import type { Space, SpaceDetail, SpacePatch } from "./types";

export const spacesApi = {
  list: () => invoke<Space[]>("list_spaces"),
  get: (slug: string) => invoke<SpaceDetail>("get_space", { slug }),
  update: (slug: string, patch: SpacePatch) => invoke<Space>("update_space", { slug, ...patch }),
};

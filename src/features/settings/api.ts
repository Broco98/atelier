import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

// 설정은 `localStorage`가 아니라 `~/.atelier/settings.json` 한 장에 산다(결정 53) —
// 그래서 창구가 Rust 커맨드 둘이다. 경로를 여기서 말하지 않는 이유는 그 자리를 아는 곳이
// `atelier_core::data_root()` 하나이기 때문이다(`terminal/api.ts`의 `cwd`와 같은 규칙).
export const settingsApi = {
  // 파일이 없으면 기본값이 온다 — 첫 실행이 정상 경로다. 파일이 깨져 있으면 **실패한다**:
  // 조용히 기본값으로 넘어가면 다음 저장이 사용자가 고치던 파일을 덮어쓴다.
  read: () => invoke<Settings>("read_settings"),
  // **읽은 것을 통째로 되돌려 준다.** 우리가 모르는 키가 파일에 있으면 응답에 실려 왔고,
  // 그대로 돌려보내야 파일에 남는다(`work.json`과 같은 규칙). 고친 필드 하나만 담은 새
  // 객체를 만들어 보내면 그 키들이 조용히 사라진다 — 읽은 것을 펼쳐서 고쳐라
  // (`{ ...settings, terminal: { ...settings.terminal, fontSize: 16 } }`).
  write: (settings: Settings) => invoke<void>("write_settings", { settings }),
};

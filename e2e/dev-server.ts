import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 이 워크트리의 루트. 포트도 서버 신원 확인도 이 값 하나에서 나온다. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 워크트리마다 다른 포트를 쓴다. 이 저장소는 work마다 워크트리를 두는데, 고정 포트를
// 쓰면 옆 워크트리의 검증과 서로를 죽인다(먼저 잡은 쪽이 이기고 나중 쪽은 실패한다).
// 경로에서 뽑으므로 같은 워크트리는 늘 같은 포트이고, 다른 워크트리와는 겹치지 않는다.
export const PORT =
  39000 +
  (parseInt(createHash("sha1").update(REPO_ROOT).digest("hex").slice(0, 8), 16) % 1000);

export const BASE_URL = `http://localhost:${PORT}`;

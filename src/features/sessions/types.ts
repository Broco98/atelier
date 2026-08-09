export interface StartPoint {
  kind: "project";
  slug: string;
}

export interface SessionView {
  /** 아틀리에가 만든 id. 세션 폴더 이름이다. */
  id: string;
  /** 에이전트가 준 세션 id. 재개에 쓴다. */
  agentSessionId: string;
  /** 어댑터 키 (예: codex) */
  agent: string;
  startPoint: StartPoint;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  /** 런타임의 사실이라 신원 파일에 없다 — 새로 켠 앱에서는 전부 false다. */
  alive: boolean;
}

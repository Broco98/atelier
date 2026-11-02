import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { threadQuery } from "./hooks";
import { mergeLines, setQueue } from "./thread-store";
import { NewThreadScreen, ThreadScreen } from "./ThreadScreen";
import type { RecordLine, ThreadView } from "./types";

// 새 채팅 화면은 칩만 재므로 라우터를 띄우지 않는다.
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ state: { location: { pathname: "/" } } }),
}));

// 채팅 하나가 Runtime 세션 하나다 — 화면은 `participants` · `handles` · `queues` 없이 채팅의 값만으로 그려진다. Rust만 고치면 L2 자료는 그대로
// 초록인데 실제 앱이 터지는 자리라, 엔진이 내는 꼴 그대로의 값을 쿼리 캐시에 앉히고 화면 전체를 그려 본다.

const blessed: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

const chat: ThreadView = {
  id: "20261010-100000",
  title: "세 낱말로 답해 줘",
  createdAt: "2026-10-10T10:00:00.000+09:00",
  work: null,
  mode: null,
  runtime: "claude-code",
  sessionId: "세션",
  cwd: "/home/threads/20261010-100000",
  additionalDirectories: [],
  model: "opus",
  effort: "high",
  lastRead: 0,
  lastSeq: blessed[blessed.length - 1].seq,
  askLevel: "always",
  live: false,
  queue: [{ id: "q1", text: "열 때 읽은 말", sendNow: false }],
  readOnly: null,
};

function draw(view: ThreadView): string {
  const client = new QueryClient();
  client.setQueryData(threadQuery(view.id).queryKey, view);
  mergeLines(view.id, blessed);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ThreadScreen thread={view.id} />
    </QueryClientProvider>,
  );
}

describe("채팅 화면", () => {
  it("채팅의 모델 · 생각 깊이가 칩에 서고 대기 줄이 입력창 위에 선다", () => {
    const html = draw(chat);
    expect(html).toContain("Opus 5.5");
    expect(html).toContain("높음");
    expect(html).toContain("열 때 읽은 말");
    expect(html).toContain("hello from turn");
  });

  it("대기 줄 이벤트가 온 뒤에는 그 값이 이긴다", () => {
    const view = { ...chat, id: "20261010-100001" };
    setQueue(view.id, [{ id: "q2", text: "이벤트로 온 말", sendNow: false }]);
    const html = draw(view);
    expect(html).toContain("이벤트로 온 말");
    expect(html).not.toContain("열 때 읽은 말");
  });

  it("모델을 고르지 않은 채팅은 Session이 연 값을 보인다", () => {
    const html = draw({ ...chat, id: "20261010-100002", model: null, effort: null });
    expect(html).toContain("Sonnet");
  });
});

describe("새 채팅 화면", () => {
  const drawNew = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <NewThreadScreen seed={{ link: { kind: "no-work" }, say: null, space: null }} />
      </QueryClientProvider>,
    );

  it("작업공간 없는 새 채팅의 칩은 「편집 자동」이다", () => {
    expect(drawNew()).toContain('aria-label="물어보는 정도 편집 자동"');
  });
});

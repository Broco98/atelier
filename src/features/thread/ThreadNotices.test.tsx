import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadQuery } from "./hooks";
import { mergeLines } from "./thread-store";
import { ThreadScreen } from "./ThreadScreen";
import type { RecordLine, ThreadView } from "./types";

// 안내 줄의 단추(01b-6 · 스토리 56, 57)를 Thread 화면째로 누른다. L2에는 DOM이 없어 단추의 `onClick`을 그릴 때 받아 두었다가 부른다. 재는 것은
// 누른 뒤 엔진에 무엇이 갔고 입력창에 무엇이 섰나다.

const { pressed, invoke } = vi.hoisted(() => ({
  pressed: new Map<string, () => void>(),
  invoke: vi.fn(async (_name: string, _args?: unknown) => undefined),
}));

vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<typeof import("@tauri-apps/api/core")>()), invoke }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ state: { location: { pathname: "/" } } }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
    if (typeof children === "string" && onClick) pressed.set(children, onClick);
    return <button type="button">{children}</button>;
  },
}));

const limits: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-limits.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

const at = "2026-10-10T10:01:00.000+09:00";
const cut: RecordLine[] = [
  { seq: 1, at, kind: "sent", payload: { text: "고쳐 줘" } },
  { seq: 2, at, kind: "session", payload: { state: "died", reason: "signal 9" } },
];

let serial = 0;
const chat = (lines: readonly RecordLine[]): ThreadView => ({
  id: `20261010-11000${(serial += 1)}`,
  title: "채팅",
  createdAt: at,
  work: null,
  mode: null,
  runtime: "claude-code",
  sessionId: "세션",
  cwd: "/home/threads/채팅",
  additionalDirectories: [],
  model: "opus",
  effort: "high",
  lastRead: 0,
  lastSeq: lines[lines.length - 1].seq,
  askLevel: "always",
  live: true,
  queue: [],
  readOnly: null,
  flowing: null,
});

const client = new QueryClient();

/** 화면을 그린다 — 마지막 턴까지 그린 뒤의 입력창과 단추를 잰다. */
function draw(view: ThreadView, lines: readonly RecordLine[]): string {
  client.setQueryData(threadQuery(view.id).queryKey, view);
  mergeLines(view.id, [...lines]);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ThreadScreen thread={view.id} />
    </QueryClientProvider>,
  );
}

const textarea = (html: string) => /<textarea[^>]*>([^<]*)<\/textarea>/.exec(html)?.[1] ?? null;

beforeEach(() => {
  pressed.clear();
  invoke.mockClear();
});

describe("안내 줄의 단추", () => {
  it("「이어서 하기」는 입력창을 채우기만 하고 보내지 않는다", async () => {
    const view = chat(limits);
    expect(textarea(draw(view, limits))).toBe("");

    pressed.get("이어서 하기")?.();
    await Promise.resolve();

    expect(textarea(draw(view, limits))).toBe("이어서 해 줘");
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain("thread_send");
  });

  it("「이어서 쓰기」는 「이어서 써 줘」를 채운다", async () => {
    const ends = limits.filter((line) => line.kind === "turn-end").map((line) => line.seq);
    const lines = limits.filter((line) => line.seq <= ends[1]);
    const view = chat(lines);
    draw(view, lines);

    pressed.get("이어서 쓰기")?.();
    await Promise.resolve();

    expect(textarea(draw(view, lines))).toBe("이어서 써 줘");
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain("thread_send");
  });

  it("「다시 잇기」는 끊긴 턴을 보내지 않고 다시 잇기 명령 하나를 부른다", async () => {
    const view = chat(cut);
    draw(view, cut);

    pressed.get("다시 잇기")?.();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("thread_reconnect", { thread: view.id }));
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["thread_reconnect"]);
  });

  it("읽기만인 채팅에는 어느 단추도 서지 않는다", () => {
    draw({ ...chat(limits), readOnly: "archived" }, limits);
    draw({ ...chat(cut), readOnly: "archived" }, cut);

    expect(pressed.has("이어서 하기")).toBe(false);
    expect(pressed.has("다시 잇기")).toBe(false);
  });
});

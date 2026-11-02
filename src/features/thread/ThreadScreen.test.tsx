import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { scopeKey } from "@/features/services/hooks";
import type { ReadingScope, ScopeOf } from "@/features/services/scope";
import { applyEngineEvent, checkEngine } from "./engine-store";
import { threadQuery } from "./hooks";
import { fillDraft, mergeLines, NEW_THREAD, setDraft, setQueue, takeFill } from "./thread-store";
import { seedOf, withoutNewWork, type NewThreadSeed } from "@/routes/-new-thread-search";
import { NewThreadScreen, ThreadScreen } from "./ThreadScreen";
import type { RecordLine, ThreadView } from "./types";

// 엔진은 앱 명령으로만 닿는다 — 확인을 붙들어 두는 시험이 그 답을 정한다.
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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
  flowing: null,
};

const codexRecord: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-codex.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

function draw(view: ThreadView, lines: RecordLine[] = blessed): string {
  const client = new QueryClient();
  client.setQueryData(threadQuery(view.id).queryKey, view);
  mergeLines(view.id, lines);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ThreadScreen thread={view.id} />
      </ToastProvider>
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

  // 스토리 31 — 턴이 시작되면 Runtime이 잠긴다. 채팅 화면은 첫 말이 간 뒤라 이름만 선다.
  it("Runtime 칩은 그 채팅의 Runtime 이름으로 잠겨 선다 — 메뉴가 없다", () => {
    for (const [runtime, name] of [
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
    ] as const) {
      const html = draw({ ...chat, id: `20261010-10001${runtime.length}`, runtime });
      expect(html, runtime).toContain(`aria-label="Runtime ${name}"`);
      expect(html, runtime).not.toContain('aria-label="Runtime:');
    }
  });

  // restart 01c-5 · 스토리 24 · 26 · 34 — Codex 채팅의 칩은 Codex가 보낸 대로 선다. 모드 칩의 값은 Codex가 알린 `currentModeId`(agent — 「Auto review」)가
  // 아니라 채팅 파일의 Codex 모드다.
  it("Codex 채팅은 채팅 파일의 모드와 Codex가 보낸 모델 · 생각 깊이를 칩에 세운다 — 물어보는 정도 칩이 없다", () => {
    const view: ThreadView = { ...chat, id: "20261010-100020", runtime: "codex", codexMode: "read-only", model: null, effort: null, lastSeq: 23 };
    const html = draw(view, codexRecord);
    const chip = /<button\b[^>]*aria-label="Codex 모드 Read-only"[^>]*>/.exec(html)?.[0];
    expect(chip).toContain("aria-haspopup");
    expect(html).not.toContain("Auto review");
    expect(html).not.toContain("물어보는 정도");
    expect(html).toContain('aria-label="모델과 생각 깊이 6.1 Sol · Xhigh"');
  });

  it("Codex 채팅의 「/」 메뉴는 Codex가 보낸 명령을 보인다", () => {
    const view: ThreadView = { ...chat, id: "20261010-100021", runtime: "codex", lastSeq: 23 };
    setDraft(view.id, "/");
    const html = draw(view, codexRecord);
    expect(html).toContain("Turn plan mode on.");
    expect(html).not.toContain("계획만 세우고 멈추기");
  });

  // restart 01c-9 · 스토리 37 — 카드는 입력창 자리에 서고 흐름은 그대로 보인다. 쓰던 말은 입력창의 것이라 카드가 걷히면 다시 선다. Runtime마다라
  // Codex의 로그인 끊김은 Claude 채팅에 카드를 세우지 않는다. 선 채팅에는 Runtime을 바꾸는 단추가 없다 — 턴이 시작되면 Runtime이 잠긴다.
  it("Codex의 로그인이 끊기면 Codex 채팅의 입력창 자리에 카드가 서고 흐름과 쓰던 말이 남는다 — Claude 채팅은 그대로다", () => {
    const view: ThreadView = { ...chat, id: "20261010-100030", runtime: "codex", lastSeq: 23 };
    const claude = { ...chat, id: "20261010-100031" };
    setDraft(view.id, "보내려던 말");
    setDraft(claude.id, "Claude에 쓰던 말");
    applyEngineEvent({ agent: "codex", found: true, loggedIn: false, login: null, missing: [] });
    try {
      const html = draw(view, codexRecord);
      expect(html).toContain("Codex에 로그인이 안 돼 있어요");
      expect(html).toContain("Reply with exactly one word: ok");
      expect(html).not.toContain('aria-label="보낼 말"');
      expect(html).not.toContain("바꾸기");

      const other = draw(claude);
      expect(other).not.toContain("로그인이 안 돼 있어요");
      expect(other).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>Claude에 쓰던 말<\/textarea>/);

      applyEngineEvent({ agent: "codex", found: true, loggedIn: true, login: null, missing: [] });
      expect(draw(view, codexRecord)).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>보내려던 말<\/textarea>/);
    } finally {
      applyEngineEvent({ agent: "codex", found: true, loggedIn: true, login: null, missing: [] });
      setDraft(view.id, "");
      setDraft(claude.id, "");
    }
  });

  it("범위 칩과 범위 줄은 첫 말 뒤에 서지 않는다 — 범위는 대화로 바꾼다", () => {
    const html = draw({ ...chat, id: "20261010-100003" });
    expect(html).not.toContain('aria-label="범위');
    expect(html).not.toContain('aria-label="Service');
    expect(html).not.toContain('data-slot="scope-line"');
  });
});

describe("새 채팅 화면", () => {
  const SEEDLESS = { link: null, say: null, service: null, project: null } as const;
  const READ: ReadingScope = { service: null, project: null, projects: [], worked: [], kind: "all", registered: 2 };
  const drawNew = (seed: Partial<NewThreadSeed> = {}, reading?: [ScopeOf, Partial<ReadingScope>]) => {
    const client = new QueryClient();
    if (reading) client.setQueryData(scopeKey(reading[0]), { ...READ, ...reading[1] });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <NewThreadScreen seed={{ ...SEEDLESS, ...seed }} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  };

  // 스토리 30 — 새 채팅에서 Claude Code와 Codex 중 하나를 고른다. 기본은 Claude Code다.
  it("Runtime 칩은 Claude Code를 고른 채 메뉴로 선다", () => {
    expect(drawNew()).toContain('aria-label="Runtime: Claude Code"');
  });

  // restart 01c-9 · 스토리 37 · 40 · 스펙 「재는 동작 · 화면」 — 첫 말 전에 고른 Runtime을 쓸 수 없으면 입력창 자리에 카드가 서고, 그 카드에서
  // 다른 Runtime으로 바꾼다. 쓰던 말은 입력창의 것이라 카드가 걷히면 그대로 선다. 바꾼 Runtime의 카드는 Codex 쪽 시험(`GuideCard.test.tsx`)이 잰다.
  it("고른 Runtime을 쓸 수 없으면 입력창 자리에 카드가 서고 다른 Runtime으로 바꾸는 단추가 선다 — 쓰던 말은 남는다", () => {
    setDraft(NEW_THREAD, "보내려던 말");
    applyEngineEvent({ agent: "claude", found: false, loggedIn: null, login: null, missing: [{ name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" }] });
    try {
      const html = drawNew();
      expect(html).toContain("무엇을 만들까요?");
      expect(html).toContain("claude를 찾지 못했어요");
      expect(html).toContain(">Codex로 바꾸기<");
      expect(html).toContain(">다시 찾기<");
      expect(html).toContain(">설치 안내<");
      expect(html).not.toContain('aria-label="보낼 말"');

      applyEngineEvent({ agent: "claude", found: true, loggedIn: true, login: null, missing: [] });
      expect(drawNew()).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>보내려던 말<\/textarea>/);
    } finally {
      applyEngineEvent({ agent: "claude", found: true, loggedIn: true, login: null, missing: [] });
      setDraft(NEW_THREAD, "");
    }
  });

  it("고른 Runtime을 확인하는 동안 보내기가 잠긴다 — 쓰기는 그대로다", async () => {
    setDraft(NEW_THREAD, "보내려던 말");
    let answer: () => void = () => {};
    invoke.mockReturnValueOnce(
      new Promise((resolve) => (answer = () => resolve({ state: "found", programs: [], loggedIn: true }))),
    );
    const checking = checkEngine("claude-code", false);
    try {
      const html = drawNew();
      const send = /<button\b[^>]*aria-label="보내기"[^>]*>/.exec(html)?.[0];
      expect(send).toContain("disabled");
      expect(html).toMatch(/<textarea(?![^>]*readOnly)[^>]*aria-label="보낼 말"[^>]*>보내려던 말<\/textarea>/);
      answer();
      await checking;
      expect(/<button\b[^>]*aria-label="보내기"[^>]*>/.exec(drawNew())?.[0]).not.toContain("disabled");
    } finally {
      answer();
      await checking;
      setDraft(NEW_THREAD, "");
    }
  });

  it("작업공간 없는 새 채팅의 칩은 「편집 자동」이다", () => {
    expect(drawNew()).toContain('aria-label="물어보는 정도 편집 자동"');
  });

  it("씨앗이 없는 새 채팅은 작업공간 없는 채팅이다 — Work 칩이 서지 않는다", () => {
    const html = drawNew();
    expect(html).not.toContain("작업공간 없이 대화");
    expect(html).not.toContain("새 작업공간");
    expect(html).not.toContain("어디서 일할지");
    expect(html).toContain('placeholder="무엇이든 요청하세요"');
  });

  it("예전 판이 기억한 스위치 값을 읽지 않는다", () => {
    globalThis.localStorage = { getItem: () => "new-work", setItem: () => {} } as unknown as Storage;
    try {
      expect(drawNew()).not.toContain("새 작업공간");
    } finally {
      // @ts-expect-error — 시험이 심은 저장소를 걷는다.
      delete globalThis.localStorage;
    }
  });

  it("`?new=thread`로 연 새 채팅도 작업공간 없는 채팅이고 고른 범위만 선다", () => {
    const html = drawNew(
      { link: { kind: "no-work" }, service: "결제-서비스" },
      [{ service: "결제-서비스" }, { service: { slug: "결제-서비스", name: "결제 서비스", troubled: false }, kind: "service" }],
    );
    expect(html).toContain('aria-label="범위: 결제 서비스"');
    expect(html).not.toContain("작업공간 없이 대화");
    expect(html).not.toContain("새 작업공간");
    expect(html).toContain('placeholder="무엇이든 요청하세요"');
  });

  it("`?new=work`로 연 새 채팅에 「새 작업공간」 칩이 서고 ×로 뺀다 — 고르는 메뉴는 없다", () => {
    const html = drawNew({ link: { kind: "new-work" } });
    expect(html).toContain('data-slot="new-work-chip"');
    expect(html).toContain('aria-label="새 작업공간 빼기"');
    expect(html).not.toContain("어디서 일할지");
    expect(html).toContain('placeholder="만들 기능이나 고칠 문제를 적어 주세요"');
    expect(html.indexOf('data-slot="new-work-chip"')).toBeLessThan(html.indexOf('aria-label="범위 없음"'));
  });

  it("「새 작업공간」 칩을 ×로 빼면 그냥 새 채팅이다 — 범위는 남는다", () => {
    const service: [ScopeOf, Partial<ReadingScope>] = [
      { service: "결제-서비스" },
      { service: { slug: "결제-서비스", name: "결제 서비스", troubled: false }, kind: "service" },
    ];
    const made = { link: { kind: "new-work" }, say: null, service: "결제-서비스", project: null } as const;
    expect(drawNew(made, service)).toContain('data-slot="new-work-chip"');
    const html = drawNew(seedOf(withoutNewWork(made)), service);
    expect(html).not.toContain("새 작업공간");
    expect(html).toContain('aria-label="범위: 결제 서비스"');
    expect(html).toContain('placeholder="무엇이든 요청하세요"');
    expect(html).toContain('aria-label="물어보는 정도 편집 자동"');
  });

  it("`?work=`로 연 새 채팅의 칩은 그 작업공간을 보이기만 한다 — 메뉴도 ×도 없다", () => {
    const html = drawNew({ link: { kind: "work", slug: "refund-api" } });
    expect(html).toContain('aria-label="작업공간으로 가기: refund-api"');
    expect(html).not.toContain("어디서 일할지");
    expect(html).not.toContain("빼기");
    expect(html).toContain('placeholder="refund-api에서 무엇을 할까요?"');
  });

  // 씨앗의 말은 화면이 선 뒤에 효과가 넣는다. 정적 그림에는 효과가 돌지 않아 그 자리를 채워 두고 재고, 주소에서 입력칸까지는 L3가 잰다.
  it("`?new=thread` · `?service=` · `?say=`의 말이 입력창에 채워져 있고 사람을 기다린다", () => {
    const say = "결제 서비스에 Project를 넣고 싶어요. ";
    fillDraft(NEW_THREAD, say);
    try {
      const html = drawNew(
        { link: { kind: "no-work" }, service: "결제-서비스", say },
        [{ service: "결제-서비스" }, { service: { slug: "결제-서비스", name: "결제 서비스", troubled: false }, kind: "service" }],
      );
      expect(html).toMatch(new RegExp(`<textarea[^>]*>${say}</textarea>`));
      expect(html).toContain('aria-label="범위: 결제 서비스"');
      expect(html).toContain('aria-label="보내기"');
      expect(html).not.toContain('aria-label="보내는 중"');
      expect(html).toContain("무엇을 만들까요?");
      expect(html).not.toContain("생각 중");
    } finally {
      takeFill();
      setDraft(NEW_THREAD, "");
    }
  });

  it("씨앗이 없으면 범위 칩이 「범위 없음」으로 선다", () => {
    expect(drawNew()).toContain('aria-label="범위 없음"');
  });

  it("`?service=`로 연 새 채팅의 칩에 그 Service가 골라져 있다", () => {
    const html = drawNew(
      { service: "결제-서비스" },
      [{ service: "결제-서비스" }, { service: { slug: "결제-서비스", name: "결제 서비스", troubled: false }, kind: "service" }],
    );
    expect(html).toContain('aria-label="범위: 결제 서비스"');
    expect(html).toContain('aria-label="범위 빼기"');
  });

  it("`?project=`로 연 새 채팅의 칩에 그 Project가 골라져 있다", () => {
    const html = drawNew(
      { project: "api-server" },
      [
        { project: "api-server" },
        { project: { slug: "api-server", name: "API 서버" }, projects: [{ slug: "api-server", name: "API 서버", why: "project" }], kind: "project" },
      ],
    );
    expect(html).toContain('aria-label="범위: API 서버"');
    expect(html).toContain("API 서버를 읽어요");
  });

  it("「새 작업공간」으로 연 새 채팅도 그 Project를 고른 채 선다", () => {
    const html = drawNew({ link: { kind: "new-work" }, project: "api-server" });
    expect(html).toContain('aria-label="범위: api-server"');
    expect(html).toContain('aria-label="새 작업공간 빼기"');
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { scopeKey } from "@/features/services/hooks";
import type { ReadingScope, ScopeOf } from "@/features/services/scope";
import { applyEngineEvent, checkEngine } from "./engine-store";
import { threadQuery } from "./hooks";
import { worksQuery } from "@/features/works/hooks";
import { workFixture } from "@/features/works/work-fixture";
import { fillDraft, mergeLines, NEW_THREAD, setDraft, setQueue, takeFill } from "./thread-store";
import { seedOf, withoutNewWork, type NewThreadSeed } from "@/routes/-new-thread-search";
import { NewThreadScreen, ThreadScreen, useWorkRightPlace, WorkChat, type ChatCard } from "./ThreadScreen";
import type { ReadingPlace } from "./reading-place";
import { chatSeat, moveSeat, rightPlaceStore } from "./right-place";
import type { WorkView } from "@/features/works/types";
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

// 채팅 화면의 창 머리는 앱 셸의 머리 줄로 포털을 탄다 — 정적 렌더는 포털을 못 그려, 머리를 이 마크업 안 머리 줄에 곧장 세운다
// (`screen-head-inline`). 머리는 `<header data-slot="screen-head">`로 선다.
vi.mock("@/components/shell/ShellHead", async (actual) =>
  (await import("@/components/shell/screen-head-inline")).inlineScreenHead(actual),
);

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
    applyEngineEvent({ agent: "codex", found: true, loggedIn: false, missing: [] });
    try {
      const html = draw(view, codexRecord);
      expect(html).toContain("Codex에 로그인이 안 돼 있어요");
      expect(html).toContain("Reply with exactly one word: ok");
      expect(html).not.toContain('aria-label="보낼 말"');
      expect(html).not.toContain("바꾸기");

      const other = draw(claude);
      expect(other).not.toContain("로그인이 안 돼 있어요");
      expect(other).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>Claude에 쓰던 말<\/textarea>/);

      applyEngineEvent({ agent: "codex", found: true, loggedIn: true, missing: [] });
      expect(draw(view, codexRecord)).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>보내려던 말<\/textarea>/);
    } finally {
      applyEngineEvent({ agent: "codex", found: true, loggedIn: true, missing: [] });
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

  // Thread 보드의 입력창 · 02b-2 — 첫 말 뒤의 입력창에는 트레이가 없다. 어디서 일하는지는 탭 줄 · 창 머리가 말한다.
  it("첫 말 뒤의 입력창에는 트레이도 Work 칩도 없다", () => {
    for (const view of [{ ...chat, id: "20261010-100004" }, { ...chat, id: "20261010-100005", newWork: true }]) {
      const html = draw(view);
      expect(html).not.toContain('data-slot="composer-tray"');
      expect(html).not.toContain("작업공간 없이 대화");
      expect(html).not.toContain("새 작업공간");
    }
  });

  // Thread 보드 `.ra-dock::before` · 02b-2 — 바닥에 붙은 입력창 자리는 위 28에 페이드를 둬 굴리는 대화가 그 밑으로 사라진다.
  it("입력창이 바닥에 붙은 자리(dock)에 선다", () => {
    expect(draw({ ...chat, id: "20261010-100006" })).toMatch(/<div[^>]*data-dock=""/);
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

  // 첫 화면의 입력창은 물음 아래 가운데에 선다 — 바닥에 붙지 않아 지나갈 대화가 없다(보드 `.ra-home`).
  it("첫 말 전의 입력창은 바닥 자리(dock)가 아니다", () => {
    expect(drawNew()).not.toContain("data-dock");
  });

  // 스토리 30 — 새 채팅에서 Claude Code와 Codex 중 하나를 고른다. 기본은 Claude Code다.
  it("Runtime 칩은 Claude Code를 고른 채 메뉴로 선다", () => {
    expect(drawNew()).toContain('aria-label="Runtime: Claude Code"');
  });

  // restart 01c-9 · 스토리 37 · 40 · 스펙 「재는 동작 · 화면」 — 첫 말 전에 고른 Runtime을 쓸 수 없으면 입력창 자리에 카드가 서고, 그 카드에서
  // 다른 Runtime으로 바꾼다. 쓰던 말은 입력창의 것이라 카드가 걷히면 그대로 선다. 바꾼 Runtime의 카드는 Codex 쪽 시험(`GuideCard.test.tsx`)이 잰다.
  it("고른 Runtime을 쓸 수 없으면 입력창 자리에 카드가 서고 다른 Runtime으로 바꾸는 단추가 선다 — 쓰던 말은 남는다", () => {
    setDraft(NEW_THREAD, "보내려던 말");
    applyEngineEvent({ agent: "claude", found: false, loggedIn: null, missing: [{ name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" }] });
    try {
      const html = drawNew();
      expect(html).toContain("무엇을 만들까요?");
      expect(html).toContain("claude를 찾지 못했어요");
      expect(html).toContain(">Codex로 바꾸기<");
      expect(html).toContain(">다시 찾기<");
      expect(html).toContain(">설치 안내<");
      expect(html).not.toContain('aria-label="보낼 말"');

      applyEngineEvent({ agent: "claude", found: true, loggedIn: true, missing: [] });
      expect(drawNew()).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>보내려던 말<\/textarea>/);
    } finally {
      applyEngineEvent({ agent: "claude", found: true, loggedIn: true, missing: [] });
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

  it("`?work=`로 연 새 채팅은 트레이에 Work 칩 없이 범위 칩만 선다 — 어디서 일하는지는 안내 글이 말한다", () => {
    const html = drawNew({ link: { kind: "work", slug: "refund-api" } });
    expect(html).not.toContain("작업공간으로 가기");
    expect(html).not.toContain("어디서 일할지");
    expect(html).not.toContain("빼기");
    expect(html).toContain('aria-label="범위 없음"');
    expect(html).toContain('placeholder="refund-api에서 무엇을 할까요?"');
  });

  // States 보드 01 「빈 채팅」 · Thread 보드 `.ra-empty-q`(restart 02b-1) — 작업공간의 새 채팅은 물음 아래 그 작업공간의 slug · 브랜치가 서고 입력창은
  // 바닥이다. 홈의 새 채팅에는 그 줄이 없다(Home 보드).
  it("작업공간의 새 채팅은 물음 아래 그 작업공간의 slug · 브랜치가 선다 — 홈에는 없다", () => {
    const client = new QueryClient();
    client.setQueryData(worksQuery().queryKey, [workFixture({ slug: "watcher-failure-signal", branch: "feat/watcher-failure-signal" })]);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <NewThreadScreen seed={{ ...SEEDLESS, link: { kind: "work", slug: "watcher-failure-signal" } }} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const words = html.replace(/<[^>]*>/g, "");
    expect(words).toContain("무엇을 만들까요?watcher-failure-signal · feat/watcher-failure-signal");
    expect(drawNew()).not.toContain(" · feat/");
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
    // 고른 범위도 ▾로 메뉴를 연다 — 빼기는 메뉴의 「범위 없음」이다(Composer 「새 채팅 · 범위 트레이」).
    expect(html).not.toContain('aria-label="범위 빼기"');
    expect(html).toMatch(/aria-label="범위: 결제 서비스"[^>]*aria-haspopup|aria-haspopup[^>]*aria-label="범위: 결제 서비스"/);
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

/** 작업공간 화면이 채팅 탭 몸에 건네는 오른쪽 자리 — 시험은 값만 바꿔 건넨다. */
function cardOf(over: Partial<ChatCard> = {}): ChatCard {
  return {
    open: false,
    opened: null,
    docPlace: null,
    onShowChanges: () => {},
    onOpen: () => {},
    onOpenFile: () => {},
    onClose: () => {},
    ...over,
  };
}

// restart 02a-4 — 작업공간의 채팅은 작업공간 화면의 채팅 탭에 선다. 머리 줄은 작업공간의 것이라 채팅은 머리 없이 본문만 꽂힌다(`PlainFrame`의
// 머리는 셸 머리 줄에 포털해 겹친다). restart 02a-9 — 요약 단추는 작업공간 화면의 창 머리에 서고, 오른쪽 자리의 값은 작업공간 화면이 쥐어 몸에
// 건넨다(`ChatCard`). 몸은 받은 대로 대화 폭과 카드 자리를 그린다.
describe("작업공간의 채팅 탭", () => {
  const work = workFixture();
  const linked: ThreadView = { ...chat, id: "20261010-120000", work: work.slug };

  function drawTab(view: ThreadView, place: ReadingPlace | null = null, card: ChatCard = cardOf()): string {
    const client = new QueryClient();
    client.setQueryData(worksQuery().queryKey, [work]);
    client.setQueryData(threadQuery(view.id).queryKey, view);
    mergeLines(view.id, blessed);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <WorkChat thread={view.id} card={card} place={place} onLeave={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  // restart 02a-6 — 숨은 채팅 탭은 내려간다. 돌아온 탭은 탭이 쥔 읽던 자리에서 선다 — 위로 올려 읽던 탭은 바닥을 따라가지 않아 「맨 아래로」가
  // 서고, 바닥을 따라가던 탭과 처음 여는 탭은 바닥이라 서지 않는다. 굴림 거리 자체는 정적 마크업에 없어 L3(02a-16)가 잰다.
  it("위로 올려 읽던 탭은 그 자리로 돌아와 「맨 아래로」가 선다", () => {
    expect(drawTab(linked, { kind: "at", top: 480 })).toContain('aria-label="맨 아래로"');
  });

  it("바닥을 따라가던 탭과 처음 여는 탭은 바닥이라 「맨 아래로」가 없다", () => {
    expect(drawTab(linked, { kind: "bottom" })).not.toContain('aria-label="맨 아래로"');
    expect(drawTab(linked)).not.toContain('aria-label="맨 아래로"');
  });

  it("제 카드 없이 흐름과 입력창만 선다", () => {
    const html = drawTab(linked);
    expect(html).not.toContain("<main");
    expect(html).toContain("hello from turn");
    expect(html).toContain('aria-label="보낼 말"');
  });

  // 02a-4의 임시 단추(탭 몸 오른쪽 위)를 걷었다 — 단추는 창 머리 하나다(`WorksPage.test.tsx`).
  it("몸 안에 요약 단추가 없다", () => {
    const html = drawTab(linked, null, cardOf({ open: true }));
    expect(html).not.toContain('aria-label="요약 카드"');
    expect(html).not.toContain("요약 고정");
  });

  it("오른쪽 자리가 요약 카드면 카드가 서고, 아니면 없다", () => {
    expect(drawTab(linked, null, cardOf({ open: true }))).toMatch(/<section[^>]*aria-label="요약"/);
    expect(drawTab(linked, null, cardOf({ open: false }))).not.toMatch(/<section[^>]*aria-label="요약"/);
  });

  it("작은 카드는 대화를 넓은 폭 그대로 두고 판 위 · 오른쪽 8에 선다", () => {
    const html = drawTab(linked, null, cardOf({ open: true }));
    expect(html).toContain("width:100%");
    expect(html).not.toContain("var(--size-thread-beside)");
    // 단추가 쓰던 탭 몸 오른쪽 위 자리(02a-4의 임시 — 카드가 그 아래 `top-11`에 섰다)가 걷혀 카드가 판 위 8에 선다.
    expect(html).toMatch(/class="pointer-events-none absolute[^"]*\btop-2\b/);
    expect(html).not.toContain("top-11");
  });

  // 스토리 95 — 넓힌 카드는 대화 옆에 선다. 대화는 왼쪽 480(`size-thread-beside`)에 남고 카드가 그 오른쪽을 채운다.
  it("넓힌 카드가 연 것이 있으면 대화가 왼쪽 480에 남고 카드가 넓어진다 — 대화 열은 카드를 비키지 않는다", () => {
    const html = drawTab(linked, null, cardOf({ open: true, opened: { kind: "doc", path: "overview.md" } }));
    expect(html).toContain("width:var(--size-thread-beside)");
    expect(html).toContain("left:var(--size-thread-beside)");
    expect(html).toMatch(/<section[^>]*aria-label="요약"[^>]*data-expanded=""/);
    // 대화 자리가 이미 480이라 비킬 몫이 없다(보드 Main `beside: summaryShown && !wide`) — 몫이 남으면 480 안에서 열이 132로 줄어든다.
    expect(html).not.toContain("basis-(--size-summary-room)");
    expect(drawTab(linked, null, cardOf({ open: true }))).toContain("basis-(--size-summary-room)");
  });
});

// restart 02a-9 · 스토리 93 · 94 · SummarySheet 표 — 탭 줄이 없는 채팅(작업공간 밖 · 보관)은 그 채팅을 열쇠로 오른쪽 자리를 쥔다(`chatSeat`).
// 처음 열면 카드가 닫혀 있고 창 머리의 「요약 카드」가 연다. 작업공간 밖 채팅은 작은 카드만 쓴다 — 넓힐 곳이 없다.
describe("탭 줄이 없는 채팅의 오른쪽 자리", () => {
  afterEach(() => rightPlaceStore.setState(() => ({})));

  it("처음 열면 요약 카드가 닫혀 있고 창 머리의 「요약 카드」가 꺼져 있다", () => {
    const html = draw({ ...chat, id: "20261010-150000" });
    expect(html).not.toMatch(/<section[^>]*aria-label="요약"/);
    expect(/<button\b[^>]*aria-label="요약 카드"[^>]*>/.exec(headOf(html))?.[0]).toContain('aria-pressed="false"');
  });

  it("오른쪽 자리가 요약 카드면 작은 카드가 서고 단추가 켜진다", () => {
    const id = "20261010-150001";
    moveSeat(chatSeat(id), null, { kind: "toggle", place: "summary" });
    const html = draw({ ...chat, id });
    expect(html).toMatch(/<section[^>]*aria-label="요약"/);
    expect(/<button\b[^>]*aria-label="요약 카드"[^>]*>/.exec(headOf(html))?.[0]).toContain('aria-pressed="true"');
  });

  it("작업공간 밖 채팅에는 넓힌 카드가 없다 — 넓혀 둔 값이어도 작은 카드이고 대화가 넓은 폭이다", () => {
    const id = "20261010-150002";
    moveSeat(chatSeat(id), null, { kind: "expand", target: { kind: "doc", path: "overview.md" } });
    const html = draw({ ...chat, id });
    expect(html).toMatch(/<section[^>]*aria-label="요약"/);
    expect(html).not.toContain("data-expanded");
    expect(html).not.toContain("var(--size-thread-beside)");
  });

  it("값은 채팅마다다 — 한 채팅에서 연 카드가 다른 채팅에 서지 않는다", () => {
    moveSeat(chatSeat("20261010-150003"), null, { kind: "toggle", place: "summary" });
    expect(draw({ ...chat, id: "20261010-150004" })).not.toMatch(/<section[^>]*aria-label="요약"/);
  });
});

// SummarySheet 표 「넓힌 카드」 · 「×」의 사이드바 칸 — 넓힌 카드가 서 있는 동안 사이드바가 접히고 걷히면 되돌아온다. 접기는 효과라 정적 그림에
// 없다 — 판정(`rightShown`의 `opened`)은 `right-place.test.ts`가 재고, 여기서는 작업공간 화면의 오른쪽 자리가 그 판정으로 접는 배선을 못박는다.
// 채팅 화면(탭 줄이 없는 채팅)에는 넓힌 카드가 없어 접는 자리가 없다. 손짓은 L3(02a-16)가 잰다.
describe("넓힌 카드와 사이드바", () => {
  const screen = readFileSync(fileURLToPath(new URL("./ThreadScreen.tsx", import.meta.url)), "utf8");

  it("작업공간 화면의 오른쪽 자리가 넓힌 카드가 서 있는 동안 사이드바를 접는다 — 접는 자리는 거기 하나다", () => {
    expect(screen).toContain("useFoldSidebar(shown.opened !== null);");
    expect(screen.match(/useFoldSidebar\(/g)).toHaveLength(2);
  });
});

/** 창 머리 — 화면이 셸의 머리 줄로 보낸 것(이 파일에서는 제자리 `header`에 선다). */
const headOf = (html: string) => html.match(/<header data-slot="screen-head">[\s\S]*?<\/header>/)?.[0] ?? "";
/** 머리 오른쪽 끝 묶음(`HeadEnd`). */
const endOf = (head: string) => head.slice(head.indexOf("data-head-actions"));
/** 머리의 채팅 이름 칸 — 이름 글자만 든 `span`. */
const titleTag = (head: string, title: string) => head.match(new RegExp(`<span[^>]*>${title}</span>`))?.[0] ?? "";

// restart 02a-7 · 스토리 92 · 보드 MainLoose 창 머리 · Shell 「어디에 서나」 — 탭 줄이 없는 채팅(작업공간 밖 채팅, 작업공간이 보관되거나 지워져
// 읽기만 되는 채팅)은 `/threads/:id`에 서고 창 머리를 쓴다: 셸 컨트롤 뒤 세로선 다음에 제목, 그 바로 뒤에 ⋯(채팅 메뉴)가 서고, 요약 단추
// (「요약 카드」 — 02a-9)는 오른쪽 끝이다. 이름은 창 머리에서 바꾼다(두 번 클릭 · F2 · ⋯의 「이름 바꾸기」 — 읽기만인 채팅은 못 바꾼다).
describe("탭 줄이 없는 채팅의 창 머리", () => {
  it("작업공간 밖 채팅은 제목 바로 뒤에 ⋯가 서고, 요약 단추만 오른쪽 끝에 선다", () => {
    const head = headOf(draw({ ...chat, id: "20261010-130000" }));
    const at = [chat.title, 'aria-label="채팅 메뉴"', "data-head-actions", 'aria-label="요약 카드"'].map((one) => head.indexOf(one));
    expect(at.every((one) => one > -1), head).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(endOf(head)).not.toContain("채팅 메뉴");
  });

  it("작업공간 밖 채팅의 이름은 창 머리에서 바꾼다 — 제목이 포커스를 받고 F2가 이름 바꾸기다", () => {
    const title = titleTag(headOf(draw({ ...chat, id: "20261010-130001" })), chat.title);
    expect(title).toContain('tabindex="0"');
    expect(title).toContain('aria-keyshortcuts="F2"');
  });

  it("보관된 작업공간의 채팅도 창 머리에 제목과 ⋯가 선다 — 이름은 바꾸지 못한다", () => {
    const view: ThreadView = { ...chat, id: "20261010-130002", work: "shelved-work", readOnly: "archived" };
    const head = headOf(draw(view));
    expect(head.indexOf(chat.title)).toBeGreaterThan(-1);
    expect(head.indexOf('aria-label="채팅 메뉴"')).toBeGreaterThan(head.indexOf(chat.title));
    expect(endOf(head)).not.toContain("채팅 메뉴");
    const title = titleTag(head, chat.title);
    expect(title).not.toBe("");
    expect(title).not.toContain("aria-keyshortcuts");
  });
});

// restart 02a-7 · 구현 스펙 「02a — 작업공간 밖 채팅」 — 작업공간 밖 채팅에는 열 곳(넓힌 카드)이 없어 대화의 문서 카드와 바뀐 파일 알약을 그리지
// 않는다. 작업공간의 채팅(채팅 탭)에는 그대로 선다.
describe("작업공간 밖 채팅의 대화", () => {
  const HOME = "/Users/tester";
  const atHome = (lines: RecordLine[]) => JSON.parse(JSON.stringify(lines).split("~/.atelier/").join(`${HOME}/.atelier/`)) as RecordLine[];
  const worked = atHome(
    readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-work.jsonl", import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RecordLine),
  );
  const slug = "refund-partial-amount";
  const made = workFixture({ slug, specDir: `~/.atelier/works/${slug}/spec` });

  /** 작업공간 화면이 하듯 그 작업공간의 오른쪽 자리를 쥐어 채팅 탭 몸에 건넨다 — 문서 카드의 자리(spec 폴더)도 거기서 온다. */
  function TabBody({ id, work }: { id: string; work: WorkView }) {
    const right = useWorkRightPlace(work, { chat: true, tab: 1, openFile: () => {} });
    return <WorkChat thread={id} card={right.card} />;
  }

  function drawWith(view: ThreadView, lines: RecordLine[], body: (id: string) => ReactNode): string {
    const client = new QueryClient();
    client.setQueryData(worksQuery().queryKey, [made]);
    client.setQueryData(["home-dir"], HOME);
    client.setQueryData(threadQuery(view.id).queryKey, view);
    mergeLines(view.id, lines);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>{body(view.id)}</ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("바뀐 파일 알약이 없다 — 작업공간의 채팅 탭에는 선다", () => {
    const pill = /aria-label="\d+개 파일 변경됨"/;
    const loose = drawWith({ ...chat, id: "20261010-140000" }, blessed, (id) => <ThreadScreen thread={id} />);
    expect(loose).toContain("hello from turn");
    expect(loose).not.toMatch(pill);
    const linked = drawWith({ ...chat, id: "20261010-140001", work: slug }, blessed, (id) => <TabBody id={id} work={made} />);
    expect(linked).toMatch(pill);
  });

  it("대화의 문서 카드가 없다 — 작업공간의 채팅 탭에는 선다", () => {
    const last = worked[worked.length - 1].seq;
    const loose = drawWith({ ...chat, id: "20261010-140002", lastSeq: last }, worked, (id) => <ThreadScreen thread={id} />);
    expect(loose).not.toContain("data-doc-card");
    const linked = drawWith({ ...chat, id: "20261010-140003", work: slug, lastSeq: last }, worked, (id) => <TabBody id={id} work={made} />);
    expect(linked).toContain("data-doc-card");
  });
});

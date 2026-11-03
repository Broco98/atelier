/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorksPage, { shellClosedByTab, viewTabClosedByTab } from "./WorksPage";
import { ToastProvider } from "@/components/ui/toast";
import { TAB_ROW_CARD, TAB_ROW_COLUMN } from "@/components/shell/panel-layout";
import { specFileQuery, worksQuery } from "./hooks";
import { projectsQuery } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";
import { threadQuery, threadsQuery } from "@/features/thread/hooks";
import { scopeKey } from "@/features/services/hooks";
import type { ReadingScope } from "@/features/services/scope";
import { bodyTabStore, followTab, moveSeat, rightPlaceStore, workSeat } from "@/features/thread/right-place";
import { dragStore } from "@/lib/pointer-drag";
import { forgetNewChat, newChatKey } from "@/features/thread/new-chat";
import { addChunk, discardFlow, mergeLines, NEW_THREAD, setDraft, setQuote } from "@/features/thread/thread-store";
import type { RecordLine, ThreadSummary, ThreadView } from "@/features/thread/types";
import type { ViewTab } from "@/routes/-work-search";
// 셸 목록이 패널로 오면서(결정 42) 이 화면이 터미널 스토어를 조립한다. 그 배선은 상태를
// 손으로 넣어야 보이므로 여기서 스토어를 직접 만진다 — **모듈 싱글턴이라 비우고 나간다.**
import {
  activeIdOf,
  keepChatPlace,
  MAX_SHELLS,
  NO_SHELLS,
  openChatTab,
  openCodeTab,
  openNewChatTab,
  openShell,
  ownerOf,
  shellCapNotice,
  topTerminal,
} from "@/features/terminal/shell-registry";
import type { ShellOrigin } from "@/features/terminal/shell-registry";
import {
  onNewShellRequested,
  onShellOpenRejected,
  openNewShell,
  requestNewShell,
  terminalStore,
} from "@/features/terminal/terminal-store";

// 머리(이름 · 할 일)는 앱 셸의 머리 줄로 포털을 탄다 — 정적 렌더는 포털을 못 그려, 머리를 이 화면의 마크업 안 머리 줄에 곧장 세운다
// (`screen-head-inline`).
vi.mock("@/components/shell/ShellHead", async (actual) =>
  (await import("@/components/shell/screen-head-inline")).inlineScreenHead(actual),
);

// spec 패널의 몸은 앱 셸의 작업공간 도구 기둥으로 포털을 탄다(restart 02a-14 · `WorkTools`) — 정적 렌더는 포털도 이펙트도 못 그려, 화면이
// 건넨 값과 몸으로 기둥(패널 상자 · 레일)을 이 화면의 마크업 끝에 곧장 그린다(`work-tools-inline`).
vi.mock("@/components/shell/WorkTools", async (actual) =>
  (await import("@/components/shell/work-tools-inline")).inlineWorkTools(actual),
);

// 작업 패널을 여닫는 길은 **머리 줄의 패널 토글 하나**다(ui-refresh 결정 9 · codex-ds 스펙 §10 — 머리 줄 오른쪽 맨 끝, 02 구현 스펙
// §3 S2) — 한때 흩어져 있던 둘(패널 머리의 `×`와, 닫혔을 때만 창 맨 위 줄에 뜨던 「작업공간 패널 펼치기」)이 그것 하나로 합쳐졌다.
// 토글은 늘 그 자리에 있고 이름과 `aria-expanded`가 상태를 탄다.
//
// 이 화면은 작업 하나가 골라져 있어야 헤더 우측이 그려진다. 조회를 가로채는 대신
// 쿼리 캐시에 목록을 미리 넣어 둔다 — 정적 렌더는 이펙트를 돌리지 않으므로 IPC는 나가지
// 않고, 캐시에 있는 값은 그대로 읽힌다.
const work: WorkView = workFixture();

// 이 화면의 소스를 문자열로 읽는다. 렌더로 볼 수 없는 불변조건(이펙트·리마운트 자리)이
// 여기 걸리고, 그 방식은 이 저장소가 파일 간 계약에 쓰는 것과 같다
// (state-scale.test.ts · theme-tokens.test.ts · tauri-commands.test.ts).
function source(
  file: "WorksPage.tsx" | "SpecViewer.tsx" | "work-menu-actions.ts" | "../terminal/terminal-store.ts",
): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
}

// 리터럴이 **몇 번** 나오는가. 파싱이 필요 없어 파서가 샐 자리가 없다 —
// 개수가 달라지면 반드시 빨개진다(shell-registry.test.ts가 같은 것을 쓴다).
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

/**
 * 머리 줄의 화면 자리(`<header>` — 02 구현 스펙 §3). 화면의 이름 · 할 일은 셸의 머리 줄로 포털을 타고(`ScreenHead`), 이 검사에서는
 * 제자리의 `header`에 선다(`screen-head-inline`). 작업 화면이면 패널 토글이 그 오른쪽 맨 끝에 선다.
 */
const headRowOf = (markup: string) => markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";

/**
 * `start`에 맞는 여는 `<div`부터 짝이 맞는 `</div>`까지의 마크업. 상자 안에 `div`가 겹쳐 서서 깊이를 센다 — 「다음 닫는 태그까지」로는
 * 그 상자만 안 남는다. 맞는 상자가 없으면 빈 글자다.
 */
function boxOf(markup: string, start: RegExp): string {
  const open = markup.search(start);
  if (open < 0) return "";
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let tag = tags.exec(markup); tag; tag = tags.exec(markup)) {
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(open, tag.index + tag[0].length);
  }
  return "";
}

/** 머리 줄 오른쪽의 할 일 | 보기 배치 묶음(`data-head-actions` — `Frame`의 `FrameHead`) — 상태 배지 · ⋯ | 요약 카드 · 패널 토글. */
const headActionsOf = (markup: string) => boxOf(headRowOf(markup), /<div[^>]*\sdata-head-actions/);

/**
 * 탭 줄(`data-tab-row`) 상자의 마크업. 줄은 본문 카드의 머리라(codex-ds 스펙 §4) 뒤에 카드 본문이 이어 선다. 줄이 없으면 빈 글자다.
 */
const tabRowOf = (markup: string) => boxOf(markup, /<div[^>]*\sdata-tab-row="/);

/** 경로 줄(`PathBar`) 상자 — 파일 탭의 코드 위에 선다. 줄이 없으면 빈 글자다. */
const pathBarOf = (markup: string) => boxOf(markup, /<div[^>]*\sdata-slot="path-bar"/);


// 화면이 토스트 자리(Viewport)를 그리는데 그것은 Provider 밖에서 던진다 — 앱 루트(`main.tsx`)가 싸는 토스트
// Provider를 렌더 도우미도 싼다(S14). 정적 렌더라 구독은 안 걸리고 자리만 선다.
//
// 탭의 기본 값은 채팅 탭이다(주소의 기본 — restart 02a-4). `thread`가 없으면 새 채팅 탭이 본문이다(02a-8). 한때 기본이 문서 탭(`spec`)이었고
// 분할을 셋째 인자로 받았다 — restart 02a-13이 둘을 걷었다.
//
// `bodies`는 문서 본문이다(경로 → 글). 캐시에 심어 두면 본문이 그대로 그려진다. `file`은 주소의 넓힌 카드의 문서다(`currentFile`).
function render(
  overrides: Partial<WorkView> = {},
  tab: ViewTab = "chat",
  {
    bodies = {},
    chat = null,
    file = null,
  }: { bodies?: Record<string, string>; chat?: { view: ThreadView; lines: RecordLine[] } | null; file?: string | null } = {},
): string {
  const client = new QueryClient();
  client.setQueryData(worksQuery().queryKey, [{ ...work, ...overrides }]);
  for (const [path, body] of Object.entries(bodies)) {
    client.setQueryData(specFileQuery(work.slug, path).queryKey, body);
  }
  if (chat) {
    client.setQueryData(threadQuery(chat.view.id).queryKey, chat.view);
    client.setQueryData(threadsQuery().queryKey, [summaryOf(chat.view)]);
    mergeLines(chat.view.id, chat.lines);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WorksPage
          sidebarOpen
          selectedSlug={work.slug}
          currentFile={file}
          onOpenDoc={() => {}}
          tab={tab}
          onSelectTab={() => {}}
          code={null}
          onOpenCode={() => {}}
          thread={chat?.view.id ?? null}
          onOpenChat={() => {}}
          onOpenNewChat={() => {}}
          onFollowBundle={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** 레일 — `role="group"`이고 이름이 「레일」이다(레일 카드가 곧 칸 묶음이다). 그 안의 칸(`aria-pressed` 버튼)을 순서대로 읽는다. */
function railItems(markup: string): { name: string; pressed: string }[] {
  const group = boxOf(markup, /<div[^>]*aria-label="레일"/);
  return [...group.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    name: tag.match(/aria-label="([^"]*)"/)?.[1] ?? "",
    pressed: tag.match(/aria-pressed="([^"]*)"/)?.[1] ?? "",
  }));
}

/**
 * 작업 패널이 접힌 화면 — 오른쪽 자리를 「spec 패널을 걷었다」로 두고 그린 뒤 되돌린다(오른쪽 자리는 모듈 싱글턴이다). 한때 분할로 들어온
 * 화면이 이 모양이었다(결정 88 — restart 02a-13이 분할을 걷었다).
 */
function folded<T>(draw: () => T): T {
  moveSeat(workSeat(work.slug), "spec", { kind: "hide", place: "spec" });
  try {
    return draw();
  } finally {
    rightPlaceStore.setState(() => ({}));
  }
}

/** 패널 토글의 여는 태그들 — 이름이 상태를 타므로 두 이름 중 하나로 집는다. 맞는 것을 다 돌려주고, 없으면 빈 배열이다. */
const panelToggleTags = (markup: string) =>
  markup.match(/<button[^>]*aria-label="작업공간 패널 (?:접기|펼치기)"[^>]*>/g) ?? [];

describe("WorksPage 패널 토글과 레일", () => {
  beforeEach(() => {
    // 작업 패널이 폭을 여기서 읽는다
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("패널이 열려 있으면 토글이 하나이고 「작업공간 패널 접기」 · `aria-expanded=\"true\"`다", () => {
    // ui-refresh 결정 9로 **뒤집혔다** — 한때 「열려 있으면 여는 아이콘이 없다 · 늘 보이는 토글이 없다」였다(여는 길은 창 맨 위
    // 줄, 닫는 길은 패널 머리의 `×`). 이제 그 둘이 토글 하나로 합쳐져 늘 서 있고, 누르면 무슨 일이 날지를 이름이 말한다.
    // 첫 화면은 패널이 열린 상태다(WorksPage의 workPanelOpen 초기값).
    const tags = panelToggleTags(render());
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('aria-label="작업공간 패널 접기"');
    expect(tags[0]).toContain('aria-expanded="true"');
  });

  it("패널이 접혀 있어도 토글은 그 하나이고, 이름이 「작업공간 패널 펼치기」 · `aria-expanded=\"false\"`다", () => {
    const tags = folded(() => panelToggleTags(render(specDocs(["overview.md"]))));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('aria-label="작업공간 패널 펼치기"');
    expect(tags[0]).toContain('aria-expanded="false"');
  });

  it("패널 토글은 레일이 서도 머리 줄 오른쪽 맨 끝, 요약 카드 뒤에 하나 선다", () => {
    // 한때 토글은 레일이 서면 머리 카드 밖 레일 열 위로 나갔다(DS `.at-railtop`). 머리 카드를 걷어 화면 것이 머리 줄에 바로 서며(02 구현
    // 스펙 §3 S2) 토글은 레일이 서든 안 서든 할 일 묶음의 맨 끝 — 요약 단추(restart 02a-10 — 셸이 본문이어도 선다) 뒤 — 하나다. 접혀 있을
    // 때 펼치기가 하나 더 서던 갈래는 없다. 한때 요약 단추 앞에 보기 배치(분할)가 섰다(restart 02a-13이 걷었다). spec 패널이 앱 셸의
    // 기둥으로 나가도(restart 02a-14) 토글은 이 화면의 머리 줄에 선다 — 틀이 밖의 패널을 가리키는 토글로 짓는다(`Frame`의 `panelToggle`).
    for (const [name, draw] of [
      ["열림", () => render(specDocs(["overview.md"]))],
      ["접힘", () => folded(() => render(specDocs(["overview.md"])))],
      ["터미널", () => render(specDocs(["overview.md"]), "terminal")],
    ] as const) {
      const markup = draw();
      const group = headActionsOf(markup);
      expect(group, name).not.toBe("");
      expect(panelToggleTags(headRowOf(markup)), name).toHaveLength(1);
      expect(panelToggleTags(group), `${name} — 할 일 묶음 안`).toHaveLength(1);
      const buttons = group.match(/<button[^>]*>/g) ?? [];
      expect(buttons[buttons.length - 1], name).toMatch(/aria-label="작업공간 패널 (?:접기|펼치기)"/);
      expect(buttons[buttons.length - 2], name).toContain('aria-label="요약 카드"');
      expect(buttons[buttons.length - 3], name).toContain('aria-label="작업공간 메뉴"');
    }
  });

  it("레일이 서고 칸은 `spec` 하나다 — 패널이 열렸으면 켜지고, 접혔으면 꺼진다", () => {
    // restart 02a-14 · 스토리 80 · 시안 Shell 「레일」 — 레일은 작업공간의 도구이고 칸은 `spec` 하나다. 한때 `files` 칸이 `spec` 뒤에
    // 섰다(git-integration 결정 29) — 워크트리 파일은 넓힌 카드의 Project 트리에서 연다(02a-12). 켜짐은 「패널이 열렸다」이다 — 다시
    // 누르면 닫혀 켜진 칸이 0일 수 있어서 탭(`aria-selected`)이 아니다.
    expect(railItems(render())).toEqual([{ name: "spec", pressed: "true" }]);
    expect(folded(() => railItems(render(specDocs(["overview.md"]))))).toEqual([{ name: "spec", pressed: "false" }]);
    expect(boxOf(render(), /<div[^>]*aria-label="레일"/)).toContain('data-show="true"');
  });

  it("레일의 칸과 패널 토글은 같은 일 — spec 패널을 여닫는다(오른쪽 자리의 `toggle spec`)", () => {
    // 칸이 하나라 「켜진 칸을 다시 누르면 닫히고 다른 칸이면 바꾼다」(옛 레일의 고르기 규칙)가 여닫기 하나로 접혔다. 요약 카드가 서 있으면 걷고
    // 패널을 연다 — SummarySheet 표 「레일의 spec을 누른다」. 여닫는 함수는 머리 줄의 토글 · ⌘Enter와 한 벌이다.
    const page = source("WorksPage.tsx");
    expect(page).toContain('const togglePanel = useCallback(() => moveRight({ kind: "toggle", place: "spec" }), [moveRight]);');
    expect(page).toMatch(/<WorkTools open=\{panelOpen\} busy=\{running !== null\} onToggle=\{togglePanel\}>/);
    expect(page).toContain("panelToggle={panelWork ? { name: WORK_PANEL_LABEL, open: panelOpen, onToggle: togglePanel, controls: WORK_PANEL_ID } : undefined}");
    expect(page).not.toContain("pickRail");
  });

  it("토글은 `aside` · `nav` 밖 머리 줄 안이고, 작업 패널 칸을 가리킨다", () => {
    // `aside`는 사이드바와 작업 패널 둘뿐이고(e2e `tab-row-floor`가 순서를 잰다) `nav`는 사이드바 버튼을 집는 고리다(`harness.ts`).
    // 토글은 레일 열이 아니라 머리 줄에 선다(codex-ds 스펙 §10) — `header` 안이고, `aside` · `nav`에는 안 든다.
    const markup = render();
    const toggleAt = markup.indexOf('aria-label="작업공간 패널 접기"');
    expect(toggleAt, "토글이 없다").toBeGreaterThan(-1);
    const beforeToggle = markup.slice(0, toggleAt);
    for (const tag of ["aside", "nav"]) {
      expect(countOf(beforeToggle, `<${tag}`), tag).toBe(countOf(beforeToggle, `</${tag}>`));
    }
    expect(countOf(beforeToggle, "<header")).toBe(countOf(beforeToggle, "</header>") + 1);
    // `aria-controls`가 가리키는 것은 spec 패널 상자(앱 셸 기둥의 `aside`)다.
    const panelId = markup.match(/<aside[^>]*\bid="([^"]+)"/)?.[1] ?? "";
    expect(panelId, "패널 칸에 id가 없다").toBe("work-panel");
    expect(panelToggleTags(markup)[0]).toContain(`aria-controls="${panelId}"`);
    // 레일도 `aside` · `nav` · `header` 밖이고(첫 `header`는 머리 줄의 화면 자리다), 칸이 같은 패널을 가리킨다.
    const railAt = markup.indexOf('aria-label="레일"');
    expect(railAt, "레일 묶음이 없다").toBeGreaterThan(-1);
    const beforeRail = markup.slice(0, railAt);
    for (const tag of ["aside", "nav", "header"]) {
      expect(countOf(beforeRail, `<${tag}`), tag).toBe(countOf(beforeRail, `</${tag}>`));
    }
    const items = (markup.match(/<button[^>]*>/g) ?? []).filter((tag) => /aria-label="(?:spec|files)"/.test(tag));
    expect(items).toHaveLength(1);
    for (const tag of items) expect(tag).toContain(`aria-controls="${panelId}"`);
  });

  it("터미널 본문에서도 레일과 토글이 선다", () => {
    // 결정 11. 두 본문 모두 패널을 이고 있다 — 터미널 탭에서 여는 길이 사라지면 **눌러도 아무 일이 없는 자리**가 아니라
    // 열 길 자체가 없어진다.
    const markup = render({}, "terminal");
    expect(panelToggleTags(markup)).toHaveLength(1);
    expect(railItems(markup).map((one) => one.name)).toEqual(["spec"]);
  });

  it("머리 줄에 프로젝트 칩이 없고, 상태 배지와 ⋯는 그대로 있다", () => {
    // 프로젝트는 머리에 칩으로 서지 않는다 — 프로젝트마다 base · 변경 있음은 사이드바 행의 호버 카드가 한 덩어리로 든다(codex-ds
    // 결정 25 — 한때 레일의 info 칸이 들었다). 머리 줄 안에서 본다.
    const markup = render({
      projects: ["atelier"],
      worktrees: [
        {
          project: "atelier",
          path: "~/.atelier/works/some-work/trees/atelier",
          exists: true,
          dirty: false,
        },
      ],
    });
    const header = headRowOf(markup);
    expect(header).not.toBe("");
    expect(header).not.toContain("atelier");
    // 상태 배지와 ⋯는 남는다 — 자주 누르는 조작이라 탭 뒤에 숨기면 클릭이 두 번 든다
    expect(header).toContain("active");
    expect(header).toMatch(/aria-label="작업공간 메뉴"/);
  });
});

// 머리 줄 배치(codex-ds 스펙 §6 · 스토리 23~25 · 02 구현 스펙 §3 S2) — 왼쪽은 ⚡ · work 이름, **조작은 전부 오른쪽 한 묶음**(결정 10)이다.
// 한때는 제목이 화면에서 빠지고(사이드바 행이 말했다) 창 맨 위 줄에 조작 묶음만 남았었다 — ⌘B로 사이드바를 접으면 화면 어디에도
// 제목이 없었다. 그 줄이 48 머리 줄이 되면서 머리 카드가 제목을 다시 들었고(work 메뉴의 대상이고, 그 자리에서 이름을 바꾼다 — codex-ds
// 결정 6 · 스펙 §9), 이제 카드 없이 머리 줄에 바로 선다.
describe("WorksPage 머리 줄 배치", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const header = headRowOf;
  const actions = headActionsOf;

  it("상태 다음이 ⋯, 세로선 너머가 요약 카드이고 「작업 메타」가 없다", () => {
    // ui-refresh 결정 14 — 머리 줄의 조작은 상태 · ⋯ · 요약 카드이고, 그 끝에 패널 토글이 붙는다(위 「패널 토글」). 한때 세로선 너머에
    // 보기 배치(분할)가 섰다(restart 02a-13이 걷었다).
    // 상태 배지와 ⋯ 사이에 서던 ⓘ 팝오버(「작업 메타」)가 걷혔다 — 그 복사 줄은 ⋯의 복사 ▸가 든다(codex-ds 결정 16 · 25).
    // 할 일(상태 · ⋯)과 보기 배치(요약 카드)는 얇은 세로선이 가른다(DS `HeadCard`) — 선은 장식이 아니라 구분이라 `separator`다.
    const a = actions(render());
    const status = a.indexOf('aria-description="상태 변경"');
    const menu = a.indexOf('aria-label="작업공간 메뉴"');
    const line = a.indexOf('role="separator"');
    const summary = a.indexOf('aria-label="요약 카드"');
    expect(status).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(status);
    expect(line).toBeGreaterThan(menu);
    expect(summary).toBeGreaterThan(line);
    expect(countOf(a, 'role="separator"')).toBe(1);
    expect(a).toContain('aria-orientation="vertical"');
    expect(render()).not.toContain("작업 메타");
  });

  it("⋯와 요약 카드가 같은 상자를 쓴다 — Thread 머리 줄의 단추와 같은 28이다", () => {
    // 머리 줄의 한 묶음(세로선을 사이에 둔 ⋯와 요약 카드)에 선 아이콘 버튼은 모두 같은 상자다 — 상자가 다르면 하나만 튀어 보인다.
    // 눈으로는 "살짝 튄다"로만 보여서, 어느 쪽이 틀렸는지는 나란히 놓고 재기 전에 안 드러난다.
    // ⋯가 22px·radius 7이었던 것은 옛 이웃인 상태 배지에 맞춘 값인데, 그 배지가 오른쪽
    // actions로 가면서 맞출 상대가 아이콘 버튼으로 바뀌었다. 그 상자는 머리 카드 때 24였고, 머리 줄이 한 결이 되며(02 결정 「머리 줄은
    // 한 결이다(03 뒤)」) Thread의 「…」 · 요약 단추와 같은 28(아이콘 버튼 기본 — 작은 단 `icon-button-xs`가 없다) · 글리프 15다(시안
    // `.ra-tbtn`의 `s15` — restart 03-12a, 한때 16).
    const tags = header(render()).match(/<button[^>]*>/g) ?? [];
    const box = (label: string) =>
      tags.find((tag) => tag.includes(`aria-label="${label}"`))?.match(/class="([^"]*)"/)?.[1] ?? "";
    for (const label of ["작업공간 메뉴", "요약 카드"]) {
      expect(box(label), label).toMatch(/\bicon-button\b/);
      expect(box(label), label).not.toMatch(/\bicon-button-xs\b/);
    }
    const glyph = (icon: string) => header(render()).match(new RegExp(`<svg[^>]*class="[^"]*lucide-${icon}\\b[^"]*"`))?.[0] ?? "";
    expect(glyph("ellipsis")).toMatch(/\bsize-3\.75\b/);
    expect(glyph("summary")).toMatch(/\bsize-3\.75\b/);
    // 크기 단까지 같은지는 L3가 칠해진 상자로 잰다(`e2e/primitives.spec.ts`)
    // 손으로 적은 상자 규격이 다시 들어오면 여기서 갈린다
    expect(box("작업공간 메뉴")).not.toMatch(/\bh-\[/);
  });

  it("화면의 이름표는 한 글자도 안 바뀐다", () => {
    const markup = render();
    expect(markup).toContain('aria-label="작업공간 메뉴"');
    expect(markup).toContain('aria-label="요약 카드"');
  });

  // 02 코드 리뷰 C1 — **머리 줄의 단추는 모두 Tab 정류장이다.** macOS WebKit(앱의 WKWebView · L3 macOS)의 Tab은 `tabindex` 없는 맨 `<button>`에
  // 서지 않는다(`@/lib/roving` 머리말) — 메뉴 트리거(Base UI)는 0을 스스로 달지만, 맨 버튼은 0을 잃으면 키보드로 닿지 않는다(한때 분할이
  // 그랬다 — PR #563 CI). 차례는 L3(`keyboard.spec.ts`)가 진짜 Tab으로 잰다.
  it("요약 카드가 Tab 정류장임을 tabindex로 명시한다 — ⋯와 같다", () => {
    const tags = header(render()).match(/<button[^>]*>/g) ?? [];
    for (const label of ["작업공간 메뉴", "요약 카드"]) {
      expect(tags.find((tag) => tag.includes(`aria-label="${label}"`)), label).toMatch(/\btabindex="0"/);
    }
  });

  it("조작이 전부 머리 줄 오른쪽 한 묶음에 있다", () => {
    // 결정 10. 상태 배지 · ⋯ · 요약 카드와 패널 토글이 한 자리에 모인다(위 「WorksPage 패널 토글과 레일」).
    //
    // **왼쪽에 남는 것이 있으면 안 된다.** 하나라도 왼쪽에 남으면 탭이 늘고 줄 때마다
    // 그것의 자리가 함께 움직인다 — 결정 10이 오른쪽 끝을 고른 이유가 그것이다.
    const a = actions(render());
    expect(a).not.toBe("");
    for (const one of [
      // 도움말 「상태 변경」은 툴팁이라 정적 마크업에 없다 — 이름(지금 상태)보다 더 말하던 그 말은 설명으로 남는다(S28).
      'aria-description="상태 변경"',
      'aria-label="작업공간 메뉴"',
      'aria-label="요약 카드"',
    ]) {
      expect(a, one).toContain(one);
    }
    expect(panelToggleTags(a)).toHaveLength(1);
  });

  it("머리 줄의 화면 것은 카드가 아니고, 끌기는 셸의 머리 줄이 든다 — 카드 자리는 끄는 자리가 아니다", () => {
    // 02 구현 스펙 §3 S2 — 머리 카드(흰 면 · 둥글기 · 링)를 걷고 이름 · 할 일이 머리 줄에 바로 선다. 끄는 자리는 셸의 머리 줄 하나다
    // (`ShellHeadRow`의 `deep` — 빈 자리 · 보이기만 하는 글자는 끌고, 누를 것은 Tauri가 비켜 둔다). 어느 점이 끌리는지는 L3(`frame.spec.ts`의
    // `끄는자리`)가 잰다. 카드와 카드 사이 틈도 끄는 자리가 아니다(`Frame` 머리말). 표식(`data-head-actions`)은 좁은 창의 L3(`tab-row.ts`의
    // `rowOf`)가 집는다.
    const markup = render();
    const row = header(markup);
    expect(row, "머리 줄의 화면 자리가 없다").not.toBe("");
    expect(row).not.toContain('data-slot="head-card"');
    expect(row).not.toMatch(/\brounded-xl\b|\bshadow-hairline\b/);
    expect(actions(markup), "할 일 묶음을 못 찾았다").not.toBe("");
    expect(countOf(markup, "data-tauri-drag-region")).toBe(0);
  });

  // codex-ds 스토리 23 · 24 — 머리 줄 왼쪽이 지금 어느 work인지 말한다. ⌘B로 사이드바를 접어도 제목이 화면에 남는다.
  // 한때(결정 10) 제목은 화면에서 빠지고 사이드바 행만 말했다 — 접으면 화면 어디에도 제목이 없던 그 감수가 풀렸다.
  // 이름 앞에 아이콘이 없다 — 시안 Main 머리 줄 crumb는 「흐린 Service / 이름 ⑂ 브랜치」다(restart 03-12a). 한때 ⚡(work 아이콘)가 섰다.
  it("머리 줄 왼쪽에 work 제목이 서고(아이콘 없이), 제목은 버튼이 아니다", () => {
    const card = headRowOf(render());
    expect(card).not.toBe("");
    const slash = card.indexOf("/</span>");
    const name = card.indexOf(`>${work.title}<`);
    expect(slash, "흐린 Service의 「/」가 없다").toBeGreaterThan(-1);
    expect(name, "제목이 없다").toBeGreaterThan(slash);
    expect(name).toBeLessThan(card.indexOf("data-head-actions"));
    expect(card.slice(slash, name), "Service와 이름 사이에 아이콘이 섰다").not.toMatch(/<svg/);
    expect(card).not.toContain("lucide-zap");
    // 제목은 버튼도 입력칸도 아니다 — 평소에는 포커스만 받는 글자다(`tabIndex`). 우클릭 · ⇧F10으로 work 메뉴를 여는 대상이고
    // (codex-ds 결정 6), 두 번 클릭 · F2로 그 자리가 입력칸이 된다 — 입력칸은 고치는 동안에만 선다(codex-ds 스펙 §9 ·
    // `e2e/inline-rename.spec.ts`). 누르면 고친다는 도움말(「클릭해서 편집」)도 없다.
    // 제목 앞의 흐린 Service(03 §10)만 단추다 — Service 메뉴를 연다. 그 「/」 뒤가 제목의 자리다.
    const title = card.slice(slash, card.indexOf("data-head-actions"));
    expect(title).not.toMatch(/<button|<input|contenteditable/);
    expect(title).not.toContain('title="클릭해서 편집"');
    // 브레드크럼이 아니다. 화면 이름 「작업공간 /」이 남아 있으면 제목 앞에 이유 없는 글자가 선다. 머리에는 「작업공간 메뉴」가 있어 글자로만 잰다.
    expect(header(render()).replace(/<[^>]+>/g, " ")).not.toContain("작업공간");
  });

  it("제목 앞에 흐린 Service와 「/」가 선다 — Service가 없으면 「Service 없음」, Service 목록을 아직 못 읽었으면 slug다(03 §10)", () => {
    const crumb = (card: string) => card.slice(0, card.indexOf("/</span>") + 1).replace(/<[^>]+>/g, "");
    expect(crumb(headRowOf(render()))).toBe("Service 없음/");
    expect(crumb(headRowOf(render({ service: "결제" })))).toBe("결제/");
    expect(headRowOf(render())).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*data-slot="work-service"/);
  });
});

// 뷰 탭 — 한때 `spec`과 `terminal` 둘이었다(결정 9). 본문을 고르는 자리는 탭 줄이다.
describe("WorksPage 헤더에서 뷰 탭이 걷혔다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const actions = headActionsOf;

  // 결정 70. 본문을 고르는 자리가 **사이드바 트리로 갔다.** 되살아나면 같은 것을 두 자리에서
  // 고르게 되고, 화면으로는 둘 다 멀쩡해 보여서 어느 쪽이 지금인지가 안 드러난다 —
  // 앞 판이 가로 탭 줄에서 겪은 그 병이다.
  it("`spec`·`terminal` 칸이 헤더에 없다", () => {
    for (const tab of ["chat", "terminal"] as const) {
      const markup = render({}, tab);
      expect(markup, tab).not.toContain('aria-label="spec 보기"');
      expect(markup, tab).not.toContain('aria-label="terminal 보기"');
    }
  });

  it("상태 배지는 남는다", () => {
    // 배지는 「어느 단계인가」라 뷰 탭과 성질이 다르다 — 자주 누르는 조작이라 헤더에 남는다.
    // 뷰 탭을 걷으면서 함께 쓸려 나가면 상태를 바꾸는 데 클릭이 두 번 든다.
    expect(actions(render())).toContain('aria-description="상태 변경"');
  });
});

// 결정 11. 터미널 탭에도 작업 패널이 선다 — 여는 아이콘이 탭을 가리면 **눌러도 아무 일이
// 없는 버튼**이 된다. 화면으로는 "안 열리네"로만 보여서, 버튼이 있어야 할 자리에 없는 것보다
// 알아채기 어렵다.
describe("WorksPage 터미널 탭", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 여는 길(머리 줄의 패널 토글)이 탭을 안 가리는지는 위 「WorksPage 패널 토글과 레일」이 두 본문 모두에서 렌더로
  // 잰다 — 토글이 늘 서게 되면서(ui-refresh 결정 9) 접힌 상태를 만들지 않고도 보인다.

  // 결정 26. **순서가 계약이다** — dirty 판정은 확인 대화가 아니라 그 뒤 코어에서 나므로,
  // 먼저 죽이면 거부당했을 때 Work는 남고 돌던 claude만 사라진다. 이것도 렌더로 못 본다
  // (네이티브 대화가 끼어 있다). 자리를 세 지점의 **순서**로 못박는다 — 문자열 하나를
  // 통째로 맞추면 줄바꿈만 바뀌어도 깨지고, 순서가 이 계약의 전부다.
  //
  // 흐름은 work 메뉴 넷(⋯ · 우클릭 대상 셋)이 함께 부르는 한 자리(`work-menu-actions.ts`)에 있다(codex-ds 결정 6).
  it("셸은 명령이 성공한 뒤에 거둔다", () => {
    const menuActions = source("work-menu-actions.ts");
    const call = menuActions.indexOf("await call();");
    // `await` **뒤에서** 찾는다 — 같은 문구가 위쪽 주석에도 나온다(실측으로 걸렸다).
    const bail = menuActions.indexOf("return;", menuActions.indexOf("하지 못했습니다", call));
    const reap = menuActions.indexOf("closeShellsOf(ownerOf(work.slug))");

    expect(call, "await call()을 찾지 못했다").toBeGreaterThan(-1);
    // 실패하면 **거두지 않고 돌아간다** — 이 return이 빠지면 거부당한 Work의 셸이 죽는다.
    expect(bail, "catch에서 돌아가는 자리를 찾지 못했다").toBeGreaterThan(call);
    expect(reap, "성공 뒤 회수를 찾지 못했다").toBeGreaterThan(bail);
  });

  // 티켓 12 · 프로세스 스펙 S13. **UI 아카이브 · 삭제의 제외 창.** 앱 루트는 목록이 새로 앉을 때마다 slug가 사라진
  // work의 셸을 「주인 잃은 셸」로 세운다 — MCP로 아카이브된 work을 알아채는 길이 그것뿐이다. UI 길은 성공한 뒤 제 손으로
  // 닫으므로(위 순서) 그동안 그 slug를 감지에서 뺀다. 창은 **확인 창이 참을 돌려준 뒤 · 코어 호출 전에** 열고, **회수가
  // 끝난 뒤에** 닫으며, 호출이 실패하면 **그 자리에서** 닫는다(알림 창을 기다리지 않는다). 삭제는 재조회가 앉은 뒤에야
  // 돌아오고 아카이브는 안 기다리므로 워처의 재조회가 회수 앞뒤 어디에나 올 수 있다 — 창이 이만큼 넓어야 한다.
  // 렌더로 못 보는 것은 위 검사와 같다(창과 코어 호출이 프로미스 뒤에 있다). 자리를 **순서**로 못박는다.
  it("제외 창은 확인 뒤 · 코어 호출 전에 열고, 회수 뒤에 닫으며, 실패하면 곧바로 닫는다", () => {
    const menuActions = source("work-menu-actions.ts");
    const asked = menuActions.indexOf("if (!(await askDanger(");
    const hold = menuActions.indexOf("const release = holdOwner(ownerOf(work.slug));");
    const call = menuActions.indexOf("await call();");
    const failed = menuActions.indexOf("} catch (e) {", call);
    const earlyRelease = menuActions.indexOf("release();", failed);
    const problem = menuActions.indexOf("await showProblem(", failed);
    const reap = menuActions.indexOf("closeShellsOf(ownerOf(work.slug));");
    const lateRelease = menuActions.indexOf("release();", reap);

    expect(asked, "확인 창을 찾지 못했다").toBeGreaterThan(-1);
    expect(hold, "제외 창은 확인 창이 참을 돌려준 뒤에 연다").toBeGreaterThan(asked);
    expect(call, "제외 창은 코어 호출 전에 연다").toBeGreaterThan(hold);
    expect(earlyRelease, "실패하면 제외 창을 닫는다").toBeGreaterThan(failed);
    expect(problem, "실패하면 알림 창보다 먼저 닫는다").toBeGreaterThan(earlyRelease);
    expect(lateRelease, "회수 뒤에 제외 창을 닫는다").toBeGreaterThan(reap);
    // 여는 자리는 하나다 — 둘이면 한쪽이 안 닫혀 그 slug가 영영 감지에서 빠진다. 작업 화면이 흐름을 따로 들면 그것이 둘째 자리다.
    expect(menuActions.split("holdOwner(").length - 1).toBe(1);
    expect(source("WorksPage.tsx")).not.toContain("holdOwner(");
  });

  // 결정 102·19. 정상 종료한 셸은 목록에서 스스로 빠지고(결정 48), 마지막 칸을 `×`로 닫은
  // 자리에서는 새 셸이 저절로 뜨지 않는다(판 02) — 셸이 0개인 화면이 실재한다.
  //
  // **그 화면이 내는 것이 바뀌었다.** 한때 본문이 `+ 새 셸`이 든 목록을 냈는데(결정 102),
  // 그 근거가 「탭 줄이 걷힌 뒤로 여는 길이 여기뿐이다」 하나였다. 판 03이 그 줄을
  // 되살렸으므로 결정 19가 본문의 여는 자리를 걷었다 — 남는 것은 **비었다는 표시와 여는
  // 법**이고, 여는 자리는 탭 줄의 `+` 하나다.
  //
  // **탭 줄 뒤부터 `</main>` 앞까지만 본다.** 패널에도 같은 이름의 `+`가 설 수 있고
  // 탭 줄에는 실제로 하나 선다 — 마크업 전체에서 세면 「본문에 있다」와 「어딘가 있다」가
  // 같아진다. 탭 줄은 본문 카드의 머리라(codex-ds 스펙 §4) 카드 안 맨 위에 선다.
  it("셸이 0개면 본문은 안내만 내고, 여는 자리는 탭 줄뿐이다", () => {
    const markup = render({}, "terminal");
    const row = tabRowOf(markup);
    expect(row, "탭 줄을 찾지 못했다").not.toBe("");
    const headEnd = markup.indexOf(row) + row.length;
    const bodyEnd = markup.indexOf("</main>");
    expect(bodyEnd, "본문의 끝을 찾지 못했다").toBeGreaterThan(headEnd);
    const body = markup.slice(headEnd, bodyEnd);

    // 비었다는 말이 실제로 선다 — 이것이 없으면 아래 단언이 「본문이 통째로 비어서」 초록이다.
    expect(body, "빈 본문에 아무 말도 없다 — 그 자리는 고장으로 읽힌다").toContain(
      "아직 셸이 없어요",
    );
    expect(body.match(/aria-label="(?:셸 열기|새 탭)"/g), "본문에 여는 자리가 남았다").toBeNull();
    // 그리고 여는 자리는 **탭 줄에** 있다. 둘 다 없으면 열 길이 아예 사라진 것이다. 작업공간 화면의 `+`는 「새 탭」 메뉴다(restart 02a-8 —
    // 맨 윗줄 「새 채팅」, 그 아래 셸 줄).
    expect(row).toContain('aria-label="새 탭"');
    // 패널이 **함께** 있다. 그 카드의 이름으로 확인한다.
    expect(markup).toContain('aria-label="작업공간 패널"');
    // 작업공간 화면의 ⌘T는 새 채팅 탭을 연다(restart 02a-8) — 셸을 여는 키로 가르치지 않는다. 여는 법은 탭 줄의 `+`(메뉴의 셸 줄)다.
    expect(body, "셸이 없는 본문이 ⌘T를 셸 여는 키로 가르친다").not.toContain("⌘T");
  });

  it("채팅 본문에는 여는 자리가 없다 — 여는 자리는 탭 줄의 `+`다", () => {
    // 결정 7. 셸을 여는 자리가 화면 안으로 돌아왔다(adr-03) — 그래서 채팅 중에도
    // `+`가 **탭 줄에** 서고, 본문에는 여전히 없다. 본문에 또 서면 그것이 어느 화면의
    // 셸을 여는지가 흐려진다. 한때 이 자리는 문서 탭(`spec`)이었다(restart 02a-13이 걷었다).
    const markup = render({}, "chat");
    const row = tabRowOf(markup);
    expect(row, "탭 줄을 찾지 못했다").not.toBe("");
    expect(row).toContain('aria-label="새 탭"');
    expect(markup.replace(row, "")).not.toContain('aria-label="새 탭"');
    expect(markup).toContain('aria-label="작업공간 패널"');
  });

  // 본문이 셸이라 `</>`가 적용될 곳이 없다 — 터미널 카드의 머리는 탭 줄 하나다(ui-refresh 결정 5 · codex-ds 스펙 §4). 경로
  // 줄(캡슐 · 보기 묶음)은 문서 위에만 선다.
  it("터미널 카드의 머리는 탭 줄뿐이다 — 경로 줄이 없다", () => {
    const markup = render({}, "terminal");
    const body = markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));
    expect(body, "본문 카드를 찾지 못했다").toContain('data-tone="terminal"');
    expect(tabRowOf(body)).not.toBe("");
    expect(body).not.toContain('data-slot="path-bar"');
    expect(body).not.toContain('data-slot="card-head"');
    expect(markup).not.toContain('aria-label="원문 보기"');
  });
});

// 탭 줄의 바닥 — 줄을 머리에 이는 **본문 카드**(`TAB_ROW_CARD`)와 공용 틀(`Frame`)의 **본문 열**(`TAB_ROW_COLUMN`)이 함께
// 든다(ui-refresh 결정 27 · codex-ds 스펙 §4). 카드는 줄 아닌 자식(문서 위 경로 줄 · 넓은 문서 · 코드뷰 · xterm)의 내용
// 폭을 바깥에 안 알리고, 열은 그 카드를 품은 카드 줄만 제 min-content를 알린다 — 소스 보기를 켜고 끌 때마다 패널이 창 밖으로
// 밀리던 것(한때 이 행이 `min-w-0`이 아니었던 때)이 안 돌아온다. 그 바닥이 없으면 900px 창에서 칸 상자가 0px이 되어 칸이 안
// 보였다.
//
// 레이아웃은 정적 마크업으로 볼 수 없으므로 클래스와 자리만 본다 — 실제로 칸이 남고
// 넓은 문서에서 패널이 안 밀리는지는 `e2e/tab-row-floor.spec.ts`가 잰다.
describe("WorksPage 탭 줄을 이는 본문 열의 바닥", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("카드 줄은 머리 줄 아래 본문 열의 첫 자식이고 본문 카드를 담는다 — spec 패널은 그 줄 밖, 화면 뒤의 기둥에 선다", () => {
    const markup = render(specDocs(["overview.md"]));
    const after = markup.slice(markup.indexOf("</header>") + "</header>".length);
    // 머리 줄 다음 형제가 아래 줄, 그 첫 자식이 본문 열, 다시 그 첫 자식이 카드 줄이다 — 탭 줄을 품었으므로 열의 바닥 클래스가
    // 이 줄을 격리하지 않는다(`TAB_ROW_COLUMN`).
    const row = after.match(/^<div[^>]*><div[^>]*>(<div[^>]*>)/)?.[1] ?? "";
    expect(row, "머리 줄 아래 본문 열 첫머리에 카드 줄이 없다").not.toBe("");
    // relative는 덮는 것(토스트 · 생애 겹판)이 이 줄을 기준으로 서기 위한 것이다(`Frame`의 overlay 칸).
    expect(row).toContain("relative");
    expect(after.indexOf("<main")).toBeGreaterThan(0);
    // spec 패널은 이 화면의 뿌리 밖이다(restart 02a-14) — 앱 셸의 작업공간 도구 기둥이 화면 뒤에 들고, 작업공간을 떠나면 레일과 함께
    // 접힌다. 한때 이 줄 안에서 본문 카드 뒤에 섰다. 패널 상자는 같은 카드 자리 한 줄에서 본문과 폭을 나눈다(`PanelBox`의 `trail`).
    const root = boxOf(after, /^<div/);
    expect(root, "화면 뿌리를 찾지 못했다").toContain("<main");
    expect(root).not.toContain("<aside");
    expect(after.slice(root.length)).toMatch(/^<aside/);
  });

  it("탭 줄을 이는 본문 열이 두 갈래 모두 그 바닥을 든다", () => {
    // 채팅 · 터미널 — 갈래마다 본문 열 안이 다르게 서므로, 한 갈래만 빠져도 그
    // 본문에서만 칸이 사라진다. 바닥 클래스는 `panel-layout`이 내보낸 한 벌을 그대로 쓴다. 한때 문서 · 분할 갈래도 있었다(restart
    // 02a-13이 걷었다).
    const floor = TAB_ROW_COLUMN.split(" ");
    // 본문 열 — 머리 줄 다음 형제(아래 줄)의 첫 자식이다(`Frame`).
    const columnOf = (markup: string) => {
      const at = markup.indexOf("</header>");
      if (at < 0) throw new Error("머리 줄이 없다");
      const tag = markup.slice(at + "</header>".length).match(/^<div[^>]*>(<div[^>]*>)/)?.[1] ?? "";
      return tag.replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    };
    for (const tab of ["chat", "terminal"] as const) {
      const markup = render(specDocs(["overview.md"]), tab);
      // 갈래가 정말 갈렸는지부터 — 본문 카드의 이름이 그 갈래다.
      expect(markup, tab).toContain(`<main aria-label="${tab === "chat" ? "새 채팅" : "터미널"}"`);
      const column = columnOf(markup);
      for (const one of floor) expect(column, tab).toContain(one);
      expect(column, tab).not.toContain("min-w-0");
    }
  });

  it("탭 줄을 머리에 이는 카드가 두 갈래 모두 줄의 바닥을 든다", () => {
    // 줄은 카드의 첫 자식이라 줄 바로 앞의 여는 태그가 그 카드다. 채팅 · 터미널 모두 본문 카드(`main`)다 — 그 카드가 바닥을 안 들면
    // 줄이 카드 모서리에 잘린다.
    const floor = TAB_ROW_CARD.split(" ");
    for (const tab of ["chat", "terminal"] as const) {
      const markup = render(specDocs(["overview.md"]), tab);
      const at = markup.search(/<div[^>]*\sdata-tab-row="/);
      expect(at, `${tab} — 탭 줄이 없다`).toBeGreaterThan(-1);
      const open = markup.lastIndexOf("<", at - 1);
      const card = markup.slice(open, at).replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      expect(card, tab).toContain('data-slot="card"');
      for (const one of floor) expect(card, tab).toContain(one);
    }
  });
});

// spec 패널(restart 02a-14 · 스토리 80 · 82 · 83) — 상자 · 카드 · 폭 · 손잡이 · 접힘은 앱 셸의 작업공간 도구 기둥이 든다(`WorkTools` — 그 단언은
// `WorkTools.test.tsx`에 있다). 이 화면은 서 있는 동안 기둥에 값(열림 · 바쁨 · 여닫기)을 건네고 패널의 몸(spec 트리)을 그 자리로 보낸다. 한때
// 상자는 공용 틀의 패널 칸이었고 폭 훅을 이 화면이 불렀다 — 화면과 함께 내려가 작업공간을 떠날 때 접힘 없이 사라졌다.
describe("WorksPage spec 패널", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 패널 상자 — 이 화면만 그리면 `aside`는 그것 하나다(사이드바는 앱 셸의 것이다). */
  const panelBox = (markup: string) => markup.slice(markup.indexOf("<aside"), markup.indexOf("</aside>"));

  it("패널의 몸은 spec 트리이고 「작업공간 패널」 카드 안에 선다", () => {
    const box = panelBox(render(specDocs(["overview.md"])));
    expect(box).toMatch(/<section[^>]*aria-label="작업공간 패널"/);
    expect(box).toContain(">overview.md<");
    expect(box).not.toContain("data-files-tree");
  });

  it("접혀 있어도 몸은 그대로 서 있다 — 다시 열면 접어 둔 폴더가 그대로다", () => {
    // 시안 Shell 「규칙」 · 스토리 83 — 닫아도 패널 몸은 언마운트하지 않는다. 트리를 패널 여닫기에 새로 세우지도 않는다 — 몸이 열림을 받지
    // 않는다(`WorkPanel`에 `open`이 없고 `key`도 없다). 한때 접을 때마다 트리를 새로 세워(`treeGeneration`) 접힘을 지웠다.
    const markup = folded(() => render(specDocs(["overview.md"])));
    expect(markup).toContain('aria-label="작업공간 패널 펼치기"');
    expect(panelBox(markup)).not.toMatch(/cursor-col-resize/);
    expect(panelBox(markup)).toContain(">overview.md<");
    const call = source("WorksPage.tsx").match(/<WorkPanel\b[\s\S]*?\/>/)?.[0] ?? "";
    expect(call, "WorkPanel 호출부를 찾지 못했다").not.toBe("");
    expect(call).not.toMatch(/\b(?:open|key|view)=/);
  });

  it("작업공간의 일(아카이브 · 삭제)이 도는 동안 기둥에 바쁨을 건넨다 — 생애 겹판이 덮지 않는 패널도 누를 수 없다", () => {
    // 겹판은 이 화면의 카드 줄을 덮는다(`Frame`의 overlay). 패널은 그 줄 밖 기둥에 서서, 바쁨으로 몸을 막는다(`WorkTools`).
    expect(source("WorksPage.tsx")).toMatch(/busy=\{running !== null\}/);
  });
});

// ─── 결정 49: 패널을 이 화면으로 끌어올린다 ───

// 1판은 이 패널을 **두 곳**에서 그렸다(여기와 SpecViewer). 두 본문이 형제 컬럼이라
// 어쩔 수 없었던 것인데, 그 대가로 뷰 탭을 오갈 때마다 패널 인스턴스가 갈려 탭 선택·트리
// 접힘이 초기화됐다. 호출부를 하나로 합치는 것이 이 판의 구조 변경이다.
describe("WorksPage 작업 패널은 한 곳에서만 선다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("두 탭 모두에서 같은 자리 — 화면 뿌리 뒤의 기둥 — 로 간다", () => {
    // 같은 자리에 있다는 것이 React가 인스턴스를 그대로 잇는 조건이다. 탭에 따라 자리가 달라지면 그 순간 패널이 새로 서고 트리 접힘이
    // 사라진다. 몸을 기둥으로 보내는 것(`<WorkTools>`)은 본문 갈래 밖에 하나다.
    for (const tab of ["chat", "terminal"] as const) {
      const markup = render(specDocs(["overview.md"]), tab);
      expect(countOf(markup, "<aside"), tab).toBe(1);
      expect(markup.indexOf("<aside"), tab).toBeGreaterThan(markup.lastIndexOf("</main>"));
    }
    expect(countOf(source("WorksPage.tsx"), "<WorkTools ")).toBe(1);
  });

  it("그리는 곳이 한 곳이고, key가 없다", () => {
    const worksPage = source("WorksPage.tsx");
    // SpecViewer가 다시 패널을 그리면 인스턴스가 도로 둘이 된다 — 1판이 그랬다.
    expect(source("SpecViewer.tsx")).not.toContain("WorkPanel");
    expect(worksPage.match(/<WorkPanel\b/g)).toHaveLength(1);
    // **key를 주면 앞 판 결정 4(작업을 옮기면 spec으로 리셋)가 되살아난다.** 결정 49가
    // 그것을 명시적으로 뒤집었으므로, 되살아나면 여기서 걸려야 한다.
    const call = worksPage.match(/<WorkPanel\b[\s\S]*?\/>/);
    expect(call, "WorkPanel 호출부를 찾지 못했다").not.toBeNull();
    expect(call![0]).not.toMatch(/\bkey=/);
    // 그리고 **작업 하나에 매달린 값**을 key처럼 쓰는 우회로도 없다
    expect(call![0]).not.toMatch(/\bkey=\{[^}]*slug/);
  });

  it("트리의 '지금 이 문서' 표시를 두 탭이 같은 값으로 받는다", () => {
    // 1판은 터미널 탭에서 폴백을 거치지 않은 raw 주소를 내려줘, 뷰 탭을 오갈 때마다
    // 트리 표시가 켜졌다 꺼졌다. 값을 정하는 지점이 하나여야 그 깜빡임이 사라진다 — 주소의 넓힌 카드 문서다(기본 문서로 눕히지 않는다 —
    // restart 02a-13). 표시는 트리 행의 selected-row다 (SpecTree)
    for (const tab of ["chat", "terminal"] as const) {
      expect(render(specDocs(["overview.md"]), tab, { file: "overview.md" }), tab).toContain("selected-row");
    }
  });
});

// restart 02a-13 · 구현 스펙 「02a — `spec` 탭과 분할을 지운다」 · 스토리 87 — **탭 줄의 `spec` 칸과 `spec ▏ 묶음` 분할이 사라진다.** 문서는 spec 패널의
// 문서 줄에서 채팅 탭의 넓힌 카드로 연다(02a-12). **작업공간을 열어도 기본 문서를 열지 않는다** — spec 레이아웃 결정 14(「주소에 문서가 없으면 spec 트리의
// 기본 문서를 연다」)를 뒤집는다. `specTree.defaultDoc`은 코어에 남고(L4가 잰다) 화면만 읽지 않는다.
describe("WorksPage spec 탭과 분할이 없다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const files = ["overview.md", "plan.md"];

  it("탭 줄에 spec 칸도 그 뒤 세로선도 없다 — 채팅 · 셸 본문 모두", () => {
    for (const tab of ["chat", "terminal"] as const) {
      const row = tabRowOf(render(specDocs(files), tab));
      expect(row, `${tab} — 탭 줄을 찾지 못했다`).not.toBe("");
      expect(row, tab).not.toContain('data-tab="spec"');
      expect(row, tab).not.toContain("data-tab-rule");
    }
  });

  it("머리 줄에 분할 토글이 없고, 본문은 열로 갈리지 않는다", () => {
    for (const tab of ["chat", "terminal"] as const) {
      const markup = render(specDocs(files), tab);
      expect(headActionsOf(markup), tab).not.toContain('aria-label="분할"');
      expect(markup, tab).not.toContain("lucide-columns-2");
      expect(markup, tab).not.toContain("data-column=");
    }
  });

  it("작업공간을 열어도 기본 문서를 열지 않는다 — 트리에 고른 문서가 없고, 문서 본문 · 경로 줄이 서지 않는다", () => {
    // 기본 문서가 `overview.md`인 트리다(`specDocs`의 둘째 인자) — 한때 이 화면이 그것을 골라 트리 행에 `selected-row`를 달고 본문에 세웠다.
    for (const tab of ["chat", "terminal"] as const) {
      const markup = render(specDocs(files, "overview.md"), tab);
      expect(markup, tab).not.toContain("selected-row");
      expect(markup, tab).not.toContain('aria-label="문서"');
      expect(markup, tab).not.toContain('aria-label="원문 보기"');
      expect(markup, tab).not.toContain('data-slot="path-bar"');
    }
  });

  it("탭 칸을 끄는 동안에도 본문 절반(놓을 자리)이 서지 않는다 — 놓는 곳은 탭 줄의 틈뿐이다", () => {
    const owner = ownerOf(work.slug);
    const opened = openShell(NO_SHELLS, { owner, project: null, cwd: "~/x" })!;
    terminalStore.setState(() => opened.state);
    dragStore.setState((state) => ({ ...state, source: { kind: "shell", owner, shellId: opened.id } }));
    try {
      const markup = render({}, "terminal");
      expect(markup).not.toContain("data-drop-half");
    } finally {
      dragStore.setState((state) => ({ ...state, source: null }));
      terminalStore.setState(() => NO_SHELLS);
    }
  });

  // ⌘1이 문서 탭이던 자리가 사라졌다 — ⌘1~9가 묶음의 칸을 첫 칸부터 센다(탭 줄의 보이는 차례 그대로 · `/terminal`과 같다).
  it("⌘1~9가 묶음의 칸을 첫 칸부터 센다", () => {
    const worksPage = source("WorksPage.tsx");
    expect(worksPage).toContain("shellForNav(tabs, activeIdOf(state, owner), nav, 1)");
    expect(worksPage).not.toContain('onSelectTab("spec")');
  });
});

// 결정 43. ⌘Enter는 이제 **탭이 아니라 포커스로** 갈린다. 앞 판의
// `if (tab === "terminal") return;` 한 줄이 사라졌고, 그 줄이 남겼던 「알려진 비대칭」
// (포커스가 트리에 있어도 터미널 탭에서는 안 듣는다)도 함께 사라진다.
//
// 판단은 순수 함수로 꺼내 패널 토글 곁에 둔다(`togglesPanel` — Archive의 ⌘Enter와 한 벌). 그 판정이
// 진짜로 도는 검사는 `components/shell/PanelToggle.test.ts`에 있고, 여기서 보는 것은 이 화면의 배선이다 —
// 이펙트는 정적 렌더에서 안 돈다.
describe("WorksPage ⌘Enter", () => {
  // 결정 93·98. ⌘T가 xterm 밖에서도 들린다 — 셸이 0개인 화면에는 xterm이 없어 그 키를
  // 들을 사람이 없었다. **판정은 `opensShellFromWindow`가 혼자 알고**(그쪽 검사는
  // shell-registry.test.ts에 전수돼 있다) 여기서 보는 것은 그 판정이 이 화면에 실제로
  // 배선돼 있는가다 — 이펙트는 정적 렌더에서 안 돈다.
  // restart 02a-8 — **작업공간의 ⌘T는 새 채팅 탭을 연다.** `+` 메뉴의 맨 윗줄이 「새 채팅」이고 `+` → Enter 한 번이 ⌘T와 같다(#222). 셸은
  // `+` 메뉴의 셸 줄로 연다.
  it("⌘T를 window에서 듣고, 새 채팅 탭을 열어 본문이 그 탭으로 간다", () => {
    const worksPage = source("WorksPage.tsx");
    // **이펙트를 정규식으로 잘라내지 않는다.** 한때 그렇게 했는데 앞쪽 `[\s\S]*?`가
    // **다른 이펙트(⌘Enter, 156행)에서 출발**해 103줄을 통째로 삼켰고, 그래서 아래
    // 리터럴들이 남의 이펙트로 충족됐다 — ⌘T의 `addEventListener` 한 줄을 지워도 초록이었다
    // (실측). 파싱을 없애고 **리터럴과 개수**로 본다: 새면 통과가 아니라 실패가 되는 모양이다.
    //
    // **이름이 있는지만 보면 안 된다.** 가드의 `!` 하나를 지우면 ⌘T가 영영 안 먹고 다른
    // 모든 키가 셸을 여는데, 그렇게 뒤집어도 초록이었다. 리터럴 그대로 못박는다.
    expect(worksPage).toContain("if (!opensShellFromWindow(e)) return;");
    // 딛고 선 작업의 묶음(`tabOwner` — 탭 줄과 같은 소유자)에 새 채팅 탭을 세우고, 세웠으면 본문을 그 탭으로 옮긴다. 열기만 하고 본문을 안
    // 옮기면 ⌘1·⌘2~9 한 벌에서 혼자 어긋난다(결정 98).
    expect(worksPage).toContain("if (openNewChat(tabOwner) !== null) onOpenNewChat();");
    expect(countOf(worksPage, "      startNewChat();\n")).toBe(1);
    // 셸을 여는 길(`openNewShell`)은 `+` 메뉴의 셸 줄 하나다 — ⌘T가 셸을 열던 옛 리터럴이 남으면 키 하나에 두 길이 선다.
    expect(worksPage).not.toContain("openNewShell(workDefaultOrigin(panelWork));");
    expect(worksPage).not.toContain("workShellOrigin(panelWork, null)");
    // **셸 안 ⌘T도 이 자리로 온다**(UI개선 결정 19). xterm 핸들러는 요청만 보내고 화면이 연다 —
    // 구독이 빠지면 셸에 포커스가 있는 동안 ⌘T가 죽는다. 창 keydown 리스너로 짓지 않는다
    // (아래 개수가 그대로다). 여기서는 **구독하는가**만 본다 — 이 화면의 셸만 듣는 규칙은
    // 스토어가 쥐고 값으로 재며(「셸 안 ⌘T의 요청은 그 셸의 화면에만 간다」), 포커스를 둔
    // 셸의 ⌘T가 기본 자리로 이어지는 사슬은 `e2e/shell-origin.spec.ts`가 잰다.
    expect(worksPage).toContain("onNewShellRequested(tabOwner, startNewChat)");
    // **등록을 따로 센다.** 위 리터럴은 전부 핸들러 **본문**이라, 핸들러가 window에 안
    // 걸려도 그대로 남는다 — 정리 함수가 계속 참조하므로 tsc도 안 막는다. 이 화면이
    // window에서 키를 듣는 자리는 둘이다(⌘Enter의 패널 토글 · ⌘T). 하나가 등록을 잃으면
    // 셸이 0개인 화면에서 ⌘T가 다시 안 먹는다 — 결정 93이 없애려던 증상 그 자체다.
    // 이 화면이 window에서 듣는 자리는 **넷이다** — ⌘Enter(패널 접기) · ⌘T(새 채팅 탭) ·
    // 본문을 옮기는 ⌘1~9·⌃Tab(결정 78·79) · ⌘W(켜진 탭 닫기 — 결정 13). 줄어들면 그중
    // 한 벌이 통째로 죽은 것이다.
    expect(
      countOf(worksPage, 'window.addEventListener("keydown", onKeyDown);'),
      "window에서 키를 듣는 자리가 넷이 아니다 — ⌘Enter · ⌘T · ⌘1~9·⌃Tab · ⌘W",
    ).toBe(4);
  });

  // 결정 78·109. ⌘1~9는 **이 화면의** 묶음의 칸이다. 클릭도 키도 이 seam에서는 못
  // 거니(정적 마크업이다) 배선을 소스에서 본다 — 표현식을 통째로 못박는다. 한때 ⌘1이 spec이고 ⌘2~9가 한 칸 밀린 셸이었다 — restart
  // 02a-13이 spec 칸을 걷어 ⌘1부터가 묶음이다(위 「spec 탭과 분할이 없다」).
  it("⌘1~9는 이 화면의 묶음의 칸이다", () => {
    const worksPage = source("WorksPage.tsx");
    expect(worksPage).toContain("const nav = shellNavFromWindow(e);");
    // 세는 것이 이 work의 셸이 아니면, 사이드바에 펼쳐 둔 **남의 셸까지** 세게 된다.
    // 조회하는 소유자도 여는 자리와 같은 함수(`ownerOf`)에서 나온다 — 짓는 함수가 하나라 갈릴 수 없다.
    expect(worksPage).toContain("const owner = ownerOf(panelWork.slug);");
    // 세는 것은 이 work의 **묶음**이다(git-integration 결정 31 · S10) — 지금 묶음에는 셸만 선다.
    expect(worksPage).toContain("const tabs = bundleOf(state, owner);");
    expect(worksPage).toContain("shellForNav(tabs, activeIdOf(state, owner), nav, 1)");
  });

  it("듣는 자리가 탭을 안 본다 — 가드 한 줄이 되살아나면 걸린다", () => {
    const worksPage = source("WorksPage.tsx");
    // 지운 그 줄. 되살아나면 앞 판의 비대칭이 그대로 돌아온다.
    expect(worksPage).not.toMatch(/if \(tab === "terminal"\) return;/);
    // 가드가 없어졌다는 것만 보면 **핸들러가 통째로 사라져도 초록이다** — 이펙트를 함께 본다.
    const effect = worksPage.match(
      /useEffect\(\(\) => \{[\s\S]*?window\.addEventListener\("keydown"[\s\S]*?\}, \[([^\]]*)\]\);/,
    );
    expect(effect, "⌘Enter 효과를 찾지 못했다").not.toBeNull();
    expect(effect![0]).toContain("togglesPanel");
    // 여닫는 것은 오른쪽 자리의 spec 패널이다(restart 02a-9 — 한때 화면의 `workPanelOpen`이었다). 패널 토글과 같은 손짓이다.
    expect(effect![0]).toContain('moveRight({ kind: "toggle", place: "spec" });');
    // `tab`을 안 본다 — 의존성은 그 작업공간의 오른쪽 자리를 바꾸는 길 하나다. `tab`이 남아 있으면 판단이 아직 탭에 매여 있다는 뜻이다.
    expect(effect![1].trim()).toBe("moveRight");
    expect(effect![0]).not.toContain("tab");
  });
});

// ─── 결정 7·10·13(판 03): 탭 줄 — 지금은 본문 카드의 머리다(codex-ds 스펙 §4) ───

// **이 화면이 그 줄을 조립한다** — 줄 자체(ShellTabs)는 상태와 콜백만 받으므로, 「이 work의
// 셸이 실제로 칸으로 서는가」는 스토어를 여기서 손으로 채워야 보인다. 줄 쪽 seam은
// 상태를 직접 넣고(ShellTabs.test.tsx), 이 seam은 그 둘이 이어졌는지를 본다.
describe("WorksPage 본문 카드 머리가 탭 줄이다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // 스토어는 모듈 싱글턴이라 이 파일 안에서 새어 나간다. 비우고 나간다.
    terminalStore.setState(() => NO_SHELLS);
  });

  // **비우지 않고 얹는다.** 여러 셸이 함께 서 있을 때 무엇이 줄에 서는가를 재야 해서다.
  // 새고 나가지 않는 것은 `afterEach`가 든다.
  function seedOrigin(origin: ShellOrigin, count = 1): void {
    terminalStore.setState((state) => {
      let next = state;
      for (let n = 0; n < count; n += 1) next = openShell(next, origin)!.state;
      return next;
    });
  }

  // **소유자는 `ownerOf`가 짓는다**(결정 10) — 화면이 조회하는 것과 같은 함수여야 여기서
  // 띄운 셸이 그 줄에 선다. slug를 그냥 넘기면 이 파일만 옛 키를 쓰며 조용히 빈 줄을 잰다.
  function seed(count: number, slug: string, cwd: string): void {
    seedOrigin({ owner: ownerOf(slug), project: null, cwd }, count);
  }

  // 칸을 표식으로 자른다 — ShellTabs.test.tsx의 같은 관용구다(정규식으로 블록을 잘라내는
  // 판정은 쓰지 않는다: 이 저장소는 그 fail-open으로 데었다).
  const kindsOf = (markup: string) =>
    markup
      .split('data-tab="')
      .slice(1)
      .map((chunk) => chunk.slice(0, chunk.indexOf('"')));

  // **켜진 칸**의 종류. `+` 뒤 조각은 세지 않는다 — 거기엔 오른쪽 끝 조작이 딸려 올 수 있고(한때 분할의 터미널 열을 닫는 `×`였다),
  // 조작이 자기 켜짐을 **같은 말**(`aria-pressed`)로 하면 칸으로 세어 켜진 칸이 하나 더 있는 것으로 읽힌다.
  const tabsOn = (markup: string) =>
    markup
      .split('data-tab="')
      .slice(1)
      .map((chunk) => ({ kind: chunk.slice(0, chunk.indexOf('"')), markup: chunk }))
      .filter((cell) => cell.kind !== "new" && cell.markup.includes('aria-pressed="true"'))
      .map((cell) => cell.kind);

  it("이 Work의 셸이 탭 줄 맨 앞부터 칸으로 선다", () => {
    seed(2, work.slug, "~/.atelier/works/some-work/trees/atelier");
    // 남의 work의 셸이 섞이면 안 된다 — `owner`가 이 화면의 것이어야 한다.
    terminalStore.setState(
      (state) =>
        openShell(state, {
          owner: ownerOf("남"),
          project: null,
          cwd: "~/x",
        })!.state,
    );
    expect(kindsOf(tabRowOf(render({}, "terminal")))).toEqual(["shell", "shell", "new"]);
  });

  it("세로 목록의 둘째 줄은 안 따라온다", () => {
    // 결정 45의 `cwd` 줄은 **세로 목록**의 것이다. 한 줄짜리 칸에 끌고 오면 이름이 그만큼
    // 밀린다 — 옮겨 온 것은 「칸이 무엇을 고르나」이지 행의 모양이 아니다.
    seed(1, work.slug, "~/.atelier/works/some-work/trees/atelier");
    expect(render()).not.toContain("~/.atelier/works/some-work/trees/atelier");
  });

  it("셸을 닫는 `×`가 칸마다 하나씩, 탭 줄 안에만 있다", () => {
    // 결정 71이 이 화면에서 걷어낸 것은 **세로 목록**이다. 닫는 길은 여전히 하나이고
    // (결정 22·92) 그것이 이제 탭의 `×`다 — 본문·패널에 또 서면 두 자리가 된다.
    seed(2, work.slug, "~/.atelier/works/some-work/trees/atelier");
    const markup = render();
    const row = tabRowOf(markup);
    expect(row.match(/aria-label="[^"]*닫기"/g)).toHaveLength(2);
    expect(markup.replace(row, "")).not.toMatch(/aria-label="[^"]*셸[^"]*닫기"/);
  });

  it("고른 작업이 없으면 탭 줄이 없고, 머리 줄에 화면 이름만 선다", () => {
    // **빈 소유자 키 `""`는 최상위 터미널이다**(ui-refresh 결정 23). 고른 작업이 없는 화면이
    // 소유자를 세우면 그 자리가 비어 `ownerOf(undefined)` → `""`가 되는데,
    // 그러면 `/terminal`의 셸이 work 화면의 줄에 서고 `+`는 열 자리가 없어 눌러도 아무 일이
    // 없는 버튼이 된다(결정 11·21이 금지하는 것). 그래서 여기 심는 것이 **최상위 셸**이다 —
    // 화면이 그 키를 짓지 않는다는 것이 이 케이스가 재는 전부다.
    seedOrigin(topTerminal(), 2);
    const client = new QueryClient();
    client.setQueryData(worksQuery().queryKey, []);
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <WorksPage
            sidebarOpen
            selectedSlug={null}
            currentFile={null}
            onOpenDoc={() => {}}
            tab="chat"
            onSelectTab={() => {}}
            code={null}
            onOpenCode={() => {}}
            thread={null}
            onOpenChat={() => {}}
            onOpenNewChat={() => {}}
            onFollowBundle={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(tabRowOf(markup)).toBe("");
    expect(kindsOf(markup)).toEqual([]);
    // 화면 이름은 머리 줄이 말한다(codex-ds 티켓 14) — 지금 보는 work가 없어 할 일 묶음도 패널 토글도 없고, 칸 안에 고를 것이
    // 없어 빈 화면 칸에는 머리가 없다.
    expect(headRowOf(markup)).toContain(">작업공간<");
    expect(headActionsOf(markup)).toBe("");
    expect(panelToggleTags(markup)).toEqual([]);
    expect(markup.slice(markup.indexOf("<main"))).not.toContain('data-slot="card-head"');
  });

  // 결정 12 — 켜진 칸은 **본문에 선 것 하나**다. 한때 분할이면 문서 칸과 그 셸 둘이 켜졌다(restart 02a-13이 분할을 걷었다).
  it("켜진 칸은 본문에 선 것 하나다", () => {
    seed(1, work.slug, "~/.atelier/works/some-work/trees/atelier");
    expect(tabsOn(tabRowOf(render({}, "terminal")))).toEqual(["shell"]);
  });

  // git-integration 판 01 — 켜진 칸은 **본문에 선 것**이다. 주소가 셸을 말하는데(`tab=terminal`) 묶음에
  // 셸이 없으면 지금 탭이 파일 탭으로 남는다(`withShellActive`가 켤 셸이 없고, 프로젝트가 둘 이상인 work은 자동 셸도 안
  // 띄운다). 그때 본문은 「아직 셸이 없어요」인데 그 파일 탭을 켜면 보이는 것과 켜진 칸이 어긋난다.
  it("주소가 셸을 말하는데 묶음에 셸이 없어 지금 탭이 파일 탭으로 남으면 묶음의 칸은 켜지지 않는다", () => {
    terminalStore.setState(() => openCodeTab(NO_SHELLS, ownerOf(work.slug), { project: "billing", path: "src/a.ts" }));
    expect(tabsOn(tabRowOf(render({}, "terminal")))).toEqual([]);
  });

  // 결정 12 — 칸을 끄는 자리를 **이 화면이 만든다.** 탭 줄이 스스로 만들면
  // `terminal → works` 방향이 값 차원에서 생겨 반대 방향과 맞물린다(ShellTabs의 그 prop
  // 주석이 같은 함정을 든다).
  //
  // 원천이 slug가 아니라 **owner**다(UI개선 스펙 S4) — `/terminal` 셸에는 slug가 없어
  // 공용 제스처가 slug를 실으면 그 화면이 못 끈다. 모양을 이 리터럴이 못박는다.
  //
  // 배선은 렌더로 못 본다(핸들러는 직렬화되지 않는다). **정규식으로 블록을 잘라내지
  // 않는다** — 이 파일이 그 fail-open을 이미 겪었다. 리터럴 하나로 통째로 못박으면
  // 어느 갈래가 뒤집혀도 반드시 빨개진다.
  //
  // 묶음의 칸(셸 칸 · 파일 탭 — git-integration 결정 31 · 채팅 탭 — restart 02a-5)은 그 칸의 종류를 싣는다 — 종류는 레지스트리가 id로
  // 안다. 채팅 탭도 거르지 않는다 — 셸 탭과 같은 규칙으로 끌린다. 새 채팅 탭(restart 02a-8)은 채팅 탭의 종류로 끌린다 — 줄의 틈은 종류를
  // 안 본다. 한때 문서 칸(`spec`)도 끌려 본문 절반에 놓으면 분할이 섰다(restart 02a-13이 둘을 걷었다).
  it("칸을 끄는 자리를 이 화면이 만들고, 묶음의 칸을 그 종류로 싣는다", () => {
    const page = source("WorksPage.tsx");
    expect(countOf(
      page,
      `onDragTab={(shellId, from) => {
        const owner = ownerOf(panelWork.slug);
        const kind = bundleTabOf(terminalStore.state, owner, shellId)?.kind;
        if (kind) armDrag({ kind: kind === "new-chat" ? "chat" : kind, owner, shellId }, from);
      }}`,
    )).toBe(1);
    expect(countOf(page, "halfSource")).toBe(0);
    expect(countOf(page, "dropHere")).toBe(0);
  });

  // 같은 눌림의 **둘째 소비자**가 탭 줄이다(UI개선 스펙 S10) — 줄은 스토어를 모르므로
  // 틈을 적는 자리와 놓았을 때 옮기는 자리를 이 화면이 준다. 둘 다 모듈 함수라 회차를 넘어
  // 같다. 틈 표시는 드래그 상태에서 읽어 내린다.
  it("탭 줄의 틈을 적고 놓으면 옮기는 자리를 이 화면이 준다", () => {
    const page = source("WorksPage.tsx");
    expect(countOf(page, "slot={drag.slot}")).toBe(1);
    expect(countOf(page, "onSlot={hoverSlot}")).toBe(1);
    expect(countOf(page, "onDropSlot={dropShellOnSlot}")).toBe(1);
  });
});

// restart 02a-4 — 작업공간의 채팅이 채팅 탭에 선다. 탭 줄에서 셸 · 파일 탭과 같은 묶음에 서고, 켜지면 본문 카드가 그 채팅이다(머리는 탭 줄,
// 몸은 채팅의 흐름과 입력창). 탭은 주소가 정본이라 묶음은 이 시험이 심는다 — 주소를 따라 묶음을 맞추는 일은 화면의 효과라 정적 마크업에서
// 돌지 않는다.
describe("WorksPage 채팅 탭", () => {
  const chat: ThreadView = {
    id: "20261010-100000",
    title: "실패 신호 구현",
    createdAt: "2026-10-10T10:00:00.000+09:00",
    work: work.slug,
    mode: null,
    runtime: "claude-code",
    sessionId: "세션",
    cwd: "/home/works/some-work",
    additionalDirectories: [],
    model: null,
    effort: null,
    lastRead: 0,
    lastSeq: 1,
    askLevel: "always",
    live: false,
    queue: [],
    readOnly: null,
    flowing: null,
  };
  const said: RecordLine[] = [];

  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    terminalStore.setState(() => openChatTab(NO_SHELLS, ownerOf(work.slug), chat.id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    terminalStore.setState(() => NO_SHELLS);
  });

  const kindsOf = (markup: string) =>
    markup
      .split('data-tab="')
      .slice(1)
      .map((chunk) => ({ kind: chunk.slice(0, chunk.indexOf('"')), on: chunk.includes('aria-pressed="true"') }));

  it("채팅 탭이 묶음에 그 채팅의 이름으로 서고, 켜져 있다", () => {
    const row = tabRowOf(render({}, "chat", { chat: { view: chat, lines: said } }));
    expect(kindsOf(row)).toEqual([
      { kind: "chat", on: true },
      { kind: "new", on: false },
    ]);
    expect(row).toContain("실패 신호 구현");
  });

  it("본문 카드가 그 채팅이다 — 머리는 탭 줄이고 몸은 입력창이 선 채팅이다", () => {
    const markup = render({}, "chat", { chat: { view: chat, lines: said } });
    const main = markup.slice(markup.indexOf("<main"));
    expect(main).toMatch(/^<main[^>]*aria-label="채팅"/);
    expect(main).toContain("data-tab-row");
    expect(main).toContain('aria-label="보낼 말"');
    // 문서 카드가 아니다 — 경로 줄이 없다.
    expect(pathBarOf(markup)).toBe("");
  });

  // restart 02a-5 — 채팅 탭은 셸 탭처럼 닫히고 이름이 바뀐다. 칸의 `×`는 그 채팅의 이름으로 서고, 칸에서 고친 이름은 채팅 이름 명령으로
  // 간다(머리 줄에서 고치던 것과 같은 길). 우클릭 메뉴 앞머리는 채팅의 ⋯ 항목이다 — 정의는 채팅 쪽 한 자리다. 배선은 렌더로 못 봐서
  // 리터럴로 못박는다(핸들러는 직렬화되지 않는다).
  it("채팅 탭에 그 채팅 이름의 `×`가 서고, 이름 바꾸기와 ⋯ 항목이 채팅 쪽으로 이어진다", () => {
    const row = tabRowOf(render({}, "chat", { chat: { view: chat, lines: said } }));
    expect(row).toContain('aria-label="실패 신호 구현 닫기"');
    const page = source("WorksPage.tsx");
    expect(page).toContain("chat={chatTabs}");
    expect(countOf(page, "renameThread.mutate(")).toBe(1);
    expect(page).toContain("menu: (rename) => <ThreadMenuItems rename={rename} />");
  });

  // restart 02a-6 — 숨은 채팅 탭은 내려서 기록 구독과 조각 그리기를 멈춘다. 켜진 채팅 탭 하나만 그리므로 숨은 탭의 기록 줄도 흐르는 글도 화면에
  // 없다. 기록 · 글 · 첨부 · 인용은 스토어에 있어 남고, 굴림 자리는 탭이 쥐었다가 돌아오면 되살린다.
  describe("숨은 채팅 탭", () => {
    const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
    // 도는 턴의 채팅 — 물음 하나 뒤 답이 흐른다.
    const running: ThreadView = { ...chat, id: "20261010-110000", title: "흐르는 채팅", live: true, lastSeq: 1 };
    const asked: RecordLine[] = [{ seq: 1, at: at(1), kind: "sent", payload: { text: "숨은 탭의 물음" } }];

    function drawBoth(tab: ViewTab, thread: string | null): string {
      const client = new QueryClient();
      client.setQueryData(worksQuery().queryKey, [work]);
      client.setQueryData(threadsQuery().queryKey, [summaryOf(chat), summaryOf(running)]);
      client.setQueryData(threadQuery(chat.id).queryKey, chat);
      client.setQueryData(threadQuery(running.id).queryKey, running);
      mergeLines(running.id, asked);
      return renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <WorksPage
              sidebarOpen
              selectedSlug={work.slug}
              currentFile={null}
              onOpenDoc={() => {}}
              tab={tab}
              onSelectTab={() => {}}
              code={null}
              onOpenCode={() => {}}
              thread={thread}
              onOpenChat={() => {}}
              onOpenNewChat={() => {}}
              onFollowBundle={() => {}}
            />
          </ToastProvider>
        </QueryClientProvider>,
      );
    }

    beforeEach(() => {
      terminalStore.setState(() => openChatTab(openChatTab(NO_SHELLS, ownerOf(work.slug), running.id), ownerOf(work.slug), chat.id));
      addChunk(running.id, { stream: 1, kind: "message", offset: 0, text: "숨은탭에흐르는답" });
    });
    afterEach(() => {
      discardFlow(running.id, 1);
      setDraft(running.id, "");
    });

    it("다른 채팅 탭이 켜지면 숨은 탭의 기록 줄과 흐르는 글을 그리지 않는다", () => {
      // 켜면 그 채팅이 선다 — 이 시험이 그리는 자리가 실제로 흐르는 글을 그린다는 것부터 본다.
      const shown = drawBoth("chat", running.id);
      expect(shown).toContain("숨은 탭의 물음");
      expect(shown).toContain("숨은탭에흐르는답");

      const hidden = drawBoth("chat", chat.id);
      expect(hidden).not.toContain("숨은 탭의 물음");
      expect(hidden).not.toContain("숨은탭에흐르는답");
      expect(hidden.match(/aria-label="보낼 말"/g)).toHaveLength(1);
    });

    it("셸이나 파일 탭이 켜지면 채팅을 그리지 않는다", () => {
      const markup = drawBoth("terminal", null);
      expect(markup).not.toContain("숨은탭에흐르는답");
      expect(markup).not.toContain('aria-label="보낼 말"');
    });

    it("돌아온 탭은 쥔 자리에 서고 쓰던 말이 남는다 — 위로 올려 읽던 탭에는 「맨 아래로」가 선다", () => {
      setDraft(running.id, "숨은 동안 쓰던 말");
      terminalStore.setState((state) => keepChatPlace(state, ownerOf(work.slug), running.id, { kind: "at", top: 480 }));
      const back = drawBoth("chat", running.id);
      expect(back).toContain('aria-label="맨 아래로"');
      expect(back).toMatch(/<textarea[^>]*aria-label="보낼 말"[^>]*>숨은 동안 쓰던 말<\/textarea>/);
    });

    it("바닥을 따라가던 탭은 바닥으로 돌아온다 — 「맨 아래로」가 없다", () => {
      terminalStore.setState((state) => keepChatPlace(state, ownerOf(work.slug), running.id, { kind: "bottom" }));
      expect(drawBoth("chat", running.id)).not.toContain('aria-label="맨 아래로"');
    });

    // 내려가는 순간은 정적 렌더에 없다 — 화면이 그 탭의 자리를 묶음에 쥐는 배선을 소스로 못박는다. 굴림 거리는 L3(02a-16)가 잰다.
    it("채팅 탭 몸이 탭이 쥔 자리를 받고, 내려갈 때 그 탭에 쥔다", () => {
      const worksPage = source("WorksPage.tsx");
      expect(worksPage).toContain("place={chatPlaceOf(shellState, ownerOf(selected.slug), chatThread)}");
      expect(worksPage).toContain("onLeave={(place) => keepChatTabPlace(ownerOf(selected.slug), chatThread, place)}");
    });
  });
});

// restart 02a-9 · 스토리 93 · 94 · 96 · 보드 SummarySheet 「오른쪽 자리는 하나다」 — spec 패널과 요약 카드는 오른쪽 자리 하나를 나눠 쓰고, 그
// 값은 작업공간 화면이 작업공간마다 하나로 쥔다(`workSeat`). 요약 단추(「요약 카드」)는 창 머리 오른쪽, 패널 토글 앞에 선다. 값은 손짓으로
// 바꾸고(정적 마크업에는 누름이 없다) 그린 화면으로 표의 줄마다 잰다. 사이드바 접기는 효과라 정적 그림에 없다 — 그 판정(`rightShown`)은
// `right-place.test.ts`가 재고, 배선은 리터럴로 못박는다.
describe("WorksPage 오른쪽 자리", () => {
  const chat: ThreadView = {
    id: "20261010-160000",
    title: "실패 신호 구현",
    createdAt: "2026-10-10T10:00:00.000+09:00",
    work: work.slug,
    mode: null,
    runtime: "claude-code",
    sessionId: "세션",
    cwd: "/home/works/some-work",
    additionalDirectories: [],
    model: null,
    effort: null,
    lastRead: 0,
    lastSeq: 1,
    askLevel: "always",
    live: false,
    queue: [],
    readOnly: null,
    flowing: null,
  };
  const onChat = () => render({}, "chat", { chat: { view: chat, lines: [] } });
  const summaryButton = (markup: string) => /<button\b[^>]*aria-label="요약 카드"[^>]*>/.exec(headRowOf(markup))?.[0] ?? "";
  const hasCard = (markup: string) => /<section[^>]*aria-label="요약"/.test(markup);
  const seat = workSeat(work.slug);

  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    terminalStore.setState(() => openChatTab(NO_SHELLS, ownerOf(work.slug), chat.id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    terminalStore.setState(() => NO_SHELLS);
    rightPlaceStore.setState(() => ({}));
    bodyTabStore.setState(() => ({}));
  });

  // 한때 「요약 카드」 앞에 분할이 섰다(restart 02a-13이 걷었다) — 이제 세로선 너머 첫 단추다.
  it("창 머리의 「요약 카드」가 ⋯ 뒤 세로선 너머, 패널 토글 앞에 선다", () => {
    const buttons = headActionsOf(onChat()).match(/<button[^>]*>/g) ?? [];
    const at = (label: string) => buttons.findIndex((tag) => tag.includes(`aria-label="${label}"`));
    expect(at("요약 카드")).toBeGreaterThan(-1);
    expect(at("요약 카드")).toBe(at("작업공간 메뉴") + 1);
    expect(at("작업공간 패널 접기")).toBe(at("요약 카드") + 1);
  });

  // restart 02a-10 — 셸 · 파일 탭에서 누르면 채팅 탭을 먼저 켜고 작은 카드를 세운다(`cardTabOf`). 그래서 단추는 작업공간 화면에 늘
  // 선다(시안 Main 창 머리). 셸 · 파일 탭이 켜지면 값이 없음이 되어 꺼져 있다.
  it("「요약 카드」는 셸 탭에서도 같은 자리에 선다", () => {
    const markup = render({}, "terminal");
    const buttons = headActionsOf(markup).match(/<button[^>]*>/g) ?? [];
    const at = (label: string) => buttons.findIndex((tag) => tag.includes(`aria-label="${label}"`));
    expect(at("요약 카드")).toBe(at("작업공간 메뉴") + 1);
    expect(summaryButton(markup)).toContain('aria-pressed="false"');
  });

  it("셸이 켜진 뒤의 자리 — 카드가 닫혀 단추가 꺼지고 spec 패널은 그대로다", () => {
    followTab(seat, "spec", 1);
    moveSeat(seat, "spec", { kind: "expand", target: { kind: "doc", path: "overview.md" } });
    followTab(seat, "spec", null);
    const markup = render({}, "terminal");
    expect(summaryButton(markup)).toContain('aria-pressed="false"');
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="false"');
  });

  it("채팅을 처음 열면 spec 패널이 열려 있고 요약 카드는 닫혀 있다", () => {
    const markup = onChat();
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="true"');
    expect(railItems(markup)[0]).toEqual({ name: "spec", pressed: "true" });
    expect(hasCard(markup)).toBe(false);
    expect(summaryButton(markup)).toContain('aria-pressed="false"');
  });

  it("「요약 카드」로 연 자리 — spec 패널이 접히고 작은 카드가 서며 단추가 켜진다", () => {
    moveSeat(seat, "spec", { kind: "toggle", place: "summary" });
    const markup = onChat();
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="false"');
    expect(railItems(markup)[0]).toEqual({ name: "spec", pressed: "false" });
    expect(hasCard(markup)).toBe(true);
    expect(markup).not.toContain("data-expanded");
    expect(summaryButton(markup)).toContain('aria-pressed="true"');
  });

  it("레일의 spec으로 연 자리 — spec 패널이 열리고 요약 카드가 닫힌다", () => {
    moveSeat(seat, "spec", { kind: "toggle", place: "summary" });
    moveSeat(seat, "spec", { kind: "show", place: "spec" });
    const markup = onChat();
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="true"');
    expect(hasCard(markup)).toBe(false);
  });

  it("넓힌 자리 — spec 패널이 접히고 카드가 넓어져 대화가 왼쪽 480에 남는다", () => {
    moveSeat(seat, "spec", { kind: "expand", target: { kind: "doc", path: "overview.md" } });
    const markup = onChat();
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="false"');
    expect(markup).toMatch(/<section[^>]*aria-label="요약"[^>]*data-expanded=""/);
    expect(markup).toContain("width:var(--size-thread-beside)");
  });

  // 토스트는 한 장이고(S26) 화면마다 자리가 하나다(S14) — 넓힌 카드가 서 있으면 그 보기(`ExpandedViewer`)의 자리가 받는다(구현 스펙 「설치
  // 안내」 줄 · 채팅 본문의 `toasts={!expanded}`와 같다). 두 자리가 한 관리자를 읽으면 같은 토스트가 두 자리에 함께 선다(02a-15 — L3
  // `target-menus` 「Works 문서에서 … 복사」).
  it("넓힌 카드가 서 있으면 토스트 자리는 그 보기의 것 하나다 — 작은 카드 · 카드 없음에서는 화면의 자리 하나다", () => {
    const places = (markup: string) => markup.match(/aria-label="메시지"/g)?.length ?? 0;
    expect(places(onChat()), "카드 없음").toBe(1);
    moveSeat(seat, "spec", { kind: "toggle", place: "summary" });
    expect(places(onChat()), "작은 카드").toBe(1);
    moveSeat(seat, "spec", { kind: "expand", target: { kind: "doc", path: "overview.md" } });
    const expanded = onChat();
    expect(expanded, "넓힌 카드를 찾지 못했다").toMatch(/<section[^>]*aria-label="요약"[^>]*data-expanded=""/);
    expect(places(expanded), "넓힌 카드").toBe(1);
    expect(expanded.indexOf('aria-label="메시지"'), "자리가 넓힌 카드의 보기 안에 선다").toBeGreaterThan(expanded.indexOf("data-viewer="));
  });

  it("넓힌 카드의 × 뒤 — 작은 카드로 돌아오고 spec 패널은 접힌 채다", () => {
    moveSeat(seat, "spec", { kind: "expand", target: { kind: "doc", path: "overview.md" } });
    moveSeat(seat, "spec", { kind: "collapse" });
    const markup = onChat();
    expect(hasCard(markup)).toBe(true);
    expect(markup).not.toContain("data-expanded");
    expect(markup).toContain("width:100%");
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="false"');
  });

  it("오른쪽 자리 값이 작업공간마다 하나다 — 다른 작업공간에서 연 카드가 이 화면에 서지 않는다", () => {
    moveSeat(workSeat("another-work"), "spec", { kind: "toggle", place: "summary" });
    const markup = onChat();
    expect(hasCard(markup)).toBe(false);
    expect(panelToggleTags(markup)[0]).toContain('aria-expanded="true"');
  });

  // 넓힌 카드는 채팅이 본문에 서 있을 때만이다 — 셸이 본문이면 카드도 없고, 넓은 동안 접었던 사이드바가 돌아온다(그 판정이 `chat`이다).
  it("셸이 본문이면 넓혀 둔 값이어도 카드가 없다", () => {
    moveSeat(seat, "spec", { kind: "expand", target: { kind: "doc", path: "overview.md" } });
    const markup = render({}, "terminal");
    expect(hasCard(markup)).toBe(false);
    expect(markup).not.toContain("var(--size-thread-beside)");
  });

  // restart 02a-11 — 새 채팅 탭도 카드가 서는 탭이다. 켜진 새 채팅 탭 몸에도 같은 값을 건넨다.
  it("작업공간 화면이 오른쪽 자리를 쥐고 채팅 탭 · 새 채팅 탭 몸에 건넨다 — 넓힌 카드는 그 탭이 본문에 설 때만이다", () => {
    const page = source("WorksPage.tsx");
    expect(page).toContain("chat: selected !== null && (chatThread !== null || newChatShown),\n    tab: bodyTab,");
    expect(page).toContain("card={right.card}");
    expect(page).toContain("card={visibleNewChat?.id === one.id ? right.card : null}");
    expect(countOf(page, "<SummaryToggle")).toBe(1);
  });

  // 누름은 정적 그림에 없다 — 켤 채팅 탭을 고르는 것(`cardTabOf`)은 `right-place.test.ts`가 표의 줄마다 재고, 배선은 리터럴로 못박는다. 카드가
  // 서는 탭이 아니면 채팅 탭을 먼저 켜고 작은 카드를 세운다(여닫기가 아니다 — 셸에서는 값이 늘 없음이라 같은 말이지만, 표가 「작은 카드」다).
  it("셸 · 파일 탭에서 「요약 카드」는 채팅 탭을 먼저 켜고 작은 카드를 세운다", () => {
    const page = source("WorksPage.tsx");
    expect(page).toContain("<SummaryToggle open={right.summaryOpen} onToggle={pressSummary} />");
    expect(page).toContain(
      "return cardTabOf(workSeat(slug), bundleOf(terminalStore.state, ownerOf(slug)), latest);",
    );
    expect(page).toContain('if (landing.kind === "thread") onOpenChat(landing.id);\n    else onOpenNewChat();\n    moveRight({ kind: "show", place: "summary" });');
  });
});

// restart 02a-12 · 스토리 95 · 102 · SummarySheet 표의 문서 줄 · 「넓힌 카드」 표의 Project 줄 — 문서와 파일을 넓힌 카드에서 연다. 누름 · 주소에 닿는
// 것 · 카드가 바뀌는 것은 정적 그림에 없다(이펙트 · 핸들러). 무엇을 고르는지는 순수 함수가 잰다 — 켤 탭(`cardTabOf`)과 값(`nextSeat`)은
// `right-place.test.ts`의 「문서 줄」, 주소와 카드의 짝(`docArrival` · `cardDocFile`)은 「주소의 문서와 넓힌 카드」, 주소의 모양(`cardDocSearch` ·
// `fileSearch`)은 `-work-search.test.ts`의 「넓힌 카드의 문서 주소」, 트리의 갈래(`treePick`)는 `expanded.test.ts`. 배선은 리터럴로 못박는다.
describe("WorksPage 문서와 파일을 넓힌 카드에서 연다", () => {
  const page = source("WorksPage.tsx");
  const thread = (file: string) => readFileSync(fileURLToPath(new URL(`../thread/${file}`, import.meta.url)), "utf8");

  // 「요약 카드」와 같은 길이다(02a-10) — 카드가 서는 탭이 본문이면 그 자리에서 넓히고, 아니면 켤 탭으로 옮기며 문서를 주소에 얹는다(한 번에).
  it("spec 패널의 문서 줄은 넓힌 카드로 연다 — 카드가 서는 탭이 아니면 「요약 카드」처럼 켤 탭을 먼저 고른다", () => {
    expect(page).toContain("onSelectFile={openDoc}");
    expect(page).toContain(
      'moveRight({ kind: "expand", target: { kind: "doc", path } });\n    if (!cardBody) onOpenDoc(path, cardTabNow(selected.slug));',
    );
    expect(page).toContain("const landing = cardTabNow(selected.slug);");
    expect(countOf(page, "cardTabOf(")).toBe(1);
  });

  // 주소의 `file`은 넓힌 카드의 문서다 — 닿으면 열고(없는 문서면 걷고), 카드가 다른 것을 열거나 닫히면 주소가 따라간다. 둘 다 카드가 서는 탭이
  // 본문일 때만이다(한때 분할의 `file`은 문서 열의 것이었다 — restart 02a-13이 분할을 걷었다).
  it("주소에 닿은 문서가 넓힌 카드를 열고, 카드가 바뀌면 주소가 따라간다", () => {
    expect(page).toContain("const cardBody = selected !== null && (chatThread !== null || newChatShown);");
    expect(page).toContain("const move = docArrival(currentFile, selected.specFiles, right.card.opened);");
    expect(page).toContain('if (move === "clear") onOpenDoc(null, null);');
    expect(page).toContain("const next = cardDocFile(right.card.opened, currentFile);");
    expect(page).toContain("if (next !== undefined) onOpenDoc(next, null);");
  });

  // 넓힌 카드 안의 코드 보기를 걷었다 — 바뀐 파일은 변경 보기, 그 밖의 파일은 파일 탭(트리를 훑는 손짓이라 replace)이다. 파일 탭이 켜지면 탭 줄
  // 규칙이 카드를 닫는다(02a-10).
  it("넓힌 카드의 Project 트리에서 바뀐 파일은 변경으로, 그 밖의 파일은 파일 탭으로 연다", () => {
    const viewer = thread("ExpandedViewer.tsx");
    expect(viewer).toContain("const pick = treePick(project, target.path, changed);");
    expect(viewer).toContain('if (pick.kind === "change") onOpen(pick);\n          else onOpenFile(pick);');
    expect(viewer).not.toContain("CodeView =");
    expect(page).toContain("openFile: (target) => onOpenCode(target.project, target.path, false),");
    expect(thread("ThreadScreen.tsx")).toContain("onOpenFile={card.onOpenFile}");
  });
});

/** 채팅 화면의 값에서 목록 요약을 짓는다 — 탭 줄이 채팅 이름을 목록에서 읽는다. */
function summaryOf(view: ThreadView): ThreadSummary {
  return {
    id: view.id,
    title: view.title,
    createdAt: view.createdAt,
    lastAt: view.createdAt,
    work: view.work,
    service: view.service ?? null,
    project: null,
    lastRead: view.lastRead,
    readOnly: view.readOnly,
    broken: null,
  };
}

// **이 화면의 셸 조회는 이 work의 주인 키를 딛는다**(셸 주인이 slug다 — ui-refresh 결정 23). **소유자를 짓는 자리마다**
// 못박는다. 눈에 보이는 하나(탭 줄)는 위에서 값으로 재고, 여기 남은 둘은 렌더로 못 본다 — 하나는 이펙트가
// 읽는 셀렉터이고 하나는 버튼을 눌러야 서는 확인 대화 안이다. 리터럴 하나를 통째로 세면 파싱이 없어 샐 자리도 없다.
describe("WorksPage 셸 조회가 이 work의 것이다", () => {
  const worksPage = source("WorksPage.tsx");

  // 묶음이 비었는지를 재는 개수다(restart 02a-8 — 비면 새 채팅 탭이 선다. 한때 분할을 걷는 판단도 이것을 셌다). 남의 칸을 세면 이 work의
  // 마지막 칸을 닫아도 새 채팅 탭이 안 서고, 남의 칸을 닫으면 선다.
  it("묶음이 비었는지 세는 칸 수가 이 work의 것이다", () => {
    expect(countOf(worksPage, "bundleOf(state, ownerOf(panelWork.slug)).length")).toBe(1);
  });

  // 「셸 N개가 닫혀요」의 N(결정 26). 남의 셸을 세면 엉뚱한 수를 말하고 — 0이라 아예 안 묻고 — 정작 닫히는 것은 이
  // work의 셸들이다. 묻는 흐름은 work 메뉴 넷이 함께 부르는 자리(`work-menu-actions.ts`)에 있고, `work`는 그 메뉴의 대상이다.
  it("아카이브 확인이 말하는 수가 이 work의 것이다", () => {
    expect(countOf(source("work-menu-actions.ts"), "runningShellsOf(terminalStore.state, ownerOf(work.slug))")).toBe(1);
  });
});

// 결정 13. ⌘W의 대상이 **켜진 탭**이 됐다 — 겨눌 칸이 화면에 서게 된 것이 그 근거다(adr-03).
//
// **겨누는 칸을 정하는 일이 순수 함수로 나와 있어 이건 진짜로 도는 검사다**(⌘Enter의 `togglesPanel`과
// 같은 이유). 핸들러 안에 두면 소스를 문자열로 훑는 검사밖에 못 거는데, 그 검사는 핸들러
// 첫 줄에 `return`을 얹어도 초록이었다(실측). 키 판정 쪽(`closesShellFromWindow`)은
// shell-registry.test.ts에 전수돼 있다.
describe("WorksPage ⌘W가 겨누는 칸", () => {
  afterEach(() => {
    terminalStore.setState(() => NO_SHELLS);
  });

  const ownerFor = (slug: string) => ownerOf(slug);
  function seed(origin: ShellOrigin): number {
    const opened = openShell(NO_SHELLS, origin)!;
    terminalStore.setState(() => opened.state);
    return opened.id;
  }
  const workSeat = (slug: string): ShellOrigin => ({
    owner: ownerFor(slug),
    project: null,
    cwd: "~/x",
  });

  it("터미널 탭에서는 그 화면의 켜진 칸이다", () => {
    const id = seed(workSeat(work.slug));
    expect(shellClosedByTab("terminal", ownerFor(work.slug), terminalStore.state)).toBe(id);
  });

  // 셸 칸을 닫는 길은 본문이 셸일 때만이다 — 채팅 탭이 본문이면 셸이 묶음에 있어도 셸을 닫지 않는다. 한때 이 자리는 「`spec`이 켜져
  // 있으면」이었다(restart 02a-13이 그 칸을 걷었다).
  it("채팅 탭이 본문이면 셸을 닫지 않는다", () => {
    seed(workSeat(work.slug));
    expect(shellClosedByTab("chat", ownerFor(work.slug), terminalStore.state)).toBeNull();
  });

  it("고른 작업이 없으면 최상위 터미널의 셸을 닫지 않는다", () => {
    // **`null`은 「고른 작업이 없다」다** — 최상위 터미널이 아니다. 그 가드를 지우고 그냥
    // `activeIdOf`를 부르면 이제는 L0가 먼저 막지만(소유자가 늘 문자열이다), 가드가 없어지는
    // 대신 `ownerOf(panelWork?.slug)` 꼴이 들어오면 **빈 키 `""`**가 되어 work 화면의
    // ⌘W가 최상위 셸을 죽인다. 그 갈래를 여기서 못박는다.
    seed(topTerminal());
    expect(shellClosedByTab("terminal", null, terminalStore.state)).toBeNull();
  });

  it("그 화면의 셸이 0개면 닫을 것이 없다", () => {
    seed(workSeat("남"));
    expect(shellClosedByTab("terminal", ownerFor(work.slug), terminalStore.state)).toBeNull();
  });

  // git-integration 판 01 — 묶음에는 파일 탭도 선다. 주소가 셸을 말하는데(`tab=terminal`) 묶음에 셸이 없으면 지금 탭이 파일
  // 탭으로 남는다(`withShellActive`가 켤 셸이 없다 — 자동 셸이 안 뜨는 프로젝트 둘 이상의 work). 그 칸을 셸을 닫는 길에
  // 넘기면 확인 창을 거치는 길이 셸 아닌 칸을 받는다 — 본문에 셸이 없으니 닫을 것이 없다.
  it("터미널 탭인데 지금 탭이 파일 탭이면(묶음에 셸이 없다) 셸을 닫는 길에 그 칸을 넘기지 않는다", () => {
    terminalStore.setState(() => openCodeTab(NO_SHELLS, ownerFor(work.slug), { project: "billing", path: "src/a.ts" }));
    expect(shellClosedByTab("terminal", ownerFor(work.slug), terminalStore.state)).toBeNull();
  });

  // 파일 탭 쪽 짝(git-integration 스토리 50 · 티켓 07). ⌘W는 본문이 그 파일 탭일 때만 닫는다 — 주소가 다른 탭을 말하면 묶음의 지금 탭이
  // 파일 탭이어도 아무 일이 없다. 한때 분할에서 문서 열에 포커스가 있으면(`tab`이 spec) 옆 열의 파일 탭을 닫지 않는 갈래였다(restart
  // 02a-13이 분할을 걷었다).
  describe("파일 탭", () => {
    const owner = ownerFor(work.slug);
    function seedCode(): number {
      terminalStore.setState(() => openCodeTab(NO_SHELLS, owner, { project: "billing", path: "src/a.ts" }));
      return terminalStore.state.activeByOwner[owner]!;
    }

    it("본문이 파일 탭이면 그 칸이다", () => {
      const id = seedCode();
      expect(viewTabClosedByTab("code", owner, terminalStore.state)).toBe(id);
    });

    it("주소가 채팅 탭을 말하면 파일 탭을 닫지 않는다", () => {
      seedCode();
      expect(viewTabClosedByTab("chat", owner, terminalStore.state)).toBeNull();
    });

    it("주소가 셸을 말하면 파일 탭을 닫지 않는다", () => {
      seedCode();
      expect(viewTabClosedByTab("terminal", owner, terminalStore.state)).toBeNull();
    });

    it("지금 탭이 셸이면 이 길로 닫지 않는다 — 셸은 확인 창을 거친다", () => {
      seedCode();
      // 얹는다 — `seed`는 빈 상태에서 다시 짓는다. 새 셸이 묶음 끝에 서고 지금 탭이 된다.
      terminalStore.setState((state) => openShell(state, workSeat(work.slug))!.state);
      expect(viewTabClosedByTab("code", owner, terminalStore.state)).toBeNull();
    });

    it("고른 작업이 없으면 닫을 것이 없다", () => {
      seedCode();
      expect(viewTabClosedByTab("code", null, terminalStore.state)).toBeNull();
    });
  });

  // restart 02a-5 — 채팅 탭은 셸 탭처럼 닫힌다. 본문이 채팅 탭이면 ⌘W가 그 칸을 확인 없이 닫는다 — 닫는 것은 칸뿐이고 채팅과 돌던 턴은
  // 남는다. 입력창에서 친 ⌘W는 여기까지 오지 않는다(`closesShellFromWindow`가 글을 치는 자리를 비켜 간다).
  describe("채팅 탭", () => {
    const owner = ownerFor(work.slug);
    function seedChat(): number {
      terminalStore.setState(() => openChatTab(NO_SHELLS, owner, "20261010-100000"));
      return terminalStore.state.activeByOwner[owner]!;
    }

    it("본문이 채팅 탭이면 그 칸이다", () => {
      const id = seedChat();
      expect(viewTabClosedByTab("chat", owner, terminalStore.state)).toBe(id);
    });

    it("주소가 셸을 말하면 채팅 탭을 닫지 않는다 — 셸은 확인 창을 거친다", () => {
      seedChat();
      expect(viewTabClosedByTab("terminal", owner, terminalStore.state)).toBeNull();
    });

    it("주소가 파일 탭을 말하는데 지금 탭이 채팅이면 닫지 않는다 — 본문과 다른 칸을 닫지 않는다", () => {
      seedChat();
      expect(viewTabClosedByTab("code", owner, terminalStore.state)).toBeNull();
    });
  });

  // 배선은 렌더로 못 본다(이펙트다). **정규식으로 블록을 잘라내지 않는다** — 앞쪽
  // `[\s\S]*?`가 남의 이펙트에서 출발해 초록이 되는 사고를 이 파일이 이미 겪었다.
  it("그 판단이 window에서 듣는 자리에 실제로 배선돼 있다", () => {
    const worksPage = source("WorksPage.tsx");
    // 판정을 손으로 다시 적으면 xterm 안에서 확인 창이 두 번 뜬다 — 그 예외는 저 함수가 든다.
    expect(worksPage).toContain("if (!closesShellFromWindow(e)) return;");
    expect(worksPage).toContain("const id = shellClosedByTab(tab, tabOwner, terminalStore.state);");
    // **확인 창을 우회하는 길을 새로 만들지 않는다**(결정 92).
    expect(worksPage).toContain("void requestCloseShell(id);");
    // 탭의 `×`도 **같은 함수**로 온다. 두 길이 갈리면 한쪽만 확인 창을 거치는데, 화면으로는
    // 「가끔 안 묻는다」로만 보인다 — 결정 92가 `closeShell`을 밖으로 안 내보낸 그 이유다.
    // 셸이 아닌 칸(파일 탭 · 채팅 탭 · 새 채팅 탭)만 확인 없이 닫는다(git-integration 스토리 37 · restart 02a-5 · 02a-8) — 셸 칸은 여전히
    // 이 함수다. 보기 탭을 닫는 길은 하나다(`closeBundleView` — 새 채팅 탭이면 그 탭의 글도 지운다).
    expect(worksPage).toContain(`if (kind === "shell") void requestCloseShell(id);
        else if (kind) closeBundleView(id);`);
    // ⌘W도 보기 탭은 같은 길이다.
    expect(worksPage).toContain("closeBundleView(viewId);");
    // 보기 탭을 확인 없이 빼는 자리는 그 하나다 — 한때 files 칸 트리에서 보이는 파일을 다시 누르면 닫는 길이 하나 더 있었다(restart 02a-14가
    // files 칸과 함께 걷었다).
    expect(countOf(worksPage, "closeViewTab(")).toBe(1);
    expect(worksPage).toContain("  forgetNewChat(newChatKey(id));\n  closeViewTab(id);");
  });
});

// restart 02a-8 — **작업공간에서 새 채팅 탭을 연다.** `tab=chat`에 `thread`가 없으면 새 채팅 탭이고, 어느 새 채팅 탭인지는 묶음이 쥔다(셸과
// 같다). 몸은 그 작업공간에 이어 보내는 입력창이다 — 작업공간은 씨앗(`?work=`)이 아니라 그 탭이 선 묶음에서 읽는다. 글 · 첨부 · 인용의 열쇠는
// 탭마다다(`newChatKey`). **숨은 새 채팅 탭은 내리지 않는다** — 고른 Runtime · 보내는 중 상태가 그 몸의 지역 상태라, 셸 · 파일 탭을
// 다녀와도 남아야 한다. 묶음은 이 시험이 심는다 — 주소를 따라 묶음을 맞추는 일은 화면의 효과라 정적 마크업에서 돌지 않는다.
describe("WorksPage 새 채팅 탭", () => {
  const owner = ownerOf(work.slug);
  let first = 0;
  let second = 0;

  function drawNewChat(tab: ViewTab, opening = false, seed: (client: QueryClient) => void = () => {}): string {
    const client = new QueryClient();
    client.setQueryData(worksQuery().queryKey, [work]);
    client.setQueryData(threadsQuery().queryKey, []);
    seed(client);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <WorksPage
            sidebarOpen
            selectedSlug={work.slug}
            currentFile={null}
            onOpenDoc={() => {}}
            tab={tab}
            onSelectTab={() => {}}
            code={null}
            onOpenCode={() => {}}
            thread={null}
            onOpenChat={() => {}}
            onOpenNewChat={() => {}}
            opening={opening}
            onFollowBundle={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  /** 그 새 채팅 탭의 몸을 싼 상자(`data-new-chat`). */
  const bodyOf = (markup: string, id: number) => boxOf(markup, new RegExp(`<div[^>]*data-new-chat="${id}"`));

  const kindsOf = (markup: string) =>
    markup
      .split('data-tab="')
      .slice(1)
      .map((chunk) => ({ kind: chunk.slice(0, chunk.indexOf('"')), on: chunk.includes('aria-pressed="true"') }));

  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    // 새 채팅 탭 둘 — 둘째가 켜져 있다.
    const one = openNewChatTab(NO_SHELLS, owner);
    first = activeIdOf(one, owner) ?? -1;
    const two = openNewChatTab(one, owner);
    second = activeIdOf(two, owner) ?? -1;
    terminalStore.setState(() => two);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    terminalStore.setState(() => NO_SHELLS);
    rightPlaceStore.setState(() => ({}));
    bodyTabStore.setState(() => ({}));
    forgetNewChat(newChatKey(first));
    forgetNewChat(newChatKey(second));
    forgetNewChat(NEW_THREAD);
  });

  // restart 02a-11 · 구현 스펙 「02a — 오른쪽 자리」 — 새 채팅 탭에도 요약 카드와 넓힌 카드가 선다. 오른쪽 자리 값은 작업공간마다 하나라 켜진
  // 새 채팅 탭이 그 값대로 카드를 그리고, 숨은 새 채팅 탭은 그리지 않는다.
  describe("오른쪽 자리", () => {
    const seat = workSeat(work.slug);
    const hasCard = (markup: string) => /<section[^>]*aria-label="요약"/.test(markup);

    it("오른쪽 자리가 요약 카드면 켜진 새 채팅 탭에 작은 카드가 서고, 숨은 새 채팅 탭에는 없다", () => {
      moveSeat(seat, "spec", { kind: "toggle", place: "summary" });
      const markup = drawNewChat("chat");
      expect(hasCard(bodyOf(markup, second))).toBe(true);
      expect(bodyOf(markup, second)).not.toContain("data-expanded");
      expect(hasCard(bodyOf(markup, first))).toBe(false);
    });

    // 02 §7 · Screen-Live — 카드가 열린 동안 대화 열과 입력창은 카드 왼쪽 끝 16 앞에서 멈추도록 비켜난다(`Beside` — 몫 `size-summary-room`).
    // 새 채팅 탭의 대화 열은 물음과 입력창이다 — 둘이 함께 비켜나야 물음이 입력창 가운데 위에 남는다.
    it("작은 카드가 서면 새 채팅 탭의 물음과 입력창이 카드를 비켜나고, 카드가 없으면 그대로다", () => {
      const room = "basis-(--size-summary-room)";
      expect(countOf(bodyOf(drawNewChat("chat"), second), room)).toBe(0);
      moveSeat(seat, "spec", { kind: "toggle", place: "summary" });
      const shown = bodyOf(drawNewChat("chat"), second);
      expect(countOf(shown, room)).toBe(2);
      // 비키는 몫은 열 오른쪽 빈 칸이다 — 하나는 물음 뒤, 하나는 입력창 뒤에 선다.
      const [question, field] = [shown.indexOf("무엇을 만들까요?"), shown.indexOf('aria-label="보낼 말"')];
      expect(shown.indexOf(room)).toBeGreaterThan(question);
      expect(shown.indexOf(room)).toBeLessThan(field);
      expect(shown.lastIndexOf(room)).toBeGreaterThan(field);
    });

    // 아직 채팅이 없어 카드는 작업공간의 것이다 — 소스의 Project는 그 작업공간의 읽는 범위다(채팅 탭은 그 채팅의 범위).
    it("새 채팅 탭의 카드 소스는 작업공간의 읽는 범위다", () => {
      const reading: ReadingScope = {
        service: null,
        project: null,
        projects: [{ slug: "web-app", name: "웹 앱", why: "all" }],
        worked: [],
        kind: "all",
        registered: 1,
      };
      moveSeat(seat, "spec", { kind: "toggle", place: "summary" });
      const shown = bodyOf(
        drawNewChat("chat", false, (client) => client.setQueryData(scopeKey({ work: work.slug }), reading)),
        second,
      );
      const card = shown.slice(shown.search(/<section[^>]*aria-label="요약"/));
      expect(card).toMatch(/data-project="web-app"[^]*읽기만/);
    });

    // 넓힌 카드의 문서에서 고른 글은 그 탭의 입력창에 인용으로 붙는다(S41) — 카드가 쓰는 열쇠가 그 탭의 글 열쇠(`newChatKey`)다. 고르는 손짓은
    // 정적 그림에 없어 카드에서 문서 보기까지의 배선은 리터럴로 못박고, 그 열쇠에 붙은 인용이 그 탭의 입력창에만 서는 것을 그림으로 잰다.
    it("넓힌 카드의 문서 인용이 그 탭의 입력창으로 간다 — 다른 새 채팅 탭에는 서지 않는다", () => {
      setQuote(newChatKey(second), { file: "overview.md", start: 1, end: 2, text: "고른 글" });
      const markup = drawNewChat("chat");
      expect(bodyOf(markup, second)).toMatch(/<span data-quote[^>]*>[^]*고른 글[^]*overview\.md/);
      expect(bodyOf(markup, first)).not.toContain("data-quote");
      const read = (file: string) => readFileSync(fileURLToPath(new URL(`../thread/${file}`, import.meta.url)), "utf8");
      expect(read("ThreadScreen.tsx")).toContain("<WorkSummaryCard\n            key={draftKey}\n            draftKey={draftKey}\n            slug={work}");
      expect(read("SummaryCard.tsx")).toContain("<ExpandedViewer\n            draftKey={draftKey}");
      expect(read("ExpandedViewer.tsx")).toContain("onQuote={(quote) => setQuote(draftKey, quote)}");
    });

    // 스토리 95 — 채팅이 아직 없어도 문서를 읽는다. 넓힌 카드는 카드가 서는 탭이 본문일 때만인데(`chat`), 새 채팅 탭도 그 탭이다.
    it("넓혀 둔 값이면 새 채팅 탭의 카드가 넓어져 대화가 왼쪽 480에 남는다", () => {
      moveSeat(seat, "spec", { kind: "expand", target: { kind: "doc", path: "overview.md" } });
      const shown = bodyOf(drawNewChat("chat"), second);
      expect(shown).toMatch(/<section[^>]*aria-label="요약"[^>]*data-expanded=""/);
      expect(shown).toContain("width:var(--size-thread-beside)");
      expect(shown).toContain("left:var(--size-thread-beside)");
      // 대화 자리가 이미 480이라 물음 · 입력창이 카드를 비키지 않는다(보드 Main `beside: summaryShown && !wide`).
      expect(shown).not.toContain("basis-(--size-summary-room)");
    });
  });

  it("새 채팅 탭이 묶음에 「새 채팅」으로 서고, 켜진 하나가 켜져 있다", () => {
    const row = tabRowOf(drawNewChat("chat"));
    expect(kindsOf(row)).toEqual([
      { kind: "new-chat", on: false },
      { kind: "new-chat", on: true },
      { kind: "new", on: false },
    ]);
    expect(countOf(row, 'aria-label="새 채팅 닫기"')).toBe(2);
  });

  it("본문 카드가 「새 채팅」이고 몸은 이 작업공간에 이어 보내는 입력창이다", () => {
    const markup = drawNewChat("chat");
    const main = markup.slice(markup.indexOf("<main"));
    expect(main).toMatch(/^<main[^>]*aria-label="새 채팅"/);
    const shown = bodyOf(markup, second);
    expect(shown).toMatch(/^<div[^>]*class="contents"/);
    expect(shown).toContain('aria-label="보낼 말"');
    // 작업공간은 탭이 선 묶음의 것이다 — 빈 칸의 말이 이 작업공간을 말한다. 잠긴 Work 칩은 없다(restart 02b-2 — 시안 Composer의
    // 트레이에 Work 칩이 없다).
    expect(shown).toContain(`${work.title}에서 무엇을 할까요?`);
    expect(shown).not.toContain("작업공간으로 가기");
    expect(pathBarOf(markup)).toBe("");
  });

  it("작업공간 A의 새 채팅 탭에 쓴 글은 B의 새 채팅 탭과 홈에 서지 않는다", () => {
    setDraft(newChatKey(first), "첫 탭에서 쓰던 말");
    setDraft(NEW_THREAD, "홈에서 쓰던 말");
    const markup = drawNewChat("chat");
    expect(bodyOf(markup, first)).toMatch(/<textarea[^>]*>첫 탭에서 쓰던 말<\/textarea>/);
    expect(bodyOf(markup, second)).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(markup).not.toContain("홈에서 쓰던 말");
  });

  // 숨은 새 채팅 탭은 내려가지 않는다 — 채팅 · 셸 · 파일 카드 어디서든 **같은 자리**(탭 줄 바로 뒤, 카드의 첫 몸)에 꽂혀 카드를 오가도
  // 그 몸이 새로 서지 않는다(카드는 하나 — `Card`). 자리가 갈리면 React가 그 몸을 내렸다 다시 세워 고른 Runtime이 사라진다. 한때 문서 카드도
  // 그 자리였다(restart 02a-13이 문서 탭을 걷었다).
  it("숨은 새 채팅 탭의 몸은 셸을 봐도 그 자리에 숨어 있다", () => {
    setDraft(newChatKey(first), "숨은 탭의 말");
    for (const tab of ["terminal", "chat"] as const) {
      const markup = drawNewChat(tab);
      const row = tabRowOf(markup);
      const afterRow = markup.slice(markup.indexOf(row) + row.length);
      expect(afterRow, tab).toMatch(new RegExp(`^<div[^>]*data-new-chat="${first}"`));
      expect(bodyOf(markup, first), tab).toMatch(/^<div[^>]*class="hidden"/);
      expect(bodyOf(markup, first), tab).toContain("숨은 탭의 말");
    }
    // 셸을 보는 중이면 둘 다 숨는다.
    expect(bodyOf(drawNewChat("terminal"), second)).toMatch(/^<div[^>]*class="hidden"/);
  });

  // **끌어다 놓기는 켜진 탭의 입력창만 듣는다**(restart 02a-16b · 구현 스펙 「새 채팅의 글」 — 「글과 첨부의 열쇠를 탭마다 나눈다」). 놓기는 창 전체의
  // 이벤트라(Tauri `onDragDropEvent`) 듣는 입력창 모두에 간다. 숨은 새 채팅 탭은 위처럼 내리지 않으므로, 그 입력창이 들으면 보이지 않는 탭에도
  // 첨부가 붙는다(L3 `new-chat-tabs`). 셸 · 파일 탭이 켜져 있으면 듣는 입력창이 없다 — 숨은 채팅 탭은 내려가 듣지 않는다. 듣는 것은 이펙트라
  // 정적 그림에 없어 화면 → 몸 → 입력창의 배선을 리터럴로 못박고, 손짓은 L3가 잰다.
  it("숨은 새 채팅 탭의 입력창은 끌어다 놓기를 듣지 않는다 — 켜진 새 채팅 탭만 듣는다", () => {
    const thread = (file: string) => readFileSync(fileURLToPath(new URL(`../thread/${file}`, import.meta.url)), "utf8");
    expect(source("WorksPage.tsx")).toMatch(/<WorkNewChat\n\s+work=\{panelWork\.slug\}\n\s+draftKey=\{newChatKey\(one\.id\)\}\n\s+shown=\{visibleNewChat\?\.id === one\.id\}/);
    expect(thread("ThreadScreen.tsx")).toMatch(/<NewChat\n\s+link=\{link\}[^]*?\n\s+drops=\{shown\}/);
    expect(thread("ThreadScreen.tsx")).toMatch(/<ThreadComposer\n\s+draftKey=\{draftKey\}[^]*?\n\s+drops=\{drops\}/);
    expect(thread("ThreadComposer.tsx")).toContain("useAttachmentDrop(drops && !busy && !carded, attach)");
  });

  it("다른 작업공간의 새 채팅 탭은 이 화면에 꽂히지 않는다", () => {
    const other = openNewChatTab(terminalStore.state, ownerOf("다른-작업"));
    const theirs = activeIdOf(other, ownerOf("다른-작업")) ?? -1;
    terminalStore.setState(() => other);
    expect(drawNewChat("chat")).not.toContain(`data-new-chat="${theirs}"`);
  });

  // 처음 여는 주소(탭도 채팅도 적지 않았다)의 `chat`은 기본 값이지 새 채팅 탭이 아니다 — 처음 여는 규칙이 주소를 고칠 때까지 새 채팅 탭을
  // 세우거나 보이지 않는다. 새 채팅 탭으로 치면 채팅이 있는 작업공간에도 새 채팅 탭이 하나 선다.
  it("처음 여는 주소의 한 틱에는 새 채팅 탭이 서지 않는다", () => {
    const markup = drawNewChat("chat", true);
    expect(markup.slice(markup.indexOf("<main"))).toMatch(/^<main[^>]*aria-label="채팅"/);
    expect(bodyOf(markup, second)).toMatch(/^<div[^>]*class="hidden"/);
    expect(kindsOf(tabRowOf(markup)).filter((cell) => cell.on)).toEqual([]);
    expect(source("WorksPage.tsx")).toContain("else if (newChatShown) showNewChatTab(tabOwner);");
  });

  // 배선은 렌더로 못 본다(핸들러 · 이펙트). 어느 새 채팅 탭인지는 묶음이 쥐므로 **켜는 것은 화면이 먼저 하고** 주소는 `tab=chat`만 고친다 —
  // 탭 줄 · ⌘2~9가 같다. 첫 말의 답이 오면 그 칸이 채팅 탭이 되고(켜짐은 그대로 — 꺼져 있었으면 주소도 그대로다) 그 열쇠의 글을 지운다.
  it("탭 줄 · ⌘2~9 · 첫 말의 답이 묶음과 주소에 이어진다", () => {
    const page = source("WorksPage.tsx");
    expect(page).toContain(`if (picked?.kind === "new-chat") {
          selectShell(id);
          onOpenNewChat();
          return;
        }`);
    expect(page).toContain(`selectShell(next);
      // 새 채팅 탭이면 그 탭을 켜고 본문이 새 채팅 탭이 된다(restart 02a-8) — 어느 새 채팅 탭인지는 묶음이 쥐어 켜는 것은 여기서 한다(셸과 같다).
      if (picked?.kind === "new-chat") onOpenNewChat();
      else onSelectTab("terminal");`);
    expect(page).toContain(`settleNewChat(one.id, started);
                  forgetNewChat(newChatKey(one.id));`);
    expect(page).toContain("onNewChat={startNewChat}");
  });
});

// 결정 47. 상한 8에서 ⌘T는 **아무 일도 안 일어난 것처럼** 보였다(스토리 33의 알려진 구멍) —
// 그 키는 xterm의 키 핸들러에서 오고 그것은 React 트리 밖이라 화면의 토스트를 부를 길이
// 없었다. 스토어가 거절을 알리고 이 화면이 그것을 받는다.
describe("WorksPage 상한에서 ⌘T가 말한다", () => {
  afterEach(() => {
    terminalStore.setState(() => NO_SHELLS);
  });

  it("상한에서 셸을 열려 하면 잠긴 `+`와 **같은 문장**이 온다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      state = openShell(state, topTerminal())!.state;
    }
    terminalStore.setState(() => state);

    const heard: string[] = [];
    const stop = onShellOpenRejected((notice) => heard.push(notice));
    // ⌘T가 부르는 그 함수다. 상한에서는 인스턴스를 만들기 전에 돌아오므로 xterm이 안 뜬다.
    openNewShell(topTerminal());
    stop();

    expect(heard).toEqual([shellCapNotice(terminalStore.state, topTerminal().owner)]);
    expect(heard[0]).toContain(`${MAX_SHELLS}개까지`);
  });

  // 「상한이 아니면 아무 말도 하지 않는다」는 여기 없다 — 이 seam에서 상한 아래로
  // `openNewShell`을 부르면 실제로 열려 xterm 인스턴스가 뜬다(DOM이 없다). 그래서 그 절반은
  // 판정을 순수 모듈로 내려 shell-registry.test.ts의 「열렸으면 아무 말도 하지 않는다」가
  // 실제로 돌며 지킨다. 여기 구독만 걸고 곧바로 비었음을 보는 검사를 두면 어떤 구현에도
  // 통과하는 이름뿐인 그물이 된다.

  // 한때 여기 「화면에 들어간 것만으로는 아무 말도 하지 않는다」가 있었다 — 상한에 닿은 채
  // 어떤 Work의 터미널 탭에 들어가면 `ensureShell`이 「이 화면엔 칸이 0개」라며 열려다
  // 거절당했고, 그때 토스트가 뜨면 탭을 오갈 때마다 아무도 안 누른 알림이 다시 떴다.
  //
  // **결정 23이 그 전제를 없앴다.** 상한이 화면마다가 되면서 `ensureShell`의 거절 경로가
  // **도달 불가**가 됐다: 그 함수는 칸이 0개일 때만 열고, 0은 언제나 상한 미만이다. 남의
  // 화면이 꽉 차도 이 화면은 자기 몫을 그대로 갖는다는 것을 `shell-registry.test.ts`의
  // 「한 화면을 꽉 채워도 다른 화면은 자기 몫을 갖는다」가 순수 층에서 든다 — 여기서
  // 다시 세우면 `ensureShell`이 실제로 열려 이 seam에 없는 xterm을 만든다.

  it("구독을 끊으면 더 듣지 않는다", () => {
    // 화면이 언마운트된 뒤에도 듣고 있으면 사라진 화면의 setState가 불린다.
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      state = openShell(state, topTerminal())!.state;
    }
    terminalStore.setState(() => state);

    const heard: string[] = [];
    onShellOpenRejected((notice) => heard.push(notice))();
    openNewShell(topTerminal());
    expect(heard).toEqual([]);
  });

  it("화면이 그 통로를 실제로 구독한다", () => {
    // 위 넷은 스토어 쪽 계약이다. 화면이 그것을 안 들으면 전부 초록인 채로 ⌘T가 다시
    // 조용해진다. 그리고 **토스트로** 말해야 한다 — 콘솔이나 대화 상자가 아니라.
    const worksPage = source("WorksPage.tsx");
    const effect = worksPage.match(/useEffect\(\(\) => onShellOpenRejected\([\s\S]*?\);/)?.[0] ?? "";
    expect(effect, "거절을 듣는 효과를 찾지 못했다").not.toBe("");
    expect(effect).toContain("showToast");
  });

  it("⌘T는 알리는 쪽으로 온다", () => {
    // `ensureShell`이 조용한 짝을 쓰게 되면서 **같은 모듈에 여는 함수가 둘**이 됐다. ⌘T가
    // 실수로 조용한 쪽으로 옮겨가면 상한에서 다시 아무 말이 없어지는데 — 스토리 33의 그
    // 구멍이 되돌아온다 — 그것을 잡는 것이 이 검사 하나다(실측: 이 검사를 넣기 전에는
    // 바꿔도 431건이 전부 초록이었다).
    //
    // ⌘T가 React 트리 밖(`attachCustomKeyEventHandler`)에 살아 렌더로는 못 본다. 그래서
    // 소스를 읽되 **못 찾으면 실패한다** — 못 찾은 것을 통과로 읽으면 이 검사가 지키는 것은
    // 배선이 아니라 자기 자신이다.
    //
    // **셸 안 ⌘T는 이제 요청만 보낸다**(UI개선 결정 19) — 여는 것은 그 요청을 받은 화면이다. 그래서
    // 사슬의 두 고리를 함께 본다: 핸들러가 요청을 보내고, 화면이 받은 요청을 알리는 쪽
    // (`openNewShell`)으로 연다. 작업공간 화면의 ⌘T는 셸이 아니라 새 채팅 탭을 열어(restart 02a-8 — 위 「⌘T를 window에서 듣고…」) 상한과
    // 무관하다 — 셸을 여는 `+` 메뉴의 셸 줄이 알리는 쪽으로 연다. 최상위 터미널의 ⌘T는 그대로 셸이다.
    const store = source("../terminal/terminal-store.ts");
    expect(store).toContain('if (route.hotkey === "new") requestNewShell(instance.origin.owner);');
    expect(source("WorksPage.tsx")).toContain("openNewShell(origin);");
  });
});

describe("셸 안 ⌘T의 요청은 그 셸의 화면에만 간다", () => {
  // UI개선 결정 19. 셸 안 ⌘T는 요청만 보내고 **그 셸의 소유자 화면**이 연다. 가려 받는 규칙이 화면마다
  // 있으면 규칙을 잊은 화면 하나가 남의 셸의 ⌘T에 제 셸을 연다 — 한 번 눌러 두 화면에 셸이
  // 선다. 그래서 가르는 자리는 스토어 하나이고, 이 검사가 그 자리를 값으로 잰다.
  it("구독한 소유자의 요청만 듣고, 끊으면 안 듣는다", () => {
    const mine = ownerOf("가");
    let heard = 0;
    const stop = onNewShellRequested(mine, () => heard++);
    requestNewShell(ownerOf("나"));
    requestNewShell(ownerOf());
    expect(heard, "남의 셸의 요청을 들었다").toBe(0);
    requestNewShell(mine);
    expect(heard).toBe(1);
    stop();
    requestNewShell(mine);
    expect(heard, "끊은 뒤에도 들었다").toBe(1);
    // 요청이 셸을 **스스로 열지 않는다** — 자리를 정하는 것은 받은 화면이다.
    expect(terminalStore.state).toBe(NO_SHELLS);
  });
});

// **묶음의 마지막 칸이 닫히면 새 채팅 탭이 선다**(restart 02a-8 — 한때 「묶음이 비면 spec」이었다). 판정은 `shellsEmptied`가 들고
// (shell-registry.test.ts), 그것을 실제로 딛는지는 렌더로 안 보인다 — 이펙트라서다. 본문을 따로 옮기지 않는다 — 세운 칸이 지금 탭이 되어
// 「묶음 → 주소」가 따라간다. 옛 갈래(분할째로 걷고 문서로 간다 — restart 02a-13이 분할을 걷었다)가 남으면 새 칸과 문서가 한 틱에 겹친다.
it("묶음의 마지막 칸이 닫히면 새 채팅 탭을 세우고, 본문은 묶음 → 주소가 옮긴다", () => {
  const page = source("WorksPage.tsx");
  expect(page).toContain("if (emptied && !left && tabOwner !== null) openNewChat(tabOwner);");
  expect(page).not.toContain('changeSplit(null, "spec");');
});

// **떠난 작업공간의 묶음은 다시 채우지 않는다**(restart 02a-15c · 구현 스펙 「작업공간이 바뀌는 순간」). UI 아카이브 · 삭제의 회수(`closeShellsOf`)는
// 화면이 목록에서 그 작업공간을 잃기 전에 묶음을 통째로 걷는다. 그것을 「마지막 칸이 닫혔다」로 읽어 새 채팅 탭을 세우면 「묶음 → 주소」가 켜진
// 채팅 탭(`thread`)을 주소에서 걷어, 목록이 그 작업공간을 잃는 순간 다른 작업공간으로 넘어갔다(L3 `thread-archived`) — 그 채팅의
// `/threads/:id`로 가야 한다. 화면은 회수의 알림(`onWorkReclaimed` — terminal-store.test.ts)으로 안다. 이펙트라 렌더로 안 보여 배선을 읽는다.
it("회수가 걷은 묶음은 마지막 칸이 닫힌 것으로 세지 않는다 — 그 작업공간이 떠났다", () => {
  const page = source("WorksPage.tsx");
  expect(page).toContain("onWorkReclaimed(");
  expect(page).toContain("const left = tabOwner !== null && reclaimed.current === tabOwner;");
});

// 고른 항목이 하나도 없을 때의 본문. 목록을 비우고 `selectedSlug`를 `null`로 두면 그 화면이
// 선다 — 프로젝트 목록은 캐시에 심어야 「아직 안 왔다」(`isPending`)와 「하나도 없다」가
// 갈린다.
function renderEmpty(projects: ProjectView[] = []): string {
  const client = new QueryClient();
  client.setQueryData(worksQuery().queryKey, []);
  client.setQueryData(projectsQuery().queryKey, projects);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WorksPage
          sidebarOpen
          selectedSlug={null}
          currentFile={null}
          onOpenDoc={() => {}}
          tab="chat"
          onSelectTab={() => {}}
          code={null}
          onOpenCode={() => {}}
          thread={null}
          onOpenChat={() => {}}
          onOpenNewChat={() => {}}
          onFollowBundle={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const PROJECT: ProjectView = {
  slug: "atelier",
  name: "atelier",
  path: "~/MyProjects/atelier",
  baseBranch: "main",
  createdAt: "2026-08-01",
  description: "",
  git: null,
  missing: false,
};

// 빈 화면의 말(US 22). 낱말의 계약은 `work-sections.test.ts`가 글자까지 재고,
// 여기서 보는 것은 **화면이 그 표를 실제로 부르는가**다.
describe("아무것도 안 골랐을 때의 본문", () => {
  beforeEach(() => {
    // 폭 훅이 여기서 읽힌다 — 이 화면은 고른 것이 없어도 그 훅을 먼저 부른다.
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });

  it("머리는 그대로 `Works`다", () => {
    const html = renderEmpty();
    expect(html).toContain(">작업공간<");
  });

  it("레일도 패널 토글도 없다 — 고른 작업이 없으면 열 패널이 없다", () => {
    // 레일은 작업을 고른 작업 화면에만 선다(판 04 티켓 04). 여기 서면 눌러도 아무 일이 없는 버튼이 된다(결정 11·21).
    const html = renderEmpty([PROJECT]);
    expect(html).not.toContain('aria-label="레일"');
    expect(html).not.toMatch(/작업공간 패널 (?:접기|펼치기)/);
    expect(html).not.toContain("<aside");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("문구 셋이 그대로 선다", () => {
    const html = renderEmpty([PROJECT]);
    expect(html).toContain("아직 작업공간이 없어요");
    expect(html).toContain("작업공간은 Claude Code에서 시작돼요.");
    expect(html).toContain("새 작업공간");
  });

  // 반대쪽 증거 — 프로젝트가 0개면 첫 실행의 안내가 선다. 맡길 곳은 **터미널의 에이전트**다(설정 · spec 레이아웃과 같은 말) — 한때 그냥
  // 「에이전트」라 대화의 Runtime과 헷갈렸다(restart 코드 리뷰).
  it("프로젝트가 0개면 등록으로 이끌고, 맡길 곳은 터미널의 에이전트다", () => {
    const html = renderEmpty([]);
    expect(html).toContain("먼저 프로젝트를 등록해요");
    expect(html).toContain("Projects에서 폴더를 고르거나, 터미널의 에이전트에게 맡겨도 돼요.");
    expect(html).toContain("폴더 등록해줘");
  });
});

// **프로젝트를 고르는 `+`**(US 26). 갈리는 값(`projects`)이 워크트리에서 나온다.
describe("프로젝트를 고르는 `+`", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // `+`의 것만 본다 — `aria-haspopup`을 마크업 전체에서 세면 나중에 다른 팝오버가
  // 하나 생기는 날 이 검사가 조용히 무의미해진다.
  const asks = (markup: string) => /data-tab="new"[^>]*aria-haspopup="menu"/.test(markup);
  const twoTrees: Partial<WorkView> = {
    projects: ["atelier", "notes"],
    worktrees: [
      { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false },
      { project: "notes", path: "~/.atelier/works/some-work/trees/notes", exists: true, dirty: false },
    ],
  };

  it("워크트리가 둘이면 어디에 열지 물어본다", () => {
    expect(asks(render(twoTrees))).toBe(true);
  });
});

// 확인 대화의 문장은 `askDanger` 프로미스 뒤에 있어 이 저장소의 정적 마크업 seam에 아예
// 안 걸린다 — 낱말의 계약은 `work-menu-copy.test.ts`가 글자까지 재고, 여기서 보는 것은
// **화면이 그 표를 부르는가**뿐이다(`work-sections`·`archive-copy`와 같은 나눔).
describe("work 메뉴의 확인 대화", () => {
  it("문장을 손으로 안 적고 표에서 꺼낸다", () => {
    const menuActions = source("work-menu-actions.ts");
    expect(menuActions).toContain("ARCHIVE_CONFIRM_BODY");
    expect(menuActions).toContain("REMOVE_CONFIRM_BODY");
    // **리터럴이 남아 있으면 안 된다.** 표를 부르면서 옛 문장을 그대로 둔 판은 위 두 줄로는
    // 안 걸리고, 그 순간 두 벌이 따로 늙기 시작한다.
    expect(menuActions).not.toContain("워크트리 폴더가 정리돼요");
    expect(menuActions).not.toContain("워크트리 폴더와 스펙 문서가 모두 지워져요");
  });
});

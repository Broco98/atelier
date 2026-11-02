import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CODEX_DEFAULT_MODE, EFFORTS, type ChoiceOption } from "./chips";
import ThreadComposer, { MentionPaint, type ThreadComposerProps } from "./ThreadComposer";
import type { Attachment } from "./types";
import { setAttachments } from "./attachments";
import { mentionKey, type MentionPlace } from "./mentions";
import { addMention, setDraft } from "./thread-store";

// 입력창(02 티켓 10 · 03 구현 스펙 §5 · §6 · 캔버스 v52 F4-KitComposer · v35 Diff-Chat · Screen-Live) — 정적 마크업으로 사람이 보는 것을 잰다:
// 트레이가 어디에 서는지(첫 화면은 상자 아래, Thread 화면은 상자 위)와 그 Work 칩(첫 말 전은 고르는 칩, 뒤는 잠긴 칩), 입력창 안의 것(`+` ·
// 물어보는 정도 · 모델 칩), 보내기 원 하나가 네 상태(빈 · 글 · 보내는 중 · 도는 중)에서 무엇을 할 수 있다고 말하는지
// (접근성 이름 · 꺼짐).

const none = () => {};
const quiet = async () => {};

let drafts = 0;
/**
 * 입력창의 정적 마크업 — `draft`는 입력칸에 이미 쓴 글이다(커서는 글 끝). `places`는 「@」 언급의 찾기 명령이 이미 준 답이고(`mentions`의 자리),
 * `mentioned`는 메뉴로 넣어 둔 언급이다.
 */
const composer = (
  over: Partial<ThreadComposerProps> = {},
  draft = "",
  attached: Attachment[] = [],
  { places, mentioned = [] }: { places?: MentionPlace[]; mentioned?: string[] } = {},
) => {
  const draftKey = `composer-test-${(drafts += 1)}`;
  setDraft(draftKey, draft);
  setAttachments(draftKey, attached);
  mentioned.forEach((mention) => addMention(draftKey, mention));
  const client = new QueryClient();
  if (places && over.mentions) client.setQueryData(mentionKey(over.mentions), places);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ThreadComposer
        draftKey={draftKey}
        mode={{ kind: "ask", level: "always", onLevel: none }}
        model={claudeModel()}
        commands={[]}
        running={false}
        onSend={quiet}
        onNewThread={none}
        {...over}
      />
    </QueryClientProvider>,
  );
};

/** Claude Code 채팅의 모델 칩 — 목록을 주면 메뉴가 붙는다. */
const claudeModel = (models: readonly ChoiceOption[] | null = null, model: string | null = null): ThreadComposerProps["model"] => ({
  runtime: "claude-code",
  models,
  model,
  efforts: EFFORTS,
  effort: null,
  onModel: none,
  onEffort: none,
});

/** 트레이의 마크업 — 입력창(`form`)에 붙어 서는 회색 띠다. */
const trayOf = (markup: string) => /<div data-slot="composer-tray"[^>]*>.*?<\/div>/s.exec(markup)?.[0] ?? null;
const formOf = (markup: string) => /<form[^>]*>.*<\/form>/s.exec(markup)?.[0] ?? "";

// Composer 「새 채팅 · 범위 트레이」 — 트레이는 첫 말 전의 새 채팅에만 상자 아래에 선다. 첫 말 뒤 입력창(Thread 보드)에는 트레이가 없다 — 부르는
// 쪽이 주지 않는다(`ThreadScreen.test.tsx`). 앞에 서는 칩은 작업공간 만들기로 연 「새 작업공간」 하나다.
describe("트레이", () => {
  it("트레이를 주지 않으면 서지 않는다", () => {
    const markup = composer();
    expect(markup).not.toContain("새 작업공간");
    expect(trayOf(markup)).toBeNull();
  });

  it("상자 아래에 서고 「새 작업공간」 칩이 든다 — 입력창 안에는 없고 ×로 뺀다", () => {
    const markup = composer({ tray: { work: { kind: "new-work", onDrop: none } } });
    expect(trayOf(markup)).toContain("새 작업공간");
    expect(trayOf(markup)).toContain('aria-label="새 작업공간 빼기"');
    expect(formOf(markup)).not.toContain("새 작업공간");
    expect(markup.indexOf('data-slot="composer-tray"')).toBeGreaterThan(markup.indexOf("</form>"));
  });

  it("칩이 없는 트레이도 선다 — 씨앗 없는 새 채팅의 범위 칩 자리다", () => {
    expect(trayOf(composer({ tray: {} }))).not.toBeNull();
  });

  it("입력창 자리에 카드가 서면 트레이도 걷힌다", () => {
    expect(trayOf(composer({ card: <section aria-label="승인" />, tray: { work: { kind: "new-work", onDrop: none } } }))).toBeNull();
  });
});

describe("입력창 안(03 §6)", () => {
  it("`+` · 물어보는 정도 · 모델 칩만 선다 — `@` 단추(Agent 부르기)가 없다", () => {
    const names = buttonsOf(composer({ model: claudeModel([{ value: "default", name: "Default", description: null }], "default") })).map(
      (one) => one.name,
    );
    expect(names).toContain("파일 첨부");
    expect(names).toContain("물어보는 정도 매번 묻기");
    expect(names.some((name) => name.startsWith("모델과 생각 깊이"))).toBe(true);
    expect(names).not.toContain("Agent 부르기");
  });

  // 「@」는 파일 언급이다(restart 02b-3) — Agent를 부르는 메뉴(01a-2가 지웠다)는 돌아오지 않는다. 찾을 자리가 없는 입력창에는 「@」 메뉴도 없다.
  it("찾을 자리를 주지 않은 입력창은 `@`를 쳐도 메뉴가 서지 않는다", () => {
    expect(composer({}, "/")).toContain('role="listbox"');
    for (const draft of ["@", "이거 @", "@rev"]) {
      expect(composer({}, draft), draft).not.toContain('role="listbox"');
    }
  });
});

// Composer 「「@」 언급」 — 입력창 위 8에 같은 폭으로 「파일」 메뉴가 서고, 찾은 파일이 글리프와 경로로 한 줄씩 선다. 포커스는 입력칸에 남는다(켜진
// 줄은 `aria-activedescendant`). 메뉴는 쓴 글(커서 앞 낱말)과 찾기 명령의 답만 보고 서므로 정적 마크업으로 잰다 — 키 입력은 L3다.
describe("「@」 언급 메뉴", () => {
  const WHERE = { work: "refund" };
  const PLACES: MentionPlace[] = [
    { name: null, root: "", files: ["README.md", "src-tauri/src/watcher.rs", "src/features/works/watcher.test.ts"] },
    { name: "api-server", root: "/repos/api-server/", files: ["src/lib.rs"] },
  ];
  const menuOf = (markup: string) => /<div[^>]*role="listbox"[^>]*aria-label="파일"[^>]*>.*?<\/div><\/form>/s.exec(markup)?.[0] ?? null;
  const rowsOf = (markup: string) =>
    [...(menuOf(markup) ?? "").matchAll(/<div[^>]*role="option"[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/div>/gs)].map(({ 1: on, 2: row }) => ({
      on: on === "true",
      text: row.replace(/<[^>]*>/g, ""),
    }));

  it("`@`로 시작한 낱말이면 「파일」 메뉴가 서고 찾은 파일이 선다 — 첫 줄이 켜져 있다", () => {
    const markup = composer({ mentions: WHERE }, "@wat", [], { places: PLACES });
    expect(menuOf(markup)).toContain(">파일<");
    expect(rowsOf(markup)).toEqual([
      { on: true, text: "src-tauri/src/watcher.rs" },
      { on: false, text: "src/features/works/watcher.test.ts" },
    ]);
    expect(markup).toMatch(/<textarea[^>]*aria-activedescendant="[^"]+-0"/);
  });

  it("말 가운데의 `@`도 찾고, 작업 폴더 밖의 파일은 줄 끝에 자리 이름이 선다", () => {
    expect(rowsOf(composer({ mentions: WHERE }, "이것도 봐 줘 @lib", [], { places: PLACES }))).toEqual([{ on: true, text: "src/lib.rsapi-server" }]);
  });

  it("찾은 파일이 없거나 · 아직 답이 없거나 · 낱말을 띄어 쓴 뒤 · 메일 주소면 서지 않는다", () => {
    expect(menuOf(composer({ mentions: WHERE }, "@없는파일", [], { places: PLACES }))).toBeNull();
    expect(menuOf(composer({ mentions: WHERE }, "@wat"))).toBeNull();
    expect(menuOf(composer({ mentions: WHERE }, "@wat ", [], { places: PLACES }))).toBeNull();
    expect(menuOf(composer({ mentions: WHERE }, "me@wat", [], { places: PLACES }))).toBeNull();
  });
});

// Composer 「첨부 · 언급」 `.ra-mention` — 메뉴로 넣은 언급은 파란 면에 링크 색이다. 입력칸은 글자를 그리지 않고(caret만) 그 밑의 칠 층이 같은 자리에
// 글을 그린다. 언급이 없으면 칠 층이 없고 입력칸이 글을 그린다.
describe("언급 칠", () => {
  const paintOf = (markup: string) => /<div[^>]*data-slot="mention-paint"[^>]*>(.*?)<\/div>/s.exec(markup)?.[1] ?? null;

  it("넣은 언급이 칠을 입고 나머지 글은 그대로 선다", () => {
    const markup = composer({}, "@src/watcher.rs 이 파일에서 재시도 간격도 같이 봐 줘", [], { mentioned: ["@src/watcher.rs"] });
    const paint = paintOf(markup);
    expect(paint).toMatch(/<span[^>]*data-mention=""[^>]*>@src\/watcher\.rs<\/span> 이 파일에서 재시도 간격도 같이 봐 줘/);
    expect(markup).toMatch(/<textarea[^>]*class="[^"]*text-transparent/);
  });

  // 한글 조합 중(입력칸이 글자를 그린다 — `inkOf`)에는 칠 층이 면만 두고 글자는 투명이다. 면 · 글자 자리는 그대로라 조합이 끝나 글자를 되받아도
  // 흔들리지 않는다. 조합 이벤트는 정적 그림에 없어 층만 따로 그린다 — 실제 조합은 WebKit에서 쟀다(`시안-비교/02b-3/차이.md`).
  it("입력칸이 글자를 그리는 동안(한글 조합 중) 칠 층은 면만 두고 글자는 투명이다", () => {
    const field = { current: null };
    const parts = [
      { text: "@src/watcher.rs", mention: true },
      { text: " 이 파일", mention: false },
    ];
    const quiet = renderToStaticMarkup(<MentionPaint parts={parts} field={field} ink="field" />);
    expect(quiet).toMatch(/<div[^>]*data-slot="mention-paint"[^>]*class="[^"]*text-transparent/);
    expect(quiet).toMatch(/<span[^>]*data-mention=""[^>]*class="[^"]*bg-accent-soft[^"]*text-transparent/);
    const inked = renderToStaticMarkup(<MentionPaint parts={parts} field={field} ink="paint" />);
    expect(inked).toMatch(/<span[^>]*data-mention=""[^>]*class="[^"]*bg-accent-soft[^"]*text-link/);
    expect(inked).not.toContain("text-transparent");
  });

  it("찾는 중인 `@wat`은 칠하지 않고 칠 층도 없다", () => {
    const markup = composer({}, "@wat", [], { mentioned: ["@src/watcher.rs"] });
    expect(paintOf(markup)).toBeNull();
    expect(markup).not.toMatch(/<textarea[^>]*class="[^"]*text-transparent/);
  });
});

/** 입력창의 둥근 단추들 — 접근성 이름과 꺼졌는지. 보내기 원은 `+` · 칩 뒤 맨 끝이다. */
const buttonsOf = (markup: string) =>
  [...markup.matchAll(/<button\b([^>]*)>/g)].flatMap(({ 1: attrs }) => {
    const name = /aria-label="([^"]+)"/.exec(attrs)?.[1];
    return name === undefined ? [] : [{ name, disabled: /\sdisabled=""/.test(attrs) }];
  });
const sendSpot = (markup: string) => buttonsOf(markup).filter((one) => ["보내기", "보내는 중", "멈추기"].includes(one.name));

// Composer 「Runtime 고르기」 · 스토리 30 · 31 — 새 채팅에서만 열리고, 턴이 시작되면 잠긴다. 자리는 아래 줄 오른쪽, 모델 칩 앞이다.
describe("Runtime 칩", () => {
  /** Runtime 칩의 마크업 — 고르는 칩이면 메뉴 단추, 잠긴 칩이면 글자만 선 칸이다. */
  const runtimeChip = (markup: string) => /<(?:button|span)\b[^>]*aria-label="Runtime[^"]*"[^>]*>/.exec(markup)?.[0] ?? null;

  it("새 채팅에서는 고른 Runtime 이름에 메뉴가 붙은 칩이다", () => {
    const chip = runtimeChip(composer({ runtime: { value: "claude-code", onPick: none } }));
    expect(chip).toContain('aria-label="Runtime: Claude Code"');
    expect(chip).toContain("aria-haspopup");
  });

  it("턴이 시작된 채팅에서는 이름만 서고 메뉴가 없다", () => {
    const markup = composer({ runtime: { value: "codex" } });
    const chip = runtimeChip(markup);
    expect(chip).toContain('aria-label="Runtime Codex"');
    expect(chip).not.toContain("aria-haspopup");
    expect(markup).toContain(">Codex<");
  });

  it("첫 말을 보내는 중이면 고를 수 있던 칩도 잠긴다 — Runtime이 이미 그 말과 함께 떠났다", () => {
    const chip = runtimeChip(composer({ busy: true, runtime: { value: "codex", onPick: none } }));
    expect(chip).toContain('aria-label="Runtime Codex"');
    expect(chip).not.toContain("aria-haspopup");
  });

  it("모델 칩 앞에 선다", () => {
    const markup = composer({
      runtime: { value: "claude-code", onPick: none },
      model: claudeModel([{ value: "default", name: "Default", description: null }], "default"),
    });
    const names = buttonsOf(markup).map((one) => one.name);
    const model = names.findIndex((name) => name.startsWith("모델과 생각 깊이"));
    expect(names.indexOf("Runtime: Claude Code")).toBe(model - 1);
  });
});

// restart 01c-5 · Composer 「모드 · Codex」 · 「능력이 적을 때」 · 「첫 말 전 Codex」 — Codex 채팅의 모드 칩은 Codex가 보낸 모드의 이름이고, 메뉴는
// Session이 열려 Codex의 목록이 왔을 때만 열린다. Runtime이 선언하지 않은 칩은 서지 않는다.
describe("Codex 채팅의 칩", () => {
  const MODES: ChoiceOption[] = [
    { value: "read-only", name: "Read-only", description: "Requires approval to edit files and access the internet." },
    { value: "workspace-write", name: "Workspace access", description: "Edit workspace files." },
  ];
  /** Codex 모드 칩의 여는 태그 — 메뉴가 붙으면 단추, 잠겼으면 글자만 선 칸이다. */
  const modeChip = (markup: string) => /<(?:button|span)\b[^>]*aria-label="Codex 모드[^"]*"[^>]*>/.exec(markup)?.[0] ?? null;
  const codexModel = (efforts: readonly ChoiceOption[] | null): ThreadComposerProps["model"] => ({
    runtime: "codex",
    models: [{ value: "gpt-6.1-sol", name: "6.1 Sol", description: null }],
    model: "gpt-6.1-sol",
    efforts,
    effort: "xhigh",
    onModel: none,
    onEffort: none,
  });

  it("Session이 연 채팅의 모드 칩은 채팅의 모드 이름이고 메뉴가 붙는다 — 물어보는 정도 칩은 서지 않는다", () => {
    const markup = composer({ mode: { kind: "codex", value: "read-only", name: "Read-only", options: MODES, onPick: none } });
    expect(modeChip(markup)).toContain('aria-label="Codex 모드 Read-only"');
    expect(modeChip(markup)).toContain("aria-haspopup");
    expect(markup).not.toContain("물어보는 정도");
  });

  it("첫 말 전에는 Workspace access로만 서고 메뉴가 없으며, 모델 칩이 서지 않는다", () => {
    const { value, name } = CODEX_DEFAULT_MODE;
    const markup = composer({ mode: { kind: "codex", value, name, options: null, onPick: none }, model: null });
    expect(modeChip(markup)).toContain('aria-label="Codex 모드 Workspace access"');
    expect(modeChip(markup)).not.toContain("aria-haspopup");
    expect(markup).toContain(">Workspace access<");
    expect(markup).not.toContain('aria-label="모델');
  });

  it("모델 칩은 Codex가 보낸 이름이고, 생각 깊이도 Codex가 보낸 이름이다", () => {
    const efforts = [{ value: "xhigh", name: "Xhigh", description: null }];
    const markup = composer({ model: codexModel(efforts) });
    expect(markup).toContain('aria-label="모델과 생각 깊이 6.1 Sol · Xhigh"');
  });

  it("Runtime이 선언하지 않은 칩은 서지 않는다 — 모드가 없으면 모드 칩이, 생각 깊이가 없으면 그 조각이 없다", () => {
    const markup = composer({ mode: null, model: codexModel(null) });
    expect(modeChip(markup)).toBeNull();
    expect(markup).not.toContain("물어보는 정도");
    expect(markup).toContain('aria-label="모델과 생각 깊이 6.1 Sol"');
  });

  it("「/」 메뉴에 Codex가 보낸 `/plan`이 그 글로 서고, 앱의 `/plan` · `/policy`는 서지 않는다", () => {
    const menu = composer(
      {
        mode: { kind: "codex", value: "read-only", name: "Read-only", options: MODES, onPick: none },
        commands: [{ name: "plan", description: "Turn plan mode on.", aliases: [] }],
      },
      "/",
    );
    expect(menu).toContain("Turn plan mode on.");
    expect(menu).not.toContain("계획만 세우고 멈추기");
    expect(menu).not.toContain("언제 물어볼지");
    expect(menu).toContain("/new");
  });
});

describe("「/」 명령 메뉴", () => {
  // Composer 「「/」 명령」 — 메뉴 머리는 그 채팅 Runtime의 명령이다.
  it("메뉴 머리가 그 채팅 Runtime의 이름으로 선다", () => {
    expect(composer({ runtime: { value: "claude-code" } }, "/")).toContain(">Claude Code 명령<");
    expect(composer({ runtime: { value: "codex" }, model: null }, "/")).toContain(">Codex 명령<");
  });

  it("첫 말 전에도 `/work`가 없다 — 어디서 일할지는 씨앗이 정한다", () => {
    const menu = composer({ tray: { work: { kind: "new-work", onDrop: none } } }, "/");
    expect(menu).toContain("/new");
    expect(menu).not.toContain("/work");
    expect(composer({ tray: {} }, "/work")).not.toContain('role="listbox"');
  });
});

describe("보내기 원 하나의 네 상태", () => {
  it("비었으면 꺼진 「보내기」다", () => {
    expect(sendSpot(composer())).toEqual([{ name: "보내기", disabled: true }]);
  });

  it("글이 있으면 켜진 「보내기」다", () => {
    expect(sendSpot(composer({}, "환불 API 고쳐 줘"))).toEqual([{ name: "보내기", disabled: false }]);
  });

  it("보내는 중(새 Thread의 첫 말 — Session이 열리기까지)이면 꺼진 「보내는 중」이다", () => {
    expect(sendSpot(composer({ busy: true }, "환불 API 고쳐 줘"))).toEqual([{ name: "보내는 중", disabled: true }]);
  });

  it("턴이 도는 동안 비었으면 「멈추기」다", () => {
    expect(sendSpot(composer({ running: true, onStop: quiet }))).toEqual([{ name: "멈추기", disabled: false }]);
  });

  it("턴이 도는 동안 글을 쓰면 원은 「보내기」다 — 멈추기는 Esc가 맡고, 원은 하나다", () => {
    expect(sendSpot(composer({ running: true, onStop: quiet }, "이것도 봐 줘"))).toEqual([{ name: "보내기", disabled: false }]);
  });
});

// Composer 「비어 있음」 · 「일하는 중 · 비어 있음」 · 「세션 여는 중」 · Thread 보드의 자리표시 — 빈 칸의 말이 지금 할 수 있는 일을 말한다. 새 채팅은
// 시작할 곳의 말을 따로 준다(`startPlaceholder`).
describe("빈 칸의 말", () => {
  const placeholderOf = (markup: string) => /<textarea[^>]*placeholder="([^"]*)"/.exec(markup)?.[1] ?? null;

  it("턴이 끝난 채팅은 후속 작업을 묻는다 — 우리가 멈춘 뒤도 같다", () => {
    expect(placeholderOf(composer())).toBe("후속 작업을 입력하세요");
  });

  it("턴이 도는 동안은 더 말해 두면 차례로 보낸다고 말한다", () => {
    expect(placeholderOf(composer({ running: true, onStop: quiet }))).toBe("일하는 동안 더 말해 두면 차례로 보내요");
  });

  it("새 채팅은 받은 말이고, 첫 말을 보내는 동안은 시작하는 중이다", () => {
    expect(placeholderOf(composer({ placeholder: "무엇이든 요청하세요" }))).toBe("무엇이든 요청하세요");
    expect(placeholderOf(composer({ placeholder: "무엇이든 요청하세요", busy: true }))).toBe("채팅을 시작하는 중…");
  });
});

// Composer 「세션 여는 중」 · Thread 보드 `chipSkeleton` — 첫 말을 보내 Session이 열리기를 기다리는 동안 모델 칩은 Runtime이 목록을 알려 줄 때까지
// 스켈레톤이다(Codex처럼 모델 칩이 없던 Runtime도 같다). 물어보는 정도 칩 · 잠긴 Runtime 칩은 그대로 선다.
describe("세션 여는 중", () => {
  it("모델 칩 자리에 스켈레톤이 서고 다른 칩은 그대로다", () => {
    const markup = composer({ busy: true, runtime: { value: "claude-code", onPick: none } }, "환불 API 고쳐 줘");
    expect(markup).toContain('aria-label="모델을 읽는 중"');
    expect(markup).not.toMatch(/aria-label="모델(과 생각 깊이)? /);
    expect(markup).toContain('aria-label="물어보는 정도 매번 묻기"');
    expect(markup).toContain('aria-label="Runtime Claude Code"');
  });

  it("모델 칩이 없던 Runtime도 받을 때까지 스켈레톤이다", () => {
    expect(composer({ busy: true, model: null }, "첫 말")).toContain('aria-label="모델을 읽는 중"');
  });

  it("보내기 전에는 스켈레톤이 없다", () => {
    expect(composer()).not.toContain("모델을 읽는 중");
  });
});

// Composer 「첨부 · 언급」 — 붙인 칩은 글리프 · 이름 · ×다. 크기는 칩에 서지 않고 가리키면 경로와 함께 보인다.
describe("입력창의 첨부 칩", () => {
  const ATTACHED: Attachment[] = [
    { path: "/w/spec/overview.md", size: 2048, folder: false },
    { path: "/w/배너 시안.png", size: 48000, folder: false },
  ];
  const chipsOf = (markup: string) => /<ul aria-label="첨부"[^>]*>.*?<\/ul>/s.exec(markup)?.[0] ?? "";
  const textOf = (markup: string) => markup.replace(/<[^>]*>/g, "");

  it("이름과 빼기 단추로 서고 크기는 글로 서지 않는다", () => {
    const chips = chipsOf(composer({}, "", ATTACHED));
    expect(textOf(chips)).toBe("overview.md배너 시안.png");
    expect(chips).toContain('aria-label="overview.md 빼기"');
    expect(chips).toContain('title="/w/spec/overview.md · 2.0KB"');
  });
});

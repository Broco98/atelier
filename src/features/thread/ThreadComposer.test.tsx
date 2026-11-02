import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CODEX_DEFAULT_MODE, EFFORTS, type ChoiceOption } from "./chips";
import ThreadComposer, { type ThreadComposerProps } from "./ThreadComposer";
import { setDraft } from "./thread-store";
import { lockedWork } from "./work-chip";

// 입력창(02 티켓 10 · 03 구현 스펙 §5 · §6 · 캔버스 v52 F4-KitComposer · v35 Diff-Chat · Screen-Live) — 정적 마크업으로 사람이 보는 것을 잰다:
// 트레이가 어디에 서는지(첫 화면은 상자 아래, Thread 화면은 상자 위)와 그 Work 칩(첫 말 전은 고르는 칩, 뒤는 잠긴 칩), 입력창 안의 것(`+` ·
// 물어보는 정도 · 모델 칩), 보내기 원 하나가 네 상태(빈 · 글 · 보내는 중 · 도는 중)에서 무엇을 할 수 있다고 말하는지
// (접근성 이름 · 꺼짐).

const none = () => {};
const quiet = async () => {};

let drafts = 0;
/** 입력창의 정적 마크업 — `draft`는 입력칸에 이미 쓴 글이다. */
const composer = (over: Partial<ThreadComposerProps> = {}, draft = "") => {
  const draftKey = `composer-test-${(drafts += 1)}`;
  setDraft(draftKey, draft);
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
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
/** 트레이가 입력창 상자의 어느 쪽에 섰나 — 마크업의 차례로 읽는다. */
const sideOf = (markup: string) => (markup.indexOf('data-slot="composer-tray"') < markup.indexOf("<form") ? "above" : "below");
const formOf = (markup: string) => /<form[^>]*>.*<\/form>/s.exec(markup)?.[0] ?? "";

describe("트레이의 자리", () => {
  it("트레이를 주지 않으면 서지 않는다", () => {
    const markup = composer();
    expect(markup).not.toContain("새 작업공간");
    expect(trayOf(markup)).toBeNull();
  });

  it("첫 화면(입력창이 가운데)에서는 상자 아래에 서고, 「새 작업공간」 칩이 든다 — 입력창 안에는 없다", () => {
    const markup = composer({ tray: { at: "below", work: { kind: "new-work", onDrop: none } } });
    expect(trayOf(markup)).toContain("새 작업공간");
    expect(trayOf(markup)).toContain('aria-label="새 작업공간 빼기"');
    expect(formOf(markup)).not.toContain("새 작업공간");
    expect(sideOf(markup)).toBe("below");
  });

  it("칩이 없는 트레이도 선다 — 씨앗 없는 새 채팅의 범위 칩 자리다", () => {
    expect(trayOf(composer({ tray: { at: "below" } }))).not.toBeNull();
  });

  it("Thread 화면(입력창이 아래에 붙음)에서는 상자 위에 선다 — 첫 말 뒤의 칩은 잠겨 메뉴가 없다", () => {
    const markup = composer({
      tray: { at: "above", work: { kind: "locked", locked: lockedWork(null, null, false), onOpen: none } },
    });
    expect(sideOf(markup)).toBe("above");
    expect(trayOf(markup)).toContain("작업공간 없이 대화");
    expect(trayOf(markup)).not.toContain("aria-haspopup");
  });

  it("입력창 자리에 카드가 서면 트레이도 걷힌다", () => {
    const markup = composer({
      card: <section aria-label="승인" />,
      tray: { at: "above", work: { kind: "locked", locked: lockedWork(null, null, false), onOpen: none } },
    });
    expect(trayOf(markup)).toBeNull();
  });
});

describe("잠긴 Work 칩(03 §5 · S3)", () => {
  it("Work에 이은 Thread는 그 Work 이름이고, 누르면 그 Work로 가는 단추다", () => {
    const tray = trayOf(
      composer({ tray: { at: "above", work: { kind: "locked", locked: lockedWork("refund-api", "환불 API 버그 수정", false), onOpen: none } } }),
    );
    expect(tray).toContain('aria-label="작업공간으로 가기: 환불 API 버그 수정"');
    expect(tray).toContain("환불 API 버그 수정");
  });

  it("Work 없는 Thread · 아직 Work가 없는 「새 작업공간」 Thread는 보이기만 한다 — 누를 것이 없다", () => {
    for (const [locked, text] of [
      [lockedWork(null, null, false), "작업공간 없이 대화"],
      [lockedWork(null, null, true), "새 작업공간"],
    ] as const) {
      const tray = trayOf(composer({ tray: { at: "above", work: { kind: "locked", locked, onOpen: none } } })) ?? "";
      expect(tray, text).toContain(text);
      expect(tray, text).not.toContain("<button");
    }
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

  // 입력창의 메뉴는 「/」 명령 메뉴 하나뿐이고 쓴 글만 보고 선다 — 그래서 정적 마크업으로 사람이 친 글을 그대로 잰다. 첫 칸은 이 그물이
  // 메뉴를 실제로 보는지다.
  it("`@`를 쳐도 메뉴가 서지 않는다 — 말의 처음 · 가운데 · 이름을 이어 친 뒤 모두", () => {
    expect(composer({}, "/")).toContain('role="listbox"');
    for (const draft of ["@", "이거 @", "@rev", "@reviewer 봐 줘"]) {
      expect(composer({}, draft), draft).not.toContain('role="listbox"');
    }
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
  it("첫 말 전에도 `/work`가 없다 — 어디서 일할지는 씨앗이 정한다", () => {
    const menu = composer({ tray: { at: "below", work: { kind: "new-work", onDrop: none } } }, "/");
    expect(menu).toContain("/new");
    expect(menu).not.toContain("/work");
    expect(composer({ tray: { at: "below" } }, "/work")).not.toContain('role="listbox"');
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

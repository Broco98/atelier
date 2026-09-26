import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import SettingsPage, {
  canSave,
  HooksSection,
  hookStateLabel,
  FONT_PRESETS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  parseFontSize,
  NotificationSection,
  patchTerminal,
  previewFontFamily,
  TerminalSection,
} from "./SettingsPage";
import { notificationChoice, patchNotifications } from "./notifications";
import { FONT_FAMILY, FONT_SIZE, MONO_FACE } from "@/features/terminal/terminal-defaults";
import { terminalThemeDark, terminalThemeLight } from "@/features/terminal/terminal-theme";
import type { HookStatus, NotificationSettings, Settings } from "./types";

// 이 화면이 지켜야 하는 것은 화면으로는 안 잡히는 종류다.
//
// 1. **모르는 키가 살아남는 것** — 사용자가 손으로 적은 줄이 저장 한 번에 사라져도 화면에는
//    아무 일도 안 일어난다. 다음에 파일을 열어 봐야 안다. 결정 53이 파일로 간 이유가
//    「손으로 고칠 수 있다」인데, 그 말이 거짓이 되는 자리다.
// 2. **미리보기가 폴백을 감추지 않는 것** — 결정 52가 미리보기를 필수로 만든 이유 자체가
//    「이름을 잘못 적어도 조용히 그려진다」이고, 미리보기에 폴백을 덧붙이면 그 실패가
//    미리보기 안에서 한 번 더 감춰진다. 눈으로는 「글꼴이 잘 나오네」로 보인다.
// 3. **기본 글꼴·크기를 이 화면이 베껴 적지 않는 것** — 값을 정하는 자리는
//    `terminal-defaults.ts`이고, 여기에 옮겨 적으면 그쪽이 바뀔 때 이 화면만 낡는다.
//    낡아도 조용하다: 미리보기가 실물과 다른 글꼴을 그려도 화면에는 아무 표시가 없다.
// 4. **범위 밖 크기가 파일에서 온 것인지 여기서 적힌 것인지** — 파일이 준 값이 저장을
//    잠그면 테마 한 줄 바꾸는 것도 막힌다. 화면에는 「저장이 안 눌린다」로만 보이고 왜
//    잠겼는지는 어디에도 안 적힌다.
//
// 클릭은 걸 수 없다(jsdom이 없어 `renderToStaticMarkup` 문자열을 본다) — 그래서 판단은
// 전부 순수 함수로 꺼내 두고 여기서 그 함수들을 직접 돌린다.

const settings = (terminal: Partial<Settings["terminal"]> = {}): Settings => ({
  terminal: { fontFamily: null, fontSize: null, theme: "dark", ...terminal },
});

function render(value: Settings, sizeText = ""): string {
  return renderToStaticMarkup(
    <TerminalSection
      settings={value}
      sizeText={sizeText}
      onChange={() => {}}
      onChangeSize={() => {}}
    />,
  );
}

describe("읽은 것을 펼쳐 고친다", () => {
  it("고친 필드만 바뀐다", () => {
    const next = patchTerminal(settings({ fontSize: 15 }), { theme: "light" });
    expect(next.terminal).toEqual({ fontFamily: null, fontSize: 15, theme: "light" });
  });

  // 백엔드가 `#[serde(flatten)] extra`로 실어 보내는 것들이다(`settings.rs`). 타입에는
  // 없지만 런타임 객체에는 있고, 펼치기가 곧 보존이다.
  it("우리가 모르는 키는 구획 안팎 모두 살아남는다", () => {
    const read = {
      editor: { tabWidth: 2 },
      terminal: { fontFamily: null, fontSize: null, theme: "dark", bell: "off" },
    } as unknown as Settings;

    const next = patchTerminal(read, { fontSize: 16 }) as unknown as {
      editor: unknown;
      terminal: { bell: string; fontSize: number };
    };

    expect(next.editor, "모르는 구획이 사라졌다").toEqual({ tabWidth: 2 });
    expect(next.terminal.bell, "모르는 키가 사라졌다").toBe("off");
    expect(next.terminal.fontSize).toBe(16);
  });

  it("읽은 객체를 제자리에서 고치지 않는다", () => {
    const read = settings({ fontSize: 15 });
    patchTerminal(read, { fontSize: 20 });
    expect(read.terminal.fontSize).toBe(15);
  });
});

describe("크기 칸 읽기", () => {
  it("빈 칸은 고르지 않음이다", () => {
    expect(parseFontSize("")).toBeNull();
    expect(parseFontSize("   ")).toBeNull();
  });

  it("정수는 그 값이다", () => {
    expect(parseFontSize("15")).toBe(15);
    expect(parseFontSize(" 15 ")).toBe(15);
  });

  it("범위 안팎이 갈린다", () => {
    expect(parseFontSize(String(FONT_SIZE_MIN))).toBe(FONT_SIZE_MIN);
    expect(parseFontSize(String(FONT_SIZE_MAX))).toBe(FONT_SIZE_MAX);
    expect(parseFontSize(String(FONT_SIZE_MIN - 1))).toBe("invalid");
    expect(parseFontSize(String(FONT_SIZE_MAX + 1))).toBe("invalid");
  });

  // Rust 쪽이 `u16`이라 소수는 저장할 때 거절당한다 — 여기서 먼저 말한다.
  it("숫자가 아니거나 소수면 잘못 적힌 것이다", () => {
    expect(parseFontSize("abc")).toBe("invalid");
    expect(parseFontSize("15.5")).toBe("invalid");
    expect(parseFontSize("-15")).toBe("invalid");
  });
});

describe("저장이 열리는 조건", () => {
  // 파일이 15를 줬고 사용자가 그걸 그대로 두고 다른 칸을 고친 상태가 기본형이다.
  const state = (over: Partial<Parameters<typeof canSave>[0]> = {}) =>
    canSave({ dirty: true, sizeText: "15", savedSizeText: "15", saving: false, ...over });

  it("고친 것이 있어야 열린다", () => {
    expect(state()).toBe(true);
    expect(state({ dirty: false })).toBe(false);
  });

  it("크기가 잘못 적혀 있으면 잠긴다 — 그 칸만 조용히 옛 값으로 남는 것을 막는다", () => {
    expect(state({ sizeText: "999" })).toBe(false);
  });

  // 결정 53이 파일로 간 이유가 「손으로 고칠 수 있다」다. 큰 화면에서 손으로 적은
  // `fontSize: 40`이 테마 한 줄 바꾸는 것까지 막으면, 그 편집이 화면을 반쯤 못 쓰게
  // 만든 셈이고 울타리가 파일을 심판한 것이다(FONT_SIZE_MIN 주석).
  it("파일이 준 범위 밖 값은 다른 칸의 저장까지 잠그지 않는다", () => {
    expect(state({ sizeText: "40", savedSizeText: "40" })).toBe(true);
  });

  // 반대쪽 — 같은 40이라도 이 화면에서 적힌 것이면 잠근다. 저장하면 그 칸만 조용히
  // 예전 값으로 남기 때문이다.
  it("그 값을 이 화면에서 적었으면 잠긴다", () => {
    expect(state({ sizeText: "40", savedSizeText: "15" })).toBe(false);
  });

  // `settings.rs`가 tmp 이름을 고정해 두고 「쓰기는 한 번에 하나」를 전제로 적었다 —
  // 겹치면 한쪽의 rename이 남이 아직 쓰는 중인 tmp를 옮긴다. 구획 사이의 직렬화는
  // `saveSettingsSection`이 지고, 이 칸은 한 구획 안의 연타를 막는다.
  it("이미 쓰는 중이면 잠긴다", () => {
    expect(state({ saving: true })).toBe(false);
  });
});

describe("미리보기가 읽는 글꼴", () => {
  // 폴백을 덧붙이면 오타가 그럴듯한 다른 글꼴로 그려져, 미리보기가 존재 이유를 잃는다.
  it("고른 이름에 폴백을 덧붙이지 않는다", () => {
    expect(previewFontFamily("Menlo")).toBe("Menlo");
    expect(previewFontFamily("있지도 않은 글꼴")).toBe("있지도 않은 글꼴");
  });

  // **고르지 않았을 때만 셸과 글자 그대로 같다.** 고른 이름에는 셸 쪽에서 폴백 사슬이
  // 붙지만(결정 56) 여기는 안 붙인다 — 위 검사가 그 이유다. 「기본」은 붙일 것이 없어
  // 두 값이 같아지고, 그래서 이 칩만은 실물과 어긋날 수 없다.
  //
  // 이름을 베껴 적지 않고 **값을 정하는 유일한 지점**에서 읽는다. 예전에는 그 자리가
  // `@xterm/*`를 딸고 오는 `terminal-store.ts` 안이라 앱 토큰 `var(--font-mono)`를 대신
  // 읽었는데, 결정 55가 터미널 글꼴만 `JetBrainsMonoNL Nerd Font`로 옮기면서 그 대역이
  // 실물과 갈라졌다. `terminal-defaults.ts`가 그 물음을 닫았다.
  it("고르지 않았으면 셸이 쓸 목록을 그대로 그린다", () => {
    expect(previewFontFamily(null)).toBe(FONT_FAMILY);
  });
});


describe("프리셋", () => {
  // 첫 줄은 앱이 번들하는 글꼴이다 — 목록의 순서가 「무엇을 먼저 권하는가」다. 이름이 아니라
  // **자리**를 본다: 이름은 `MONO_FACE` 하나가 정하므로 베껴 적을 것이 없고(위 목록 주석),
  // 여기서 어긋날 수 있는 것은 그 글꼴이 첫 줄이 아니게 되는 것뿐이다.
  it("첫 줄이 번들 글꼴이고 macOS의 셋이 함께 있다", () => {
    expect(FONT_PRESETS[0]).toBe(MONO_FACE);
    expect(FONT_PRESETS).toContain("SF Mono");
    expect(FONT_PRESETS).toContain("Menlo");
    expect(FONT_PRESETS).toContain("Monaco");
  });

  it("프리셋 칩이 목록 순서대로 그려진다", () => {
    const markup = render(settings());
    const positions = FONT_PRESETS.map((preset) => markup.indexOf(preset));
    expect(positions.some((at) => at < 0), "그려지지 않은 프리셋이 있다").toBe(false);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("고른 프리셋만 켜진다", () => {
    const markup = render(settings({ fontFamily: "Menlo" }));
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Menlo</);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>Monaco</);
  });
});

describe("미리보기 한 줄", () => {
  it("고른 글꼴이 그대로 실린다", () => {
    const markup = render(settings({ fontFamily: "있지도 않은 글꼴" }));
    expect(markup).toContain("font-family:있지도 않은 글꼴");
    // 폴백이 함께 실리면 오타가 그럴듯하게 그려진다
    expect(markup).not.toContain("var(--font-mono)");
  });

  // 기본 글꼴 이름을 이 화면이 **베껴 적지** 않는다 — 값을 정하는 자리는
  // `terminal-defaults.ts`이고 여기는 그 상수를 읽는다. 그래서 그 이름이 **마크업에** 나오는
  // 것은 맞다(셸이 쓸 목록을 그대로 그리는 중이다). 틀린 것은 이 화면 소스에 문자열로
  // 적히는 쪽이고, 그 갈래는 위 「전제」 검사가 아니라 이 import 하나가 닫는다.
  //
  // `var(--font-mono)`를 대신 읽던 자리다 — 결정 55가 터미널 글꼴만 옮기면서 그 대역이
  // 실물과 갈라졌다.
  it("고르지 않았으면 셸이 쓸 목록을 그대로 그린다", () => {
    const markup = render(settings());
    expect(markup).toContain(`font-family:${FONT_FAMILY}`);
    expect(markup).not.toContain("var(--font-mono)");
  });

  // 글꼴과 같은 규칙이다. 예전에는 고르지 않았을 때 크기를 **아예 적지 않고** CSS 클래스에
  // 맡겼는데(기본값을 베껴 적지 않으려는 것이었다), 그러면 「기본」 미리보기가 실물보다 작게
  // 그려지는 것을 아무도 못 본다 — 미리보기가 실패를 감추는 그 자리다.
  it("고른 크기가 실리고, 고르지 않았으면 기본 크기로 그린다", () => {
    expect(render(settings({ fontSize: 20 }), "20")).toContain("font-size:20px");
    expect(render(settings())).toContain(`font-size:${FONT_SIZE}px`);
  });

  // 「어둡게」가 어떤 어둠인지는 이름으로 알 수 없다 — 두 벌의 실제 값을 그대로 쓴다.
  it("고른 테마의 색으로 그린다", () => {
    const dark = render(settings({ theme: "dark" }));
    expect(dark).toContain(`background:${terminalThemeDark.background}`);
    expect(dark).toContain(`color:${terminalThemeDark.foreground}`);

    const light = render(settings({ theme: "light" }));
    expect(light).toContain(`background:${terminalThemeLight.background}`);
    expect(light).toContain(`color:${terminalThemeLight.foreground}`);
  });
});

describe("테마 줄", () => {
  it("고른 쪽만 켜진다", () => {
    const markup = render(settings({ theme: "light" }));
    expect(markup).toMatch(/aria-pressed="true"[^>]*>밝게</);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>어둡게</);
  });
});

// 결정 52가 명시적으로 뺀 둘이다. 「설정 화면이 있으니 한 줄 더」로 조용히 들어오기 쉬운
// 자리라 여기서 못박는다 — 스크롤백은 모양이 아니라 메모리 값이고(셸 8개 × 10,000줄),
// 색 편집기는 별건이다.
describe("이 판이 열지 않은 것", () => {
  it("스크롤백도 ANSI 색 편집도 화면에 없다", () => {
    const markup = render(settings());
    expect(markup).not.toContain("스크롤백");
    expect(markup).not.toContain("ANSI");
  });
});

// ── 알림 구획 (#206 · 결정 10)
//
// 이 구획이 지켜야 하는 것도 화면으로는 안 잡히는 종류다.
//
// 1. **고르지 않은 값이 파일에 안 적히는 것** — 기본(둘 다 켬)은 프런트가 들고 백엔드는
//    「고른 것만」 적는다(`settings.rs`). 화면이 기본값을 그대로 저장으로 흘려보내면 안
//    고른 것이 고른 것이 되고, 그 뒤로는 기본이 바뀌어도 이 사용자만 옛 값에 묶인다.
// 2. **셋째 선택이 없는 것**(결정 10 · 스토리 67) — 「배경일 때만」은 명시적으로 기각됐다.
// 3. **권한 거부가 이 화면에 적히는 것**(스토리 69) — 인앱 토스트로 대체하지 않는다.
//    거부된 채 조용하면 사람은 「알림 기능이 고장 났다」로 읽는다.

// **안 고른 값은 키가 없다** — 백엔드가 이 구획만 `skip_serializing_if`로 줄째 빼기
// 때문이고(`settings.rs`), 그래서 아무것도 안 준 기본이 빈 구획 `{}`다.
const withNotifications = (patch: Partial<NotificationSettings> = {}): Settings => ({
  terminal: { fontFamily: null, fontSize: null, theme: "dark" },
  notifications: { ...patch },
});

function renderNotifications(value: Settings, granted: boolean | null = true): string {
  return renderToStaticMarkup(
    <NotificationSection settings={value} granted={granted} onChange={() => {}} />,
  );
}

describe("알림 설정의 기본은 프런트가 든다", () => {
  // 백엔드는 구획째 안 쓸 수 있다(`settings.rs`의 `is_empty`) — 그 파일이 여기 그대로 온다.
  it("구획이 아예 없어도 둘 다 켬이다", () => {
    const bare = { terminal: { fontFamily: null, fontSize: null, theme: "dark" } } as Settings;
    expect(notificationChoice(bare)).toEqual({ enabled: true, sound: true });
  });

  it("안 고른 값은 켬이다", () => {
    expect(notificationChoice(withNotifications())).toEqual({ enabled: true, sound: true });
  });

  // **`false`가 살아남아야 한다.** `?? true`가 아니라 `|| true`로 적으면 껐다는 선택이
  // 조용히 켬으로 돌아오고, 화면에서는 「껐는데 다시 켜졌다」로만 보인다.
  it("끈 것은 끈 채로 온다", () => {
    expect(notificationChoice(withNotifications({ enabled: false, sound: false }))).toEqual({
      enabled: false,
      sound: false,
    });
  });
});

describe("알림 설정을 고친다", () => {
  it("구획이 없어도 만들어 얹는다", () => {
    const bare = { terminal: { fontFamily: null, fontSize: null, theme: "dark" } } as Settings;
    expect(patchNotifications(bare, { sound: false }).notifications).toEqual({ sound: false });
  });

  // `patchTerminal`과 같은 규칙이다 — 읽은 것을 펼쳐 고쳐야 모르는 키가 산다.
  it("우리가 모르는 키는 구획 안팎 모두 살아남는다", () => {
    const read = {
      editor: { tabWidth: 2 },
      terminal: { fontFamily: null, fontSize: null, theme: "dark" },
      notifications: { enabled: true, quietHours: "22-08" },
    } as unknown as Settings;

    const next = patchNotifications(read, { sound: false }) as unknown as {
      editor: unknown;
      notifications: { quietHours: string; enabled: boolean; sound: boolean };
    };

    expect(next.editor, "모르는 구획이 사라졌다").toEqual({ tabWidth: 2 });
    expect(next.notifications.quietHours, "모르는 키가 사라졌다").toBe("22-08");
    expect(next.notifications.enabled, "옆 값이 사라졌다").toBe(true);
    expect(next.notifications.sound).toBe(false);
  });
});

describe("알림 구획의 화면", () => {
  // 결정 10 · 스토리 67 — 켬/끔과 소리 켬/끔 **둘뿐**이다.
  it("고르는 것이 둘뿐이다", () => {
    const html = renderNotifications(withNotifications());
    expect(html).toContain("알림");
    expect(html).toContain("소리");
    // 칩은 둘씩 두 줄 — 넷이다. 셋째 선택이 생기면 여기서 먼저 걸린다.
    expect(html.match(/aria-pressed=/g) ?? []).toHaveLength(4);
    expect(html, "기각된 셋째 선택이 화면에 있다").not.toContain("배경");
  });

  it.each([
    [{}, ["true", "false", "true", "false"]],
    [{ enabled: false }, ["false", "true", "true", "false"]],
    [{ sound: false }, ["true", "false", "false", "true"]],
  ] as ReadonlyArray<readonly [Partial<NotificationSettings>, string[]]>)(
    "고른 쪽만 켜진다 %s",
    (patch, pressed) => {
      const html = renderNotifications(withNotifications(patch));
      expect([...html.matchAll(/aria-pressed="(\w+)"/g)].map((one) => one[1])).toEqual(pressed);
    },
  );

  // 스토리 69 — 거부된 채 조용하면 왜 안 울리는지 어디에도 안 적힌다.
  it("권한이 거부돼 있으면 그 사실이 이 화면에 적힌다", () => {
    expect(renderNotifications(withNotifications(), false)).toContain("권한");
  });

  it.each([true, null])("권한이 %s면 아무 말도 안 한다", (granted) => {
    expect(renderNotifications(withNotifications(), granted)).not.toContain("권한");
  });
});

// ── 에이전트 훅 구획 (#207 · 구현 결정 8)
//
// 이 구획이 지켜야 하는 것도 화면으로는 안 잡히는 종류다.
//
// 1. **「모른다」와 「안 깔렸다」가 갈리는 것** — 설정 파일이 깨져 판정을 못 한 것을
//    「설치 안 됨」이라 적으면, 사람은 설치 버튼을 누르고 실패하는 길로 보내진다.
//    백엔드는 그때 `installed: false`에 `error`를 함께 실어 보낸다(`hooks.rs`).
// 2. **미리보기가 화면에 서는 것**(스토리 73) — 내 설정을 앱에 맡기는 일이라, 누르기 전에
//    무엇이 어디에 들어가는지 보여야 한다. 그 글자는 백엔드가 낸 것을 그대로 그린다.
// 3. **되돌릴 길이 화면에 있는 것**(스토리 74) — 설치만 있고 제거가 없으면 훅이 남아
//    있는지 몰라 헤맨다.
// 4. **아는 사실이 「모른다」로 안 지워지는 것** — 쓰기가 실패한 것(`writeError`)과 판정을
//    못 한 것(`error`)은 다른 사실이다. 읽기는 되는데 쓰기만 실패한 파일에서 「확인 못 함」이라
//    적으면, 낱말 셋(설치됨·설치 안 됨·확인 못 함)의 뜻이 그 자리에서 깨진다.

const hook = (patch: Partial<HookStatus> = {}): HookStatus => ({
  agent: "claude",
  path: "~/.claude/settings.json",
  installed: false,
  error: null,
  writeError: null,
  preview: '{\n  "hooks": {}\n}\n',
  ...patch,
});

function renderHooks(statuses: HookStatus[]): string {
  return renderToStaticMarkup(
    <HooksSection
      statuses={statuses}
      busy={false}
      error={null}
      onInstall={() => {}}
      onUninstall={() => {}}
    />,
  );
}

/** 이 마크업의 버튼들이 사람에게 보이는 글자. **버튼만 걸린다** — 상태 낱말이 같은 화면에
 *  있어 `toContain("설치")`는 버튼을 통째로 지워도 통과한다. */
function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
}

describe("훅이 지금 어떤지 한 낱말로", () => {
  it("깔렸으면 설치됨, 아니면 설치 안 됨이다", () => {
    expect(hookStateLabel(hook({ installed: true }))).toBe("설치됨");
    expect(hookStateLabel(hook())).toBe("설치 안 됨");
  });

  // **`installed`만 보면 둘이 같은 낱말이 된다.** 깨진 파일에서 백엔드는 판정을 안 하고
  // `false`에 까닭을 실어 보내는데, 그것을 「설치 안 됨」이라 읽으면 화면이 없는 사실을
  // 만들고 사람을 실패하는 버튼으로 보낸다.
  it("판정을 못 했으면 안 깔렸다고 하지 않는다", () => {
    expect(hookStateLabel(hook({ error: "설정 파일이 잘못됐습니다" }))).toBe("확인 못 함");
  });
});

describe("훅 구획의 화면", () => {
  it("에이전트마다 어디에 무엇이 들어가는지와 지금 상태가 선다", () => {
    const html = renderHooks([
      hook({ installed: true, preview: "클로드 조각" }),
      hook({ agent: "codex", path: "~/.codex/config.toml", preview: "코덱스 조각" }),
    ]);

    // **이름 칸을 걸어 잰다.** 그냥 `toContain("claude")`이면 아래 경로에 그 글자가 이미
    // 있어 에이전트 이름 칸을 통째로 지워도 통과한다.
    expect(html).toContain(">claude</span>");
    expect(html).toContain(">codex</span>");
    expect(html).toContain("~/.claude/settings.json");
    expect(html).toContain("설치됨");
    expect(html).toContain("~/.codex/config.toml");
    expect(html).toContain("설치 안 됨");
    // 스토리 73 — 누르기 전에 무엇이 들어가는지 보인다. 화면이 따로 적은 글이 아니라
    // 백엔드가 낸 그 글자다.
    expect(html).toContain("클로드 조각");
    expect(html).toContain("코덱스 조각");
  });

  // 스토리 70·74 — 버튼 하나로 깔리고, 되돌릴 길이 화면에 있다.
  it("설치와 제거가 버튼으로 둘 다 있다", () => {
    expect(buttonLabels(renderHooks([hook()]))).toEqual(["설치", "제거"]);
  });

  // 스토리 73 — claude 쪽 미리보기는 **빈 설정에 병합한 결과**라 그대로 두면 「내 파일이
  // 이걸로 바뀐다」로 읽힌다. 예순 줄짜리 설정을 가진 사람이 볼 그림이 그것이면 이 구획이
  // 없애려던 불안을 되레 키운다.
  it("미리보기가 「더해지는 것」임을 말한다", () => {
    const html = renderHooks([hook()]);
    expect(html).toContain("이미 있는 내용은 그대로 두고");
  });

  // 읽기는 됐는데 **쓰기만** 실패한 자리. 파일이 읽기 전용이면 그렇다 — 그때 우리는
  // 설치 여부를 안다. 아는 것을 「확인 못 함」으로 지우면 안 된다.
  it("쓰기가 실패해도 아는 상태는 그대로 적고 까닭을 덧붙인다", () => {
    const status = hook({ installed: true, writeError: "설정을 쓰지 못했습니다: 권한이 없습니다" });
    expect(hookStateLabel(status)).toBe("설치됨");

    const html = renderHooks([status]);
    expect(html).toContain("설치됨");
    expect(html).not.toContain("확인 못 함");
    expect(html).toContain("설정을 쓰지 못했습니다");
  });

  // 깨진 파일에서는 쓰기도 판정도 같은 까닭으로 실패한다 — 그때 같은 줄이 두 번 서면
  // 사람은 두 가지 일이 났다고 읽는다.
  it("같은 까닭은 두 번 안 적는다", () => {
    const why = "설정 파일이 잘못됐습니다 — 손대지 않았습니다";
    const html = renderHooks([hook({ error: why, writeError: why })]);
    expect(html.split(why).length - 1).toBe(1);
  });

  // 깨진 파일의 까닭은 **화면에 적힌다.** 조용히 삼키면 사람은 버튼이 고장 났다고 읽는다.
  it("판정을 못 한 까닭이 그 자리에 적힌다", () => {
    const html = renderHooks([hook({ error: "설정 파일이 잘못됐습니다 — 손대지 않았습니다" })]);
    expect(html).toContain("손대지 않았습니다");
    expect(html).toContain("확인 못 함");
  });
});

// UI개선 결정 22 — 항목 하나가 페이지 하나가 되면서 제목은 페이지(`SettingsPage`)가 든다.
// 구획이 제 제목을 또 들면 머리 `Settings / 터미널` 바로 밑에 같은 낱말이 한 번 더 서고, 그
// 글자는 `SETTINGS_ITEMS`가 아닌 리터럴이라 이름을 고치는 날 한쪽만 바뀐다.
describe("구획은 제 제목을 들지 않는다", () => {
  const headings = (html: string) => html.match(/<h[1-6][\s>]/g) ?? [];

  it("터미널 · 알림 · 에이전트 훅 구획 어디에도 제목 요소가 없다", () => {
    expect(headings(render(settings()))).toEqual([]);
    expect(headings(renderNotifications(withNotifications()))).toEqual([]);
    expect(headings(renderHooks([hook()]))).toEqual([]);
  });
});

// ── 본문 머리(UI개선 결정 22 · spec 레이아웃 티켓 08)
//
// 머리(`Settings / …`)와 제목 역할의 줄은 설정 nav와 **같은 표**(`SETTINGS_ITEMS`)를 읽는다 — 넷째 항목을
// 표에 더한 것만으로 머리가 선다. 사이드바의 설정 nav가 그 표를 도는 것은 `Sidebar.test.tsx`의 소스
// 검사가, 눌러서 그 페이지에 서는 것은 L3(`spec-layout-page.spec.ts`)가 잰다.
describe("본문 머리", () => {
  function renderPage(item: "spec-layout"): string {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage sidebarOpen item={item} />
      </QueryClientProvider>,
    );
  }

  it("「spec 레이아웃」 페이지의 머리는 `Settings / spec 레이아웃`이다", () => {
    const html = renderPage("spec-layout");
    const header = /<header\b[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(header.replace(/<[^>]+>/g, "")).toBe("Settings/spec 레이아웃");
    expect(html).toContain('<h2 class="sr-only">spec 레이아웃</h2>');
  });
});

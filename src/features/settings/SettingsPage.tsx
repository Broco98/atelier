import { useEffect, useState } from "react";
import PageHeader from "@/components/shell/PageHeader";
import { cn } from "@/lib/utils";
import { FONT_FAMILY, FONT_SIZE, MONO_FACE } from "@/features/terminal/terminal-defaults";
import { applyTerminalSettings } from "@/features/terminal/terminal-settings";
import { terminalThemeFor } from "@/features/terminal/terminal-theme";
import { settingsApi } from "./api";
import type { Settings, TerminalSettings, TerminalTheme } from "./types";

// 앱 전역 설정 화면 (결정 51·52·54). 지금 구획은 `터미널` 하나이고, 다음 구획이 생기면
// 아래 `<section>` 하나가 는다.
//
// **값은 `~/.atelier/settings.json` 한 장에 산다**(결정 53 · adr-02) — `localStorage`가
// 아니다. 창구는 `api.ts`의 둘뿐이고, 쓸 때는 **읽은 것을 펼쳐 고친다**(`patchTerminal`).
//
// **저장에 성공하면 그 값을 셸에도 먹인다**(`applyTerminalSettings`) — 이미 떠 있는 칸까지
// 따라온다(결정 52). 먹이는 일 자체는 이 화면이 하지 않는다: 무엇이 바뀌어야 하는지를 아는 곳은
// `terminal-store.ts`이고, 이 화면은 그 모듈을 import하지 않는다(`@xterm/*`가 함께 온다).
// 둘 사이에 스토어 한 장(`terminal-settings.ts`)이 있고, 이 화면이 아는 것은 거기까지다.
//
// **파일에 적기 전에는 먹이지 않는다.** 칸을 고칠 때마다 먹이면 이름을 한 자 지운 순간
// (`Menl`)이 셸에 가고, 저장을 안 하고 화면을 떠난 값이 셸에만 남는다.

// 프리셋은 **손으로 적는다.** 설치된 글꼴을 실측으로 얻는 웹 API가 WebKit에 없다
// (`queryLocalFonts()`는 Chromium 전용이고, Rust로 시스템 글꼴을 열거하는 안은 결정 52가
// 「이 판에서 열 크기가 아니다」로 기각했다). 나머지 셋은 macOS에 늘 있는 것들이고, 여기 없는
// 글꼴은 아래 자유 입력이 받는다.
//
// **첫 줄만은 이름을 베껴 적지 않는다** — 번들 글꼴의 이름은 `MONO_FACE`가 정하고 그 값이
// `index.css`의 `@font-face`와 같은지는 `font-bundle.test.ts`가 묶는다. 여기 문자열로 적으면
// 이 한 줄만 그 그물 밖에 남는데, 되돌리는 길이 「파일을 `…NerdFontMono-*`로 갈아 끼운다」라
// (`assets/fonts/README.md`) 이름이 실제로 바뀐다 — 그때 낡은 칩은 없는 글꼴을 권하고,
// 누르면 아무 소리 없이 폴백으로 흐른다.
//
// **이 목록은 「기본값」이 아니라 「고를 수 있는 것」이다.** 고르지 않았을 때 무엇으로
// 그려지는지는 `previewFontFamily`가 답하고, 그 답에 글꼴 이름은 나오지 않는다.
export const FONT_PRESETS = [MONO_FACE, "SF Mono", "Menlo", "Monaco"] as const;

// 터미널이 못 쓰게 되는 값을 파일에 적지 않기 위한 울타리다. 위아래 둘 다 실제로 못 쓰는
// 크기이고(8 미만은 글자가 뭉개지고 32 초과는 한 줄에 몇 자 안 들어간다), **이 화면이 새로
// 만드는 값에만 건다** — 손으로 고친 파일이 이 밖의 값을 갖고 있으면 그 값은 칸에 그대로
// 뜨고 저장도 잠기지 않는다. 그건 파일의 권한이다(결정 53). 그 갈림을 판정하는 자리는
// `canSave` 하나다.
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

/**
 * 크기 칸의 글자를 저장할 값으로 옮긴다. 빈 칸은 **「고르지 않음」**이다 — 자유 입력이라
 * 되돌릴 길이 있어야 하고, 그 길이 「비우면 기본」이면 글꼴 칸과 규칙이 같아진다.
 *
 * `"invalid"`를 따로 돌려주는 이유: 잘못 적힌 값을 조용히 무시하면 저장이 성공했는데 그
 * 칸만 예전 값으로 남는다 — 사용자가 보기엔 「저장이 한 칸을 삼켰다」다. 그래서 저장을
 * 아예 잠근다(`canSave`).
 */
export function parseFontSize(raw: string): number | null | "invalid" {
  const text = raw.trim();
  if (text === "") return null;
  // 정수만 받는다. `Number("15.5")`는 15.5를 돌려주는데 Rust 쪽은 `u16`이라 저장할 때
  // 조용히 거절당한다 — 여기서 먼저 말하는 편이 낫다.
  if (!/^\d+$/.test(text)) return "invalid";
  const size = Number(text);
  return size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX ? size : "invalid";
}

/**
 * 고친 것을 **읽은 것 위에 얹는다.** 새 객체를 만들어 보내면 파일에 있던 모르는 키가
 * 조용히 사라진다 — `api.ts`의 `write` 주석이 못박은 규칙이고, 백엔드는 그것을
 * `#[serde(flatten)] extra`로 실어 보낸다(`settings.rs`). 타입에는 그 키들이 없지만
 * 런타임 객체에는 실려 있으므로, **펼치기가 곧 보존이다.**
 *
 * 이 규칙을 아는 곳을 여기 하나로 둔다 — 화면 어느 칸을 고치든 이 함수를 지난다.
 */
export function patchTerminal(settings: Settings, patch: Partial<TerminalSettings>): Settings {
  return { ...settings, terminal: { ...settings.terminal, ...patch } };
}

/**
 * 미리보기가 읽을 글꼴. **고른 이름에 폴백을 덧붙이지 않는다.**
 *
 * 결정 52가 미리보기를 필수로 만든 이유가 그것이다 — 이름을 잘못 적으면 오류 없이 폴백으로
 * 그려지는 조용한 실패를 눈에 보이게 하는 것. 여기서 `, monospace`를 덧붙이면 오타가 그럴듯한
 * 다른 글꼴로 그려져 **미리보기가 그 실패를 도로 감춘다.**
 *
 * **그래서 여기는 실물 터미널과 일부러 다르다.** 셸이 실제로 받는 것은 고른 이름 뒤에 폴백
 * 사슬이 붙은 목록이다(결정 56 — 고른 글꼴이 무엇이든 한글은 늘 같은 모양이어야 한다).
 * 그 사슬을 여기 붙이면 이 칸이 하는 일이 사라진다.
 *
 * 고르지 않았을 때만 다르다 — **그때는 셸이 받는 것과 글자 그대로 같은 목록을 그린다.**
 * 여기 이름을 베껴 적는 것이 아니라 그 값을 정하는 유일한 지점(`terminal-defaults.ts`의
 * `FONT_FAMILY`)에서 읽는다. 예전에는 그 모듈이 `@xterm/*`를 딸고 오는 `terminal-store.ts`
 * 안에 있어서 앱 토큰 `--font-mono`를 대신 읽었고, 결정 55가 그 둘을 갈라놓으면서
 * 「기본」 칩이 실물과 다른 글꼴을 그리게 됐다. 그 대신 물음을 이 import 하나가 닫는다.
 */
export function previewFontFamily(fontFamily: string | null): string {
  return fontFamily ?? FONT_FAMILY;
}

/**
 * 저장을 열어 둘 조건. 셋 다 이유가 다르다.
 *
 * - 고친 것이 없으면 파일을 건드릴 이유가 없다.
 * - **이미 쓰는 중이면 막는다.** `settings.rs`가 tmp 이름을 고정해 두고(`.settings.json.tmp`)
 *   「쓰기는 한 번에 하나」를 전제로 적었다 — 겹치면 한쪽의 rename이 다른 쪽이 아직 쓰는 중인
 *   tmp를 옮긴다. 그 주석이 「설정 화면이 연타를 허용하게 되면 그 화면이 직렬화를 진다」고
 *   적은 자리가 여기다.
 * - 크기가 잘못 적힌 채 저장하면 그 칸만 조용히 예전 값으로 남는다(`parseFontSize`).
 *
 * 셋째에는 단서가 하나 붙는다. **파일이 준 원문 그대로면 잠그지 않는다.** 손으로 적은
 * `fontSize: 40`(결정 53이 인정한 파일의 권한)이 칸에 그대로 떠 있을 뿐인데 그것이 테마
 * 한 줄 바꾸는 것까지 막으면, 울타리가 「이 화면이 새로 만드는 값」을 넘어 파일을 심판한
 * 것이다. 그때 저장해도 그 칸은 파일에 있던 값 그대로 나간다 — 원문을 안 건드렸으니
 * `changeSize`를 지나지 않았고 `draft.fontSize`도 그대로다.
 *
 * 그래서 견주는 짝이 「처음 읽은 값」이 아니라 **「지금 파일에 있다고 아는 값」**이다
 * (`saved`). 저장에 성공하면 그쪽이 따라 움직이므로 방금 저장한 값도 같은 대우를 받는다.
 */
export function canSave(state: {
  dirty: boolean;
  sizeText: string;
  savedSizeText: string;
  saving: boolean;
}): boolean {
  if (!state.dirty || state.saving) return false;
  if (state.sizeText === state.savedSizeText) return true;
  return parseFontSize(state.sizeText) !== "invalid";
}

// 미리보기 한 줄. 셸 프롬프트 모양에 박스 문자와 헷갈리는 글자(0O1lI)를 함께 둔다 —
// 「이 글꼴이 있는가」와 「이 글꼴로 TUI를 볼 만한가」가 한 줄에서 보인다.
const PREVIEW_LINE = "~/atelier $ git status  ─│┌┐└┘  0O1lI";

const THEME_LABELS: Record<TerminalTheme, string> = {
  light: "밝게",
  dark: "어둡게",
};

function SettingsPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  // 파일과 같다고 아는 값과 화면이 고치는 값을 따로 든다 — 「고친 것이 있나」가 둘의 차이다.
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  // 크기만 원문을 따로 든다. 숫자로만 들면 「15」를 지우는 중인 한 글자(`1`)가 곧 크기가 되고,
  // 잘못 적힌 글자를 화면에 그대로 둘 수가 없다.
  const [sizeText, setSizeText] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 다시 읽기 — 깨진 파일은 손으로 고치는 것이 정상 경로라(결정 53) 앱을 껐다 켜지 않고
  // 그 자리에서 다시 읽을 길이 있어야 한다.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setReadError(null);
    settingsApi.read().then(
      (settings) => {
        if (!alive) return;
        setSaved(settings);
        setDraft(settings);
        setSizeText(settings.terminal.fontSize?.toString() ?? "");
      },
      (error) => {
        // **기본값으로 넘어가지 않는다.** 깨진 파일을 기본값으로 대신 그리면 다음 저장이
        // 사용자가 고치던 파일을 통째로 덮어쓴다(`settings.rs`의 `read` 주석).
        if (alive) setReadError(String(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  // 키 순서는 읽은 것을 펼쳐 만들었으므로 그대로다 — 문자열 비교로 충분하다.
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  // 파일이 준 크기의 원문. 칸의 글자가 이것과 같은 동안에는 그 값이 범위 밖이어도 저장을
  // 잠그지 않는다(`canSave`) — 읽을 때 그대로 넣은 값이라 `sizeText`와 같은 규칙으로 만든다.
  const savedSizeText = saved?.terminal.fontSize?.toString() ?? "";

  const change = (patch: Partial<TerminalSettings>) => {
    setDraft((current) => (current === null ? current : patchTerminal(current, patch)));
    setSaveError(null);
  };

  const changeSize = (raw: string) => {
    setSizeText(raw);
    const size = parseFontSize(raw);
    // 잘못 적힌 동안에는 저장할 값을 건드리지 않는다 — 저장은 `canSave`가 잠가 둔다.
    if (size !== "invalid") change({ fontSize: size });
  };

  const save = async () => {
    if (draft === null || !canSave({ dirty, sizeText, savedSizeText, saving })) return;
    setSaving(true);
    setSaveError(null);
    try {
      await settingsApi.write(draft);
      setSaved(draft);
      // **파일에 들어간 뒤에 먹인다.** 먼저 먹이면 쓰기가 실패했을 때 셸만 새 값으로 남아
      // 다음 실행에 되돌아간다 — 「저장이 안 됐는데 바뀌었다」가 가장 읽기 어려운 상태다.
      applyTerminalSettings(draft.terminal);
    } catch (error) {
      setSaveError(String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root="Settings" inset={!sidebarOpen} />
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 scroll-quiet">
          <div className="flex max-w-[620px] flex-col gap-6">
            {readError !== null ? (
              <div className="flex flex-col items-start gap-3 pt-2">
                <p className="text-[13.5px] leading-[1.7] text-red-600">{readError}</p>
                <p className="text-[13px] leading-[1.7] text-tertiary">
                  파일을 손으로 고친 뒤 다시 읽어 주세요. 고칠 때까지 이 화면은 아무것도 저장하지
                  않아요.
                </p>
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="h-7 rounded-[9px] px-[11px] text-[13.5px] font-medium text-muted-foreground transition-colors quiet-hover"
                >
                  다시 읽기
                </button>
              </div>
            ) : draft === null ? null : (
              <>
                <TerminalSection
                  settings={draft}
                  sizeText={sizeText}
                  onChange={change}
                  onChangeSize={changeSize}
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={!canSave({ dirty, sizeText, savedSizeText, saving })}
                    // 규격은 이 저장소의 유일한 주 버튼 선례를 그대로 쓴다
                    // (ProjectsPage의 "프로젝트 추가"). disabled:pointer-events-none은
                    // 테두리를 걷어낸 뒤로 배경 농도가 "누를 수 있다"를 말하는 유일한
                    // 어휘라서다 — 잠긴 채 hover가 걸리면 눌리는 버튼으로 읽힌다.
                    className="h-8 rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-[filter] hover:brightness-[1.08] disabled:pointer-events-none disabled:opacity-40"
                  >
                    {saving ? "저장 중…" : "저장"}
                  </button>
                  {saveError !== null && (
                    <span className="text-[13px] text-red-600">{saveError}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * `터미널` 구획 — 글꼴 · 크기 · 테마 · 미리보기 네 줄이다(결정 52·54).
 *
 * **스크롤백도 ANSI 16색 편집도 없다.** 결정 52가 둘 다 명시적으로 뺐다 — 스크롤백은 모양이
 * 아니라 메모리 값이고(셸 8개 × 10,000줄), 색 편집기는 별건이다.
 *
 * 값을 들지 않는다 — 위 화면이 들고 이쪽은 그리기만 한다. 마크업 테스트가 클릭을 못 걸어
 * (jsdom이 없다) 상태를 쥔 컴포넌트는 첫 화면 하나밖에 못 보여주기 때문이다.
 */
export function TerminalSection({
  settings,
  sizeText,
  onChange,
  onChangeSize,
}: {
  settings: Settings;
  sizeText: string;
  onChange: (patch: Partial<TerminalSettings>) => void;
  onChangeSize: (raw: string) => void;
}) {
  const { fontFamily, fontSize, theme } = settings.terminal;
  const palette = terminalThemeFor(theme);

  return (
    <section className="flex flex-col gap-5 pt-2">
      <h2 className="text-[14px] font-semibold text-muted-foreground">터미널</h2>

      {/* 글꼴 — 프리셋은 지름길일 뿐이고 **값은 아래 칸 하나가 든다.** 둘을 따로 들면
          「프리셋을 골랐는데 칸에는 옛 이름이 남은」 상태가 생기고, 그때 무엇이 저장되는지
          화면에서 읽을 수 없다. 비우면 「고르지 않음」이다(크기 칸과 같은 규칙). */}
      <Row label="글꼴">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Chip
              label="기본"
              active={fontFamily === null}
              onClick={() => onChange({ fontFamily: null })}
            />
            {FONT_PRESETS.map((preset) => (
              <Chip
                key={preset}
                label={preset}
                active={fontFamily === preset}
                onClick={() => onChange({ fontFamily: preset })}
              />
            ))}
          </div>
          <input
            aria-label="터미널 글꼴"
            value={fontFamily ?? ""}
            placeholder="기본"
            onChange={(e) =>
              onChange({ fontFamily: e.target.value.trim() === "" ? null : e.target.value })
            }
            className="h-[30px] w-[280px] rounded-[9px] border border-border-strong bg-background px-[9px] text-[13px] outline-none focus:border-primary"
          />
        </div>
      </Row>

      {/* 크기 — `type="number"`가 아니다. 스피너가 이 앱에 없는 어휘이고, 무엇이 잘못
          적혔는지는 `parseFontSize` 하나가 정해야 한다(브라우저마다 다른 강제 보정에
          맡기지 않는다).

          파일이 준 범위 밖 값에도 테두리는 빨갛다 — 「이 화면이 만들 수 있는 범위 밖」은
          출처와 무관한 사실이다. 그것이 저장까지 잠그느냐는 다른 질문이고 `canSave`가
          따로 답한다. */}
      <Row label="크기">
        <div className="flex items-center gap-2">
          <input
            aria-label="터미널 글꼴 크기"
            inputMode="numeric"
            value={sizeText}
            placeholder="기본"
            onChange={(e) => onChangeSize(e.target.value)}
            className={cn(
              "h-[30px] w-[72px] rounded-[9px] border bg-background px-[9px] text-[13px] outline-none focus:border-primary",
              parseFontSize(sizeText) === "invalid" ? "border-red-500" : "border-border-strong",
            )}
          />
          <span className="text-[13px] text-tertiary">
            px · {FONT_SIZE_MIN}–{FONT_SIZE_MAX}
          </span>
        </div>
      </Row>

      {/* 테마 — 두 벌뿐이다(결정 54). 기본은 어둡게이고 그 기본은 백엔드가 정해 온다
          (`settings.rs`의 `TerminalTheme::default`), 그래서 이 칸에는 「고르지 않음」이 없다. */}
      <Row label="테마">
        <div className="flex gap-1.5">
          {(["light", "dark"] as const).map((option) => (
            <Chip
              key={option}
              label={THEME_LABELS[option]}
              active={theme === option}
              onClick={() => onChange({ theme: option })}
            />
          ))}
        </div>
      </Row>

      {/* 미리보기 — **필수다**(결정 52). 글꼴 이름을 잘못 적으면 오류 없이 폴백으로 그려지는
          조용한 실패를, 저장하기 전에 눈에 보이게 만드는 값싼 길이다. 색도 고른 테마의 것을
          그대로 쓴다 — 「어둡게」가 실제로 어떤 어둠인지는 이름으로 알 수 없다. */}
      <Row label="미리보기">
        <div
          style={{
            background: palette.background,
            color: palette.foreground,
            fontFamily: previewFontFamily(fontFamily),
            // 글꼴과 같은 규칙이다 — 고르지 않았으면 셸이 쓸 기본 크기를 그대로 그린다.
            // 베껴 적는 것이 아니라 그 값을 정하는 유일한 지점에서 읽는다(`terminal-defaults.ts`).
            fontSize: `${fontSize ?? FONT_SIZE}px`,
          }}
          className="overflow-x-auto whitespace-pre rounded-[10px] px-3.5 py-3 leading-[1.6]"
        >
          {PREVIEW_LINE}
        </div>
      </Row>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-[64px] shrink-0 pt-[7px] text-[13px] text-tertiary">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// 규격은 WorkPanel의 탭 버튼과 같다 — 켜짐은 toggle-on, 꺼짐의 hover는 quiet-hover를
// **꺼진 가지 안에만** 둔다(둘이 한 요소에 겹치면 hover 규칙이 두 벌이 되어 정렬 순서가
// 승자를 정한다 — index.css).
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // 색만으로는 어느 쪽이 켜졌는지 접근성 트리에 드러나지 않는다.
      aria-pressed={active}
      className={cn(
        "h-[26px] rounded-[9px] px-[10px] text-[13px] font-medium transition-colors",
        active ? "toggle-on" : "text-tertiary quiet-hover",
      )}
    >
      {label}
    </button>
  );
}

export default SettingsPage;

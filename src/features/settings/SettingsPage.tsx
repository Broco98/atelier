import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import PageHeader from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FONT_FAMILY, FONT_SIZE, MONO_FACE } from "@/features/terminal/terminal-defaults";
import { applyTerminalSettings } from "@/features/terminal/terminal-settings";
import { applyNotifySettings } from "@/features/terminal/notify-settings";
import { terminalThemeFor } from "@/features/terminal/terminal-theme";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { hooksApi, settingsApi } from "./api";
import { notificationChoice, patchNotifications } from "./notifications";
import { settingsItem, type SettingsItemKey } from "./pages";
import { saveSettingsSection, type SettingsSectionKey } from "./save-section";
import type {
  HookStatus,
  NotificationSettings,
  Settings,
  TerminalSettings,
  TerminalTheme,
} from "./types";

// 앱 전역 설정 화면 (결정 51·52·54). 항목은 `터미널` · `알림` · `에이전트 훅` 셋이고, 항목 하나가
// 주소 하나인 페이지다(UI개선 결정 22 · `pages.ts`) — 조각(`…SettingsPage` · `AgentHooksPage`, #225)이
// 한 페이지에 하나씩 서고 초안과 저장은 조각마다 따로 산다. 터미널 설정과 알림 설정이 각자 저장
// 버튼을 갖고, 에이전트 훅은 누르면 바로 적용된다.
//
// **값은 `~/.atelier/settings.json` 한 장에 산다**(결정 53 · adr-02) — `localStorage`가
// 아니다. 창구는 `api.ts`의 둘뿐이고, 초안은 **읽은 것을 펼쳐 고친다**(`patchTerminal`).
// 저장은 화면을 열 때의 사본이 아니라 **쓰는 순간의 최신에 자기 칸만 덮는다**(`save-section.ts`) —
// 옛 사본에서 나머지 칸을 가져오면 그사이 다른 구획이 저장한 값을 덮는다.
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

/**
 * 「기본」 칩의 칸 값. 글꼴 값으로는 `null`(고르지 않음)인데 칸 값은 글자여야 해서 따로 둔다 —
 * 칸 값을 읽는 자리는 `fontChipsOf`와 그 반대 방향인 칩 줄의 `onValueChange` 둘뿐이다.
 */
const DEFAULT_FONT_CHIP = "default";
type FontChip = typeof DEFAULT_FONT_CHIP | (typeof FONT_PRESETS)[number];

/**
 * 글꼴 값에서 켜질 칩. **프리셋 밖의 이름이면 아무것도 안 켜진다**(`[]`) — 칸에 적은 이름이 값이고
 * 칩은 지름길이라, 그때 그룹 값이 빈 것이 정상 상태다(S16).
 */
function fontChipsOf(fontFamily: string | null): FontChip[] {
  if (fontFamily === null) return [DEFAULT_FONT_CHIP];
  const preset = FONT_PRESETS.find((one) => one === fontFamily);
  return preset === undefined ? [] : [preset];
}

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
 * **터미널 설정의** 저장을 열어 둘 조건. 셋 다 이유가 다르다.
 *
 * - 고친 것이 없으면 파일을 건드릴 이유가 없다.
 * - **이미 쓰는 중이면 막는다.** `settings.rs`가 tmp 이름을 고정해 두고(`.settings.json.tmp`)
 *   「쓰기는 한 번에 하나」를 전제로 적었다 — 겹치면 한쪽의 rename이 다른 쪽이 아직 쓰는 중인
 *   tmp를 옮긴다. 저장 버튼이 구획마다 생긴 뒤로 **구획 사이의** 줄 세우기는
 *   `saveSettingsSection`이 지고(`save-section.ts`), 이 칸은 한 구획 안의 연타를 막는다.
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

/**
 * 설정 항목마다 본문에 서는 조각. **항목 표(`SETTINGS_ITEMS`)의 key 전부를 받는 `Record`다** — 항목을
 * 하나 더하고 본문을 잊으면 사이드바에 항목만 서고 본문이 비는데, 이 모양이면 그 자리에서 L0가
 * 빨개진다.
 */
const ITEM_BODIES: Record<SettingsItemKey, () => ReactNode> = {
  terminal: () => (
    <SettingsFileGate>{(settings) => <TerminalSettingsPage initial={settings} />}</SettingsFileGate>
  ),
  notifications: () => (
    <SettingsFileGate>
      {(settings) => <NotificationSettingsPage initial={settings} />}
    </SettingsFileGate>
  ),
  // **읽기 실패의 게이트가 없다.** 이 항목이 고치는 것은 `~/.atelier/settings.json`이 아니라
  // 사용자의 claude·codex 설정이라, 우리 파일이 깨져 있다고 훅을 못 깔 이유가 없다.
  hooks: () => <AgentHooksPage />,
};

/**
 * 설정 항목 하나의 화면(UI개선 결정 22). 머리는 `Settings / 터미널`이고 본문은 그 항목 하나다.
 *
 * **초안은 항목 페이지 안에 산다**(결정 26) — 항목을 옮기면 주소가 바뀌어 페이지가 내려가고,
 * 저장 안 한 편집이 함께 버려진다. 경고하지 않는다: 설정 화면을 떠날 때 이미 그랬고, 같은 규칙이
 * 항목 경계에도 걸리는 것이다.
 */
function SettingsPage({ sidebarOpen, item }: { sidebarOpen: boolean; item: SettingsItemKey }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root="Settings" leaf={settingsItem(item).label} inset={!sidebarOpen} />
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 scroll-quiet">
          <div className="flex max-w-[620px] flex-col gap-6">
            {/* **제목은 머리가 보여 주고, 제목 역할은 이 줄이 진다.** 한 화면에 구획이 셋이던 때는
                구획마다 보이는 머리가 있었는데, 항목이 페이지가 되면서 머리 바로 밑에 같은 낱말이
                한 번 더 섰다. 다만 `PageHeader`는 제목 역할이 없는 글자라, 이것마저 지우면 페이지에
                제목이 하나도 없다. 글자는 머리와 같은 표(`SETTINGS_ITEMS`)에서 읽는다. */}
            <h2 className="sr-only">{settingsItem(item).label}</h2>
            {/* **항목이 곧 key다.** 두 항목의 본문이 같은 게이트로 시작해, key가 없으면 React가
                항목을 옮길 때 게이트를 이어 써 옛 사본을 들고 파일을 다시 안 읽을 수 있다 —
                항목마다 새로 서야 초안도 사본도 따라오지 않는다(위 결정 26). */}
            <Fragment key={item}>{ITEM_BODIES[item]()}</Fragment>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * 앱 설정 파일을 **한 번 읽고**, 읽은 것을 조각에게 내린다. 읽기가 실패하면 조각을 안 세우고
 * 까닭과 「다시 읽기」를 그린다.
 *
 * 항목 페이지마다 제 게이트를 둔다(한 화면에 조각이 하나다). 조각이 받는 것은 **화면을 열 때의
 * 사본**일 뿐이고, 저장은 그 사본이 아니라 쓰는 순간의 최신을 딛는다(`save-section.ts`) — 그래서
 * 알림 설정을 저장하고 터미널 설정으로 옮겨 온 페이지가 새로 읽은 사본을 들어도, 옛 사본을 들어도 덮어쓰기가 없다.
 */
function SettingsFileGate({
  children,
}: {
  children: (settings: Settings) => React.ReactNode;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  // 다시 읽기 — 깨진 파일은 손으로 고치는 것이 정상 경로라(결정 53) 앱을 껐다 켜지 않고
  // 그 자리에서 다시 읽을 길이 있어야 한다.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setReadError(null);
    settingsApi.read().then(
      (read) => {
        if (alive) setSettings(read);
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

  if (readError !== null) {
    return (
      <div className="flex flex-col items-start gap-3 pt-2">
        <p className="text-[13.5px] leading-[1.7] text-red-600">{readError}</p>
        <p className="text-[13px] leading-[1.7] text-tertiary">
          파일을 손으로 고친 뒤 다시 읽어 주세요. 고칠 때까지 이 화면은 아무것도 저장하지 않아요.
        </p>
        <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          다시 읽기
        </Button>
      </div>
    );
  }
  return settings === null ? null : <>{children(settings)}</>;
}

/**
 * 저장 버튼을 가진 페이지 하나의 **초안 → 저장**(#225). 터미널 설정과 알림 설정이 같은 규칙을
 * 지나야 해서 한 자리에 둔다 — 두 벌로 적으면 한쪽만 「먹이기 전에 파일부터」를 잃는다.
 *
 * **초안이 제 구획의 칸 하나다**(`Settings[K]`). 설정 통째를 초안으로 들면 화면을 열 때의 다른
 * 구획 사본이 함께 실려 다니고, 그것을 저장에 넘기는 실수 한 번이면 옛 값이 나간다 — 모양이
 * 그 실수를 못 하게 한다.
 *
 * 「파일과 같다고 아는 값」(`saved`)은 **쓴 결과에서** 가져온다 — `saveSettingsSection`이 돌려준
 * 그 설정이 셸에도 먹는 값이라, 두 자리가 한 출처를 딛는다.
 */
function useSectionSave<K extends SettingsSectionKey>(
  key: K,
  initial: Settings[K],
  apply: (written: Settings) => void,
) {
  const [saved, setSaved] = useState<Settings[K]>(initial);
  const [draft, setDraft] = useState<Settings[K]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 키 순서는 읽은 것을 펼쳐 만들었으므로 그대로다 — 문자열 비교로 충분하다.
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const edit = (update: (current: Settings[K]) => Settings[K]) => {
    setDraft(update);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const written = await saveSettingsSection(key, draft);
      setSaved(written[key]);
      // **파일에 들어간 뒤에 먹인다.** 먼저 먹이면 쓰기가 실패했을 때 셸만 새 값으로 남아
      // 다음 실행에 되돌아간다 — 「저장이 안 됐는데 바뀌었다」가 가장 읽기 어려운 상태다.
      apply(written);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setSaving(false);
    }
  };

  /** 저장 버튼에 내릴 것. 열어 둘 조건(`enabled`)은 페이지마다 달라 부르는 쪽이 정한다. */
  const button = (enabled: boolean) => ({
    enabled,
    saving,
    error,
    onSave: () => {
      if (enabled) void save();
    },
  });

  return { saved, draft, dirty, saving, edit, button };
}

/**
 * 「터미널 설정」 페이지 조각 — 구획 + 제 저장 버튼. **초안을 제가 든다**(#225): 알림 설정과
 * 초안을 함께 들면 알림을 저장할 때 고치다 만 터미널 값이 따라 나간다. 이 조각은
 * `/settings/terminal` 페이지 하나에 선다.
 */
function TerminalSettingsPage({ initial }: { initial: Settings }) {
  const section = useSectionSave("terminal", initial.terminal, (written) =>
    applyTerminalSettings(written.terminal),
  );
  // 크기만 원문을 따로 든다. 숫자로만 들면 「15」를 지우는 중인 한 글자(`1`)가 곧 크기가 되고,
  // 잘못 적힌 글자를 화면에 그대로 둘 수가 없다.
  const [sizeText, setSizeText] = useState(initial.terminal.fontSize?.toString() ?? "");

  // 파일이 준 크기의 원문. 칸의 글자가 이것과 같은 동안에는 그 값이 범위 밖이어도 저장을
  // 잠그지 않는다(`canSave`) — 읽을 때 그대로 넣은 값이라 `sizeText`와 같은 규칙으로 만든다.
  const savedSizeText = section.saved.fontSize?.toString() ?? "";
  const enabled = canSave({
    dirty: section.dirty,
    sizeText,
    savedSizeText,
    saving: section.saving,
  });

  // 구획 그림(`TerminalSection`)과 고치는 규칙(`patchTerminal`)은 `Settings`를 받는다. 그 모양에
  // 맞춰 **그리고 고칠 때만** 감싼다 — 다른 칸은 저장에 안 닿는다(초안이 `terminal` 하나다).
  const view: Settings = { ...initial, terminal: section.draft };

  const change = (patch: Partial<TerminalSettings>) =>
    section.edit((current) => patchTerminal({ ...initial, terminal: current }, patch).terminal);

  const changeSize = (raw: string) => {
    setSizeText(raw);
    const size = parseFontSize(raw);
    // 잘못 적힌 동안에는 저장할 값을 건드리지 않는다 — 저장은 `canSave`가 잠가 둔다.
    if (size !== "invalid") change({ fontSize: size });
  };

  return (
    <div role="group" aria-label="터미널 설정" className="flex flex-col gap-6">
      <TerminalSection
        settings={view}
        sizeText={sizeText}
        onChange={change}
        onChangeSize={changeSize}
      />
      <SaveButton {...section.button(enabled)} />
    </div>
  );
}

/**
 * 「알림 설정」 페이지 조각 — 구획 + 제 저장 버튼. 초안을 제가 드는 이유는
 * `TerminalSettingsPage`와 같다.
 *
 * 저장 조건이 터미널보다 짧다 — 잘못 적힐 수 있는 자유 입력 칸이 없어 「고친 것이 있고 쓰는
 * 중이 아니다」가 전부다.
 */
function NotificationSettingsPage({ initial }: { initial: Settings }) {
  const section = useSectionSave("notifications", initial.notifications, (written) =>
    applyNotifySettings(notificationChoice(written)),
  );
  // OS가 알림 권한을 줬나(스토리 69). **아직 못 물어봤으면 `null`이고 그때는 아무 말도 안
  // 한다** — 모르는 것을 「거부됐다」로 적으면 앱이 없는 사실을 만든다. 물어보는 것이 이
  // 조각인 이유는 사람이 「왜 안 울리지」를 들고 오는 자리가 여기라서다.
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    isPermissionGranted().then(
      (ok) => {
        if (alive) setGranted(ok);
      },
      // **못 물어본 것과 거부된 것은 다르다.** 채널이 없는 자리(웹뷰 밖)에서 여기가 실제로
      // 터지는데, 그것을 「거부됐다」로 적으면 시스템 설정을 열라는 말이 거짓이 된다.
      () => {
        if (alive) setGranted(null);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const enabled = section.dirty && !section.saving;

  // 터미널 설정과 같은 까닭으로 그리고 고칠 때만 감싼다. 알림 스위치도 같은 규칙을 지난다 — 읽은
  // 것을 펼쳐 고친다(`patchNotifications`).
  const view: Settings = { ...initial, notifications: section.draft };

  const change = (patch: Partial<NotificationSettings>) =>
    section.edit(
      (current) => patchNotifications({ ...initial, notifications: current }, patch).notifications,
    );

  return (
    <div role="group" aria-label="알림 설정" className="flex flex-col gap-6">
      <NotificationSection settings={view} granted={granted} onChange={change} />
      <SaveButton {...section.button(enabled)} />
    </div>
  );
}

/**
 * 「에이전트 훅」 조각. **저장 버튼을 안 지난다** — 이 둘은 우리 파일이 아니라 사용자의
 * claude·codex 설정을 고치는 일이라 「고치고 나중에 저장」이라는 초안이 있을 수 없다.
 */
function AgentHooksPage() {
  const [hooks, setHooks] = useState<HookStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    hooksApi.status().then(
      (list) => {
        if (alive) setHooks(list);
      },
      // **판정이 통째로 실패하는 길**(홈을 못 읽는 등)과 파일 한 장이 깨진 것은 다르다 —
      // 뒤엣것은 `HookStatus.error`로 그 줄에 붙어 오고, 여기 오는 것은 앞엣것뿐이다.
      (failure) => {
        if (alive) setError(String(failure));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // 넣는 것도 걷는 것도 **끝난 뒤의 상태를 그 자리에서 돌려받는다** — 다시 물어보지 않는다.
  // 연타를 막는 것은 같은 파일에 두 쓰기가 겹치면 안 되기 때문이다.
  const run = async (action: () => Promise<HookStatus[]>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setHooks(await action());
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <HooksSection
      statuses={hooks}
      busy={busy}
      error={error}
      onInstall={() => void run(hooksApi.install)}
      onUninstall={() => void run(hooksApi.uninstall)}
    />
  );
}

/** 구획 하나의 저장 버튼과 그 저장이 실패한 까닭. */
function SaveButton({
  enabled,
  saving,
  error,
  onSave,
}: {
  enabled: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {/* 주 버튼(Button의 기본) — 프로젝트 빈 화면의 「프로젝트 등록」과 한 규격이다. */}
      <Button onClick={onSave} disabled={!enabled}>
        {saving ? "저장 중…" : "저장"}
      </Button>
      {error !== null && <span className="text-[13px] text-red-600">{error}</span>}
    </div>
  );
}

/**
 * `터미널` 구획 — 글꼴 · 크기 · 테마 · 미리보기 네 줄이다(결정 52·54).
 *
 * **스크롤백도 ANSI 16색 편집도 없다.** 결정 52가 둘 다 명시적으로 뺐다 — 스크롤백은 모양이
 * 아니라 메모리 값이고(셸 8개 × 10,000줄), 색 편집기는 별건이다.
 *
 * 값을 들지 않는다 — 조각(`TerminalSettingsPage`)이 들고 이쪽은 그리기만 한다. 마크업 테스트가 클릭을 못 걸어
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
  const sizeHintId = useId();

  return (
    <section className="flex flex-col gap-5 pt-2">
      {/* 글꼴 — 프리셋은 지름길일 뿐이고 **값은 아래 칸 하나가 든다.** 둘을 따로 들면
          「프리셋을 골랐는데 칸에는 옛 이름이 남은」 상태가 생기고, 그때 무엇이 저장되는지
          화면에서 읽을 수 없다. 비우면 「고르지 않음」이다(크기 칸과 같은 규칙). */}
      <Row label="글꼴">
        <div className="flex flex-col gap-2">
          <ToggleGroup
            size="chip"
            aria-label="글꼴 프리셋"
            value={fontChipsOf(fontFamily)}
            // 켜진 칩을 다시 눌러 끄는 것은 뜻이 없다 — 부품이 그 누름을 없던 일로 한다(S16). 「고르지 않음」은
            // 「기본」 칩이 말한다.
            deselectable={false}
            onValueChange={([pick]) =>
              onChange({ fontFamily: pick === DEFAULT_FONT_CHIP ? null : pick })
            }
          >
            <ToggleGroupItem value={DEFAULT_FONT_CHIP}>기본</ToggleGroupItem>
            {FONT_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset} value={preset}>
                {preset}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Field orientation="horizontal">
            <Input
              variant="field"
              className="w-[280px]"
              aria-label="터미널 글꼴"
              value={fontFamily ?? ""}
              placeholder="기본"
              onChange={(e) =>
                onChange({ fontFamily: e.target.value.trim() === "" ? null : e.target.value })
              }
            />
          </Field>
        </div>
      </Row>

      {/* 크기 — `type="number"`가 아니다. 스피너가 이 앱에 없는 어휘이고, 무엇이 잘못
          적혔는지는 `parseFontSize` 하나가 정해야 한다(브라우저마다 다른 강제 보정에
          맡기지 않는다).

          파일이 준 범위 밖 값에도 테두리는 빨갛다 — 「이 화면이 만들 수 있는 범위 밖」은
          출처와 무관한 사실이다. 그것이 저장까지 잠그느냐는 다른 질문이고 `canSave`가
          따로 답한다.

          틀린 값은 **칸이 말한다** — 빨간 테두리와 스크린리더의 「잘못된 값」이 한 속성(`aria-invalid`)에서
          나온다(스토리 107). 행 전체를 빨갛게 하는 Field의 `data-invalid`는 쓰지 않는다(지금 모양). 안내는
          칸의 설명이다 — registry Field가 저절로 잇지 않아 여기서 id로 잇는다. */}
      <Row label="크기">
        <Field orientation="horizontal">
          <Input
            variant="field"
            className="w-[72px]"
            aria-label="터미널 글꼴 크기"
            aria-describedby={sizeHintId}
            aria-invalid={parseFontSize(sizeText) === "invalid"}
            inputMode="numeric"
            value={sizeText}
            placeholder="기본"
            onChange={(e) => onChangeSize(e.target.value)}
          />
          <FieldDescription id={sizeHintId}>
            px · {FONT_SIZE_MIN}–{FONT_SIZE_MAX}
          </FieldDescription>
        </Field>
      </Row>

      {/* 테마 — 두 벌뿐이다(결정 54). 기본은 어둡게이고 그 기본은 백엔드가 정해 온다
          (`settings.rs`의 `TerminalTheme::default`), 그래서 이 칸에는 「고르지 않음」이 없다 —
          켜진 칩을 다시 눌러 값을 비우지 못한다(S16 — 부품의 `deselectable={false}`). 둘 중 하나가 늘 켜져 있다. */}
      <Row label="테마">
        <ToggleGroup
          size="chip"
          aria-label="테마"
          value={[theme]}
          deselectable={false}
          onValueChange={([pick]) => onChange({ theme: pick })}
        >
          {(["light", "dark"] as const).map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {THEME_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
          className="overflow-x-auto whitespace-pre rounded-[10px] px-3.5 py-3 leading-[1.6] scroll-quiet"
        >
          {PREVIEW_LINE}
        </div>
      </Row>
    </section>
  );
}

/**
 * `알림` 구획 — **고르는 것이 둘뿐이다**(결정 10 · 스토리 67). 「배경일 때만」 같은 셋째
 * 선택은 기각됐다: 이 앱은 창이 하나이고 「그 셸을 보고 있는가」가 이미 억제를 맡고 있어
 * (결정 7) 셋째 단이 더할 것이 없다.
 *
 * **권한이 거부돼 있으면 그 사실을 여기 적는다**(스토리 69). 인앱 토스트로 대체하지
 * 않는다 — 거부는 앱이 고칠 수 없는 상태라 「지금 벌어진 일」이 아니라 **설정의 사실**이고,
 * 사람이 왜 안 울리는지 찾으러 오는 자리가 여기다. 아직 못 물어봤으면(`null`) 아무 말도
 * 안 한다: 모르는 것을 「거부됐다」로 적으면 앱이 없는 사실을 만든다.
 *
 * **다만 이 줄은 지금 채널로는 설 수 없다 — 「거의 없다」가 아니라 길이 없다.** 알림
 * 플러그인의 데스크톱 구현은 `permission_state()`가 **늘 `Granted`를 돌려주고**
 * (2.4.0 `desktop.rs`), 플러그인이 웹뷰에 까는 init 스크립트가 뜨자마자 그 답으로
 * `window.Notification.permission`을 `granted`로 굳힌다. JS `isPermissionGranted()`는 그
 * 값을 먼저 보므로 **실물에서 `granted === false`가 되는 길이 없다** — macOS 시스템 설정에서
 * 아틀리에의 알림을 꺼 둬도 앱은 그것을 못 읽는다. 그래서 스토리 69는 이 판에서 **반쪽만
 * 선다**: 구현-스펙의 미확인 목록에 그대로 올려 뒀고, 채우려면 다른 길(자체 Rust 명령이
 * `UNUserNotificationCenter`를 묻는 것)이 필요하다.
 *
 * 그래도 이 줄을 두는 것은 판정이 **진짜 API를 딛고 있어서다**: 그 길이 생기는 날 화면이
 * 저절로 따라온다. 여기서 「거부됐을 것 같다」를 우리가 지어내지는 않는다(결정 3의 그 규칙).
 *
 * 값을 들지 않는다 — 조각(`…Page`)이 들고 이쪽은 그리기만 한다(`TerminalSection`과 같은 이유).
 */
export function NotificationSection({
  settings,
  granted,
  onChange,
}: {
  settings: Settings;
  /** OS가 알림 권한을 줬나. 아직 못 물어봤으면 `null`이다. */
  granted: boolean | null;
  onChange: (patch: Partial<NotificationSettings>) => void;
}) {
  const choice = notificationChoice(settings);

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Row label="알림">
        <div className="flex flex-col gap-2">
          <LabeledSwitch
            label="셸이 나를 부르면 알림"
            checked={choice.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
          {granted === false && (
            // 규격은 이 화면의 오류 문구와 같은 가족이되 빨강이 아니다 — 앱이 실패한 것이
            // 아니라 OS가 안 준 것이라, 사람이 갈 곳을 적는 것이 이 줄이 하는 일 전부다.
            <p className="text-[13px] leading-[1.7] text-tertiary">
              macOS가 알림 권한을 안 줬어요. 시스템 설정 › 알림에서 아틀리에를 켜 주세요.
            </p>
          )}
        </div>
      </Row>

      {/* 소리만 따로 끌 수 있다(스토리 64) — 소리는 시스템 기본 알림음이다. */}
      <Row label="소리">
        <LabeledSwitch
          label="알림에 소리"
          checked={choice.sound}
          onCheckedChange={(sound) => onChange({ sound })}
        />
      </Row>
    </section>
  );
}

/**
 * 훅이 지금 어떤가를 **한 낱말로**. 셋이고, 셋째가 이 함수가 있는 이유다.
 *
 * `installed`만 보면 「깨져서 판정을 못 했다」가 「안 깔렸다」와 같은 낱말이 된다. 백엔드는
 * 그때 판정을 안 하고 `installed: false`에 까닭을 함께 실어 보내는데(`hooks.rs`의 `look`),
 * 화면이 그 둘을 한 낱말로 접으면 **없는 사실을 만들고** 사람을 실패하는 버튼으로 보낸다.
 */
export function hookStateLabel(status: HookStatus): string {
  if (status.error !== null) return "확인 못 함";
  return status.installed ? "설치됨" : "설치 안 됨";
}

/**
 * `에이전트 훅` 구획 — 에이전트마다 상태·경로·미리보기, 그리고 버튼 둘 (스토리 70~74).
 *
 * **미리보기가 필수다**(스토리 73). 내 설정을 앱에 맡기는 일이라 누르기 전에 무엇이 어디에
 * 들어가는지 보여야 하고, 그 글자는 화면이 따로 적는 것이 아니라 **실제로 넣는 함수가 낸
 * 값**이다(`hooks.rs`의 `preview`) — 두 벌로 적으면 약속이 실물과 조용히 갈린다.
 *
 * 값을 들지 않는다 — 조각(`…Page`)이 들고 이쪽은 그리기만 한다(`TerminalSection`과 같은 이유).
 */
export function HooksSection({
  statuses,
  busy,
  error,
  onInstall,
  onUninstall,
}: {
  statuses: HookStatus[];
  /** 넣거나 걷는 중인가. 연타를 막는다 — 같은 파일에 두 쓰기가 겹치면 안 된다. */
  busy: boolean;
  /** 명령 자체가 실패했으면 그 까닭(스크립트를 못 세운 경우). */
  error: string | null;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <section className="flex flex-col gap-5 pt-2">
      {/* **다른 구획의 저장 버튼과 별개다** — 고치는 것이 우리 파일이 아니라 사용자의 claude·codex
          설정이라 초안이라는 것이 없다. 되돌릴 벌을 뜬다는 것도 여기서 말한다: 누르기
          전에 알아야 마음이 놓인다. */}
      <p className="text-[13px] leading-[1.7] text-tertiary">
        누른 순간 아래 파일에 적용돼요(저장 버튼과 별개예요). 고치기 전에 같은 자리에{" "}
        <code>.bak</code> 한 벌을 떠 두고, 다른 도구의 훅은 그대로 둬요.{" "}
        {/* **아래 글자가 「더해지는 것」임을 말한다.** claude 쪽 미리보기는 설정이 비어
            있을 때의 결과 파일이라, 이 줄이 없으면 예순 줄짜리 설정을 가진 사람에게는
            「내 파일이 이걸로 바뀐다」로 읽힌다 — 이 구획이 없애려던 그 불안이다. */}
        아래는 <strong className="font-medium">더해지는 부분</strong>이에요 — 이미 있는
        내용은 그대로 두고 여기에만 얹어요.
      </p>

      {statuses.map((status) => (
        <Row key={status.agent} label={status.agent}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              {/* 색만으로는 상태가 안 읽힌다 — 낱말이 곧 상태다. */}
              <span className="text-[13px] font-medium">{hookStateLabel(status)}</span>
              <span className="text-[13px] text-tertiary">{status.path}</span>
            </div>
            {status.error !== null && (
              <p className="text-[13px] leading-[1.7] text-red-600">{status.error}</p>
            )}
            {/* **판정과 다른 줄이다.** 쓰기가 실패해도 설치 여부는 파일이 답해 주므로 위
                낱말은 그대로 서고, 방금 무슨 일이 났는지만 여기 적힌다. 다만 파일이 깨진
                경우엔 쓰기도 판정도 같은 까닭으로 실패하므로, 같은 글이면 한 번만 적는다 —
                두 줄이면 사람은 두 가지 일이 났다고 읽는다. */}
            {status.writeError !== null && status.writeError !== status.error && (
              <p className="text-[13px] leading-[1.7] text-red-600">{status.writeError}</p>
            )}
            {/* 무엇이 어디에 들어가는가 — 넣는 함수가 낸 글자 그대로다(스토리 73). */}
            <pre className="max-h-[168px] overflow-auto rounded-[10px] bg-muted px-3 py-2.5 text-[12px] leading-[1.6] scroll-quiet">
              {status.preview}
            </pre>
          </div>
        </Row>
      ))}

      <Row label="">
        <div className="flex items-center gap-3">
          {/* 규격은 이 화면의 「다시 읽기」와 같은 쪽 동작 버튼이다 — 저장 버튼(주 버튼)은 터미널
              설정·알림 설정에만 있고, 이 둘은 그 자리를 안 지나는 별개의 쓰기다. */}
          <Button variant="ghost" size="sm" onClick={onInstall} disabled={busy}>
            설치
          </Button>
          <Button variant="ghost" size="sm" onClick={onUninstall} disabled={busy}>
            제거
          </Button>
          {error !== null && <span className="text-[13px] text-red-600">{error}</span>}
        </div>
      </Row>
    </section>
  );
}

/**
 * 켬/끔 하나 — 스위치와 그 이름(결정 12). 참·거짓 하나를 칩 둘로 나누면 어느 쪽이 켜졌는지를 색으로
 * 읽어야 하는데, 스위치는 모양으로 말한다. 스크린리더는 이름과 켬/끔(`role="switch"`·`aria-checked`,
 * Base UI가 단다)을 말한다.
 *
 * **이름은 옆 글자다.** 스위치를 `<label>`로 감싸면 Base UI가 숨은 체크박스의 부모 label을 찾아
 * `aria-labelledby`로 잇는다 — 보이는 글자와 읽히는 이름이 한 벌이고, 글자를 눌러도 켜고 끈다.
 */
function LabeledSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    // 26px 줄 가운데에 세운다 — 왼쪽 행 라벨(`Row`의 pt-[7px])이 그 높이의 줄에 맞춰져 있다(테마·글꼴 칩 줄).
    <label className="flex h-[26px] w-fit items-center gap-2 text-[13px] select-none">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      {label}
    </label>
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

export default SettingsPage;

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sectionSaver } from "./save-section";
import type { NotificationSettings, Settings, TerminalSettings } from "./types";

// 구획 저장이 지켜야 하는 것은 화면으로는 안 잡힌다 — **덮어쓰기는 조용하다.** 알림을 끄고
// 저장한 뒤 터미널 글꼴을 저장하면 알림이 다시 켜져 있어도, 화면은 둘 다 「저장됨」을 그린다.
// 다음에 앱을 켤 때에야 울린다.
//
// 그래서 `invoke`를 흉내 낸다: 파일 한 장을 메모리에 두고 읽기·쓰기가 그것을 오간다.
// 렌더 없이 모듈 함수만 돈다(구획 저장이 컴포넌트 밖에 있는 이유).

/** 설정 파일 한 장. `read`는 **지금** 파일에 있는 것을 돌려준다 — 쓰기가 끝난 값이다. */
function fakeFile(initial: unknown) {
  let text = JSON.stringify(initial);
  const writes: unknown[] = [];
  return {
    read: async () => JSON.parse(text) as Settings,
    write: async (settings: Settings) => {
      // 와이어를 한 번 지난다 — 제자리에서 고친 객체가 파일로 새어 들어가는 것을 막는다.
      text = JSON.stringify(settings);
      writes.push(JSON.parse(text));
    },
    // 모르는 최상위 키(`editor`)도 실려 온다 — 파일 한 장을 그대로 편 것이다.
    now: () => JSON.parse(text) as Settings & { editor?: unknown },
    writes,
  };
}

// 화면을 열 때 읽은 사본 — 두 구획이 **같은 옛 사본**을 들고 시작한다.
const terminal: TerminalSettings = { fontFamily: null, fontSize: null, theme: "dark" };
const notifications: NotificationSettings = { enabled: true };
const opened = {
  terminal,
  notifications,
  // 우리가 모르는 최상위 키. 사람이 손으로 적은 줄이다(결정 53).
  editor: { tabWidth: 2 },
};

describe("구획 저장은 최신 설정에 자기 칸만 덮는다", () => {
  it("알림을 저장한 뒤 옛 사본을 든 터미널 저장이 알림을 되돌리지 않는다", async () => {
    const file = fakeFile(opened);
    const save = sectionSaver(file.read, file.write);

    await save("notifications", { enabled: false, sound: false });
    await save("terminal", { ...opened.terminal, fontSize: 16 });

    expect(file.now().notifications, "알림 값이 옛 사본으로 되돌아갔다").toEqual({
      enabled: false,
      sound: false,
    });
    expect(file.now().terminal.fontSize).toBe(16);
  });

  it("터미널을 저장한 뒤 옛 사본을 든 알림 저장이 터미널을 되돌리지 않는다", async () => {
    const file = fakeFile(opened);
    const save = sectionSaver(file.read, file.write);

    await save("terminal", { ...opened.terminal, theme: "light" });
    await save("notifications", { ...opened.notifications, sound: false });

    expect(file.now().terminal.theme, "터미널 값이 되돌아갔다").toBe("light");
    expect(file.now().notifications).toEqual({ enabled: true, sound: false });
  });

  it("파일에 있던 모르는 최상위 키가 두 저장 뒤에도 남는다", async () => {
    const file = fakeFile(opened);
    const save = sectionSaver(file.read, file.write);

    await save("terminal", { ...opened.terminal, fontSize: 14 });
    await save("notifications", { enabled: false });

    expect(file.now().editor, "모르는 키가 사라졌다").toEqual({ tabWidth: 2 });
    // 쓰기마다 남아 있어야 한다 — 마지막 파일만 보면 중간에 사라졌다 되살아난 것을 못 본다.
    for (const written of file.writes) {
      expect((written as Record<string, unknown>).editor).toEqual({ tabWidth: 2 });
    }
  });

  // **돌려주는 값이 먹일 값이다.** 부르는 쪽이 그것으로 셸에 먹이므로, 파일에 들어간 것과
  // 다른 객체를 돌려주면 「저장된 것과 먹은 것」이 갈린다.
  it("쓴 그대로를 돌려준다", async () => {
    const file = fakeFile(opened);
    const save = sectionSaver(file.read, file.write);

    const written = await save("notifications", { sound: false });
    expect(written).toEqual(file.now());
  });

  // 두 구획이 거의 동시에 저장하면 **둘 다 최신을 읽은 뒤 쓰기가 겹친다** — 뒤에 쓴 쪽이 앞의
  // 값을 옛 사본으로 덮는다. 그리고 `settings.rs`는 tmp 이름을 고정해 「쓰기는 한 번에 하나」를
  // 전제로 적었다. 둘 다 이 함수가 줄을 세워 닫는다.
  it("겹친 두 저장이 서로의 값을 안 지운다", async () => {
    const file = fakeFile(opened);
    let active = 0;
    let overlapped = false;
    const slowWrite = async (settings: Settings) => {
      active += 1;
      if (active > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await file.write(settings);
      active -= 1;
    };
    const save = sectionSaver(file.read, slowWrite);

    await Promise.all([
      save("terminal", { ...opened.terminal, fontSize: 18 }),
      save("notifications", { enabled: false }),
    ]);

    expect(overlapped, "쓰기가 겹쳤다").toBe(false);
    expect(file.now().terminal.fontSize).toBe(18);
    expect(file.now().notifications).toEqual({ enabled: false });
  });

  // 한 번 실패해도 줄이 막히면 안 된다 — 다음 저장이 영영 안 나가면 화면은 「저장 중…」에 선다.
  it("앞 저장이 실패해도 다음 저장은 나간다", async () => {
    const file = fakeFile(opened);
    let fail = true;
    const flakyWrite = async (settings: Settings) => {
      if (fail) {
        fail = false;
        throw new Error("쓰지 못했습니다");
      }
      await file.write(settings);
    };
    const save = sectionSaver(file.read, flakyWrite);

    await expect(save("notifications", { enabled: false })).rejects.toThrow("쓰지 못했습니다");
    await save("notifications", { sound: false });
    expect(file.now().notifications).toEqual({ sound: false });
  });
});

// **줄은 하나일 때만 줄이다.** 위 「겹친 두 저장」은 `sectionSaver`가 만든 `save` 하나 안에서만
// 참이고, 페이지가 제 `sectionSaver(...)`를 따로 만들거나 `settingsApi.write`를 곧장 부르면 줄이
// 둘이 된다 — 그래도 L2는 위 검사가 로컬 인스턴스를 돌아 초록이고, L3 고정 백엔드는 쓰기를
// 기억하지 않아 겹침을 못 본다. 그래서 **그 길을 여는 문자열이 어느 파일에 있나**를 센다
// (13이 설정을 항목별 페이지로 가를 때 가장 쉽게 새는 자리다).
//
// 파싱하지 않는다 — 파일 전체에서 문자열을 세고, 나온 파일의 목록이 허용 목록과 **정확히
// 같은지**를 본다. 「적어도 여기 있다」가 아니라 「여기뿐이다」라서, 이름이 바뀌어 스캔이 통째로
// 헛돌면 그것도 여기서 터진다(fail-closed).
describe("설정 파일을 쓰는 길은 `saveSettingsSection` 하나다", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => file.split("\\").join("/"));
  const filesWith = (needle: string) =>
    sources.filter((file) => readFileSync(root + file, "utf8").includes(needle)).sort();

  it.each([
    // 커맨드 이름은 창구 한 곳에만 적힌다.
    ["\"write_settings\"", ["features/settings/api.ts"]],
    // 창구의 쓰기를 부르는 곳은 공유 저장을 만드는 한 줄뿐이다.
    ["settingsApi.write", ["features/settings/save-section.ts"]],
    // 줄을 새로 만드는 곳도 그 한 줄뿐이다 — 정의가 같은 파일에 있다.
    ["sectionSaver(", ["features/settings/save-section.ts"]],
  ])("%s", (needle, allowed) => {
    expect(filesWith(needle)).toEqual(allowed);
  });
});

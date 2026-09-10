import { describe, expect, it } from "vitest";
import {
  COALESCE_MS,
  createNotifier,
  decideNotification,
  MAC_DEFAULT_SOUND,
  notificationPayload,
  notifyShells,
  outgoing,
} from "./shell-notify";
import type { NotifyContent, NotifyInput, NotifyShell } from "./shell-notify";
import type { NotifyChoice } from "@/features/settings/notifications";
import type { Attention, ShellSignal } from "./shell-attention";
import type { Shell, ShellsState } from "./shell-registry";

// 알림 판정 seam(#206 · 스토리 81). 순수 함수 하나가 대상이라 렌더도 DOM도 없이 기본
// 환경(node)에서 돈다 — `shell-attention.test.ts`가 선례다.
//
// **표로 재는 것이 이 검사의 존재 이유다**(스토리 81 · 결정 10). 엣지 트리거의 재무장 조건이
// 어긋나면 **두 번째 진짜 프롬프트가 삼켜지는데**, 그 실패는 화면에 아무 표시도 안 난다 —
// 알림이 안 온 것과 부를 일이 없던 것이 사람에게 똑같이 보인다. 그래서 **전이 열여섯**을 한
// 표에 늘어놓고 하나씩 센다 — 그 수는 아래 `TRANSITIONS`가 들고, 표가 조용히 줄어드는 것은
// 그 길이를 재는 검사가 막는다(수를 문단에 손으로 적어 두면 줄이 사라져도 아무 신호가 없다).

const base: NotifyInput = {
  prev: null,
  next: "waiting",
  // **직전과 새 사실의 시각이 같다** — 그래야 아래 표의 「머무름」 두 줄이 「같은 값이 그대로
  // 앉아 있는 것」을 재고, 「같은 값으로 새 사실이 도착한 것」은 그 시각을 갈라 따로 잰다.
  prevSince: 5_000,
  since: 5_000,
  visible: false,
  lastNotifiedAt: null,
  now: 10_000,
  title: "터미널 신호",
  shellName: "atelier · claude",
  message: "커밋할까요?",
};

const decide = (patch: Partial<NotifyInput>) => decideNotification({ ...base, ...patch });

/**
 * 화면값 넷(`waiting`·`done`·`working`·없음)이 서로 오가는 길 **열여섯 전부**. 왼쪽이 직전
 * 화면값, 가운데가 새 화면값, 오른쪽이 「울리는가」다.
 *
 * **밖으로 꺼낸 것은 길이를 재기 위해서다** — 표가 한 줄 줄어도 남은 줄은 전부 통과하므로
 * 조용하다. 4×4가 다 서 있다는 사실을 검사가 들면 그 침묵이 사라진다.
 */
const TRANSITIONS = [
  // **들어감** — 확인할 것 둘로 처음 들어오는 길 넷.
  [null, "waiting", true],
  [null, "done", true],
  ["working", "waiting", true],
  ["working", "done", true],
  // **둘 사이를 오가는 것도 들어감이다**(결정 10). 답을 기다리다 세션을 마친 것은 새 사실이다.
  ["waiting", "done", true],
  ["done", "waiting", true],
  // **머무름** — 같은 값으로 남아 있는 동안은 조용하다(스토리 60).
  ["waiting", "waiting", false],
  ["done", "done", false],
  // **나감** — 재무장하는 자리라 여기서는 안 울린다.
  ["waiting", "working", false],
  ["done", "working", false],
  ["waiting", null, false],
  ["done", null, false],
  // **도는 중은 어느 방향으로도 안 울린다**(스토리 68).
  [null, "working", false],
  ["working", "working", false],
  ["working", null, false],
  [null, null, false],
] as ReadonlyArray<readonly [ShellSignal | null, ShellSignal | null, boolean]>;

describe("어느 전이가 울리나", () => {
  // 화면값 넷이 서로 오가는 길은 4×4다. 줄이 사라지면 여기서 터진다.
  it("전이 열여섯이 다 서 있다", () => {
    expect(TRANSITIONS).toHaveLength(16);
  });

  it.each(TRANSITIONS)("%s → %s 는 %s", (prev, next, fires) => {
    expect(decide({ prev, next }) !== null).toBe(fires);
  });

  // **이것이 이 표가 있는 이유다**(결정 10 — Agent Deck 「두 번째 진짜 프롬프트가 삼켜짐」).
  // 재무장 조건을 잘못 잡으면 위 줄 하나하나는 통과하면서 이어 붙인 이 길에서만 무너진다.
  it("부르기를 그쳤다가 다시 부르면 두 번째도 울린다", () => {
    expect(decide({ prev: null, next: "waiting" })).not.toBeNull();
    expect(decide({ prev: "waiting", next: "working" })).toBeNull();
    expect(decide({ prev: "working", next: "waiting" })).not.toBeNull();
  });

  // **훅 셸에는 화면값이 `waiting`을 벗어나는 길이 사실상 없다.** 결정 6의 소거 규칙은
  // 「`UserPromptSubmit` · 출력」 둘인데 구현 결정 1이 출력을 권위 규칙 **안쪽**으로
  // 좁혔고(`nextOnOutput`은 `source: "osc"`만 푼다), 승인 클릭은 `UserPromptSubmit`을
  // 안 낸다 — 설치되는 훅 다섯에 「승인 완료」 이벤트가 없다. 그래서 승인 요청이 연달아
  // 오는 동안 화면값은 `waiting`에 계속 앉아 있고, **화면값 하나로만 재면 둘째 프롬프트
  // 부터 전부 삼켜진다** — 결정 10이 이름 붙여 막으려던 그 실패다(Agent Deck).
  //
  // 그래서 「머무름」의 판정을 화면값이 아니라 **그 사실의 정체**로 넓힌다: `applySignal`이
  // 이벤트마다 새 `since`를 찍으므로, 같은 값이 그대로 앉아 있는 것과 같은 값으로 새 사실이
  // 도착한 것이 그 한 칸으로 갈린다.
  it("같은 화면값이라도 새 사실이면 울린다", () => {
    expect(
      decide({ prev: "waiting", next: "waiting", prevSince: 1_000, since: 2_000 }),
    ).not.toBeNull();
    expect(decide({ prev: "done", next: "done", prevSince: 1_000, since: 2_000 })).not.toBeNull();
  });

  // 그 반대쪽 — 같은 사실이 다시 그려지는 것(다른 칸이 바뀌어 회차가 도는 것)은 조용하다.
  // 이 줄이 없으면 위 넓히기가 「늘 울린다」로 무너져도 초록이다.
  it("같은 사실이 다시 와도 안 울린다", () => {
    expect(decide({ prev: "waiting", next: "waiting", prevSince: 2_000, since: 2_000 })).toBeNull();
  });
});

describe("억제", () => {
  // 결정 7의 「봤다」와 **같은 판정**을 받는다 — 이미 보고 있는 것을 또 알리지 않는다(스토리 58).
  it("보고 있는 셸은 안 울린다", () => {
    expect(decide({ visible: true })).toBeNull();
  });

  // 「같은 앱 안이어도 다른 work을 보고 있으면 울린다」(스토리 59)는 이 함수에서 **입력의
  // 뜻**으로 지켜진다 — `visible`은 앱이 아니라 **그 셸**을 보고 있는가다.
  it("다른 화면을 보고 있으면 울린다", () => {
    expect(decide({ visible: false })).not.toBeNull();
  });

  it.each([
    // 마지막 알림에서 얼마나 지났나 → 울리는가.
    [0, false],
    [1, false],
    [COALESCE_MS - 1, false],
    // **경계는 열려 있다** — 「5초 안」이 접히는 것이라 딱 5초는 새 알림이다.
    [COALESCE_MS, true],
    [COALESCE_MS + 1, true],
  ])("같은 work에서 %sms 뒤는 %s", (gap, fires) => {
    expect(decide({ lastNotifiedAt: base.now - gap }) !== null).toBe(fires);
  });

  it("그 work에서 아직 안 울렸으면 창이 없다", () => {
    expect(decide({ lastNotifiedAt: null })).not.toBeNull();
  });
});

describe("무엇이 실리나", () => {
  it("제목은 work, 부제는 셸, 본문은 셸의 마지막 말이다", () => {
    expect(decide({})).toEqual({
      title: "터미널 신호",
      body: "커밋할까요?",
      subtitle: "atelier · claude",
    });
  });

  // 훅이 페이로드를 못 읽어도 「그 이벤트가 났다」는 남는다(`atelier-hook.py`) — 그때 본문이
  // 비면 알림이 무엇을 말하는지 없어진다. 바닥은 **화면과 같은 말**이다(`SIGNAL_LABEL`).
  it.each([
    ["waiting", "나를 기다림"],
    ["done", "확인할 것"],
  ] as ReadonlyArray<readonly [ShellSignal, string]>)("말이 없으면 %s 는 %s 가 바닥이다", (next, body) => {
    expect(decide({ next, message: null })?.body).toBe(body);
  });
});

// **직전 화면값을 기억하는 자리**(#206). 위 판정은 전이 하나를 보고, 이쪽은 그 전이를
// **만들어 낸다** — 회차마다 목록을 받아 셸마다 직전과 견주고, 울린 것은 그 work의 시각을
// 갱신한다. 여기가 틀리면 판정이 아무리 맞아도 두 번째 프롬프트가 삼켜진다.
describe("판정을 회차에 걸어 두는 것", () => {
  const shell = (patch: Partial<NotifyShell> = {}): NotifyShell => ({
    id: 1,
    owner: "signal",
    kind: "waiting",
    since: 0,
    visible: false,
    title: "터미널 신호",
    shellName: "atelier · claude",
    message: null,
    ...patch,
  });

  it("같은 값이 계속 와도 한 번만 울린다", () => {
    const notifier = createNotifier();
    expect(notifier.step([shell()], 0)).toHaveLength(1);
    expect(notifier.step([shell()], 1000)).toHaveLength(0);
    expect(notifier.step([shell()], 60_000)).toHaveLength(0);
  });

  // **이것이 훅 셸의 실물 경로다**(위 판정 검사의 짝). claude가 `Bash` 승인을 묻고, 사람이
  // 가서 승인하고, 3분 뒤 `Edit` 승인을 묻는다 — 훅 셸에서 그 사이 화면값은 `waiting`에
  // 그대로 앉아 있고 바뀌는 것은 `since`·`message`뿐이다. 회차가 화면값만 기억하면 둘째
  // 승인 요청이 삼켜져, 다른 앱을 보던 사람은 claude가 멈춰 선 것을 모른다.
  it("같은 화면값으로 새 승인이 오면 두 번째도 울린다", () => {
    const notifier = createNotifier();
    expect(notifier.step([shell({ since: 0, message: "Bash · git status" })], 0)).toHaveLength(1);
    const 다음 = notifier.step([shell({ since: 180_000, message: "Edit · src/pty.rs" })], 180_000);
    expect(다음.map((one) => one.body)).toEqual(["Edit · src/pty.rs"]);
  });

  // 스토리 60의 반대쪽 — 「그쳤다가 다시 부르면」이 회차에서도 산다.
  it("도는 중을 지나 다시 부르면 두 번째도 울린다", () => {
    const notifier = createNotifier();
    expect(notifier.step([shell()], 0)).toHaveLength(1);
    expect(notifier.step([shell({ kind: "working" })], 1000)).toHaveLength(0);
    expect(notifier.step([shell()], 60_000)).toHaveLength(1);
  });

  // **셸이 사라졌다 돌아오는 것도 재무장이다.** 칸이 닫히면 그 기억도 함께 없어져야 —
  // 안 그러면 같은 번호를 물려받은 새 칸이 첫 부름을 삼킨다.
  it("목록에서 빠졌다 돌아온 셸은 다시 울린다", () => {
    const notifier = createNotifier();
    expect(notifier.step([shell()], 0)).toHaveLength(1);
    expect(notifier.step([], 1000)).toHaveLength(0);
    expect(notifier.step([shell()], 60_000)).toHaveLength(1);
  });

  // 결정 10의 중복 창 — 턴 종료와 권한 요청이 연달아 울리지 않는다(스토리 61).
  it("같은 work의 셸 둘이 한꺼번에 부르면 첫 것만 울린다", () => {
    const notifier = createNotifier();
    const fired = notifier.step([shell({ id: 1 }), shell({ id: 2, shellName: "atelier · codex" })], 0);
    expect(fired.map((one) => one.subtitle)).toEqual(["atelier · claude"]);
  });

  // 창은 **work마다** 따로다 — 한 work이 시끄럽다고 다른 work의 부름이 접히면 안 된다.
  it("다른 work은 같은 순간에도 각자 울린다", () => {
    const notifier = createNotifier();
    const fired = notifier.step(
      [shell({ id: 1, owner: "signal" }), shell({ id: 2, owner: "papercuts", title: "ux 종이베임" })],
      0,
    );
    expect(fired.map((one) => one.title)).toEqual(["터미널 신호", "ux 종이베임"]);
  });

  // 최상위 셸은 어느 work의 것도 아니라(`owner: null`) 자기들끼리 한 창을 쓴다.
  it("최상위 셸도 자기 창을 갖는다", () => {
    const notifier = createNotifier();
    const fired = notifier.step(
      [shell({ id: 1, owner: null, title: "Terminal" }), shell({ id: 2, owner: "signal" })],
      0,
    );
    expect(fired.map((one) => one.title)).toEqual(["Terminal", "터미널 신호"]);
  });

  // **접힌 알림은 창을 늘리지 않는다.** 접힌 것까지 시각을 갱신하면 셸이 줄줄이 부르는
  // 동안 창이 끝없이 밀려 5초가 지나도 아무것도 안 울린다.
  it("접힌 알림은 창을 밀지 않는다", () => {
    const notifier = createNotifier();
    notifier.step([shell({ id: 1 })], 0);
    // 4초에 둘째 셸이 불러 접힌다.
    expect(notifier.step([shell({ id: 1 }), shell({ id: 2, kind: "waiting" })], 4000)).toHaveLength(0);
    // 셋째가 5초에 부르면 창은 첫 알림에서 재므로 열려 있다.
    expect(notifier.step([shell({ id: 1 }), shell({ id: 2 }), shell({ id: 3 })], COALESCE_MS)).toHaveLength(1);
  });
});

// **레지스트리에서 판정의 재료를 뽑는 자리**(#206). 「누가 부르나」는 이미 정해져 있고
// (`callingShells` — 띠가 읽는 그 목록) 여기가 더하는 것은 알림에만 필요한 셋이다:
// 지금 보고 있는가 · work의 이름 · 셸의 이름.
describe("레지스트리에서 재료를 뽑는다", () => {
  const 칸 = (over: Partial<Shell>): Shell => ({
    id: 1,
    status: { kind: "running" },
    title: null,
    shellName: "zsh",
    owner: null,
    project: null,
    cwd: null,
    running: null,
    attention: null,
    ...over,
  });
  const 상태 = (over: Partial<Attention> = {}): Attention => ({
    kind: "waiting",
    message: "커밋할까요?",
    since: 100,
    seen: false,
    source: "hook",
    agent: "claude",
    ...over,
  });
  const 화면 = (...shells: ReadonlyArray<Shell>): ShellsState => ({
    shells,
    activeByOwner: {},
    nextId: shells.length + 1,
  });
  const 제목 = (owner: string | null) => (owner === null ? "Terminal" : `《${owner}》`);

  // **띠와 같은 목록이다.** 부르는 셸만 들고 차례도 그쪽이 정한 그대로다 — 접히는 차례가
  // 우선순위와 갈리면 5초 창에서 급한 것이 접히고 덜 급한 것이 울린다.
  it("부르는 셸만, 띠의 차례 그대로 든다", () => {
    const rows = notifyShells(
      화면(
        칸({ id: 1, owner: "가", attention: 상태({ kind: "done", since: 30 }) }),
        칸({ id: 2, owner: "나", attention: 상태({ kind: "waiting", since: 20 }) }),
        칸({ id: 3, owner: "다", attention: 상태({ kind: "working" }) }),
        칸({ id: 4, owner: "라", attention: null }),
      ),
      { activeIds: [], focused: true },
      제목,
    );
    expect(rows.map((one) => one.id)).toEqual([2, 1]);
    expect(rows.map((one) => one.kind)).toEqual(["waiting", "done"]);
    // **시각도 함께 온다** — 판정이 「같은 값으로 새 사실이 왔나」를 이 칸으로 가른다.
    // 여기서 빠지면 위 판정 검사가 아무리 맞아도 실물에서는 둘째 승인이 삼켜진다.
    expect(rows.map((one) => one.since)).toEqual([20, 30]);
  });

  // 「봤다」 판정은 **한 자리**다(스토리 80) — 탭 물들임과 같은 함수(`isShellSeen`)를 딛는다.
  it("보고 있는 셸에 보임이 선다", () => {
    const rows = notifyShells(
      화면(
        칸({ id: 1, owner: "가", attention: 상태() }),
        칸({ id: 2, owner: "나", attention: 상태() }),
      ),
      { activeIds: [2], focused: true },
      제목,
    );
    expect(rows.map((one) => [one.id, one.visible])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  // 창이 뒤에 있으면 켜진 탭도 「보는 중」이 아니다(결정 7) — 그래야 다른 앱을 보는 동안 울린다.
  it("창이 뒤에 있으면 켜진 탭도 안 보는 것이다", () => {
    const rows = notifyShells(
      화면(칸({ id: 2, owner: "나", attention: 상태() })),
      { activeIds: [2], focused: false },
      제목,
    );
    expect(rows[0].visible).toBe(false);
  });

  // 제목은 **밖에서 온다** — 터미널은 슬러그까지만 안다(`bandRows` 머리말). 셸 이름은
  // 탭에 적히는 그것과 같은 함수를 딛는다(`shellRowName`).
  it("제목과 셸 이름과 말이 실린다", () => {
    const rows = notifyShells(
      화면(칸({ id: 1, owner: "가", title: "claude", project: "atelier", attention: 상태() })),
      { activeIds: [], focused: true },
      제목,
    );
    expect(rows[0]).toMatchObject({
      owner: "가",
      title: "《가》",
      shellName: "atelier · claude",
      message: "커밋할까요?",
    });
  });

  it("최상위 셸의 제목도 밖이 정한다", () => {
    const rows = notifyShells(
      화면(칸({ id: 1, owner: null, attention: 상태() })),
      { activeIds: [], focused: true },
      제목,
    );
    expect(rows[0].title).toBe("Terminal");
  });
});

// **이 플러그인이 부제를 안 노출한다**(#206 실측 — `tauri-plugin-notification` 2.4.0의
// `desktop.rs`가 데스크톱 알림에 싣는 것은 title·body·icon·sound 넷뿐이다. 그 아래
// `notify-rust`는 macOS에서 부제를 실을 수 있다 — 못 나르는 것은 채널이 아니라 이 층이다).
// 판정은 스펙대로 셋을 내고, 그 셋을 채널이 받는 모양으로 접는 자리가 여기 하나다 — 접는
// 규칙이 부르는 자리마다 갈리면 같은 알림이 실행마다 다른 모양으로 뜬다.
describe("채널이 나를 수 있는 모양으로 접는다", () => {
  it("셸 이름이 제목 줄에 함께 선다", () => {
    expect(
      notificationPayload(
        { title: "터미널 신호", body: "커밋할까요?", subtitle: "atelier · claude" },
        true,
      ),
    ).toEqual({ title: "터미널 신호 · atelier · claude", body: "커밋할까요?", sound: MAC_DEFAULT_SOUND });
  });

  // **말이 사라지지 않는다.** 부제를 본문에 앞세우는 안은 기각했다 — 알림에서 사람이 읽는
  // 것은 셸이 한 말이고, 그 앞에 이름을 붙이면 잘리는 쪽이 말이 된다.
  it("본문은 셸이 한 말 그대로다", () => {
    expect(notificationPayload({ title: "가", body: "나를 기다림", subtitle: "zsh" }, true).body).toBe(
      "나를 기다림",
    );
  });
});

// **설정 스위치 둘이 무엇을 바꾸는지**(#206 · 스토리 64·66). 이 표가 없던 판에서는
// `if (!enabled) return;`을 지워도, 소리를 늘 싣게 굳혀도 검증이 통째로 초록이었다 —
// 동작을 바꾸는 뮤테이션이 그물 없이 지나가는 자리였고, 그 실패는 화면에 아무 표시도
// 안 난다(끈 사람에게는 「원래 조용한 것」과 같아 보인다).
describe("설정이 무엇을 바꾸나", () => {
  const 하나: NotifyContent = { title: "터미널 신호", body: "커밋할까요?", subtitle: "atelier · claude" };
  const 둘: NotifyContent = { title: "터미널 신호", body: "권한을 줄까요?", subtitle: "atelier · codex" };

  // 왼쪽이 고른 값, 가운데가 나가는 알림 수와 거기 실리는 소리, 오른쪽이 독 배지의 수다.
  it.each([
    // 둘 다 켬 — 기본이다(안 고른 파일이 여기로 온다).
    [{ enabled: true, sound: true }, 2, MAC_DEFAULT_SOUND, 3],
    // **소리만 끈다**(스토리 64) — 알림은 그대로 나가고 소리 칸만 빈다.
    [{ enabled: true, sound: false }, 2, undefined, 3],
    // **끄면 조용하다**(스토리 66) — 나가는 것이 없고 배지도 0이다.
    [{ enabled: false, sound: true }, 0, undefined, 0],
    [{ enabled: false, sound: false }, 0, undefined, 0],
  ] as ReadonlyArray<readonly [NotifyChoice, number, string | undefined, number]>)(
    "%o 이면 알림 %i개(소리 %s) · 배지 %i",
    (choice, count, sound, badge) => {
      const out = outgoing([하나, 둘], 3, choice);
      expect(out.toShow).toHaveLength(count);
      expect(out.badge).toBe(badge);
      for (const one of out.toShow) expect(one.sound).toBe(sound);
    },
  );

  // 소리를 껐다는 것은 **키가 아예 없는 것**이다 — 채널이 「이름 없는 소리」를 조용함으로
  // 읽는지에 기대지 않는다(`sound: undefined`를 실어 보내는 것과 뜻이 같아 보이지만,
  // 그 동치는 이 저장소가 정한 것이 아니라 남의 구현이 정한 것이다).
  it("소리를 끄면 소리 칸이 아예 안 실린다", () => {
    const [one] = outgoing([하나], 1, { enabled: true, sound: false }).toShow;
    expect("sound" in one, "빈 소리 칸이 실려 나갔다").toBe(false);
  });

  // 끈 동안에도 **배지만 남기지 않는다**: 독에 수가 남아 있으면 「껐는데 아직 부른다」로
  // 읽힌다. 스위치는 하나이고 채널 셋(알림·소리·배지)이 그 하나에 달렸다(결정 10의 채널 칸).
  it("끄면 부르는 셸이 있어도 배지가 0이다", () => {
    expect(outgoing([하나], 7, { enabled: false, sound: true }).badge).toBe(0);
  });

  // 울린 것이 없어도 배지는 **지금 부르는 수**다 — 접혀서 안 울린 셸도 독에는 센다.
  it("안 울린 회차에도 배지는 부르는 수를 센다", () => {
    expect(outgoing([], 2, { enabled: true, sound: true })).toEqual({ toShow: [], badge: 2 });
  });
});

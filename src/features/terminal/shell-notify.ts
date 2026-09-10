import { SIGNAL_LABEL } from "@/components/shell/shell-signal";
import { callingShells, isShellSeen } from "./shell-attention";
import type { ShellSignal, ShellView } from "./shell-attention";
import { shellRowName } from "./shell-registry";
import type { ShellsState } from "./shell-registry";

// 알림을 **울릴지 정하는 자리 하나**(#206 · 결정 10). Rust는 여기서 나온 답을 받아 띄우기만
// 한다 — 판정이 백엔드로 새면 「보고 있으면 안 울린다」가 화면의 사실(결정 7)과 갈린다.
//
// **값으로 들이는 것이 말 하나뿐이라** DOM 없는 기본 환경에서 그대로 돈다
// (`shell-attention.ts`가 선례다). `SIGNAL_LABEL`을 여기서 다시 적지 않는 이유는 그것이
// 화면(행·띠·탭의 접근성 이름)과 **같은 말**이어야 하기 때문이다 — 알림 본문만 「대기 중」
// 이라고 쓰면 같은 사실이 앱 안팎에서 두 이름을 갖는다.

/** 같은 work의 알림을 하나로 접는 창(결정 10 — Orca 5s). */
export const COALESCE_MS = 5000;

/** 울릴 때 실리는 것 셋. Rust가 그대로 받아 띄운다. */
export interface NotifyContent {
  /** work 제목. 최상위 셸이면 nav 항목의 이름(`Terminal`)이다. */
  title: string;
  /** 셸이 마지막으로 한 말의 첫 줄. 없으면 상태의 말이 바닥이다. */
  body: string;
  /** 어느 셸인가 — 탭에 적히는 그 이름. */
  subtitle: string;
}

/**
 * 판정이 보는 것 전부. 앞 다섯이 「울리나」를 정하고 뒤 셋이 「무엇이 실리나」를 정한다.
 */
export interface NotifyInput {
  /** 직전 화면값. 앱이 켜진 뒤 이 셸을 한 번도 못 봤으면 `null`이다. */
  prev: ShellSignal | null;
  /** 새 화면값. `signalOf`가 낸 그 값이라 **본 완료는 이미 `null`**이다. */
  next: ShellSignal | null;
  /** 지금 사람이 그 셸을 보고 있나(결정 7의 판정 — `isShellSeen`). */
  visible: boolean;
  /** 그 work에서 마지막으로 울린 시각. 없으면 `null`. */
  lastNotifiedAt: number | null;
  now: number;
  title: string;
  shellName: string;
  message: string | null;
}

/**
 * 울릴까. **엣지 트리거다** — 화면값이 「확인할 것」 둘(`waiting`·안 본 `done`) 중 하나로
 * **들어가는 순간**에만 울리고, 같은 값으로 남아 있는 동안은 조용하다(결정 10).
 *
 * **재무장을 따로 기억하지 않는다.** 「나갔다 다시 들어왔는가」를 플래그로 들면 그 플래그를
 * 언제 푸는지가 곧 재무장 조건이 되고, 그것을 잘못 잡으면 **두 번째 진짜 프롬프트가
 * 삼켜진다**(Agent Deck 소스의 실패 사례 — 결정 10). 여기서는 그 조건이 `prev !== next`
 * 하나로 접힌다: `working`이나 `null`을 지나 돌아오면 그 비교가 저절로 참이 된다.
 *
 * `waiting → done`처럼 둘 사이를 오가는 것도 **「들어감」이다** — 같은 셸이 답을 기다리다
 * 세션을 마친 것은 새 사실이라 한 번 더 알린다.
 *
 * **도는 중은 어느 방향으로도 안 울린다**(스토리 68). 알림은 늘 「내가 할 일이 생겼다」는
 * 뜻이고, 에이전트가 일을 시작한 것도 끝난 것도 그 뜻이 아니다.
 */
export function decideNotification(input: NotifyInput): NotifyContent | null {
  const { next } = input;
  // 「확인할 것」 둘로 들어가는 것만이 울릴 일이다. 도는 중과 없음은 여기서 함께 걸린다.
  if (next !== "waiting" && next !== "done") return null;
  if (next === input.prev) return null;
  if (input.visible) return null;
  // **접히는 것은 뒤에 온 쪽이다**(결정 10 — 첫 것만). 턴 종료와 권한 요청이 연달아 오는
  // 그 순간이 이 창이 있는 이유다.
  if (input.lastNotifiedAt !== null && input.now - input.lastNotifiedAt < COALESCE_MS) return null;

  return {
    title: input.title,
    body: input.message ?? SIGNAL_LABEL[next],
    subtitle: input.shellName,
  };
}

/**
 * 판정에 걸릴 셸 하나. `kind`는 **화면값**이라(`signalOf`) 본 완료는 이미 `null`이고,
 * `visible`은 결정 7의 판정(`isShellSeen`)이 그대로 온 것이다.
 */
export interface NotifyShell {
  id: number;
  /** 5초 창을 나누는 키 — work 슬러그다. 최상위 셸은 어느 work의 것도 아니라 `null`. */
  owner: string | null;
  kind: ShellSignal | null;
  visible: boolean;
  /** 알림 제목에 설 이름 — work 제목, 최상위 셸이면 nav 항목의 이름이다. */
  title: string;
  shellName: string;
  message: string | null;
}

/**
 * 회차마다 목록을 받아 **울릴 것만** 돌려준다. 상태는 둘뿐이다 — 셸마다의 직전 화면값과
 * work마다의 마지막 알림 시각.
 */
export interface Notifier {
  step(shells: ReadonlyArray<NotifyShell>, now: number): ReadonlyArray<NotifyContent>;
}

/**
 * 판정을 **회차에 걸어 두는 것**. 위 `decideNotification`이 전이 하나를 보는 순수 함수라면
 * 이쪽은 그 전이를 **만들어 내는** 자리다: 목록을 받아 셸마다 직전과 견주고, 울린 것으로
 * 그 work의 창을 민다.
 *
 * **기억을 회차마다 통째로 갈아 끼운다.** 목록에서 빠진 셸(닫힌 칸)의 직전 값이 남아 있으면
 * 같은 번호를 물려받은 새 칸의 첫 부름이 「같은 값이 계속 온 것」으로 삼켜진다 — 레지스트리의
 * 번호는 실행 안에서 다시 쓰이지 않지만, 그 성질에 기대지 않는 편이 이 자리에서 싸다.
 *
 * **창을 미는 것은 실제로 울린 것뿐이다.** 접힌 것까지 시각을 갱신하면 셸이 줄줄이 부르는
 * 동안 창이 끝없이 밀려 5초가 지나도 아무것도 안 울린다 — 「하나로 접는다」가 「하나도 안
 * 울린다」가 되는 그 자리다.
 *
 * **받은 차례가 곧 접히는 차례다.** 같은 work에서 둘이 한 회차에 부르면 앞의 것이 울리고
 * 뒤의 것이 접히므로, 부르는 쪽은 우선순위대로 줄 세운 목록을 준다(`callingShells`).
 */
export function createNotifier(): Notifier {
  let previous = new Map<number, ShellSignal | null>();
  const lastByOwner = new Map<string | null, number>();

  return {
    step(shells, now) {
      const fired: NotifyContent[] = [];
      const next = new Map<number, ShellSignal | null>();

      for (const shell of shells) {
        next.set(shell.id, shell.kind);
        const content = decideNotification({
          prev: previous.get(shell.id) ?? null,
          next: shell.kind,
          visible: shell.visible,
          lastNotifiedAt: lastByOwner.get(shell.owner) ?? null,
          now,
          title: shell.title,
          shellName: shell.shellName,
          message: shell.message,
        });
        if (content === null) continue;
        lastByOwner.set(shell.owner, now);
        fired.push(content);
      }

      previous = next;
      return fired;
    },
  };
}

/**
 * 레지스트리에서 이 회차의 재료를 뽑는다. **부르는 셸만 든다** — 「누가 부르나」와 그 차례는
 * 이미 정해져 있고(`callingShells`, 띠가 읽는 그 목록) 여기가 더하는 것은 알림에만 필요한
 * 셋뿐이다: 지금 보고 있는가 · 화면의 이름 · 셸의 이름.
 *
 * **부르기를 그친 셸이 목록에서 빠지는 것이 곧 재무장이다.** 조용해진 셸을 `kind: null`로
 * 실어 보내는 안도 있었지만, 그러면 셸 여덟이 늘 목록에 앉아 있고 「부르는 것만 본다」는
 * 성질이 이 자리에서 깨진다 — `Notifier`가 회차마다 기억을 통째로 갈아 끼우므로(그 머리말)
 * 빠지는 것만으로 같은 일이 난다.
 *
 * **독 배지가 세는 것도 이 목록이다.** 「확인할 것의 수」를 다른 자리에서 다시 세면 배지와
 * 띠 헤더의 `N`이 갈리는 날이 온다(`callingShells` 머리말의 그 경고).
 *
 * `titleOf`가 밖에서 오는 것은 터미널이 슬러그까지만 알기 때문이다(`bandRows` 머리말) —
 * work 제목도 최상위 셸의 `Terminal`도 화면의 말이라, 둘 다 쥔 자리가 건넨다.
 */
export function notifyShells(
  state: ShellsState,
  view: ShellView,
  titleOf: (owner: string | null) => string,
): ReadonlyArray<NotifyShell> {
  return callingShells(state.shells).map(({ shell, kind, attention }) => ({
    id: shell.id,
    owner: shell.owner,
    kind,
    // 결정 7의 판정 **그 함수**를 딛는다(스토리 80) — 탭 물들임과 두 벌이 되면 초록은
    // 꺼졌는데 알림은 울리는(또는 그 반대인) 어긋남이 난다.
    visible: isShellSeen(shell.id, view),
    title: titleOf(shell.owner),
    shellName: shellRowName(shell),
    message: attention.message,
  }));
}

/**
 * 판정이 낸 셋을 **채널이 나를 수 있는 둘로** 접는다.
 *
 * **부제 칸이 없다 — 실측이다.** 스펙은 「부제에 셸 이름」이라 적었지만
 * `tauri-plugin-notification` 2.4.0이 데스크톱 알림에 싣는 것은 title·body·icon·sound
 * 넷뿐이다(`desktop.rs`의 `NotificationBuilder::show`). 부제는 모바일 쪽 필드다.
 *
 * 그래서 **제목 줄에 함께 세운다.** macOS는 알림 위에 앱 이름을 이미 그리므로 제목 줄이
 * 「어느 것인가」를 말하는 자리이고, 본문은 셸이 한 말을 위한 자리로 남는다. 기각: 본문
 * 앞에 이름을 붙이는 안 — 잘리는 쪽이 말이 되어, 알림을 눌러 볼지 정하는 근거가 사라진다.
 *
 * **판정이 셋을 내는 것은 그대로 둔다.** 채널이 못 나르는 것과 우리가 말하려는 것은 다른
 * 사실이고, 채널이 바뀌면 고칠 자리가 이 함수 하나로 남는다.
 */
export function notificationPayload(content: NotifyContent): { title: string; body: string } {
  return { title: `${content.title} · ${content.subtitle}`, body: content.body };
}

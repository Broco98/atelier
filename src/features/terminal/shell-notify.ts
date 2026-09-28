import { SIGNAL_LABEL, type ShellSignal } from "@/components/shell/shell-signal";
import type { NotifyChoice } from "@/features/settings/notifications";
import { isCalling, isShellSeen, shellCalls } from "./shell-attention";
import type { ShellView } from "./shell-attention";
import { shellRowName } from "./shell-registry";
import type { ShellOwner, ShellsState } from "./shell-registry";

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
  /**
   * 직전 사실이 도착한 시각. 값을 한 번도 못 본 셸은 `null`이다.
   *
   * **`prev`와 짝이다** — 「같은 값이 그대로 앉아 있는 것」과 「같은 값으로 **새 사실**이
   * 도착한 것」을 가르는 칸이 이것 하나다(아래 `decideNotification` 머리말).
   */
  prevSince: number | null;
  /** 새 화면값. `signalOf`가 낸 그 값이라 **본 완료는 이미 `null`**이다. */
  next: ShellSignal | null;
  /** 새 사실이 도착한 시각(`Attention.since`). `applySignal`이 이벤트마다 새로 찍는다. */
  since: number;
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
 * 삼켜진다**(Agent Deck 소스의 실패 사례 — 결정 10). 여기서는 그 조건이 「화면값과 시각이
 * 둘 다 그대로인가」로 접힌다: `working`이나 `null`을 지나 돌아오면 화면값이 갈리고,
 * 화면값이 안 갈려도 새 사실이면 시각이 갈린다.
 *
 * **「같은 kind의 새 사실도 진입이다.」** 화면값 하나로만 재던 판정이 훅 셸에서 새던 자리가
 * 여기다 — 훅 셸에는 `waiting`을 푸는 길이 사실상 없다: 결정 6의 소거 규칙 둘 중 「출력」을
 * 구현 결정 1이 권위 규칙 안쪽으로 좁혔고(`nextOnOutput`은 `source: "osc"`만 푼다), 남은
 * `UserPromptSubmit`을 **승인 클릭은 안 낸다**. 옛 설치(훅 다섯)에는 승인 완료 이벤트가 아예 없었고,
 * 프로세스 결정 13이 이렇게 고쳤다: 승인 뒤 도구가 돌면 도구 사건(`tool`)이 기다림을 푼다 — 그 사건은 도구가 끝나야
 * 오므로(판 03 선행 시험) 사람이 권한 창에 누른 확정 키가 먼저 푼다(승인 추론 — `inferApproval`). 그래도 도구 사건
 * 없이 물음이 연달아 오는 길(`Elicitation` 둘, 도구 훅이 없는 옛 설치)에서는 화면값이 `waiting`에 계속
 * 앉아 있고, 그 사이 앱은 `since`·`message`를 새로 받으면서도 알림만 조용했다. `applySignal`이
 * 기다림에 온 기다림에도 새 `since`를 찍으므로 그 한 칸이 「그대로 앉아 있는 값」과 「새로 도착한 같은
 * 값」을 가른다.
 *
 * `waiting → waiting`이 짧은 간격으로 이어지는 것은 5초 창(`COALESCE_MS`)이 이미 받아 준다 —
 * 이 넓히기가 「매 프레임 울린다」가 되지 않는 이유가 그것이다.
 *
 * `waiting → done`처럼 둘 사이를 오가는 것도 **「들어감」이다** — 같은 셸이 답을 기다리다
 * 턴을 마친 것은 새 사실이라 한 번 더 알린다(옛 판의 예는 「세션을 마친 것」이었다 — 프로세스 결정 13이
 * 이렇게 고쳤다: 세션 끝은 기다림을 지울 뿐 확인할 것을 새로 세우지 않는다).
 *
 * **도는 중은 어느 방향으로도 안 울린다**(스토리 68). 알림은 늘 「내가 할 일이 생겼다」는
 * 뜻이고, 에이전트가 일을 시작한 것도 끝난 것도 그 뜻이 아니다.
 */
export function decideNotification(input: NotifyInput): NotifyContent | null {
  const { next } = input;
  // 뒤의 `isCalling`은 앞이 참이면 늘 참이다 — 아래 말 고르기(`SIGNAL_LABEL[next]`)에 좁힌 값을 건네려고 한 번 더 적는다.
  if (!entersCalling(input) || !isCalling(next)) return null;
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
 * **부르는 상태에 들어섰나** — 알림 판정의 첫 두 줄이다(위 `decideNotification`). 울릴지는 그 뒤의 두 줄(보고 있나 · 5초 창)이
 * 더 가르지만, 들어섰다는 사실은 거기서 안 바뀐다. 그 사실만 따로 읽는 자리가 방금 부른 셸의 기억이다(티켓 23 · 프로세스
 * 스펙 S59) — 보고 있어서 · 접혀서 · 알림을 꺼서 안 울린 부름도 사람을 부른 것이다. 판정을 두 벌 적지 않으려고 여기 하나로
 * 뗐다. **견주는 값이 둘이다** — 알림은 화면값(`NotifyShell.kind`)으로, 기억은 부르는 사실(`NotifyShell.call`)로 이 판정을
 * 지난다(`createNotifier`).
 */
export function entersCalling(input: Pick<NotifyInput, "prev" | "prevSince" | "next" | "since">): boolean {
  // 「확인할 것」 둘로 들어가는 것만이 울릴 일이다. 도는 중과 없음은 여기서 함께 걸린다.
  // **갈래의 이름을 딛는다**(`isCalling`) — 축이 느는 날 띠·배지와 여기가 갈리지 않게.
  if (!isCalling(input.next)) return false;
  // **시각까지 같아야 「머무름」이다.** 화면값만 견주면 훅 셸의 둘째 승인 요청이 삼켜진다
  // (위 `decideNotification` 머리말).
  return !(input.next === input.prev && input.since === input.prevSince);
}

/**
 * 판정에 걸릴 셸 하나. `kind`는 **화면값**이라(`signalOf`) 본 완료는 이미 `null`이고, `call`은 **부르는 사실**이라 봤어도
 * 그대로다. `visible`은 terminal-activity-signal 결정 7의 판정(`isShellSeen`)이 그대로 온 것이다.
 */
export interface NotifyShell {
  id: number;
  /**
   * 그 셸의 셸 키(프로세스 스펙 S34). 알림 판정은 안 쓴다 — 들어선 셸을 기억하는 자리(방금 부른 셸로 · 티켓 23)가 이 값으로
   * 셸을 가리킨다. spawn 응답 전이면 `null`이다.
   */
  shellKey: string | null;
  /**
   * 5초 창을 나누는 키 — **소유자 키 그대로**다(`<모드>:<slug>`). slug가 비었으면 그 세계의
   * 최상위 셸이다.
   *
   * **슬러그만으로는 못 가른다.** 두 루트에 같은 slug가 설 수 있어(코어의 유일성은 한 루트 쌍
   * 안에서만 본다) 저쪽 세계의 같은 이름 work이 이 창을 나눠 쓰게 된다 — 한쪽이 부르는 동안
   * 다른 쪽의 부름이 「같은 창의 반복」으로 삼켜진다.
   */
  owner: ShellOwner;
  /** 화면값 — 알림(`fired`)과 독 배지가 이것으로 가른다. 본 확인할 것은 `null`이다. */
  kind: ShellSignal | null;
  /**
   * 부르는 사실 — **「봤다」와 무관하다**(코드 리뷰 스펙 2). 들어섬(`entered` — 방금 부른 셸의 기억)이 이것으로 가른다. 보고 있는
   * 셸에 온 턴끝은 같은 갱신 안에서 본 것이 되어(`markShellsSeen`) 화면값이 없는데, 그 부름도 사람을 부른 것이다(S59).
   * `notifyShells`가 내는 줄에서는 늘 부르는 값이다(`shellCalls`).
   */
  call: ShellSignal | null;
  /**
   * 그 사실이 도착한 시각(`Attention.since`). **`kind`와 함께 기억된다** — 회차가 화면값
   * 하나만 들면 같은 값으로 도착한 새 사실이 「계속 같은 값이 온 것」으로 삼켜진다.
   */
  since: number;
  visible: boolean;
  /** 알림 제목에 설 이름 — work 제목, 최상위 셸이면 nav 항목의 이름이다. */
  title: string;
  shellName: string;
  message: string | null;
}

/**
 * 회차 하나가 낸 것 셋. `fired`는 **울릴 것**이고, `entered`는 이 회차에 **부르는 상태에 들어선 셸**이다 — 울렸든(보임 억제 ·
 * 5초 창에 걸려) 안 울렸든, 봤든 든다(`entersCalling`을 부르는 사실로). 차례는 받은 목록 그대로다. `calling`은 **지금 부르는
 * 셸의 수**(화면값)다 — 독 배지가 센다(`outgoing`). 본 확인할 것은 줄에 들어도(기억의 재료) 안 센다: 띠 헤더의 `N`과 같은 수다.
 */
export interface NotifyStep {
  fired: ReadonlyArray<NotifyContent>;
  entered: ReadonlyArray<NotifyShell>;
  calling: number;
}

/**
 * 회차마다 목록을 받아 울릴 것과 들어선 셸을 돌려준다. 상태는 둘뿐이다 — 셸마다의 직전 값(화면값 · 부르는 사실 · 시각)과
 * work마다의 마지막 알림 시각.
 */
export interface Notifier {
  step(shells: ReadonlyArray<NotifyShell>, now: number): NotifyStep;
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
  // **기억하는 것이 화면값 하나가 아니라 「그 사실의 정체」다**(`decideNotification` 머리말).
  // 훅 셸은 `waiting`을 벗어나는 길이 사실상 없어서, 값만 들면 승인 요청이 연달아 오는 동안
  // 둘째부터 전부 삼켜진다.
  let previous = new Map<number, { kind: ShellSignal | null; call: ShellSignal | null; since: number }>();
  const lastByOwner = new Map<string | null, number>();

  return {
    step(shells, now) {
      const fired: NotifyContent[] = [];
      const entered: NotifyShell[] = [];
      const next = new Map<number, { kind: ShellSignal | null; call: ShellSignal | null; since: number }>();

      for (const shell of shells) {
        next.set(shell.id, { kind: shell.kind, call: shell.call, since: shell.since });
        const was = previous.get(shell.id) ?? null;
        const at = { prevSince: was?.since ?? null, since: shell.since };
        // **울리기 전에 적는다** — 아래 판정이 보임 · 5초 창으로 거절해도 들어선 사실은 남는다(`entersCalling`). 견주는 것은
        // **부르는 사실**이다 — 화면값으로 견주면 보고 있는 셸의 턴끝(곧바로 본 것이 된다)이 들어서지 못한다(코드 리뷰 스펙 2).
        if (entersCalling({ ...at, prev: was?.call ?? null, next: shell.call })) entered.push(shell);
        // 울림은 **화면값**으로 가른다 — 알림의 전이 표와 억제(보임 · 5초 창 · 설정)는 그대로다.
        const content = decideNotification({
          ...at,
          prev: was?.kind ?? null,
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
      return { fired, entered, calling: shells.filter((shell) => isCalling(shell.kind)).length };
    },
  };
}

/**
 * 레지스트리에서 이 회차의 재료를 뽑는다. **부르는 셸만 든다** — 「누가 부르나」와 그 차례는
 * 이미 정해져 있고(`shellCalls`, 띠가 읽는 목록의 바탕) 여기가 더하는 것은 알림에만 필요한
 * 셋뿐이다: 지금 보고 있는가 · 화면의 이름 · 셸의 이름.
 *
 * **본 확인할 것도 든다**(코드 리뷰 스펙 2) — 화면값은 없고(`kind: null`) 부르는 사실(`call`)만 선 줄이다. 울리지 않고
 * 배지에도 안 세이지만(`NotifyStep.calling`), 들어섬은 부르는 사실로 가르므로 방금 부른 셸의 기억에 든다.
 *
 * **부르기를 그친 셸이 목록에서 빠지는 것이 곧 재무장이다.** 조용해진 셸을 `kind: null`로
 * 실어 보내는 안도 있었지만, 그러면 셸 여덟이 늘 목록에 앉아 있고 「부르는 것만 본다」는
 * 성질이 이 자리에서 깨진다 — `Notifier`가 회차마다 기억을 통째로 갈아 끼우므로(그 머리말)
 * 빠지는 것만으로 같은 일이 난다.
 *
 * **독 배지가 세는 것도 이 목록이다** — 화면값이 부르는 줄만(`NotifyStep.calling`). 「확인할 것의 수」를 다른 자리에서
 * 다시 세면 배지와 띠 헤더의 `N`이 갈리는 날이 온다(`callingShells` 머리말의 그 경고).
 *
 * `titleOf`가 밖에서 오는 것은 터미널이 슬러그까지만 알기 때문이다(`bandRows` 머리말) —
 * work 제목도 최상위 셸의 `Terminal`도 화면의 말이라, 둘 다 쥔 자리가 건넨다.
 */
export function notifyShells(
  state: ShellsState,
  view: ShellView,
  titleOf: (owner: ShellOwner) => string,
): ReadonlyArray<NotifyShell> {
  return shellCalls(state.shells).map(({ shell, kind, call, attention }) => ({
    id: shell.id,
    shellKey: shell.shellKey,
    owner: shell.owner,
    kind,
    call,
    since: attention.since,
    // 결정 7의 판정 **그 함수**를 딛는다(스토리 80) — 탭 물들임과 두 벌이 되면 초록은
    // 꺼졌는데 알림은 울리는(또는 그 반대인) 어긋남이 난다.
    visible: isShellSeen(shell.id, view),
    title: titleOf(shell.owner),
    shellName: shellRowName(shell),
    message: attention.message,
  }));
}

/**
 * macOS 기본 알림음을 부르는 이름. **손으로 적는다** — 이 채널은 소리를 안 주면 조용하고
 * (`mac-notification-sys`가 이름 없는 알림에 `""`를 넘긴다) 「시스템 기본 알림음」(결정 10)이
 * 여기서는 이 문자열로 적힌다. **이 이름이 실제로 소리를 내는지는 헤드리스로 못 잰다** —
 * 실물 확인이 남아 있는 자리다(구현-스펙 7. 알림의 미확인 목록).
 */
export const MAC_DEFAULT_SOUND = "NSUserNotificationDefaultSoundName";

/** 채널이 그대로 받는 모양. `sound`가 **없으면 조용하다**. */
export interface NotifyPayload {
  title: string;
  body: string;
  sound?: string;
}

/**
 * 판정이 낸 셋을 **채널이 받는 모양으로** 접는다. 소리도 여기서 실린다.
 *
 * **이 플러그인이 부제를 안 노출한다 — 실측이다.** 스펙은 「부제에 셸 이름」이라 적었지만
 * `tauri-plugin-notification` 2.4.0이 데스크톱 알림에 싣는 것은 title·body·icon·sound
 * 넷뿐이다(`desktop.rs`의 `NotificationBuilder::show`) — 부제 필드는 모바일 쪽에만 있다.
 * 그 아래 `notify-rust`는 macOS에서 부제를 실을 수 있으니(`nsusernotifications.rs`의
 * `maybe_subtitle`) 못 나르는 것은 채널이 아니라 **이 층**이다.
 *
 * 그래서 **제목 줄에 함께 세운다.** macOS는 알림 위에 앱 이름을 이미 그리므로 제목 줄이
 * 「어느 것인가」를 말하는 자리이고, 본문은 셸이 한 말을 위한 자리로 남는다. 기각: 본문
 * 앞에 이름을 붙이는 안 — 잘리는 쪽이 말이 되어, 알림을 눌러 볼지 정하는 근거가 사라진다.
 *
 * **판정이 셋을 내는 것은 그대로 둔다.** 이 층이 못 나르는 것과 우리가 말하려는 것은 다른
 * 사실이고, 층이 바뀌면 고칠 자리가 이 함수 하나로 남는다.
 *
 * **소리를 끈 것은 키가 아예 없는 것이다**(스토리 64) — `sound: undefined`를 실어 보내면
 * 「이름 없는 소리」를 조용함으로 읽는지가 남의 구현에 달린다.
 */
export function notificationPayload(content: NotifyContent, sound: boolean): NotifyPayload {
  const payload: NotifyPayload = {
    title: `${content.title} · ${content.subtitle}`,
    body: content.body,
  };
  return sound ? { ...payload, sound: MAC_DEFAULT_SOUND } : payload;
}

/** 이 회차에 밖으로 나가는 것 전부 — 알림 목록과 독 배지의 수. */
export interface NotifyOutgoing {
  toShow: ReadonlyArray<NotifyPayload>;
  /** 독에 붙일 수. 0이 「없앤다」이고, 그 뜻을 채널의 말로 옮기는 것은 부르는 쪽이다. */
  badge: number;
}

/**
 * **설정 스위치 둘이 무엇을 바꾸는지 정하는 자리 하나**(#206 · 스토리 64·66). 울릴 것이
 * 정해진 뒤(`createNotifier`) 고른 값을 먹여 **실제로 나갈 것**을 낸다.
 *
 * **자리가 여기인 이유**는 위 `notificationPayload`가 여기 있는 이유와 같다: 채널이 받는
 * 모양을 짓는 자리가 하나여야 채널이 바뀔 때 고칠 자리도 하나로 남는다. 그리고 이 자리가
 * 순수 함수라야 「끄면 조용하다」·「소리만 끈다」가 **표로 재진다** — 배선 안에 `if`로 두면
 * 그 두 줄을 지워도 어느 층도 빨개지지 않는다(2026-09-10 리뷰가 잡은 그 자리).
 *
 * **끄면 배지도 함께 내린다.** 결정 10의 채널 칸이 「알림 + 소리 + 독 배지」 셋을 한 묶음으로
 * 적었고 설정 칸은 그 묶음에 스위치를 하나만 뒀다 — 배지만 남기는 안은 그 스위치를 둘로
 * 쪼개는 것이라 결정 10 밖이다. 끈 순간 독에 수가 남아 있으면 「껐는데 아직 부른다」로도
 * 읽힌다. **다만 이것은 구현이 고른 것이지 사람이 닫은 결정이 아니다** — 스토리 65(앱을 안
 * 열고도 몇 개가 부르는지 안다)가 알림을 끈 사람에게서 통째로 사라지므로, 구현-스펙의
 * 미확인 목록에 그대로 올려 뒀다.
 *
 * `calling`은 **지금 부르는 셸의 수**다(회차가 낸 `NotifyStep.calling` — 화면값이 부르는 줄) — 이 회차에 울린
 * 것의 수가 아니다. 접혀서 안 울린 셸도 독에는 세어야 「몇 개가 부르나」가 맞는다.
 */
export function outgoing(
  fired: ReadonlyArray<NotifyContent>,
  calling: number,
  choice: NotifyChoice,
): NotifyOutgoing {
  if (!choice.enabled) return { toShow: [], badge: 0 };
  return { toShow: fired.map((one) => notificationPayload(one, choice.sound)), badge: calling };
}

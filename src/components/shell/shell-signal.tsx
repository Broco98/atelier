import { cn } from "@/lib/utils";
import { agentMarkOf } from "@/components/ui/agent-mark";
import { Spinner } from "@/components/ui/spinner";

// 상태 축이 **눈에 보이는 모양**(#203). 값을 정하는 자리는 `features/terminal/shell-attention`
// 이고 여기는 그것을 그리기만 한다 — 사이드바 행 · 알림 띠(#204) · 셸 탭(#205)이
// 같은 조각을 쓰므로 **한 자리에서 갈리지 않는다**: 색이 자리마다 달라지면 「행·띠·탭이 같은
// 셸에 다른 상태를 낸다」(스토리 79)가 색에서 먼저 깨진다.
//
// **화면값의 모양(아래 타입 셋)은 여기 적고, 터미널 feature가 그것을 가져간다**(`sidebar-active-band`
// 티켓 05 — 「값의 모양은 목록 쪽이나 `components/shell`에 따로 적는다」). 이 파일은 터미널
// feature를 **아무것도** 들이지 않는다 — 그래서 정적 마크업 seam에 산다(`shell-meta.tsx`가 같은
// 조건으로 그 자리에 있다). 사이드바 목록도 이 타입을 여기서 읽는다: 그 파일은
// `@/features/terminal`이라는 글자를 **한 번도 쓸 수 없고**(SidebarWorkList.test.tsx가 리터럴로
// 센다) 그러면서 화면값을 prop으로 받아야 한다. 방향이 한쪽인 것이 요점이다 — 값을 고르는
// 쪽(터미널)이 그리는 쪽의 어휘를 딛고, 그리는 쪽은 고르는 쪽을 모른다. 어휘는 한 벌이다:
// 같은 union을 두 벌 적으면 한쪽이 늘 때 다른 쪽이 조용히 늙는다(`AttentionKind`도 이 값을 딛는다).

/** 화면값 — 행의 레인·탭 채움·띠·알림이 **모두 이 값 하나만** 읽는다. */
export type ShellSignal = "waiting" | "done" | "working";

/**
 * 「확인할 것」에 드는 화면값(결정 8). 띠에 서는 것 · 독 배지가 세는 것 · 알림이 울리는 것이
 * 전부 **이 갈래 하나**이고, 도는 중과 조용한 셸은 여기 못 온다.
 *
 * **이름을 세워 두는 이유는 축이 늘 때다.** 실패(빨강)는 다음 판이고(결정 12), 그날
 * `ShellSignal`에 값을 하나 더하면 `RANK`·`SIGNAL_LABEL`·`TONE`은 컴파일러가 가리켜
 * 반드시 채워지지만, 「부르는가」를 리터럴 둘로 좁힌 자리들은 **아무 오류도 안 낸다** —
 * 새 축이 조용히 걸러져 띠에도 배지에도 알림에도 안 나타난다. 그 셋이 한 목록을 딛고
 * 있으므로(`callingShells`) 갈래의 이름도 하나여야 한다. 판정은 `isCalling` 한 자리다.
 */
export type CallingKind = Extract<ShellSignal, "waiting" | "done">;

/**
 * **부르는 셸이 한 말**(`sidebar-active-band` 결정 14). 행이 한 줄이 되면서 행에서 빠진 셸의 마지막
 * 말이 서는 자리 둘 — 호버 카드의 말 칸(`SignalNote`)과 행 버튼의 접근성 설명(`aria-description`)
 * — 이 이 값 하나를 나눠 읽는다. 고르는 것은 `callingNote`다.
 *
 * **종류가 함께 오는 것은 카드의 라벨 때문이다.** 칸의 라벨이 상태 말(「나를 기다림」·「확인할 것」)
 * 이라, 말만 실어 보내면 받는 쪽이 종류를 다른 값에서 다시 찾아 맞춰야 한다 — 그 둘이 같은
 * 셸의 것이라는 보장을 받는 쪽이 지게 된다. 종류가 `CallingKind`인 것은 이 값이 **부르는
 * 셸에만** 서기 때문이다.
 */
export interface CallingNote {
  kind: CallingKind;
  /** 셸이 마지막으로 한 말의 첫 줄. 어댑터가 접어 준 것 그대로이고 비어 있지 않다. */
  message: string;
}

/**
 * 상태의 **말**. 접근성 이름이 이 표를 읽는다 — 행 버튼(`<제목> — 나를 기다림`) · 탭 버튼 ·
 * 띠 줄이 같은 말을 쓴다(결정 8).
 *
 * **띠의 이름(「알림」)은 이 표에서 오지 않는다**(`BAND_LABEL`, `sidebar-active-band` 결정 13). 띠는 두 종류(답을
 * 기다리는 셸 · 끝났는데 안 본 셸)를 함께 모으므로, 그중 한쪽의 이름을 들면 다른 쪽 줄만
 * 서 있어도 머리가 틀린 말을 한다.
 */
export const SIGNAL_LABEL: Readonly<Record<ShellSignal, string>> = {
  waiting: "나를 기다림",
  done: "확인할 것",
  working: "도는 중",
};

/**
 * 상태색의 유틸리티. 토큰 넷은 `index.css`가 들고 라이트·다크가 거기서 갈린다.
 *
 * **이름을 조각내 짓지 않는다**(`bg-${tone}`). Tailwind는 소스에 **글자 그대로 있는** 클래스만
 * 만들므로 이어 붙인 이름은 규칙이 아예 안 생기고, 화면에서는 「색이 투명하다」로만 나타난다 —
 * 실제로 그렇게 났고 L3의 대비 검사가 그것을 잡았다(2026-09-10).
 *
 * **점과 글자가 다른 토큰을 읽는다**(`-ink`). 결정 3의 표가 못박은 것은 점의 색인데
 * (`amber-600`) 라이트 사이드바에서 그 색의 대비는 2.98이라, 같은 색을 **글자**에 쓰면
 * 두 줄 행을 연 판이 고치려던 3.0짜리 글자를 다시 만든다(그 판의 스토리 24). 점은 3px 후광이
 * 면적을 벌지만 글자에는 그런 것이 없어서, 라이트의 글자만 한 단 어둡게 갈랐다 — 지금 그
 * 잉크를 읽는 글자는 탭 이름과 호버 카드 말 칸의 라벨이다. 사람에게 열어 둔 물음은
 * `spec/물음-둘째-줄의-색.md`다.
 */
const TONE: Readonly<
  Record<CallingKind, { dot: string; text: string; fill: string; edge: string }>
> = {
  waiting: {
    dot: "bg-wait ring-wait-soft",
    text: "text-wait-ink",
    fill: "bg-wait-soft",
    edge: "ring-wait",
  },
  done: {
    dot: "bg-done ring-done-soft",
    text: "text-done-ink",
    fill: "bg-done-soft",
    edge: "ring-done",
  },
};

/**
 * 셸 탭의 **물들임**(#205, 결정 6 — 안 J3). 칸 배경을 통째로 칠하고 이름 글자를 같은 가족의
 * 잉크로 바꾼다. 도는 중과 아무 말 없는 칸은 `null`이다 — 탭에는 스피너를 안 세운다(스토리 52).
 */
export interface SignalTint {
  /** **칸 상자**에 붙는 것 — 채움과, 켜졌으면 1px 안쪽 테두리. 색은 배경뿐이다. */
  cell: string;
  /** **이름 글자에만** 붙는 잉크. 상자에 두면 안쪽이 통째로 물든다(아래 머리말). */
  ink: string;
}

/**
 * **이 함수가 여기 사는 것이 스토리 79다.** 탭은 채움이고 행은 점이라 **어휘가 둘인데**
 * (결정 6: 「표면이 다르면 문법이 달라도 된다」) 색은 하나여야 한다 — 자리마다 토큰을 새로
 * 고르면 같은 셸이 사이드바에서 앰버, 탭에서 초록이 되는 날이 오고 그것을 잡는 검사가
 * 없다. 같은 표(`TONE`)를 딛으면 그 어긋남이 **생길 자리가 없다**.
 *
 * **채움과 잉크가 갈려 나가는 것은 마크 때문이다**(판 04 결정 15 · 스토리 32). 마크는 늘
 * 「누구」이고 색은 늘 「어떤 상태」다 — 정체엔 색을 안 쓴다. 사이드바 행은 그 규칙을
 * **자리로** 지킨다(색은 레인의 점이 들고, 마크는 오른쪽 메타에 행 글자색으로 선다 — `SignalMeta`).
 * 탭에서는 마크가 칸 상자 **안**에 서므로 그 길이 없다: 잉크를 상자에 얹으면 이름이 숨는
 * 폭에서만 서는 글리프가 `currentColor`로 물들어, 하필 스토리 53이 「거기서도 신호가 살아야
 * 한다」고 적은 그 폭에서 claude 로고가 앰버가 된다. 그래서 **잉크를 이름 글자에만** 준다.
 *
 * **켜진 칸에서 앰버가 회색을 이긴다**(결정 6). 「부르는 탭」이 「고른 탭」보다 위 사실이라
 * `toggle-on` 대신 이 채움이 서고, 「고른 칸이다」는 1px 안쪽 테두리가 대신 말한다.
 * 테두리를 `ring`(그림자)으로 그리는 것은 **폭을 안 먹기 때문이다**(스토리 54) — `border`로
 * 그리면 안쪽 폭이 2px 줄어 상태가 바뀔 때마다 이름과 닫기가 옆으로 뛴다.
 *
 * **hover의 회색을 안 얹는다.** 채움과 겹치면 배경 유틸리티가 두 벌이 되어 승자를 정렬
 * 순서가 정하고(index.css의 경고), 그 승부에서 회색이 이기면 마우스가 지나갈 때마다
 * 부르는 칸이 조용해진다. 대가는 물든 칸이 hover에 아무 반응도 안 하는 것이고, 그 감수를
 * 이름으로 말하는 검사가 `ShellTabs.test.tsx`에 따로 서 있다.
 */
export function signalTint(kind: ShellSignal, active: boolean): SignalTint | null {
  if (kind === "working") return null;
  const tone = TONE[kind];
  return {
    // 이어 붙인 이름을 만들지 않는다 — 여기 서는 글자는 전부 `TONE`에 **그대로 있는** 것이라
    // Tailwind가 규칙을 만든다(위 `TONE` 머리말의 그 사고).
    cell: cn(tone.fill, active && "ring-1 ring-inset", active && tone.edge),
    ink: tone.text,
  };
}

/**
 * 이 화면값이 행의 오른쪽 메타에 **경과를 다는가**(결정 13 · `sidebar-active-band` S4). 도는
 * 중은 안 단다 — 레인의 스피너가 「지금 돈다」를 이미 말하고, 경과를 붙이면 「3분째 기다린다」로
 * 읽히는데 그 셸은 일하는 중이다.
 *
 * **함수 하나인 이유는 짝이 둘이기 때문이다.** 그리는 쪽(`SignalMeta`)과 시계를 켜는 쪽
 * (`Sidebar.tsx`의 `useNow`)이 같은 사실의 두 표현인데, 각자 조건을 적어 두면 규칙이 바뀌는
 * 날 한쪽만 고쳐도 화면이 멀쩡하다 — 값만 조용히 늙거나, 아무도 안 읽는 시계가 열여덟 행에서
 * 돈다. 둘 다 이 함수를 딛으면 그 어긋남이 안 생긴다.
 */
export function showsElapsed(kind: ShellSignal): boolean {
  return kind !== "working";
}

/**
 * 레인에 서는 글리프(결정 5). **행 왼쪽 14px 한 칸**에 들어가고, 화면값이 없으면 이것이
 * 아니라 work 상태 아이콘이 그 자리에 선다 — 그 갈림은 행이 한다(`WorkSectionList.tsx`).
 *
 * **점은 8px이고 후광은 3px인데 자리를 안 먹는다.** 후광을 `ring`(그림자)으로 그리는 것이
 * 목업의 `box-shadow: 0 0 0 3px`와 같은 모양이고, 테두리로 그리면 점이 14px 칸을 꽉 채워
 * 옆 제목과 붙는다.
 *
 * **도는 중은 앱의 `Spinner`다**(`sidebar-active-band` 결정 4·5). 레인 칸(14px)을 꽉 채우고
 * 색은 `currentColor`라 행 글자색을 물려받는다 — 여러 행이 함께 돌아도 부르는 행의 점보다
 * 조용하다. 회전(linear 1초)과 동작 줄이기의 원은 부품 파일의 CSS가 전부 든다: 자바스크립트로
 * 돌리면 열셋이 같이 도는 화면에서 그만큼의 리렌더가 나고(스토리 30), 「움직임을 끈 사람에게는
 * 빈틈 없는 원」도 손으로 다시 물어야 한다.
 *
 * **스크린리더에는 없다**(`aria-hidden`). 색만이 신호여선 안 되므로 상태를 말하는 자리는
 * 행 버튼의 이름이고, 여기서 한 번 더 말하면 같은 사실을 두 번 읽는다. Spinner는 겉 상자에
 * `role="status"`와 「Loading」을 들고 오므로 `aria-hidden`도 **겉 상자에** 준다 — 안쪽 svg에
 * 주면 그 역할이 행 안에 남는다. 표식(`data-signal`)도 겉 상자에 선다(검사와 레인 갈림이 집는다).
 */
export function SignalLane({ kind }: { kind: ShellSignal }) {
  if (kind === "working") {
    return <Spinner aria-hidden data-signal="working" className="size-3.5" />;
  }
  return (
    <span
      aria-hidden
      data-signal={kind}
      className={cn("size-2 shrink-0 rounded-full ring-[3px]", TONE[kind].dot)}
    />
  );
}

/**
 * 경과. `since`에서 지금까지의 **차**를 받는다 — 시계를 이 조각이 들지 않는 것은 정적
 * 마크업 seam에서 그대로 돌기 위해서이고(`now`가 밖에서 온다), 그래야 「2분 지났을 때 무엇이
 * 적히는가」를 시간을 기다리지 않고 잰다.
 *
 * **음수는 0으로 눕힌다.** 시각을 적는 쪽(훅 스크립트)과 읽는 쪽(앱)이 다른 프로세스라
 * 앞설 수 있고, 그대로 흘리면 행에 `-3s`가 앉는다.
 */
export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

/**
 * 행의 **오른쪽 메타 — 신호가 있는 갈래**(`sidebar-active-band` 결정 14 · S4). `[마크] [경과]`.
 * 행이 한 줄(32px)이 되면서 두 줄 행의 둘째 줄(마크 · 말 · 경과)이 하던 일 가운데 「누가」와
 * 「얼마나」만 이 칸이 든다 — 띠 줄과 같은 어휘다. 「무슨 말을 하나」는 올려 볼 때만 필요해서
 * 호버 카드의 말 칸과 행 버튼의 설명으로 갔다(`SignalNote`). 둘째 줄을 그리던 조각은
 * `sidebar-active-band` 판 5에서 걷혔다.
 *
 * | 화면값 | 서는 것 |
 * |---|---|
 * | 부름(기다림·안 본 완료) | 마크 + 경과. 마크가 없는 셸(그냥 zsh, 벨)이면 경과만 |
 * | 도는 중 | 마크. 경과는 없다(`showsElapsed`) |
 *
 * **마크가 상태색을 안 받는다**(판 04 결정 15). `currentColor`로 칠하는 글리프라 행의 글자색을
 * 그대로 받는다 — 색은 레인이 말한다. 경과는 부차 정보라 한 단 내려간 `tertiary`다.
 *
 * **규격(글자 크기·간격·오른쪽 여백)이 조용한 갈래(`ShellMeta`)와 같다.** 두 갈래가 같은 칸에
 * 번갈아 서므로 규격이 갈리면 행이 조용함↔부름을 오갈 때마다 숫자의 오른쪽 끝이 튄다 —
 * 그 끝이 구획 머리의 개수와 같은 x에 서는 것(`SidebarItem` 주석의 계약)도 둘 다 지켜야 한다.
 *
 * **아무것도 안 설 때는 `null`이다.** 도는 셸의 마크를 모르는 드문 갈래(훅 없는 셸이 OSC로
 * 앰버를 세웠다가 출력으로 풀린 칸에서 아는 명령이 안 도는 경우)다 — 빈 상자를 세우면 칸이
 * 오른쪽 여백만큼의 폭을 쥔다.
 */
export function SignalMeta({
  kind,
  running,
  since,
  now,
}: {
  kind: ShellSignal;
  /** 그 셸에서 도는 것의 원문 — 마크를 고르는 것은 여기다(표는 `agentMarkOf` 하나). */
  running: string | null;
  since: number;
  /** 지금. 밖에서 받는다 — 이 조각은 시계를 안 든다(`formatElapsed`). */
  now: number;
}) {
  const mark = agentMarkOf(running);
  const elapsed = showsElapsed(kind);
  if (mark === null && !elapsed) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-[5px] text-[11.5px]">
      {mark && (
        // 이름은 눈이 아니라 접근성으로만 읽는다 — `ShellMeta`의 무리와 같은 규칙이다.
        // 수가 안 붙는 것은 이 자리가 **셸 하나**의 신호이기 때문이다(무리가 아니다).
        <span role="img" aria-label={mark.label} className="flex shrink-0 items-center">
          <mark.Glyph className="size-3" />
        </span>
      )}
      {elapsed && (
        // 표식은 띠의 경과와 같은 것을 쓴다(`attention-band.tsx`) — 같은 어휘라 집는 이름도 하나다.
        <span data-elapsed="" className="shrink-0 tabular-nums text-tertiary">
          {formatElapsed(now - since)}
        </span>
      )}
    </span>
  );
}

/**
 * 호버 카드의 **말 칸**(`sidebar-active-band` 결정 14 · S6·S7). 행이 한 줄이 되면서 빠진 셸의 마지막
 * 말이 여기 선다. 받는 값이 곧 서는 조건이다 — 부르는 셸이 말을 했을 때만 값이 오고
 * (`CallingNote`), 그 가름은 값을 고르는 쪽 한 자리에 있다. 여기서 다시 묻지 않는다.
 *
 * **색이 드는 것은 라벨이다.** 라벨은 상태 말이고 상태색 잉크를 받는다 — 행 이름·띠 줄과 같은
 * 표(`SIGNAL_LABEL`)이고 색은 `TONE` 하나라, 같은 셸이 레인에서는 앰버인데 카드에서는 초록인
 * 날이 안 온다(스토리 79). 말 자체는 카드의 글자색 그대로다: 부르는 이유를 말하는 글이지
 * 상태가 아니다.
 *
 * **최대 두 줄에서 줄임표로 자른다(S7).** 카드는 폭이 정해져 있어 한 줄이면 대부분 잘린다.
 * 띄어쓰기 없는 긴 낱말(경로·명령)은 칸 안에서 끊는다 — 안 끊으면 줄임표 대신 카드 밖으로 샌다.
 *
 * **표식(`data-last-message`)은 검사가 이 칸을 집는 이름이다.** 역할이 없는 글 상자라 이름으로
 * 못 집고, 「칸이 없다」를 재려면 집을 이름이 있어야 한다.
 */
export function SignalNote({ kind, message }: CallingNote) {
  return (
    <div data-last-message="" className="flex flex-col gap-1 text-[12px] leading-snug">
      <span className={cn("font-medium", TONE[kind].text)}>{SIGNAL_LABEL[kind]}</span>
      <p className="line-clamp-2 wrap-break-word">{message}</p>
    </div>
  );
}

import { cn } from "@/lib/utils";
import { agentMarkOf } from "@/components/ui/agent-mark";
import type { CallingKind, ShellSignal } from "@/features/terminal/shell-attention";

export type { ShellSignal };

// 상태 축이 **눈에 보이는 모양**(#203). 값을 정하는 자리는 `features/terminal/shell-attention`
// 이고 여기는 그것을 그리기만 한다 — 사이드바 행 · 「확인할 것」 띠(#204) · 셸 탭(#205)이
// 같은 조각을 쓰므로 **한 자리에서 갈리지 않는다**: 색이 자리마다 달라지면 「행·띠·탭이 같은
// 셸에 다른 상태를 낸다」(스토리 79)가 색에서 먼저 깨진다.
//
// **터미널 feature에서 가져오는 것은 타입 하나뿐이다.** `import type`은 컴파일에서 지워지므로
// 이 조각은 여전히 정적 마크업 seam에 산다(`shell-meta.tsx`가 같은 조건으로 그 자리에 있다) —
// 값을 들이면 `@xterm/*`와 그 CSS가 딸려 와 그 층이 통째로 서지 못한다. 어휘를 여기서 다시
// 적지 않는 이유는 그 반대쪽이다: 같은 union을 두 벌 적으면 한쪽이 늘 때 다른 쪽이 조용히
// 늙는다.
//
// **`ShellSignal`을 여기서 다시 내보내는 것**은 사이드바 목록 때문이다: 그 파일은
// `@/features/terminal`이라는 글자를 **한 번도 쓸 수 없고**(SidebarWorkList.test.tsx가 리터럴로
// 센다) 그러면서 화면값의 타입을 prop으로 받아야 한다. 어휘가 두 벌이 되는 것보다 이 한 줄이
// 낫다.

/**
 * 상태의 **말**. 접근성 이름이 이 표를 읽는다 — 행 버튼(`<제목> — 나를 기다림`) · 탭 버튼 ·
 * 띠 줄이 같은 말을 쓴다(결정 8).
 *
 * 「확인할 것」이 안 본 완료의 이름인 것은 그 말이 띠의 이름이기도 하기 때문이다 — 띠에
 * 서는 두 종류(답을 기다리는 셸 · 끝났는데 안 본 셸) 중 이쪽이 「봤다」로 지워지는 쪽이다.
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
 * (`amber-600`) 라이트 사이드바에서 그 색의 대비는 2.98이라, 같은 색을 **말**에 쓰면 이
 * 판이 고치려던 3.0짜리 오른쪽 메타를 둘째 줄에서 다시 만든다(스토리 24). 점은 3px 후광이
 * 면적을 벌지만 글자에는 그런 것이 없어서, 라이트의 글자만 한 단 어둡게 갈랐다 —
 * 사람에게 열어 둔 물음은 `spec/물음-둘째-줄의-색.md`다.
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
 * 잉크로 바꾼다. 도는 중과 아무 말 없는 칸은 `null`이다 — 탭에는 링을 안 세운다(스토리 52).
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
 * 「누구」이고 색은 늘 「어떤 상태」다 — 정체엔 색을 안 쓴다. 사이드바 둘째 줄은 그 규칙을
 * **자리로** 지킨다(`SignalLine`: 색이 붙는 상자는 말 하나뿐이고 마크는 그 밖에 선다).
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
 * 이 화면값이 둘째 줄에 **경과를 다는가**(결정 13). 도는 중은 안 단다 — 레인의 링이 「지금
 * 돈다」를 이미 말하니 둘째 줄은 맥락을 지킨다.
 *
 * **함수 하나인 이유는 짝이 둘이기 때문이다.** 그리는 쪽(`SignalLine`)과 시계를 켜는 쪽
 * (`Sidebar.tsx`의 `useNow`)이 같은 사실의 두 표현인데, 각자 조건을 적어 두면 규칙이 바뀌는
 * 날 한쪽만 고쳐도 화면이 멀쩡하다 — 값만 조용히 늙거나, 아무도 안 읽는 시계가 열여덟 행에서
 * 돈다. 둘 다 이 함수를 딛으면 그 어긋남이 안 생긴다.
 */
export function showsElapsed(kind: ShellSignal): boolean {
  return kind !== "working";
}

/**
 * 레인에 서는 글리프(결정 5). **첫 줄 왼쪽 14px 한 칸**에 들어가고, 화면값이 없으면 이것이
 * 아니라 work 상태 아이콘이 그 자리에 선다 — 그 갈림은 행이 한다(`SidebarWorkList.tsx`).
 *
 * **점은 8px이고 후광은 3px인데 자리를 안 먹는다.** 후광을 `ring`(그림자)으로 그리는 것이
 * 목업의 `box-shadow: 0 0 0 3px`와 같은 모양이고, 테두리로 그리면 점이 14px 칸을 꽉 채워
 * 옆 제목과 붙는다.
 *
 * **링의 회전은 CSS다**(스토리 30) — `signal-ring`이 그 규격 전부를 든다(`index.css`).
 * 자바스크립트로 돌리면 링 열셋이 같이 도는 화면에서 그만큼의 리렌더가 나고, 「움직임을 끈
 * 사람에게는 정지한 완전한 링」도 손으로 다시 물어야 한다.
 *
 * **스크린리더에는 없다**(`aria-hidden`). 색만이 신호여선 안 되므로 상태를 말하는 자리는
 * 행 버튼의 이름이고, 여기서 한 번 더 말하면 같은 사실을 두 번 읽는다.
 */
export function SignalLane({ kind }: { kind: ShellSignal }) {
  if (kind === "working") {
    return <span aria-hidden data-signal="working" className="signal-ring size-3 shrink-0" />;
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
 * 행 둘째 줄의 **부르는 갈래**(결정 5·13). `[마크] [셸의 마지막 말] [경과]`.
 *
 * **마크가 상태색을 안 받는다**(판 04 결정 15 · 스토리 32). 마크는 늘 「누구」이고 색은 늘
 * 「어떤 상태」다 — 그래서 색이 붙는 상자는 말 하나뿐이고 마크는 그 **밖**에 선다.
 * `currentColor`로 칠하는 글리프라(그 결정) 색 상자 안에 넣으면 그것만으로 물든다.
 *
 * **도는 중은 경과를 안 붙인다**(결정 13). 레인의 링이 「지금 돈다」를 이미 말하니 둘째 줄은
 * 맥락을 지킨다 — 경과를 붙이면 「3분째 기다린다」로 읽히는데 그 셸은 일하는 중이다. 기각:
 * 도는 명령 이름(마크와 중복) · 종류·수로 되돌리기.
 *
 * **말이 없으면 상태 말이 바닥이다.** 훅이 페이로드를 못 읽어도 「그 이벤트가 났다」는
 * 남기므로(`PermissionRequest`가 그렇다) 말 없는 상태가 실제로 온다 — 그때 줄이 통째로 비면
 * 행은 부르는데 둘째 줄만 조용하다. 이것은 **바닥**이지 이 줄의 내용이 아니다: 둘째 줄이
 * 상태 이름을 적는 안(목업 D)은 「A와 같은 정보를 더 높게」라는 이유로 기각됐다(결정 5).
 *
 * **그런데 그 바닥이 서는 화면은 기각된 D와 겉이 같다.** 그리고 그것은 사고가 아니라 정규
 * 경로다 — 전이 표에 message 없는 상태가 둘 있고(벨로 뜬 `done`, `/clear` 뒤의 `working`),
 * 벨로 뜬 초록 행은 **늘** 둘째 줄에 「확인할 것」이 앉는다. 스펙이 이 자리를 안 정했으므로
 * 구현이 고른 것이고, 사람에게 물어 둔 것이 `spec/물음-둘째-줄의-색.md`의 둘째 물음이다
 * (상태 이름인가 · 종류·수로 되돌아가는가 · 비워 두는가). 정해지기 전까지 이 모양을 둔다.
 */
export function SignalLine({
  kind,
  message,
  running,
  since,
  now,
}: {
  kind: ShellSignal;
  /** 셸이 마지막으로 한 말의 첫 줄. 없으면 상태 말이 대신 선다. */
  message: string | null;
  /** 그 셸에서 도는 것의 원문 — 마크를 고르는 것은 여기다(표는 `agentMarkOf` 하나). */
  running: string | null;
  since: number;
  /** 지금. 밖에서 받는다 — 이 조각은 시계를 안 든다(`formatElapsed`). */
  now: number;
}) {
  const mark = agentMarkOf(running);
  return (
    <>
      {mark && (
        // 이름은 눈이 아니라 접근성으로만 읽는다 — `ShellMeta`의 무리와 같은 규칙이다.
        // 수가 안 붙는 것은 이 줄이 **셸 하나**의 말이기 때문이다(무리가 아니다).
        <span role="img" aria-label={mark.label} className="flex shrink-0 items-center">
          <mark.Glyph className="size-3" />
        </span>
      )}
      <span
        data-fade=""
        className={cn(
          "min-w-0 flex-1 whitespace-nowrap",
          // **도는 중은 아무 색도 안 든다** — 둘째 줄 상자가 깔아 둔 바닥
          // (`muted-foreground`, 대비 6.9) 그대로다. 「직전 말을 흐리게」(결정 13)는
          // 그 바닥에 **머무는 것**으로 이미 성립한다: 부르는 행은 `font-medium` +
          // 상태색으로 그 위로 올라오므로 옆에 두면 이쪽이 흐리다. `tertiary`(≈3.0)로 한 단
          // 더 내리는 안은 구현 결정 4가 토큰 이름까지 적어 막았다 — 「지금의 `tertiary`를
          // 그대로 내리지 않는다 … 경과 시간·종류 수 숫자는 `tertiary`여도 된다」이고,
          // 도는 중의 말은 경과도 숫자도 아니라 이 판이 고치려던 3.0을 말에서 다시 만든다.
          kind !== "working" && cn("font-medium", TONE[kind].text),
        )}
      >
        {message ?? SIGNAL_LABEL[kind]}
      </span>
      {showsElapsed(kind) && (
        // 부차 정보라 한 단 내려간다 — 둘째 줄의 바닥(`muted-foreground`)이 아니라
        // `tertiary`인 것은 「얼마나 기다렸나」가 말보다 뒤에 읽혀야 해서다(구현 결정 4).
        // 표식은 띠의 경과와 같은 것을 쓴다(`attention-band.tsx`) — 같은 조각이라 집는
        // 이름도 하나여야 한다.
        <span data-elapsed="" className="shrink-0 tabular-nums text-tertiary">
          {formatElapsed(now - since)}
        </span>
      )}
    </>
  );
}

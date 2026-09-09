import { cn } from "@/lib/utils";
import { agentMarkOf } from "@/components/ui/agent-mark";
import type { BandRow } from "@/features/terminal/shell-attention";
import { SIGNAL_LABEL, SignalLane, formatElapsed } from "./shell-signal";

// 「확인할 것」 띠(#204, 결정 5·8). 사이드바 목록 **위**, nav 아래에 서서 **부르는 셸만**
// 한 줄씩 모은다 — 열여덟 행을 훑는 대신 여기만 본다. 부르는 것이 하나도 없으면 **띠 자체가
// 없다**(스토리 38): 헤더만 남기거나 빈 상자를 그리면 평소 화면이 지금과 달라진다.
//
// **props만 받는 순수 컴포넌트다.** 값을 고르는 자리는 `Sidebar.tsx`이고(`bandRows` +
// work 제목), 여기는 그것을 그리기만 한다 — 그래야 이 조각이 정적 마크업 seam에 산다
// (`shell-signal.tsx`·`shell-meta.tsx`가 같은 조건으로 그 자리에 있다). 터미널 feature에서
// 가져오는 것은 **타입 하나뿐**이고 `import type`은 컴파일에서 지워지므로 그 조건이 지켜진다 —
// 값을 들이면 `@xterm/*`와 그 CSS가 딸려 와 이 층이 통째로 서지 못한다.
//
// **펼침은 여기 없다.** 「앱이 떠 있는 동안만 기억한다」(결정 5)는 상태의 수명 이야기라
// 스토어를 쥔 쪽이 들어야 하고, 그 쪽이 `Sidebar.tsx`의 `useState`다 — 이 조각이 스스로
// 들면 펼쳐진 띠를 마크업 seam에서 볼 길이 없어진다.

/**
 * 띠의 이름(결정 8). **행·탭의 접근성 이름과 같은 말이다** — 띠에 서는 두 종류(답을
 * 기다리는 셸 · 끝났는데 안 본 셸) 중 「봤다」로 지워지는 쪽의 이름이 곧 띠 전체의
 * 이름이라, 이 상수는 `SIGNAL_LABEL.done` **그 값 자체**다.
 *
 * 글자를 여기 다시 적지 않는 것이 요점이다. 「같은 말」이라고 주석에 적어 두고 값을 두 벌로
 * 두면 이름을 고치는 날 한쪽만 바뀌어, **띠 헤더와 줄의 접근성 이름이 서로 다른 말을 한다** —
 * `nav-items`가 `TERMINAL_LABEL`을 꺼낸 이유와 같고(「두 자리에 글자를 각각 적으면 … 「같은
 * 곳」이 화면에서 두 이름을 갖는다」), 검사도 이 상수를 통해 견주므로 그 어긋남을 못 잡는다.
 */
export const BAND_LABEL = SIGNAL_LABEL.done;

/**
 * 몇 줄까지 보이나(결정 8). 「사람이 한 번에 관리할 수 있는 에이전트는 3~5개」의 아래끝이고,
 * 그보다 많이 부르면 띠가 보여 주는 게 아니라 **사람이 밀리고 있다**는 뜻이라 접는다.
 *
 * 자르는 자리가 여기 하나인 것이 요점이다 — 값을 내는 쪽(`bandRows`)은 안 자른다.
 * 거기서 자르면 헤더의 `N`이 셀 것이 사라진다.
 */
export const BAND_LIMIT = 3;

/**
 * 띠의 줄 하나. **`bandRows`의 값에 화면의 이름이 붙은 모양이다** — 값을 다시 적지 않고
 * 그 타입을 늘리는 것은, 이 조각이 `onOpen`으로 **받은 것을 그대로 돌려주기** 때문이다:
 * 누르는 쪽이 어디로 갈지 정하려면 `owner`가 필요한데, 그리는 쪽은 그것을 읽지 않는다.
 * 넷만 골라 받으면 부르는 쪽이 「누른 줄이 어느 것인가」를 id로 되찾아야 하고, 그 되찾기가
 * 정렬과 갈리는 날 엉뚱한 화면이 열린다.
 *
 * 값 import가 아니라 **타입 import**라 이 조각은 여전히 정적 마크업 seam에 산다
 * (`shell-signal.tsx`가 `ShellSignal`을 같은 조건으로 들인다).
 */
export interface BandItem extends BandRow {
  /** 화면의 이름 — work 제목이거나, 최상위 셸이면 `Terminal`이다(결정 13의 다섯째). */
  title: string;
}

export function AttentionBand({
  items,
  now,
  expanded,
  onToggle,
  onOpen,
}: {
  /** 부르는 셸 전부, **이미 줄 세워진 채로**(기다림 먼저 · 오래된 순). 자르는 것은 여기다. */
  items: ReadonlyArray<BandItem>;
  /** 지금. 밖에서 받는다 — 이 조각은 시계를 안 든다(`SignalLine`과 같은 규칙). */
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (item: BandItem) => void;
}) {
  // **부르는 것이 없으면 통째로 없다**(스토리 38). 위쪽에서 `items.length`로 갈라 이 조각을
  // 아예 안 부르는 안은 기각했다 — 그 조건이 호출부로 새면 「띠가 없다」의 정의가 두 자리에
  // 생기고, 그중 하나만 이 seam이 본다.
  if (items.length === 0) return null;

  // 상한을 넘길 때만 접힌다. 셋 이하인데도 토글이 서면 눌러도 아무 일이 없는 줄이 하나 는다.
  const overflow = items.length > BAND_LIMIT;
  const shown = overflow && expanded ? items : items.slice(0, BAND_LIMIT);

  return (
    // 표식은 검사가 이 띠를 **정체성으로** 집기 위한 것이다 — 서고 사라지는 것 자체가
    // 이 판의 수용 기준이라(스토리 38) 「있는가」를 물을 자리가 필요하다.
    <div
      data-band=""
      className={cn(
        "flex shrink-0 flex-col gap-(--row-gap)",
        // **한 덩어리 상자다**(목업 `.strip` — 반지름 10 · 안쪽 위아래 6 · 아래 여백 8 ·
        // 바닥 `state-1`). 목록 위에 **뜬 것**으로 읽혀야 「열여덟 행을 훑지 않고 거기만
        // 본다」(스토리 36)가 성립하는데, 상자가 없으면 아래 work 행들과 같은 평면에 서서
        // 눈에 띄는 근거가 점 색 하나로 줄어든다. 위 여백 6은 nav와 떼는 몫이다.
        "mt-1.5 mb-2 rounded-[10px] bg-state-1 py-1.5",
        // **펼쳐도 목록을 다 먹지는 않는다.** 결정 8이 「상한 없이 전부 보이는 안」을 기각한
        // 근거가 「열이 부르면 사이드바 절반이 띠가 된다」인데, 펼침 뒤에는 그것을 막는 것이
        // 아무것도 없었다 — 형제가 전부 `shrink-0`이고 목록만 `flex-1 min-h-0`이라 낮은
        // 창에서 목록이 0까지 무너진 뒤 바닥 Settings가 `aside`의 `overflow-hidden` 밖으로
        // 잘린다. 여기서 굴리면 「전부 펼쳐진다」는 지켜지면서 그 대가가 안 난다.
        //
        // 한도가 둘인 것은 재는 것이 둘이라서다 — `max-h`는 **넉넉한 창에서** 띠가 사이드바
        // 절반을 먹는 것을 막고, `min-h-0`은 **낮은 창에서** 래퍼가 줄어들 때 이 상자가
        // 따라 줄게 한다(그 래퍼의 주석에 왜 그 자리가 줄어야 하는지가 있다).
        "max-h-[40vh] min-h-0 overflow-y-auto scroll-quiet",
      )}
    >
      {/* **누를 것이 없는 머리다** — 구획 헤더(`SectionHeader`)와 규격은 같되 접히지 않는다.
          띠가 접히는 것은 헤더가 아니라 아래 `+N 더`가 하는 일이고, 한 띠에 접는 것이 둘이면
          같은 일을 하는 컨트롤이 한 화면에 둘 서는 셈이다. 수가 오른쪽 끝에 서는 것은 바로
          아래 구획 헤더들과 같은 계약이다 — 한 컬럼에 세로로 붙어 서는 것들이 다른 무게로
          읽히지 않는다(`SidebarItem`의 GUTTER 주석과 같은 이야기). */}
      <div className="flex h-7 shrink-0 items-center gap-1 px-[9px]">
        <span className="shrink-0 text-[13.5px] font-medium text-tertiary">{BAND_LABEL}</span>
        {/* **접힌 것까지 센다.** 보이는 줄을 세면 넷째부터가 화면 어디에도 안 남는다 —
            그것이 「열여덟 행을 훑지 않는다」는 이 띠의 이유를 반쯤 되돌린다. */}
        <span
          data-band-count=""
          className="ml-auto shrink-0 text-[11.5px] tabular-nums text-tertiary"
        >
          {items.length}
        </span>
      </div>

      {shown.map((item) => (
        <BandLine key={item.id} item={item} now={now} onOpen={onOpen} />
      ))}

      {overflow && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          // 들여쓰기가 줄의 제목과 맞는다(9 + 레인 14 + 간격 9 = 32) — 같은 열에 서야
          // 이 줄이 「목록에 딸린 것」으로 읽힌다.
          // hover가 **한 단 위**인 것은 상자 바닥이 이미 `state-1`이라서다 — 같은 값을 얹으면
          // 눌러도 되는 줄이라는 것을 화면이 안 말한다(줄과 같은 이유, `BandLine` 참조).
          className="flex h-6 w-full shrink-0 items-center rounded-[8px] pl-8 pr-[10px] text-left text-[11.5px] text-tertiary transition-colors hover:bg-state-2 hover:text-muted-foreground"
        >
          {expanded ? "접기" : `+${items.length - shown.length} 더`}
        </button>
      )}
    </div>
  );
}

/**
 * 줄 하나 — `점 · 제목 · (셸 이름) · 마크 · 경과`, 28px(결정 5).
 *
 * **행(#203)과 어휘가 같고 규격이 다르다.** 점은 같은 조각(`SignalLane`)이고 말도 같은
 * 표(`SIGNAL_LABEL`)에서 오지만, 이 줄은 한 줄이라 message를 안 싣는다 — 띠는 「누가
 * 얼마나 기다리나」만 말하고 무슨 일인지는 그 행이나 그 셸이 말한다.
 *
 * **이름에 상태가 붙는다**(결정 8의 마지막 줄). 점은 `aria-hidden`이라(`SignalLane`)
 * 상태를 말하는 자리가 이 이름 하나다 — 색만이 신호여선 안 된다.
 *
 * **셸 이름도 그 이름에 실린다.** 스펙과 결정 8은 이름 모양을 `<work 제목> — 나를 기다림`
 * 이라 적었는데, 그 「제목」은 이 줄이 눈에 보여 주는 제목이다: 셸 이름이 붙는 경우가 곧
 * 「한 work에서 둘이 부른다」이므로(결정 5) 이름에서 그것을 빼면 두 줄의 접근성 이름이
 * **완전히 같아진다** — 눈으로 가르라고 넣은 그 글자가 스크린리더에는 안 가고, 「색만이
 * 신호여선 안 된다」가 셸 단위에서 깨진다. 사람에게 열어 둔 물음은
 * `spec/물음-띠-줄의-접근성-이름.md`다.
 */
function BandLine({
  item,
  now,
  onOpen,
}: {
  item: BandItem;
  now: number;
  onOpen: (item: BandItem) => void;
}) {
  const mark = agentMarkOf(item.running);
  return (
    <button
      type="button"
      aria-label={`${nameOf(item)} — ${SIGNAL_LABEL[item.kind]}`}
      onClick={() => onOpen(item)}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-(--glyph-gap) rounded-[8px] pl-[9px] pr-[10px] text-left text-[13.5px]",
        // **hover는 상자 바닥보다 한 단 위다** — 띠가 이미 `state-1` 위에 서 있어
        // 같은 값을 얹으면 아무 일도 안 일어난 것처럼 보인다(목업이 안 만난 충돌이다:
        // 저쪽 `.strip .it`에는 hover가 없다).
        "transition-colors hover:bg-state-2",
        // **결정 3의 우선순위가 띠 안에서도 글자로 남는다**(목업 `.strip .it` / `.it.d`).
        // 기다림은 `foreground`, 안 본 완료만 한 단 내려간다 — 바로 아래 work 행이 통째로
        // `text-muted-foreground`라(SidebarWorkList), 둘을 같은 색으로 두면 띠가 목록과
        // 같은 무게로 읽히고 「기다림 › 안 본 완료」가 점 색에만 남는다.
        item.kind === "waiting" ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {/* 레인 — work 행과 **같은 14px 한 칸**이라 점이 같은 x에 선다. 두 자리가 어긋나면
          띠와 목록이 같은 어휘를 쓰면서 눈에는 다른 줄로 읽힌다. */}
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <SignalLane kind={item.kind} />
      </span>
      {/* **좁아지면 이 상자만 줄어든다**(스토리 34) — 점·마크·경과는 `shrink-0`이라
          사이드바를 좁혀도 신호부터 죽지 않고 글자가 먼저 잘린다. 끝은 `…`이 아니라
          오른쪽 페이드다(행 제목과 같은 규칙, `index.css`의 `[data-fade]`). */}
      <span data-fade="" className="min-w-0 flex-1 whitespace-nowrap">
        {item.title}
        {/* **셸 이름은 제목 뒤에 옅게**(결정 5). 같은 상자 안이라 페이드도 함께 받는다 —
            밖에 세우면 이 조각이 폭을 먹어 제목이 그만큼 먼저 잘린다. */}
        {item.shellName !== null && <span className="text-tertiary"> {item.shellName}</span>}
      </span>
      {mark && (
        // 이름은 눈이 아니라 접근성으로만 읽는다 — `SignalLine`의 마크와 같은 규칙이고,
        // 색도 `currentColor`라 상태색으로 안 물든다(판 04 결정 15).
        <span role="img" aria-label={mark.label} className="flex shrink-0 items-center">
          <mark.Glyph className="size-3" />
        </span>
      )}
      {/* 부차 정보라 한 단 내려간다 — 둘째 줄의 경과와 같은 규격이다(구현 결정 4). */}
      <span data-elapsed="" className="shrink-0 text-[11.5px] tabular-nums text-tertiary">
        {formatElapsed(now - item.since)}
      </span>
    </button>
  );
}

/**
 * 줄이 **눈에 보여 주는 이름**. 접근성 이름이 이 함수를 딛는다.
 *
 * 함수 하나인 이유는 짝이 둘이기 때문이다 — 위 상자가 그리는 글자와 `aria-label`이 같은
 * 사실의 두 표현인데, 각자 이어 붙이면 한쪽만 늘어나는 날 눈과 귀가 다른 이름을 듣는다
 * (`showsElapsed`가 같은 이유로 함수다).
 */
function nameOf(item: BandItem): string {
  return item.shellName === null ? item.title : `${item.title} ${item.shellName}`;
}

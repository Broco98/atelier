import { cn } from "@/lib/utils";
import { ALL_MODES, modeNameOf, type Mode } from "@/mode";

/**
 * 어느 세계에 있는가를 말하고, 저쪽으로 건너가는 두 칸. 사이드바 최상단(신호등 띠 바로
 * 아래, nav 위)에 산다.
 *
 * **`SidebarItem` 규격이 아니다**(목업 `life-mode-switch.html`이 정본). 그 규격은 「누르면
 * 가는 목적지 한 줄」의 것이라 아이콘을 이고 배경 농도로 선택을 말하는데, 여기 두 칸은
 * **한 컨트롤**이다: 세로 리듬(`gap-(--row-gap)`) 밖에 서고, 선택은 농도가 아니라 두 칸
 * 사이를 미끄러지는 **떠오른 칩**이 말한다(`segment-on`의 근거가 그것이다). 같은 규격으로
 * 두면 nav 항목이 다섯 개인 것처럼 읽혀 「가는 곳」과 「어느 세계인가」가 한 줄에 섞인다.
 *
 * **점 신호는 없다**(판 02). 저쪽 세계에서 무언가 돌고 있다는 표시는 다음 판의 몫이다 —
 * 지금 넣으면 세그먼트가 「고르는 것」이면서 「알리는 것」이 되고, 그 둘의 규격이 아직 정하지
 * 않은 신호 어휘에 먼저 묶인다. 「점이 없다」는 `ModeSwitch.test.tsx`가 칸 안의 내용이
 * 낱말뿐임을 세어 붙든다.
 *
 * **선 칸을 눌러도 그대로 알린다.** 「같은 세계를 다시 고르면 아무 일도 없다」를 정하는 자리는
 * 목적지를 아는 쪽이다 — nav가 `key === activeKey`를 `AppShell`에 둔 것과 같은 분담이고,
 * 여기서 삼키면 히스토리 규칙이 두 자리로 갈린다. `SourceToggle`은 반대로 선 칸도 뒤집는데,
 * 그쪽 두 칸은 한 토글의 두 얼굴이고 여기 두 칸은 **각자 목적지를 가진 두 세계**다.
 */
export function ModeSwitch({ mode, onPick }: { mode: Mode; onPick: (mode: Mode) => void }) {
  // 칩이 몇 칸째에 서는가. 칸 순서가 `ALL_MODES` 순서라 인덱스가 그대로 자리다.
  const standing = ALL_MODES.indexOf(mode);
  return (
    // 바닥이 한 단계 눌려 있어야 그 위의 칩이 **떠오른 것**으로 읽힌다(`SourceToggle`과 같은
    // 근거). `grid-cols-2`는 결정 5가 「모드는 둘뿐」이라고 못박은 것을 그대로 적은 것이다 —
    // 셋이 되는 날 `ALL_MODES`를 도는 아래 루프는 조용히 늘어나지만 이 줄은 안 늘어나므로,
    // 그날 화면에서 바로 보인다(칩 폭 `50%`도 같은 수를 읽는다).
    <div
      role="group"
      // 사전의 말로 부른다. 목업(`life-mode-switch.html`)은 여기를 「공간 선택」이라 적었는데
      // CONTEXT.md의 「모드」 항목이 **「공간」을 _피할 말_로 등재했다** — 목업이 정본인 범위는
      // 세그먼트의 모양이고 낱말의 정본은 그 사전이다. 그리고 이것이 이 컨트롤의 유일한
      // 사용자 노출 문장이라, 여기 남으면 사전이 금지한 말을 앱이 스크린 리더로 말한다.
      // (`context-glossary.test.ts`가 그 되돌림을 붙든다.)
      aria-label="모드 선택"
      className="relative grid grid-cols-2 rounded-[10px] border bg-state-1 p-[3px]"
    >
      {/* 서 있는 칸을 말하는 떠오른 칩. 칸에 붙어 있지 않고 **두 칸 사이를 미끄러진다** —
          칸마다 배경을 켜고 끄면 「옮겨갔다」가 아니라 「깜빡였다」로 읽힌다(`SourceToggle`
          주석). 칩이 하나뿐이라 두 세계가 동시에 서는 판이 마크업에서 아예 불가능해진다.
          폭이 `calc(50% - 3px)`이고 이동이 `translate-x-full`(제 폭의 100%)인 것은 목업
          그대로다: 사이드바 폭이 240~400px로 드래그되므로 고정 px로 적으면 그 순간 칩이
          칸에서 어긋난다(`SourceToggle`의 `translate-x-[26px]`은 칸이 24px 고정이라 되는
          값이라 여기 베끼면 안 된다).
          곡선은 --ease-panel이 아니라 ease-out이다 — 그 곡선은 폭처럼 긴 거리를 위한 것이고
          여기 거리는 칸 하나라 끝에서 질질 끌린다(SourceToggle과 같은 근거). */}
      <span
        aria-hidden
        className={cn(
          "segment-on absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-[7px] transition-transform duration-[180ms] ease-out",
          standing > 0 && "translate-x-full",
        )}
      />
      {ALL_MODES.map((one) => (
        <button
          key={one}
          type="button"
          onClick={() => onPick(one)}
          // `aria-pressed`이지 `aria-expanded`가 아니다 — 이 칸은 무언가를 펼치는 것이 아니라
          // **눌린 채 서 있는** 것이다(목업도 그렇다). 그 구분이 사이드바에서는 값을 하나 더
          // 갖는다: 접히는 것은 구획 머리뿐이라 `aria-expanded`를 가진 버튼이 곧 구획 머리이고,
          // 그 사실에 검사 둘이 기대고 있다(`Sidebar.test.tsx`·`SidebarWorkList.test.tsx`).
          aria-pressed={one === mode}
          className={cn(
            // relative가 칩 위로 글자를 올린다 — 칩이 absolute라 그냥 두면 덮인다.
            "relative h-[30px] rounded-[7px] text-[12.5px] font-medium transition-colors",
            // 안 선 칸은 **배경을 안 켠다**(결정 31과 같은 근거) — 바닥이 이미 눌린 회색이라
            // 그 위에 hover 배경을 얹으면 서 있는 칸과 구분이 안 된다. 글자색만 짙어진다.
            one === mode ? "text-foreground" : "text-tertiary tint-hover",
          )}
        >
          {modeNameOf(one)}
        </button>
      ))}
    </div>
  );
}

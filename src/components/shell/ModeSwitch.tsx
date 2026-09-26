import { SegmentGroup, SegmentGroupItem } from "@/components/ui/segment-group";
import { ALL_MODES, type Mode } from "@/mode";

/**
 * 세계의 이름. **대문자 영어다**(US 59) — 사이드바에서 이 두 낱말이 nav 항목
 * (`Terminal`·`Archive`)과 같은 층이고, 그 아래 구획 머리부터 갈린다.
 *
 * `@/mode`의 표가 아니라 여기 사는 것은 이 저장소의 「쓰는 자리가 하나면 그 파일로, 둘이면
 * 공용으로」다(`shell-meta.tsx` 머리말). 화면에 세계의 이름을 적는 자리는 이 세그먼트
 * 하나뿐이라 표까지 올릴 이유가 없다 — 둘째 자리가 생기는 날 그 표로 옮긴다.
 * `Record<Mode, …>`라 모드가 하나 늘면 그날 L0가 여기서 빨개진다.
 */
const LABEL: Record<Mode, string> = { atelier: "Atelier", maison: "Maison" };

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
 * **두 칸 토글 부품(`SegmentGroup` — Base UI ToggleGroup 위)이다**(결정 1, 판 4). 사이드바 안이지만
 * 결정 3의 예외 목록에 들었다(P9). 한 컨트롤이라 Tab 자리가 하나이고(첫 칸 — S30), 그 안에서는 ←/→로
 * 옮긴다. 바닥·칩·칸의 모양은 부품 파일(`segment-group.tsx`)이 든다.
 *
 * **점 신호는 없다**(판 02). 저쪽 세계에서 무언가 돌고 있다는 표시는 다음 판의 몫이다 —
 * 지금 넣으면 세그먼트가 「고르는 것」이면서 「알리는 것」이 되고, 그 둘의 규격이 아직 정하지
 * 않은 신호 어휘에 먼저 묶인다. 「점이 없다」는 `ModeSwitch.test.tsx`가 칸 안의 내용이
 * 낱말뿐임을 세어 붙든다.
 *
 * **선 칸을 누르면 아무 일도 없다**(S16). 부품은 선 칸을 누르면 값을 비우는데(`[]`), 여기서는
 * 부품이 그 누름을 없던 일로 한다(`deselectable={false}`) — 두 칸은 **각자 목적지를 가진 두
 * 세계**라 「지금 세계를 다시 고른다」가 뜻하는 것이 없다. `SourceToggle`은 반대로 선 칸도
 * 뒤집는다: 그쪽 두 칸은 한 토글의 두 얼굴이다. 「같은 세계면 아무 데도 안 간다」는 여전히
 * 목적지를 아는 쪽(`modeSwitchTarget`)의 답이기도 하다 — 부품이 없던 일로 하는 것은 비운 값이지
 * 그 규칙이 아니다.
 */
export function ModeSwitch({ mode, onPick }: { mode: Mode; onPick: (mode: Mode) => void }) {
  return (
    <SegmentGroup
      // 사전의 말로 부른다. 목업(`life-mode-switch.html`)은 여기를 「공간 선택」이라 적었는데
      // CONTEXT.md의 「모드」 항목이 **「공간」을 _피할 말_로 등재했다** — 목업이 정본인 범위는
      // 세그먼트의 모양이고 낱말의 정본은 그 사전이다. 그리고 이것이 이 컨트롤의 유일한
      // 사용자 노출 문장이라, 여기 남으면 사전이 금지한 말을 앱이 스크린 리더로 말한다.
      // (`context-glossary.test.ts`가 그 되돌림을 붙든다.)
      aria-label="모드 선택"
      // 칸 순서가 `ALL_MODES` 순서다 — 칩이 이것과 값으로 서는 자리를 안다.
      cells={ALL_MODES}
      value={[mode]}
      deselectable={false}
      onValueChange={([pick]) => onPick(pick)}
    >
      {ALL_MODES.map((one) => (
        // `aria-pressed`이지 `aria-expanded`가 아니다(부품이 단다) — 이 칸은 무언가를 펼치는 것이
        // 아니라 **눌린 채 서 있는** 것이다(목업도 그렇다). 그 구분이 사이드바에서는 값을 하나 더
        // 갖는다: 접히는 것은 구획 머리뿐이라 `aria-expanded`를 가진 버튼이 곧 구획 머리이고,
        // 그 사실에 검사 둘이 기대고 있다(`Sidebar.test.tsx`·`SidebarWorkList.test.tsx`).
        <SegmentGroupItem key={one} value={one}>
          {LABEL[one]}
        </SegmentGroupItem>
      ))}
    </SegmentGroup>
  );
}

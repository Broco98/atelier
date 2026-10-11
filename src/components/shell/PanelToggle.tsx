import { PanelRight } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";

interface PanelToggleProps {
  open: boolean;
  onToggle: () => void;
  /** 여닫는 패널의 id(`aria-controls`) — `Frame`이 패널 칸과 함께 짓는다. */
  controls?: string;
}

/**
 * 패널 토글(ui-refresh 결정 9 · CONTEXT.md) — 작업 패널을 여닫는 버튼 하나. **머리 줄**의 오른쪽 끝에 선다(codex-ds 스펙 §4 · §10).
 * 자리는 레일을 따라 갈리고 `Frame`의 머리 줄이 잡는다(DS `.at-winctl-r`): 레일이 서면 머리 카드 밖, 레일 열 한가운데 위이고(DS
 * `HeadCard` 「패널 토글은 카드 밖, 패널 칸 줄 한가운데 위」), 서지 않으면 머리 카드 안 보기 배치(분할) 뒤다 — 지금 작업 화면은
 * 레일 칸이 하나라 이쪽이다(codex-ds 결정 25). 열림만 뒤집고 고른 레일 칸은 그대로 둔다 — ⌘Enter와 같은 일이다(`WorksPage`).
 *
 * 왼쪽 셸 컨트롤의 사이드바 토글(`PanelLeft`)을 뒤집은 그림이고 모양도 그것과 같다 — 위 줄의 작은 아이콘 버튼(`icon-button-xs`, 24 ·
 * `radius-md`)에 hover는 `quiet-hover`다. 위 줄에 서는 것은 모두 24다(DS). 열림은 켜진 면으로 따로 칠하지 않는다 — 사이드바 토글과
 * 같이 `aria-expanded`와 이름이 말한다. 한때 레일 열 맨 위의 32 원이었고 열리면 흰 원이었다(그때는 머리 줄이 없었다).
 *
 * 이름과 도움말은 상태를 탄다 — 누르면 무슨 일이 날지를 말한다(분할 토글과 같다). 열림은 `aria-expanded`가 이미 말하므로 설명은 달지
 * 않고, 키(⌘Enter)만 도움말 옆 Kbd와 설명으로 남는다(S28 — `Hint`의 `shortcut`).
 */
function PanelToggle({ open, onToggle, controls }: PanelToggleProps) {
  return (
    <Hint
      text={open ? "작업 패널 접기" : "작업 패널 펼치기"}
      shortcut="⌘Enter"
      announce="name"
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-keyshortcuts="Meta+Enter"
      className="icon-button-quiet icon-button-xs text-fg-secondary focus-ring"
    >
      <PanelRight className="size-4" />
    </Hint>
  );
}

export default PanelToggle;

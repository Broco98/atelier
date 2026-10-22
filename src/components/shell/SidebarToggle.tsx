import { PanelLeft } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { SIDEBAR_ID } from "./panel-layout";

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

// 셸 컨트롤 행의 첫 칸 — 자리는 ShellControls가 잡는다.
//
// 도움말은 상태를 타고(「사이드바 접기」 · 「사이드바 펼치기」 — 오른쪽 끝의 패널 토글과 같은 말투) 옆에 ⌘B(단축키 표의 `sidebar`)가
// 선다 — 있는 단축키를 버튼에서 배운다(codex-ds 스토리 98). 이름은 상태를 안 타고 「사이드바 토글」 그대로다 — 열림은
// `aria-expanded`가 말하고, 키는 설명 · `aria-keyshortcuts`로 남는다(S28 — `Hint`의 `shortcut`). 트리거에 직접 준 이름이 `Hint`의
// 것보다 이긴다.
//
// 여닫는 상자를 가리키고(`aria-controls` — 사이드바가 접히며 안의 포커스를 이 버튼에 넘길 때 그 이음으로 찾는다, `useFoldedFocus`),
// Tab 정류장임을 `tabIndex`로 명시한다 — WebKit의 Tab은 `tabindex` 없는 버튼에 서지 않는다(`@/lib/roving` 머리말).
function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <Hint
      text={open ? "사이드바 접기" : "사이드바 펼치기"}
      shortcut="sidebar"
      type="button"
      onClick={onToggle}
      aria-label="사이드바 토글"
      aria-expanded={open}
      aria-controls={SIDEBAR_ID}
      tabIndex={0}
      // 창 위 줄의 작은 아이콘 버튼 규격(`icon-button-xs` — 24 · `radius-md`)을 쓴다 — 셸 컨트롤과 같은 48 머리 줄에 나란히 서
      // 있어서, 이 버튼만 크기가 다르면 그 자리에서 바로 어긋나 보인다.
      // 기본 아이콘 색은 다른 아이콘 버튼(text-fg-tertiary)보다 진한 채로 둔다:
      // 사이드바가 닫혔을 때 이걸 못 찾으면 되돌릴 방법이 없다
      className="icon-button-quiet icon-button-xs text-fg-secondary focus-ring"
    >
      <PanelLeft className="size-3.75" />
    </Hint>
  );
}

export default SidebarToggle;

import { PanelRight } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { pressed, type KeyChord } from "@/lib/hotkeys";

interface PanelToggleProps {
  /** 여닫는 패널의 이름 — 토글의 이름 · 도움말이 그 뒤에 할 일을 붙인다(「작업 패널 접기」 · 「spec 목록 펼치기」). */
  name: string;
  open: boolean;
  onToggle: () => void;
  /** 여닫는 패널의 id(`aria-controls`) — `Frame`이 패널 칸과 함께 짓는다. */
  controls?: string;
}

/**
 * 패널 토글(ui-refresh 결정 9 · CONTEXT.md) — 그 화면의 오른쪽 패널(작업 화면은 작업 패널, Archive는 spec 목록 패널 — codex-ds 결정 32)을
 * 여닫는 버튼 하나. **머리 줄**의 오른쪽 끝에 선다(codex-ds 스펙 §4 · §10). 자리는 레일을 따라 갈리고 `Frame`의 머리 줄이 잡는다(DS
 * `.at-winctl-r`): 레일이 서면 머리 카드 밖, 레일 열 한가운데 위이고(DS `HeadCard` 「패널 토글은 카드 밖, 패널 칸 줄 한가운데 위」),
 * 서지 않으면 머리 카드 안 오른쪽 끝(작업 화면이면 보기 배치(분할) 뒤)이다 — 지금 작업 화면은 칸이 `spec` · `files` 둘이라 레일이
 * 서서 앞쪽이고, 레일이 없는 Archive가 뒤쪽이다(codex-ds 결정 25 · 32). 열림만 뒤집고 고른 레일 칸은 그대로 둔다 — ⌘Enter와 같은 일이다(판정은 아래 `togglesPanel`, 듣는 자리는 `WorksPage` ·
 * `ArchivePage`).
 *
 * 왼쪽 셸 컨트롤의 사이드바 토글(`PanelLeft`)을 뒤집은 그림이고 모양도 그것과 같다 — 위 줄의 작은 아이콘 버튼(`icon-button-xs`, 24 ·
 * `radius-md`)에 hover는 `quiet-hover`다. 위 줄에 서는 것은 모두 24다(DS). 열림은 켜진 면으로 따로 칠하지 않는다 — 사이드바 토글과
 * 같이 `aria-expanded`와 이름이 말한다. 한때 레일 열 맨 위의 32 원이었고 열리면 흰 원이었다(그때는 머리 줄이 없었다).
 *
 * 이름과 도움말은 상태를 탄다 — 누르면 무슨 일이 날지를 말한다(분할 토글과 같다). 앞말은 여닫는 패널의 이름이다(`name` — 공용 틀이 패널
 * 칸의 이름을 건넨다). 열림은 `aria-expanded`가 이미 말하므로 설명은 달지 않고, 키(⌘Enter — 단축키 표의 `panel`)만 도움말 옆 Kbd와
 * 설명 · `aria-keyshortcuts`로 남는다(S28 — `Hint`의 `shortcut`).
 *
 * Tab 정류장임을 `tabIndex`로 명시한다 — WebKit의 Tab은 `tabindex` 없는 버튼에 서지 않는다(`@/lib/roving` 머리말). 패널이 포커스를
 * 품은 채 접히면 그 포커스가 이리 온다(`controls` — `panel-layout`의 `useFoldedFocus`).
 */
function PanelToggle({ name, open, onToggle, controls }: PanelToggleProps) {
  return (
    <Hint
      text={open ? `${name} 접기` : `${name} 펼치기`}
      shortcut="panel"
      announce="name"
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      tabIndex={0}
      className="icon-button-quiet icon-button-xs text-fg-secondary focus-ring"
    >
      <PanelRight className="size-3.75" />
    </Hint>
  );
}

/**
 * ⌘Enter가 **패널 토글 몫인가** — 위 버튼과 같은 일을 하는 키다. 여닫는 것은 그 화면의 오른쪽 패널이다(작업 화면은 작업 패널,
 * Archive는 spec 목록 패널 — codex-ds 결정 32). 판정은 이 한 벌이고, 듣는 자리는 화면마다 하나씩이라(`WorksPage` · `ArchivePage`)
 * 저마다 제 패널의 열림을 뒤집는다.
 *
 * **기능 폴더 밖에 산다.** 한때 이 판정이 `features/works/WorksPage`에 있었고 Archive가 그것을 import했다 — 그 바람에 보관함
 * 화면의 청크가 작업 화면 모듈 전체(탭 줄 · 터미널 · 작업 패널)를 끌어왔다(`panel-layout.ts` 머리말의 사고와 같은 모양).
 *
 * **입력 · 편집 가능한 자리에 포커스가 있으면 그쪽 몫이다** — 제목 편집 칸, Archive의 찾기 칸, 그리고 **셸**(in-app-terminal
 * 결정 29 · in-app-terminal-v2 결정 43). 셸이 이 가드에 걸리는 것은 **xterm의 입력 자리가 바로 숨은 `<textarea>`**이기 때문이다
 * (`@xterm/xterm`의 `Terminal.textarea`가 `HTMLTextAreaElement`이고, 실제 요소는 `document.createElement("textarea")`로 만든
 * `.xterm-helper-textarea`다 — 둘 다 소스에서 확인함). 셸이 이 키를 삼키지도 않는다: `shellHotkey`가 아는 것은 ⌘T·⌘W 둘뿐이라
 * `attachCustomKeyEventHandler`가 `true`를 돌려주고, 이벤트는 window까지 올라온다. 탭은 보지 않는다 — 갈림은 탭이 아니라
 * **포커스**다(같은 결정 43 — 작업 화면이 한때 얹었던 터미널 탭 가드의 사연은 그쪽 리스너 곁에 있다).
 *
 * 어느 키인가는 단축키 표의 `panel`이 정한다(`@/lib/hotkeys` — 물리 키 `Enter`에 ⌘ 하나, 숫자 패드 Enter도 같은 키다). 한때 이
 * 판정만 `key`를 봤다 — `code`로 옮기며 숫자 패드 Enter는 `pressed`가 같은 키로 접어 그대로 받는다.
 *
 * **함수로 꺼낸 이유는 테스트다.** 이 저장소의 컴포넌트 seam은 정적 마크업이라 이펙트가 돌지 않고 키 이벤트도 없다 — 핸들러
 * 안에 두면 소스를 문자열로 훑는 검사밖에 못 건다. 구조적 이벤트 형태를 받는 순수 함수는 `shellHotkey`가 이미 쓰는 방식이고,
 * 그쪽과 같은 이유로 여기도 그렇게 둔다.
 */
export function togglesPanel(event: KeyChord & { target: EventTarget | null }): boolean {
  if (!pressed(event, "panel")) return false;
  const target = event.target as HTMLElement;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
    return false;
  return true;
}

export default PanelToggle;

import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

/**
 * 목록 패널(프로젝트·아카이브)의 **접힘** — 화면마다 따로 기억하는 값과 그것을 뒤집는 ⌘Enter를 한 곳에서
 * 든다. 돌려주는 것은 `[열렸나, 뒤집기]`이고, 뒤집기는 상세 카드 머리의 토글(`ListPanelToggle`)이 누른다.
 *
 * **기억은 화면마다 따로다**(`storageKey`) — 한쪽을 접었다고 다른 화면의 목록까지 접히지 않는다. 처음
 * 보는 화면은 펼쳐져 있다(`"0"`만 접힘이다).
 *
 * ⌘Enter는 「본문을 넓히는 토글」이다. 두 화면에서 접히는 것이 목록 패널뿐이라 그 자리를 받는다 — 작업
 * 화면에서는 같은 키를 작업 패널이 받는다(`WorksPage`의 `togglesWorkPanel`, 같은 판정). 글을 치는
 * 자리(입력칸·편집 가능한 자리)에서는 안 듣는다.
 */
export function useListPanel(storageKey: string): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(() => localStorage.getItem(storageKey) !== "0");
  const toggle = useCallback(() => setOpen((was) => !was), []);

  useEffect(() => {
    localStorage.setItem(storageKey, open ? "1" : "0");
  }, [storageKey, open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return [open, toggle];
}

interface ListPanelToggleProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * 목록 패널을 접고 펴는 버튼 — 프로젝트·아카이브 화면이 같은 이 하나를 상세 카드 머리의 끝에 둔다. 값은 `useListPanel`이 든다.
 * 모양은 카드 머리의 원형 아이콘 버튼이다(`size="icon-round"`, ui-refresh 결정 5 · 6). 열려 있어도 평소 흰 원 그대로다 — 머리
 * 컨트롤의 펼침 겹은 부품이 메뉴 트리거에만 준다.
 *
 * **그림은 누르면 될 일이다**(ui-refresh 결정 15) — 열렸으면 상세를 넓히는 쪽이 아니라 목록을 접는 쪽이라 안으로 모이는
 * `Minimize2`, 닫혔으면 다시 펴는 `Maximize2`다. 도움말과 같은 쪽을 말해야 그림과 글이 엇갈리지 않는다.
 *
 * 도움말은 툴팁이고 상태를 탄다 — 누르면 무슨 일이 날지를 말한다. 열림은 `aria-expanded`가 이미 말하므로
 * 설명(`aria-description`)은 안 단다(S28).
 */
function ListPanelToggle({ open, onToggle }: ListPanelToggleProps) {
  return (
    <Hint
      text={open ? "목록 패널 접기" : "목록 패널 펼치기"}
      aria-label="목록 패널 토글"
      aria-expanded={open}
      render={
        <Button
          variant="outline"
          size="icon-round"
          onClick={onToggle}
        />
      }
    >
      {open ? (
        <Minimize2 className="size-4" />
      ) : (
        <Maximize2 className="size-4" />
      )}
    </Hint>
  );
}

export default ListPanelToggle;

import { createRoot } from "react-dom/client";
import { Copy, FolderOpen, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// **메뉴 부품의 진열대** — 하위 메뉴(codex-ds 결정 10)의 모양을 L3가 칠해진 값으로 재려고 세운다(`submenu.spec.ts`).
// 앱이 이 파일을 들이지 않는다. 검사가 앱 화면 위에서 Vite dev 서버로 들인다(`page.addScriptTag`의 모듈 스크립트가
// `/e2e/menu-fixture.tsx`를 `import`한다) — 그래서 같은 React · 같은 부품 · 같은 `index.css`가 칠한다. 들이는 것은 앱이 이미 들이는 묶음(`react-dom` · `lucide-react` ·
// Base UI 메뉴)뿐이라 Vite가 의존성을 다시 묶지 않는다(다시 묶으면 열린 쪽이 모두 새로 고쳐진다).
//
// 하위 메뉴는 둘이다 — 짧은 이름만 든 것(카드가 하한 168로 선다)과 긴 이름을 든 것(상한 220에서 줄임표로 접힌다). 앱의 work 메뉴(codex-ds
// 티켓 16)도 같은 부품으로 하위 메뉴를 달지만, 그 줄의 길이는 work의 slug · 프로젝트 이름을 따라가 두 끝을 골라 세울 수 없다. 그래서
// 모양은 여기서 재고, work 메뉴의 L3는 하위 메뉴가 열리고 항목이 무엇을 부르는지를 잰다(`works-floating.spec.ts`).

/**
 * 진열대를 `body` 끝에 세운다. 여는 버튼의 이름은 「진열대 메뉴」다.
 *
 * **버튼은 화면 위쪽에 고정한다.** 흐름대로 두면 앱 화면(창 높이를 다 먹는다) 아래 화면 밖에 서서, 메뉴가 화면 바닥에 붙어
 * 뜬다. 그러면 하위 메뉴 카드가 바닥에 닿아 Base UI가 카드를 화면 안으로 밀어 올리고(충돌 피하기), 첫 줄이 연 줄에서 한 줄만큼
 * 어긋난다 — 재려는 자리(`alignOffset` · `sideOffset`)가 아니라 밀린 자리를 재게 된다. 위 160 · 왼 520이면 부모 카드(260)와 긴 하위
 * 카드(220)가 다 들어갈 자리가 아래 · 오른쪽에 남는다.
 */
export function 메뉴진열대를세운다(): void {
  const holder = document.createElement("div");
  holder.dataset.menuFixture = "";
  holder.style.cssText = "position: fixed; top: 160px; left: 520px;";
  document.body.appendChild(holder);
  createRoot(holder).render(
    <DropdownMenu>
      <DropdownMenuTrigger>진열대 메뉴</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>
          <Pencil />
          <span className="min-w-0 flex-1 truncate">이름 바꾸기</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Copy />
            <span className="min-w-0 flex-1 truncate">복사</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <span className="min-w-0 flex-1 truncate">경로</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span className="min-w-0 flex-1 truncate">이름</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderOpen />
            <span className="min-w-0 flex-1 truncate">Finder에서 열기</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <span className="min-w-0 flex-1 truncate">아주 긴 프로젝트 이름이 하위 메뉴 카드의 상한을 넘는 줄</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

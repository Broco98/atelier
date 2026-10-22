import { useRef, type ReactNode } from "react";
import { CodeXml, Copy, Eye } from "lucide-react";
import type { PathView } from "@/components/shell/PathBar";
import { TargetMenu } from "@/components/shell/TargetMenu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// **문서 글의 우클릭 메뉴**(codex-ds 스펙 §9 대상 메뉴 표 「문서 글」 · 결정 6 · 7 · 10 · 11, 티켓 30). Works 문서(`SpecViewer`)와 Archive
// 문서(`ArchivePage`)의 구르는 몸이 이 상자다 — 문서가 설 때만 선다(spec이 없는 work · 남은 문서가 없는 아카이브에는 없다).
//
// - **고른 글자가 있으면 「복사」 하나**다 — 고른 글을 클립보드에 쓰고 「고른 글자 복사됨」을 알린다(토스트는 고른 글을 되풀이하지
//   않는다 — 긴 고름이면 글 전체가 토스트에 선다). 고름은 그대로 남는다.
// - **없으면 「원문으로 보기」 · 「경로 복사」**다 — 경로 줄의 보기 묶음 · 동그란 복사와 같은 상태 · 같은 동작이다(`PathView` · 그
//   화면의 경로 복사). 이미 원문이면 같은 자리가 「문서로 보기」다. 보기를 못 바꾸는 파일(그림 · 경로 줄의 묶음이 잠긴 때)에서는 서지
//   않는다(결정 10 「해당하지 않는 항목은 숨긴다」).
//
// **고름은 오른쪽 누름의 순간에 쥔다**(`pointerdown`) — macOS WebKit은 우클릭한 낱말을 `contextmenu` 전에 스스로 골라, 그 사건의 때에
// 읽으면 「고른 것 없이 글자를 우클릭」이 「그 낱말을 골랐다」가 된다. 메뉴가 서면 누른 순간의 고름으로 되돌린다 — 웹뷰가 고른 낱말이
// 걷히고, 고른 것 안의 우클릭은 그 고름 그대로다. **열린 동안에도 그 고름을 지킨다** — WebKit은 고름 밖의 요소로 포커스가 옮기면
// 고름을 지운다(카드가 포커스를 쥘 때 · 줄을 옮길 때). 그래서 메뉴 안으로 포커스가 들 때마다 같은 고름으로 되돌린다(`onFocusIn`).
// 닫히면 포커스는 상자로 돌아가고, 고름은 상자 안이라 남는다.
//
// **상자가 포커스를 받는다**(`tabIndex` 0) — ⇧F10 · 메뉴 키가 들을 자리다. 키로 열면 카드는 고름의 끝 줄 왼쪽 아래에, 고른 것이
// 없으면 상자의 왼쪽 위에 선다(상자가 카드 높이라 왼쪽 아래면 카드 밖이다). 열린 동안의 대상 테두리는 상자 **안쪽**에 선다
// (`data-ring-inset` — 상자가 카드 끝까지 차 바깥 링은 카드가 자른다, `index.css`의 `focus-ring`).

/** 경로 줄과 같은 것 — 문서 글 메뉴가 그 화면에서 받는다. */
export interface DocMenu {
  /** 경로 줄의 보기 묶음이 받는 값 그대로 — 「원문으로 보기」가 뒤집는다. 잠겼으면 그 항목이 없다. */
  view: PathView;
  /** 경로 줄의 동그란 복사와 같은 동작. 없으면(가리킬 문서가 없다) 「경로 복사」가 없다. */
  onCopyPath?: () => void;
}

/** 메뉴를 연 순간의 고름 — 상자 안의 고른 글(없으면 `""`)과 그때의 범위들(되돌릴 것). */
interface Picked {
  text: string;
  ranges: Range[];
}

/** 지금의 고름을 쥔다. 고른 글은 그 고름이 상자에 걸칠 때만 센다 — 다른 칸에서 고른 글은 문서 글의 것이 아니다. */
function pickedIn(box: HTMLElement): Picked {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return { text: "", ranges: [] };
  const ranges = Array.from({ length: selection.rangeCount }, (_, at) => selection.getRangeAt(at).cloneRange());
  const inside = !selection.isCollapsed && ranges.some((range) => range.intersectsNode(box));
  return { text: inside ? selection.toString() : "", ranges };
}

/** 쥔 고름으로 되돌린다 — 웹뷰가 우클릭으로 고른 낱말을 걷는다. */
function restore({ ranges }: Picked): void {
  const selection = getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  for (const range of ranges) selection.addRange(range);
}

/** 키로 열 때 카드가 설 자리 — 고른 글이 있으면 그 끝 줄의 왼쪽 아래, 없으면 상자의 왼쪽 위다. */
function keySpot({ text, ranges }: Picked, box: HTMLElement): { x: number; y: number } {
  const rects = text === "" ? undefined : ranges[ranges.length - 1]?.getClientRects();
  const last = rects?.[rects.length - 1];
  if (last) return { x: last.left, y: last.bottom };
  const spot = box.getBoundingClientRect();
  return { x: spot.left, y: spot.top };
}

/** 고른 글을 클립보드에 쓴다. 못 쓰면 「못 한 일」로 알린다 — 「복사됨」이라 거짓말하지 않는다. */
function copyPicked(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => showToast("고른 글자 복사됨"),
    (e: unknown) => showToast(`복사하지 못했어요: ${e}`, "rejected"),
  );
}

/**
 * 문서 글의 상자 — 그 화면의 구르는 몸 자리에 그대로 선다(`className`이 그 자리의 모양이다). 안의 우클릭 · ⇧F10이 문서 글 메뉴를
 * 연다(머리말).
 */
export function DocTextBox({ menu, className, children }: { menu: DocMenu; className: string; children: ReactNode }) {
  // 오른쪽 누름의 순간 고름 — 웹뷰가 우클릭한 낱말을 고르기 전의 것이다. 그 누름의 우클릭이 받아 간다.
  const pressed = useRef<Picked | null>(null);
  const { view, onCopyPath } = menu;
  return (
    <TargetMenu<Picked>
      targetOf={(_from, box, by) => {
        const picked = (by === "pointer" ? pressed.current : null) ?? pickedIn(box);
        pressed.current = null;
        if (picked.text === "" && view.locked && !onCopyPath) return null;
        return { of: picked, ring: box, at: by === "key" ? keySpot(picked, box) : undefined };
      }}
      onOpen={restore}
      onFocusIn={restore}
      items={(picked) =>
        picked.text !== "" ? (
          <ContextMenuItem shortcut="copy" onClick={() => copyPicked(picked.text)}>
            복사
          </ContextMenuItem>
        ) : (
          <>
            {!view.locked && (
              <ContextMenuItem onClick={() => view.onChange(!view.source)}>
                {view.source ? <Eye /> : <CodeXml />}
                <span className="min-w-0 flex-1 truncate">{view.source ? "문서로 보기" : "원문으로 보기"}</span>
              </ContextMenuItem>
            )}
            {onCopyPath && (
              <ContextMenuItem onClick={onCopyPath}>
                <Copy />
                <span className="min-w-0 flex-1 truncate">경로 복사</span>
              </ContextMenuItem>
            )}
          </>
        )
      }
    >
      {(region) => (
        <div
          tabIndex={0}
          data-doc-text=""
          data-ring-inset=""
          onPointerDown={(event) => {
            if (event.button === 2 || (event.button === 0 && event.ctrlKey)) pressed.current = pickedIn(event.currentTarget);
          }}
          onContextMenu={region.onContextMenu}
          onKeyDown={region.onKeyDown}
          className={cn(className, "focus-ring")}
        >
          {children}
        </div>
      )}
    </TargetMenu>
  );
}

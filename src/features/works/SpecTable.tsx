import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { setResizing } from "@/components/shell/useResizableWidth";

// 예쁜 보기의 표 블록. 가로 스크롤 위에 전체화면 확대와 열 폭 조절을 얹는다.
// 모달은 MermaidBlock과 같은 패턴이다 — 포털로 띄우는 전면 오버레이, Escape·바깥 클릭으로 닫기.

// 끄는 동작은 표가 받고, 손잡이는 열 머리(th)가 그린다 — 손잡이가 설 자리는 열 경계뿐이고
// 그 자리를 아는 건 th다. 손잡이는 자기가 몇 번째 열인지 모른다. 끌기 시작할 때 DOM에서 읽는다.
interface DragHandle {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

const ColumnDrag = createContext<DragHandle | null>(null);

// 열 경계에 얹는 손잡이 — 부모 th가 relative여야 한다. 커서가 조절 가능함을 알리는 전부다.
export function ColumnResizeHandle() {
  const handle = useContext(ColumnDrag);
  if (!handle) return null;
  return (
    <span
      {...handle}
      className="absolute inset-y-0 right-0 z-10 w-[9px] cursor-col-resize touch-none select-none"
    />
  );
}

// 열이 이보다 좁아지면 안에 든 것을 알아볼 수 없다
const MIN_COLUMN = 48;

function Table({ className, children, ...props }: React.ComponentProps<"table">) {
  // null이면 아직 내용이 폭을 정하는 상태다. 조절한 폭은 여기에만 있다 — 저장소에 남기지 않는다.
  const [widths, setWidths] = useState<number[] | null>(null);
  const drag = useRef<{ column: number; x: number; base: number[] } | null>(null);

  // 끄는 도중 표가 사라지면(문서 전환) pointerup도 pointercancel도 오지 않는다.
  // 억제가 영구히 남는 유일한 경로라 언마운트에서 무조건 푼다 (ResizeHandle과 같은 이유)
  useEffect(() => () => setResizing(false), []);

  const endDrag = () => {
    drag.current = null;
    setResizing(false);
  };

  const handle: DragHandle = {
    onPointerDown: (e) => {
      const cell = e.currentTarget.closest("th");
      const row = cell?.parentElement;
      if (!cell || !row) return;
      // 첫 드래그 시점에 지금 폭을 전부 재서 고정한다. 그래야 한 열을 끌었을 때
      // 나머지 열이 내용에 따라 다시 계산되어 딸려 움직이지 않는다.
      const base = widths ?? Array.from(row.children, (c) => c.getBoundingClientRect().width);
      drag.current = { column: cell.cellIndex, x: e.clientX, base };
      setWidths(base);
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizing(true);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const next = [...d.base];
      next[d.column] = Math.max(MIN_COLUMN, d.base[d.column] + e.clientX - d.x);
      setWidths(next);
    },
    onPointerUp: (e) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      endDrag();
    },
    // 웹뷰/OS가 드래그를 가로채면 pointerup이 오지 않는다 — 캡처는 이미 풀린 상태다
    onPointerCancel: endDrag,
  };

  return (
    <ColumnDrag.Provider value={handle}>
      <table
        {...props}
        className={cn(
          "border-collapse text-[13.5px]",
          // 폭을 고정하기 전: 표 폭은 소스 보기의 긴 줄과 같은 규격이다 — w-max로 내용만큼
          // 넓어져 셀이 줄바꿈되지 않고, min-w-full로 좁은 표는 본문 폭을 채운다. w-full이면
          // 표가 컨테이너에 갇혀 넘칠 수가 없고, 넘치지 않으니 가로 스크롤도 생기지 않는다.
          // 고정한 뒤: 폭의 출처는 colgroup 하나뿐이다. min-w-full을 남겨 두면 좁은 표가
          // 본문 폭까지 늘어나며 남는 폭을 전 열에 나눠 줘서, 끌지 않은 열까지 따라 움직인다.
          widths ? "table-fixed" : "w-max min-w-full",
          className,
        )}
        style={widths ? { width: widths.reduce((sum, w) => sum + w, 0) } : undefined}
      >
        {widths && (
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
        )}
        {children}
      </table>
    </ColumnDrag.Provider>
  );
}

function SpecTable({ children, ...props }: React.ComponentProps<"table">) {
  const [fullOpen, setFullOpen] = useState(false);

  useEffect(() => {
    if (!fullOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullOpen]);

  return (
    <div className="group/table relative">
      {/* 넓은 표는 자기 안에서만 가로로 스크롤한다 — 본문 스크롤 영역은 가로로 확장되지 않는다 */}
      <div className="overflow-x-auto scroll-quiet">
        <Table {...props}>{children}</Table>
      </div>

      {/* 확대 버튼은 스크롤 상자 바깥에 얹는다 — 안에 두면 표를 옆으로 밀 때 같이 밀려 사라진다.
          숨기는 방법은 거터의 참조 복사 버튼과 같은 invisible이다. opacity-0으로 감추면
          투명한 채로 표의 오른쪽 위 모서리를 계속 덮고 있어서, 커서가 이미 그 자리에 멎어
          있을 때 오는 클릭을 아무것도 보이지 않는 버튼이 가로챈다 */}
      <button
        type="button"
        onClick={() => setFullOpen(true)}
        title="전체화면으로 크게 보기"
        aria-label="표를 전체화면으로 보기"
        className="invisible absolute right-1.5 top-1.5 flex size-[22px] items-center justify-center rounded-[7px] border bg-background text-tertiary hover:text-foreground group-hover/table:visible"
      >
        <Maximize2 className="size-3" strokeWidth={2} />
      </button>

      {fullOpen &&
        // 문서 최상위에 렌더한다 — 조상 어디에 변형이 걸려도 fixed의 기준 상자가 바뀌지 않는다
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-9"
            onClick={() => setFullOpen(false)}
          >
            <div
              className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-[14px] border border-border-strong bg-background shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-3.5">
                <span className="font-mono text-[12px] text-tertiary">표</span>
                <button
                  type="button"
                  onClick={() => setFullOpen(false)}
                  title="닫기 (Esc)"
                  aria-label="닫기"
                  className="flex size-[26px] items-center justify-center rounded-[9px] text-tertiary transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </div>
              {/* 모달에서는 이 상자 하나가 세로·가로를 다 받는다 — 안쪽에 가로 상자를 또 두면
                  가로 스크롤바가 표 밑에 붙어 화면 밖으로 내려가 손이 닿지 않는다 */}
              <div className="min-h-0 flex-1 overflow-auto p-7 scroll-quiet">
                <Table {...props}>{children}</Table>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default SpecTable;

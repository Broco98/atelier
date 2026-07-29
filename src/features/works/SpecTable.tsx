import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// 예쁜 보기의 표 블록. 가로 스크롤 위에 전체화면 확대를 얹는다.
// 모달은 MermaidBlock과 같은 패턴이다 — 포털로 띄우는 전면 오버레이, Escape·바깥 클릭으로 닫기.

function Table({ className, children, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      {...props}
      className={cn(
        // 표 폭은 소스 보기의 긴 줄과 같은 규격이다 — w-max로 내용만큼 넓어져 셀이 줄바꿈되지 않고,
        // min-w-full로 좁은 표는 본문 폭을 채운다. w-full이면 표가 컨테이너에 갇혀 넘칠 수가 없고,
        // 넘치지 않으니 가로 스크롤도 생기지 않는다.
        "w-max min-w-full border-collapse text-[13.5px]",
        className,
      )}
    >
      {children}
    </table>
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

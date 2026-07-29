import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// 본문 블록을 전면 오버레이로 키워 보는 틀 — 다이어그램과 표가 같은 손버릇으로 열고 닫히도록
// 한 곳에서 모양과 닫는 방법을 정한다. 본문(children)만 블록마다 다르다.
// children은 카드의 세로 흐름에 그대로 놓이므로 스크롤 상자 노릇까지 스스로 해야 한다
// (min-h-0 flex-1 overflow-auto). 여기서 감싸면 상자가 둘이 되어 가로 스크롤바가
// 콘텐츠 밑에 붙고 화면 밖으로 내려간다.
function FullscreenModal({
  label,
  controls,
  onClose,
  children,
}: {
  label: string;
  controls?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // 문서 최상위에 렌더한다 — 조상 어디에 변형이 걸려도 fixed의 기준 상자가 바뀌지 않는다.
    // 포털이어도 이벤트는 React 트리를 따라 오르므로 바깥 블록과의 관계는 그대로다.
    createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-9"
        onClick={onClose}
      >
        <div
          className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-[14px] border border-border-strong bg-background shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-3.5">
            <span className="font-mono text-[12px] text-tertiary">{label}</span>
            <span className="flex items-center gap-1">
              {controls}
              <button
                type="button"
                onClick={onClose}
                title="닫기 (Esc)"
                aria-label="닫기"
                className="ml-1 flex size-[26px] items-center justify-center rounded-[9px] text-tertiary transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </span>
          </div>
          {children}
        </div>
      </div>,
      document.body,
    )
  );
}

export default FullscreenModal;

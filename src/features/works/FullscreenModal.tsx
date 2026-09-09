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
        // 막은 **다른 모달과 같은 것을 쓴다**(`modal-scrim`). 한때 여기만 `bg-black/40`이었고
        // 팔레트·확인 창은 `bg-background/55 backdrop-blur-[2px]`였다 — 뒤를 어둡게 한다는
        // 답은 이 자리가 먼저 냈는데 규칙으로 서질 못했다. 값이 40%에서 25%로 옅어졌지만
        // 이 자리에서는 거의 안 보인다: 카드가 `h-full w-full max-w-[1280px]`이라 막이
        // 드러나는 곳이 위아래 36px과 창이 1280보다 넓을 때의 좌우뿐이다.
        className="modal-scrim flex items-center justify-center p-9"
        // 바깥을 눌러 닫는 판단은 click이 아니라 눌린 자리로 한다. click은 눌린 곳과 뗀 곳의
        // 공통 조상에서 나므로, 카드 안에서 시작한 드래그를 여기서 놓기만 해도 이 상자에서
        // click이 나 모달이 닫힌다 — 표 셀의 글자를 끌어 선택하다 여백에서 손을 떼는 길이다.
        // (다이어그램 본문은 select-none이라 이 길이 없었다. 글자를 고를 수 있는 표가
        //  같은 틀을 쓰면서 열렸다.) 눌린 자리가 이 상자 자신일 때만 닫는다.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-[14px] border border-border-strong bg-background shadow-lg">
          <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-3.5">
            <span className="font-mono text-[12px] text-tertiary">{label}</span>
            <span className="flex items-center gap-1">
              {controls}
              <button
                type="button"
                onClick={onClose}
                title="닫기 (Esc)"
                aria-label="닫기"
                className="icon-button-quiet ml-1 text-tertiary"
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

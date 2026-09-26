import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { appToasts, SHORT_TOAST_MS, toastActionsOf } from "./app-toast";

/**
 * 이 work의 토스트가 서는 자리(프로세스 스펙 P2 (나)). 앱 셸에 하나 서서 **어느 화면에서든** 보인다 —
 * work · Room 화면, Terminal, 설정, 아카이브.
 *
 * **Provider는 Viewport만 감싼다 — 앱 셸의 children을 감싸지 않는다.** Base UI의 토스트는 가장 가까운
 * Provider를 React 문맥으로 찾는다(`useToastManager`가 `useContext`다). 이웃 work(`sidebar-active-band`)은
 * 자기 Provider를 앱 루트에 두는데, 이 Provider가 화면들을 감싸면 그 아래 화면의 토스트가 전부 이 자리로
 * 샌다. 이 자리의 토스트는 모듈 매니저(`appToasts`)로만 들어온다.
 *
 * **자리는 오른쪽 아래다.** 작업 · 아카이브 화면의 복사 토스트가 본문 가운데 아래에 서므로, 기본 창 폭(1280)
 * 에서는 두 토스트가 함께 서도 대개 안 겹친다(아주 긴 경로만 닿는다). 좁은 창(최소 900)에서는 가로로 겹친다
 * — 그 모양은 프로세스 스펙 P2가 실물로 보고 이웃 work에 알리기로 한 자리다.
 */
export default function AppToasts() {
  return (
    <Toast.Provider toastManager={appToasts} timeout={SHORT_TOAST_MS}>
      <Toast.Viewport
        aria-label="알림"
        className="fixed right-5 bottom-5 z-40 flex max-w-[min(340px,calc(100vw-40px))] flex-col-reverse items-end gap-2 outline-none"
      >
        <ToastList />
      </Toast.Viewport>
    </Toast.Provider>
  );
}

/**
 * 선 토스트들. 새것이 맨 아래에 선다(목록은 새것부터 오고 칸은 아래에서 위로 쌓인다).
 *
 * 끌어서 치우기는 끈다 — 데스크톱 앱이라 끄는 몸짓이 글자를 긁는 손과 겹친다. 동작 토스트는 × 로 닫는다.
 */
function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => {
    const actions = toastActionsOf(toast.data);
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        swipeDirection={[]}
        className="flex items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[limited]:hidden"
      >
        <Toast.Title className="min-w-0 flex-1 leading-[1.5]" />
        {/* 버튼은 동작 토스트에만 선다 — 데이터에 버튼이 없으면 × 도 안 그린다(`toastOptionsOf`). */}
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.run}
            className="h-6 shrink-0 rounded-[7px] bg-state-2 px-2.5 text-[12px] font-medium transition-colors outline-none hover:bg-state-3 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {action.label}
          </button>
        ))}
        {actions.length > 0 && (
          <Toast.Close aria-label="닫기" className="icon-button-quiet shrink-0 text-tertiary">
            <X className="size-3.5" strokeWidth={2.2} />
          </Toast.Close>
        )}
      </Toast.Root>
    );
  });
}

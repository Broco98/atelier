import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { Toast, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { appToasts, SHORT_TOAST_MS, toastActionsOf } from "./app-toast";

/**
 * 이 work의 토스트가 서는 자리(프로세스 스펙 P2 (나)). 앱 셸에 하나 서서 **어느 화면에서든** 보인다 —
 * work · Room 화면, Terminal, 설정, 아카이브.
 *
 * **Provider는 Viewport만 감싼다 — 앱 셸의 children을 감싸지 않는다.** Base UI의 토스트는 가장 가까운
 * Provider를 React 문맥으로 찾는다(`useToastManager`가 `useContext`다). 앱 루트에는 작업 · 아카이브 화면의 토스트
 * Provider가 따로 선다(`main.tsx`의 `ToastProvider` — `sidebar-active-band` S14). 이 Provider가 화면들을 감싸면 그 아래
 * 화면의 토스트가 전부 이 자리로 샌다. 이 자리의 토스트는 모듈 매니저(`appToasts`)로만 들어온다.
 *
 * **모양은 앱 토스트 부품의 것이다**(`components/ui/toast.tsx`의 `Toast` · `ToastTitle` · `ToastViewport`) — 표면 · 글자 ·
 * 들고남이 작업 화면의 복사 토스트와 한 정의다. 이 자리가 더하는 것만 여기 있다: 자리, 여럿이 쌓이는 것, 동작 버튼.
 *
 * **자리는 오른쪽 아래다.** 작업 · 아카이브 화면의 복사 토스트는 본문 가운데 아래에 서므로, 기본 창 폭(1280)에서는 두
 * 토스트가 함께 서도 대개 안 겹친다(아주 긴 경로만 닿는다). 좁은 창(최소 900)에서는 가로로 겹친다 — 프로세스 스펙 P2가
 * 실물로 보고 그 work에 알리기로 한 자리다.
 *
 * **develop 토스트 규격의 예외다**(develop 머지). 그쪽은 앱의 토스트를 한 장으로(S26), Provider를 앱 루트 하나로, 자리를
 * 작업 · 아카이브 화면에만 둔다(S14). 이 자리는 둘째 Provider와 늘 서는 둘째 Viewport이고, 알림마다 제 id라 여럿이 쌓인다
 * (Base UI 기본 한도 3 — 넘은 것은 숨는다). 그쪽 한 장에 실으면 복사 토스트가 [모두 닫기]를 갈아 끼우고, 그쪽 자리는
 * `/terminal` · 설정 · `Processes`에 없다 — P2가 (나)를 고른 까닭이다. 그래서 한 화면에 그쪽 한 장과 이쪽 토스트들이 함께 설
 * 수 있다. 이 예외는 사람 결정으로 남았다(`구현-기록.md` 「통합 — develop 머지」). 그쪽 머리말(`main.tsx`의 Provider 자리,
 * `components/ui/toast.tsx`의 `TOAST_ID` · `Toaster`)에도 이 예외를 적었다 — 한쪽을 고치면 그쪽도 고친다.
 *
 * **영역의 이름은 「앱 메시지」다.** 토스트를 「알림」이라 부르지 않는다 — 그 말은 셸이 나를 부르는 사건의 것이다(`CONTEXT.md`의
 * 「알림 띠」). 작업 화면의 토스트 영역은 「메시지」라(`sidebar-active-band` S37), 두 영역이 한 화면에 함께 서도 이름으로 갈린다.
 */
export default function AppToasts() {
  return (
    <ToastProvider toastManager={appToasts} timeout={SHORT_TOAST_MS}>
      <ToastViewport
        aria-label="앱 메시지"
        className="fixed right-5 left-auto z-40 flex max-w-[min(340px,calc(100vw-40px))] translate-x-0 flex-col-reverse items-end gap-2"
      >
        <ToastList />
      </ToastViewport>
    </ToastProvider>
  );
}

/**
 * 선 토스트들. 새것이 맨 아래에 선다(목록은 새것부터 오고 칸은 아래에서 위로 쌓인다).
 *
 * 끌어서 치우기는 끈다(부품의 값 그대로다) — 데스크톱 앱이라 끄는 몸짓이 글자를 긁는 손과 겹친다. 동작 토스트는 × 로 닫는다.
 */
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((toast) => {
    const actions = toastActionsOf(toast.data);
    return (
      <Toast key={toast.id} toast={toast} className="data-[limited]:hidden">
        <ToastTitle className="min-w-0 flex-1 leading-[1.5]" />
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
          <ToastPrimitive.Close aria-label="닫기" className="icon-button-quiet shrink-0 text-tertiary">
            <X className="size-3.5" strokeWidth={2.2} />
          </ToastPrimitive.Close>
        )}
      </Toast>
    );
  });
}

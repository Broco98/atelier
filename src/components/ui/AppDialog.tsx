import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { cn } from "@/lib/utils";
import { dialogStore } from "./confirm-store";

/**
 * 앱이 묻거나 알리는 창을 그리는 **유일한 자리**. 앱 루트(AppShell)에 하나만 선다 —
 * 부르는 쪽마다 창을 그리면 두 물음이 겹칠 수 있고, 그때 어느 것에 답했는지가 사라진다.
 *
 * 모양은 이 저장소의 떠 있는 표면과 같다(`PopoverPortal`) — `rounded-[13px]` ·
 * `border-border-strong` · `bg-background` · `shadow-lg`. 새 어휘를 들이지 않는다.
 */
function AppDialog() {
  const pending = useStore(dialogStore, (state) => state);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const answer = pending?.answer;

  // 진행 버튼에 포커스를 준다. **셸에서 열렸을 때 이것이 중요하다** — xterm이 포커스를
  // 쥐고 있으면 키가 전부 그쪽으로 가서, 창이 떠 있는데 Enter도 Esc도 안 듣는다.
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  // Esc는 취소다. **알림에는 취소가 없지만 Esc는 듣는다** — 버튼이 하나뿐이라 닫는 것이
  // 곧 확인이고, 그때 답이 `false`로 가도 부르는 쪽이 답을 안 본다(showProblem).
  useEffect(() => {
    if (!answer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      answer(false);
    };
    // 캡처로 듣는다 — 셸이 열려 있으면 xterm의 키 핸들러가 먼저 보는 자리라, 버블에서
    // 기다리면 그쪽이 삼킨 뒤다.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [answer]);

  if (!pending) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={pending.title}
      // 바깥을 눌러도 닫힌다 — 되돌릴 수 없는 일이어도 **취소로** 닫으므로 안전하다.
      onClick={() => pending.answer(false)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/55 p-8 backdrop-blur-[2px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex w-[330px] max-w-full flex-col rounded-[13px] border border-border-strong bg-background p-4 shadow-lg"
      >
        <span className="text-[14px] font-semibold tracking-[-0.01em]">{pending.title}</span>
        <span className="mt-1.5 text-[13px] leading-[1.6] text-tertiary">{pending.body}</span>
        <div className="mt-4 flex justify-end gap-1.5">
          {/* 알림에는 취소가 없다 — 되돌릴 것이 없는데 두 갈래를 주면 무엇이 다른지를 묻게 된다. */}
          {!pending.notice && (
            <button
              type="button"
              onClick={() => pending.answer(false)}
              className="h-7 rounded-[8px] px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-state-1"
            >
              취소
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => pending.answer(true)}
            className={cn(
              "h-7 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              pending.danger
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-primary text-primary-foreground hover:bg-primary/85",
            )}
          >
            {pending.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppDialog;

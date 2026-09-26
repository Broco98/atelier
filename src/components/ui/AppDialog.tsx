import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { dialogStore, type DialogAsk } from "./confirm-store";
import { createFirstFrameGuard } from "./first-frame-guard";

/**
 * 셸에 포커스가 있는 채로 창이 뜨면, 창이 첫 포커스를 옮기는 다음 프레임까지 친 키가 셸로 간다.
 * 그 사이를 이것이 막는다(`first-frame-guard.ts`). 창은 앱에 하나라 가드도 하나다.
 */
const guard = createFirstFrameGuard();

/**
 * 앱이 묻거나 알리는 창을 그리는 **유일한 자리**. 앱 루트(AppShell)에 하나만 선다 —
 * 부르는 쪽마다 창을 그리면 두 물음이 겹칠 수 있고, 그때 어느 것에 답했는지가 사라진다.
 *
 * 창 자체는 Base UI AlertDialog다(`alert-dialog.tsx`) — 모양도 그 부품 파일이 든다. 여기는 스토어의
 * 물음을 창에 잇는 일만 한다: 여닫기, 답, 첫 포커스.
 *
 * **답하는 길이 넷이고 모두 스토어의 `answer`로 간다** — 두 버튼, Esc(창이 `onOpenChange`로
 * 알린다), 가림막 클릭. Esc와 가림막은 `false`다. 알림(`notice`)에도 Esc는 듣는다 — 버튼이 하나뿐이라
 * 닫는 것이 곧 확인이고, 그때 답이 `false`로 가도 부르는 쪽이 답을 안 본다(showProblem).
 */
function AppDialog() {
  const pending = useStore(dialogStore, (state) => state);
  // **닫히는 동안에도 마지막 물음을 그린다.** 스토어는 답하는 순간 비지만 창은 100ms 동안 사라지며
  // 서 있다 — 그동안 글자가 빈 창이 비치지 않게 한다. 다 닫히면 비운다.
  const [shown, setShown] = useState(pending);
  if (pending !== null && pending !== shown) setShown(pending);
  const ask = pending ?? shown;

  const popupRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const setPopup = useCallback((element: HTMLDivElement | null) => {
    popupRef.current = element;
    guard.surfaceRef(element);
  }, []);

  /** 물음이 고른 버튼 — 「취소에 포커스」를 청하면 「취소」(종료 확인, #223), 아니면 진행 버튼이다. */
  const focusTarget = (of: DialogAsk | null) =>
    (of?.focus === "cancel" ? cancelRef.current : null) ?? confirmRef.current;

  // **가드는 스토어에 물음이 선 순간 켠다** — 구독은 값이 바뀌는 그 자리에서 곧바로 불린다. 그리는
  // 쪽(렌더 · 효과)에서 켜면 그 사이가 샌다. 물음이 비면 끈다. 새 물음이 앞 물음을 접으면(비었다가
  // 다시 선다) 새로 켠다.
  useEffect(() => {
    const subscription = dialogStore.subscribe((next) => {
      if (next) guard.arm();
      else guard.disarm();
    });
    return () => {
      subscription.unsubscribe();
      guard.disarm();
    };
  }, []);

  // **갈아 끼운 물음도 새로 연 창처럼 첫 포커스를 정한다.** 창의 첫 포커스(`initialFocus`)는 창이
  // **열릴 때** 한 번 돈다. 셸 닫기 창(「닫기」에 포커스)이나 오류 창(「확인」)이 떠 있을 때 종료
  // 요청이 오면 창은 열린 채 내용만 바뀌고, 포커스는 진행 버튼 자리, 곧 「종료」에 남는다 — Enter 한
  // 번에 앱이 꺼진다(#223이 막은 사고).
  //
  // 그래서 창이 이미 서 있었으면(갈아 끼웠다) 여기서 준다. 닫히는 중에 다시 열린 창도 포커스가 아직
  // 안에 있어 창의 첫 포커스가 건너뛰므로 여기서 준다. 새로 연 창은 창의 첫 포커스(다음 프레임)에
  // 맡긴다 — 그 한 프레임은 위 가드가 막는다(S24). 창은 그 첫 포커스 직전의 자리를 「열기 전 자리」로
  // 적어 두고 닫힐 때 거기로 돌려준다(셸에서 띄웠으면 셸이다).
  const before = useRef<DialogAsk | null>(null);
  useLayoutEffect(() => {
    const replaced = before.current !== null;
    before.current = pending;
    if (!pending || !popupRef.current) return;
    if (!replaced && !popupRef.current.contains(document.activeElement)) return;
    focusTarget(pending)?.focus();
  }, [pending]);

  const answer = (ok: boolean) => dialogStore.state?.answer(ok);

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null);
      }}
    >
      <AlertDialogContent
        ref={setPopup}
        initialFocus={() => focusTarget(ask)}
        // 바깥을 눌러도 닫힌다 — 되돌릴 수 없는 일이어도 **취소로** 닫으므로 안전하다(S12).
        onBackdropClick={() => answer(false)}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          {/* 본문이 없는 물음이 있다 — 셸이 0개인 종료 확인은 그 줄이 **아예 없다**(결정 15). 빈 줄의
              여백만 남기지 않고, 창의 설명(`aria-describedby`)도 가리킬 곳이 없어 안 선다. */}
          {ask?.body && <AlertDialogDescription>{ask.body}</AlertDialogDescription>}
        </AlertDialogHeader>
        {/* 버튼은 판 3 동안 지금 모양 그대로다 — Button으로 바꾸는 것은 판 4다. */}
        <AlertDialogFooter>
          {/* 알림에는 취소가 없다 — 되돌릴 것이 없는데 두 갈래를 주면 무엇이 다른지를 묻게 된다. */}
          {!ask?.notice && (
            <button
              ref={cancelRef}
              type="button"
              onClick={() => answer(false)}
              className="h-7 rounded-[8px] px-3 text-[12.5px] font-medium text-muted-foreground transition-colors outline-none hover:bg-state-1 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              취소
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => answer(true)}
            className={cn(
              "h-7 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              ask?.danger
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-primary text-primary-foreground hover:bg-primary/85",
            )}
          >
            {ask?.confirm}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default AppDialog;

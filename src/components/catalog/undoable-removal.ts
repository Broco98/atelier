import { useState } from "react";
import { showProblem } from "@/components/ui/confirm-store";
import { showUndoToast } from "@/components/ui/toast";

// **빼기 · 지우기의 흐름 하나 — 쓰임을 읽고 창을 열고, 빼면 「되돌리기」 토스트**(03 구현 스펙 §14 「지우기」 · §16 「제거 창」 · 03 코드 리뷰 D1).
// Project 제거(`useProjectRemoval`)와 Space 삭제(`useSpaceDelete`)가 함께 쓴다 — 한쪽은 훅, 한쪽은 목록 화면 안에 적혀 있던 같은 차례다.
//
//   ask(item)      쓰임을 읽어(`usage`) 창을 연다. 못 읽으면 「<failed> — 까닭」
//   confirm(item)  지운다(`remove`). 답이 막힘이면(`blocked` — 그사이 진행 중인 Work가 붙었다) 창이 그 자리에서 막힌 갈래로 바뀐다. 뺐으면
//                  창을 닫고 `after`(상세는 목록으로) 뒤 「<toast> · 되돌리기」. 되돌리기가 거절되면 그 까닭을 사람의 말로(`restoreProblem`)
//   close()        창만 닫는다
//
// 토스트는 그 화면의 `<Toaster>`에 선다 — 상세에서 지우고 목록으로 가면 목록의 자리다.

/** 떠 있는 물음 — 무엇을 빼는가와 그 쓰임. */
export interface Asking<T, U> {
  item: T;
  usage: U;
}

export interface UndoableRemoval<T, U, R> {
  /** 창을 열기 전에 읽는 쓰임 — 창의 갈래가 이것으로 정해진다. */
  usage: (item: T) => Promise<U>;
  /** 창의 단추가 부르는 빼기 · 지우기. */
  remove: (item: T) => Promise<R>;
  /** 빼기의 답이 막힘이면 그 쓰임 — 창이 닫히지 않고 그 갈래로 바뀐다. 막힘이 없는 흐름은 두지 않는다. */
  blocked?: (result: R) => U | null;
  /** 토스트의 「되돌리기」. */
  restore: (item: T) => Promise<unknown>;
  /** 읽기 · 빼기가 실패했을 때 글의 앞(「제거하지 못했어요」 · 「지우지 못했어요」). */
  failed: string;
  /** 뺀 뒤 토스트의 말. */
  toast: (item: T) => string;
  /** 되돌리기가 거절된 까닭(오류 글)을 사람의 말로. */
  restoreProblem: (error: string) => string;
  /** 뺀 뒤 토스트 앞에 할 일 — 상세는 목록으로 간다. */
  after?: () => void;
}

export function useUndoableRemoval<T, U, R>(how: UndoableRemoval<T, U, R>) {
  const [asking, setAsking] = useState<Asking<T, U> | null>(null);

  const ask = async (item: T) => {
    try {
      setAsking({ item, usage: await how.usage(item) });
    } catch (e) {
      await showProblem(`${how.failed} — ${e}`);
    }
  };
  const confirm = async (item: T) => {
    let result: R;
    try {
      result = await how.remove(item);
    } catch (e) {
      setAsking(null);
      await showProblem(`${how.failed} — ${e}`);
      return;
    }
    const stays = how.blocked?.(result) ?? null;
    if (stays !== null) {
      setAsking({ item, usage: stays });
      return;
    }
    setAsking(null);
    how.after?.();
    showUndoToast(how.toast(item), () => {
      how.restore(item).catch((e) => void showProblem(how.restoreProblem(String(e))));
    });
  };
  return { asking, ask, confirm, close: () => setAsking(null) };
}

import { Store } from "@tanstack/react-store";
import type { ProjectView } from "./types";

/**
 * Project 추가 창(03 구현 스펙 §16) — **여는 길이 몇이든 창은 하나다.** Projects 「Project 추가」 · 폴더 끌어 놓기, Space 상세 「새 Project
 * 추가…」, 범위 줄 「Project 추가」가 모두 `addProject`를 부르고, 앱 루트의 창 하나(`ProjectAddDialog`)가 이 스토어를 그린다. 묻는 쪽과
 * 그리는 쪽을 나눈 까닭은 확인 창(`confirm-store.ts`)과 같다 — 여기는 값만 든다.
 */

interface AddAsk {
  /** 창이 그 폴더로 열린다(끌어 놓기 · 그 폴더 추가). 없으면 빈 창이다. */
  folder: string | null;
  /** 이 물음이 몇 번째인가 — 떠 있는 창에 새 폴더가 오면(끌어 놓기) 창이 그 폴더로 바꿔 선다. */
  seq: number;
  /** 끝 — 추가 · 만든 Project, 닫았거나 다른 Project를 열었으면 null이다. */
  done: (added: ProjectView | null) => void;
}

/** 지금 떠 있는 추가 창. `null`이면 없다. */
export const projectAddStore = new Store<AddAsk | null>(null);

let seq = 0;

/**
 * 추가 창을 연다 — 끝나면 추가 · 만든 Project, 닫으면 null이다. Space 상세처럼 추가한 Project로 할 일이 있는 자리는 그 답을 받는다.
 *
 * **이미 떠 있으면 그 창에 폴더를 넣는다** — 창을 하나 더 띄우지 않는다. 앞서 기다리던 쪽도 같은 답을 받는다(그 창에서 끝낸 추가다).
 */
export function addProject(folder: string | null = null): Promise<ProjectView | null> {
  return new Promise((resolve) => {
    const open = projectAddStore.state;
    seq += 1;
    projectAddStore.setState(() => ({
      folder,
      seq,
      done: (added) => {
        projectAddStore.setState(() => null);
        open?.done(added);
        resolve(added);
      },
    }));
  });
}

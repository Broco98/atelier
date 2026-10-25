import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * 창에 놓은 경로들 — Projects 화면이 떠 있는 동안 듣는다(03 구현 스펙 §16 · 스토리 99). 웹뷰의 HTML5 drop은 경로를 주지 않아 창의 끌어
 * 놓기 이벤트(`onDragDropEvent`)의 `paths`를 쓴다 — 입력창 첨부(`useAttachmentDrop`)와 같은 길이다. 앱 안의 끌기(사이드바 줄 옮기기)는
 * 경로가 없어 부르지 않는다. 폴더인지는 받는 쪽이 core에 묻는다(`firstFolder`).
 */
export function useFolderDrop(onDrop: (paths: string[]) => void): void {
  const dropped = useRef(onDrop);
  useEffect(() => {
    dropped.current = onDrop;
  });
  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "drop" && payload.paths.length > 0) dropped.current(payload.paths);
      })
      .then((unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, []);
}

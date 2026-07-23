import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// macOS 전체화면 여부. @tauri-apps/api 2.x에는 전용 fullscreen 이벤트가 없어
// (window.d.ts 확인: onResized/onFocusChanged 등만 존재) 전체화면 전환이
// 반드시 동반하는 resize(tauri://resize) 때마다 isFullscreen()을 다시 읽는다.
function useIsFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    const sync = () => {
      void win.isFullscreen().then((value) => {
        if (!disposed) setFullscreen(value);
      });
    };
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  return fullscreen;
}

export default useIsFullscreen;

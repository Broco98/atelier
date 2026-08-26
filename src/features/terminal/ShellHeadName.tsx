import { useStore } from "@tanstack/react-store";
import { activeShellOf, shellRowName } from "./shell-registry";
import { terminalStore } from "./terminal-store";

/**
 * 분할 열 머리에 서는 **셸 이름**(결정 104). 사이드바 셸 행과 **같은 이름**이어야 한다 —
 * 둘이 한 화면에 나란히 서므로 이름이 갈리면 같은 셸이 둘로 읽힌다.
 *
 * **조각 하나가 따로 구독한다.** 이 이름은 셸이 프롬프트마다 쏘는 OSC 타이틀에 바뀌는데,
 * 화면(WorksPage)이 그것을 구독하면 마크다운 본문이 그 빈도로 다시 그려진다. 셀렉터가
 * 문자열을 돌려주므로 이름이 실제로 바뀔 때만 이 조각이 다시 그려진다.
 */
function ShellHeadName({ owner }: { owner: string | null }) {
  const name = useStore(terminalStore, (state) => {
    const shell = activeShellOf(state, owner);
    return shell ? shellRowName(shell) : "";
  });
  return <>{name}</>;
}

export default ShellHeadName;

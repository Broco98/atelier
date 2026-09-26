import { useCallback, useLayoutEffect, useRef } from "react";
import { useBlocker, type ShouldBlockFn } from "@tanstack/react-router";
import { askChoice } from "@/components/ui/confirm-store";

// 떠날 때 확인(spec 레이아웃 티켓 15 · 결정 27 · 구현 스펙 5절 「편집기의 저장은 따로다」). 저장하지 않은 초안을 두고
// 편집기를 떠나면 묻는다 — **이 저장소의 첫 「떠날 때 확인」이다.**
//
// 설정 초안(터미널, 알림)에는 걸지 않는다 — 그쪽은 UI개선 결정 26대로 다른 항목으로 가면 경고 없이 버린다. 그것은
// 한 화면 안의 작은 값이고, 편집기의 초안은 템플릿 본문까지 담는 큰 초안이라 이 비대칭을 받아들인다. 앱 종료(⌘Q)
// 에도 걸지 않는다 — 종료 확인은 지금 그대로다.

/** 떠날 때의 답 — 머문다, 초안을 버리고 떠난다, 저장하고 떠난다. */
export type LeaveChoice = "stay" | "discard" | "save";

/**
 * 떠날지 묻는다. 버튼은 [계속 편집], 경고색의 [버리고 나가기], 그리고 **저장할 수 있을 때만**(`savable` — 저장
 * 가능 판정 `canSave`) 서는 주 버튼 [저장하고 나가기]다. 템플릿 본문까지 든 큰 초안에서는 저장하고 나가는 것이
 * 가장 흔한 답이다(결정 27).
 *
 * 창이 뜨면 포커스는 [계속 편집]에 간다 — 반사적으로 친 Enter가 초안을 버리지 않는다(종료 확인과 같은 까닭). Esc와
 * 창 바깥도 [계속 편집]이다.
 */
export async function askLeave(savable: boolean): Promise<LeaveChoice> {
  const answer = await askChoice({
    title: "저장하지 않은 변경이 있어요",
    cancel: "계속 편집",
    confirm: "버리고 나가기",
    danger: true,
    extra: savable ? "저장하고 나가기" : undefined,
    focus: "cancel",
  });
  return answer === "extra" ? "save" : answer ? "discard" : "stay";
}

/**
 * 편집기를 떠나는 이동을 붙잡아 묻는다. 떠나는 길은 넷이다 — 뒤로, 사이드바 nav, 팔레트로 다른 곳 열기, 설정 nav의
 * 다른 항목. 넷 다 라우터의 이동이라 **라우터의 막기 하나**(`useBlocker`)가 모두 받는다 — 길마다 물음을 걸면 한 길이
 * 잊는 날 그 길로만 초안이 사라진다. 팔레트의 「설정」은 이미 설정 안이면 이동이 아니다(`navigateGuardingSettings`)
 * — 이동이 없으니 묻지도 않는다.
 *
 * - 주소가 그대로인 이동(같은 편집기)은 떠나는 것이 아니다.
 * - 저장하지 않은 것이 없으면(`unsaved`가 거짓) 묻지 않는다.
 * - [저장하고 나가기]는 저장이 **되어야** 떠난다. 저장이 오류 데이터로 돌아오거나 쓰다가 실패하면 편집기에 남아
 *   그 까닭을 보인다 — `save`가 그것을 보이고 거짓을 준다.
 *
 * 물음은 이동이 일어난 순간의 값으로 한다 — 막는 함수는 한 번 걸어 두고, 값은 렌더마다 갈아 끼운다.
 */
export function useConfirmLeave(state: { unsaved: boolean; savable: boolean; save: () => Promise<boolean> }) {
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });
  const shouldBlockFn = useCallback<ShouldBlockFn>(async ({ current, next }) => {
    if (next.pathname === current.pathname || !latest.current.unsaved) return false;
    const choice = await askLeave(latest.current.savable);
    if (choice === "stay") return true;
    if (choice === "discard") return false;
    return !(await latest.current.save());
  }, []);
  // 창을 닫는 것(beforeunload)은 받지 않는다 — 앱 종료는 종료 확인의 몫이다.
  useBlocker({ shouldBlockFn, enableBeforeUnload: false });
}

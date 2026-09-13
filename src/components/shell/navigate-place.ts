import type { NavigateOptions, RegisteredRouter } from "@tanstack/react-router";
import { SETTINGS_ENTRY, inSettings } from "@/features/settings/pages";

/** 이 함수가 라우터에서 쓰는 것. 라우터 테스트가 앱과 같은 함수를 제 라우터로 부른다. */
type PlaceRouter = Pick<RegisteredRouter, "state" | "navigate">;

/**
 * 셸의 문(⌘, · 사이드바 바닥 `Settings` · 팔레트의 줄)이 화면을 옮기는 **한 자리**.
 *
 * **설정 안에서 설정으로 가는 문은 무동작이다**(UI개선 S18). `/settings`는 첫 항목으로 치환되므로
 * (`settings.index.tsx`) 그대로 보내면 알림을 보던 사람이 ⌘,를 누른 것만으로 터미널 설정으로
 * 떠나고, 칸이 하나 쌓여 뒤로가기를 한 번 더 눌러야 한다.
 *
 * **부를 때 라우터 상태를 읽는다 — 구독하지 않는다.** 「지금 설정 안인가」를 주소 select로 들면
 * 앱 셸의 구독이 하나 늘고(`AppShell.test.ts`가 센다), 문마다 가드를 적으면 한 문이 잊는 날
 * 그 문만 칸을 쌓는다. 그래서 문 셋이 이 함수 하나를 지난다.
 *
 * 가드는 **설정으로 가는 이동에만** 문다 — 팔레트는 모든 줄을 이 함수로 보내므로, 넓게 물면
 * 설정 화면에서 팔레트가 통째로 죽는다.
 */
export function navigatePlace(router: PlaceRouter, target: NavigateOptions): Promise<void> {
  if (target.to === SETTINGS_ENTRY && inSettings(router.state.location.pathname)) {
    return Promise.resolve();
  }
  return router.navigate(target);
}

import { Spinner } from "@/components/ui/spinner";

// **상태 표시** — 사이드바 줄 오른쪽 끝에 서는 표시 하나(02 구현 스펙 §2 · §4 · S11 · 캔버스 Components 「사이드바 줄」 · Diff-Frame 「제안」).
// Thread 줄(`SidebarThreads`의 `ThreadRow`)과 Work 줄(`WorkSectionList`의 `WorkRow`)이 같은 이 조각을 부른다 — 두 줄이 한 사이드바에 섞여
// 서므로 모양이 갈리면 같은 상태가 두 무게로 읽힌다. 어느 상태를 그릴지는 부르는 쪽이 고른다(Thread 줄은 `status.ts`의 `markOf`, Work
// 줄은 `features/works/work-mark.ts`의 `workMark`) — 여기는 그리기만 한다.
//
// | 상태 | 서는 것 | 값(시안) |
// |---|---|---|
// | 내 차례 | 「내 차례」 글자 알약 | 높이 18 · 12/500 · `mine`(#2c67c5) on `mine-soft`(#e8f3fe) · 둥글기 8 · 옆 안쪽 6 |
// | 도는 중 | 스피너 | 12 · 「작업 중」(그림의 이름) |
// | 실패 | 「실패」 글자 | 12 · `danger` — **사이드바의 유일한 빨강이다**(`color-guard`) |
// | 새 결과 | 파란 점 | 6 · `accent-solid` · 「새 결과」(그림의 이름) |
// | 멈춤 · 조용함 | 없음 | 사람이 멈춘 것은 일거리가 아니다(S11) |
//
// - **표시는 줄마다 하나다.** 상태가 여기저기 흩어져 있던 v1의 자리(얼굴 옆 점 · 시각 자리의 스피너 · 미리보기 앞 「실패」 · 굵은 제목)가
//   모두 이리로 모였다. 색은 파랑 둘(알약 · 점)과 빨강 하나(「실패」)뿐이고 나머지는 모양이다.
// - **말을 든다.** 알약 · 「실패」는 글자가, 스피너 · 점은 그림의 이름이 상태를 말한다 — Thread 줄은 이 조각이 이름 버튼 안에 서서 그 말이
//   줄의 이름에 붙는다(「환불 API 버그 고쳐줘 내 차례」). Work 줄은 이 조각이 이름 버튼 밖의 칸이라 이름 버튼이 같은 말을 `aria-label`로 들고
//   이 조각은 `aria-hidden`이다(`hidden`).
// - 표식(`data-mark`)은 검사와 시안 비교 캡처가 이 조각을 집는 이름이다.

/** 상태 표시가 그리는 것 — 넷이다. 멈춤 · 조용함은 표시가 없어 이 값이 아니라 `null`이다. */
export type StatusMarkKind = "mine" | "working" | "failed" | "new";

/** 표시의 말 — 알약 · 「실패」의 글자, 스피너 · 점의 그림 이름, Work 줄 이름 버튼의 꼬리(「환불 API — 내 차례」)가 이 표를 읽는다. */
export const STATUS_MARK_LABEL: Readonly<Record<StatusMarkKind, string>> = {
  mine: "내 차례",
  working: "작업 중",
  failed: "실패",
  new: "새 결과",
};

export function StatusMark({ kind, hidden = false }: { kind: StatusMarkKind | null; hidden?: boolean }) {
  // 그림 이름은 숨긴 표시에 남기지 않는다 — 숨긴 상자 안의 이름은 읽히지 않지만, 마크업에 같은 말이 두 번 적히면 검사가 이름을 셀 때 갈린다.
  // 역할도 함께 비운다(`undefined`) — `Spinner`의 겉 상자가 든 「불러오는 중」 역할이 숨긴 표시에 남지 않게.
  const named = (label: string) =>
    hidden ? { "aria-hidden": true, role: undefined, "aria-label": undefined } : { role: "img", "aria-label": label };
  switch (kind) {
    case null:
      return null;
    case "mine":
      return (
        <span
          data-mark="mine"
          aria-hidden={hidden || undefined}
          className="flex h-4.5 shrink-0 items-center rounded-md bg-mine-soft px-1.5 text-xs font-medium tracking-normal text-mine"
        >
          {STATUS_MARK_LABEL.mine}
        </span>
      );
    case "working":
      // 앱의 `Spinner`다 — 동작 줄이기면 호 대신 원이 선다(그 부품의 CSS). 겉 상자의 「불러오는 중」 역할은 여기서 덮는다.
      return <Spinner data-mark="working" {...named(STATUS_MARK_LABEL.working)} className="size-3 text-fg-secondary spin-thread" />;
    case "failed":
      return (
        <span data-mark="failed" aria-hidden={hidden || undefined} className="shrink-0 text-xs tracking-normal text-danger">
          {STATUS_MARK_LABEL.failed}
        </span>
      );
    case "new":
      return <span data-mark="new" {...named(STATUS_MARK_LABEL.new)} className="size-1.5 shrink-0 rounded-full bg-accent-solid" />;
  }
}

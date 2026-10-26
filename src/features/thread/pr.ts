import type { PrChecks, ProjectChanges, ProjectPr } from "@/features/works/types";
import type { Opened } from "./expanded";
import { isObject, nonEmpty, text } from "./json";

// **PR 카드와 PR 줄의 문장**(v1 티켓 36 · 구현 스펙 §12 S24 · 스토리 124 · 125 · 127 · 캔버스 Cards · WorkPanel · Screen-Review 보드) —
// Thread의 PR 카드(`PrCard.tsx`)와 요약 카드의 PR 줄(`summary-card.ts`의 `prRows`)이 함께 쓰는 순수 함수다.
//
// - **CI는 색 없이 문장이다**(스토리 125) — 「CI 확인 중」 · 「CI 통과」 · 「CI 실패」. 실패는 무엇이 실패했는지까지 말한다. 빨강은 사이드바
//   목록의 「실패」만 쓴다(v1 티켓 41).
// - 엔진은 처음 보인 PR과 상태 변화를 그 Work에서 가장 최근에 말한 Thread에 `pr` 줄로 남긴다 — 그 줄이 그때의 PR 하나(core
//   `PullRequest`)에 Work · Project · 처음인지를 더한 것이다(`prLineOf`).

/** 찾은 PR 하나(core `ProjectPr`의 `found`). */
export type FoundPr = Extract<ProjectPr, { kind: "found" }>;

/** 기록의 `pr` 줄 하나 — 그때의 PR과, 어느 Work · Project의 것인지, 그 Work에서 처음 보인 PR인지(아니면 상태 변화). */
export type PrLine = Omit<FoundPr, "kind"> & { work: string; first: boolean };

const STATES = ["open", "closed", "merged"] as const;

/** `pr` 줄의 몸 → PR 줄. 카드가 그릴 수 없는 줄(번호 · 제목 · 주소 · 상태 · CI가 꼴이 아니다)은 `null`이다. */
export function prLineOf(payload: unknown): PrLine | null {
  if (!isObject(payload)) return null;
  const number = payload.number;
  const title = text(payload.title);
  const url = nonEmpty(payload.url);
  const state = STATES.find((one) => one === payload.state);
  const ci = checksOf(payload.ci);
  if (typeof number !== "number" || title === null || url === null || !state || !ci) return null;
  const count = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    work: text(payload.work) ?? "",
    project: text(payload.project) ?? "",
    first: payload.first === true,
    number,
    title,
    url,
    state,
    headBranch: text(payload.headBranch) ?? "",
    baseBranch: text(payload.baseBranch) ?? "",
    additions: count(payload.additions),
    deletions: count(payload.deletions),
    changedFiles: count(payload.changedFiles),
    ci,
    approvals: count(payload.approvals),
    changesRequested: count(payload.changesRequested),
    mergedAt: text(payload.mergedAt),
  };
}

function checksOf(value: unknown): PrChecks | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case "noChecks":
    case "pending":
    case "passing":
      return { kind: value.kind };
    case "failing":
      return {
        kind: "failing",
        failed: Array.isArray(value.failed) ? value.failed.filter((one): one is string => typeof one === "string") : [],
      };
    default:
      return null;
  }
}

/** CI 문장 — 검사가 없으면 없다. */
export function ciText(ci: PrChecks): string | null {
  switch (ci.kind) {
    case "pending":
      return "CI 확인 중";
    case "passing":
      return "CI 통과";
    case "failing":
      return "CI 실패";
    case "noChecks":
      return null;
  }
}

/** 실패한 검사들 — 둘까지는 이름을, 셋부터는 첫 이름과 「외 N개」다(카드 한 줄에 든다). */
export function failedChecks(failed: readonly string[]): string {
  if (failed.length <= 2) return failed.join(", ");
  return `${failed[0]} 외 ${failed.length - 1}개`;
}

/** 요약 카드 PR 줄 아래의 실패 문장(보드 `.wnote` 「빨간색 대신 문장으로 알립니다」). */
export function failNote(failed: readonly string[]): string {
  const names = failedChecks(failed);
  return names === "" ? "검사가 실패했어요." : `${names} 검사가 실패했어요.`;
}

/**
 * 「Host에게 고쳐 달라고 하기」가 그 Thread의 입력창에 채우는 말 — 실패한 검사를 모두 싣는다. 보내는 것은 사람이다(v1 Work 카드의 더하기와
 * 같은 길, 결정.md 34).
 */
export function fixAsk(pr: Pick<PrLine, "number" | "ci">): string {
  const failed = pr.ci.kind === "failing" ? pr.ci.failed : [];
  const what = failed.length > 0 ? `${failed.join(", ")} 검사가` : "검사가";
  return `PR #${pr.number}의 CI에서 ${what} 실패했어요. 원인을 찾아 고쳐 줘.`;
}

/** 리뷰 — 승인 수와 수정 요청 수. 둘 다 없으면 「리뷰 전」이다. */
export function reviewText(pr: Pick<PrLine, "approvals" | "changesRequested">): string[] {
  const said = [
    ...(pr.approvals > 0 ? [`승인 ${pr.approvals}개`] : []),
    ...(pr.changesRequested > 0 ? [`수정 요청 ${pr.changesRequested}개`] : []),
  ];
  return said.length > 0 ? said : ["리뷰 전"];
}

/** 병합한 때 — 오늘이면 「오후 3:02」, 어제면 「어제 오후 6:12」, 그 앞은 「10월 20일」. 읽지 못하면 빈 글이다. */
export function mergedWhen(at: string, now: number): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const day = (time: number) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((day(now) - day(then.getTime())) / 86_400_000);
  const clock = then.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return clock;
  if (days === 1) return `어제 ${clock}`;
  return `${then.getMonth() + 1}월 ${then.getDate()}일`;
}

/**
 * 「변경 사항 보기」가 넓힌 카드(v1 티켓 35)에서 여는 것 — 그 PR의 Project에서 바뀐 첫 파일의 diff다. 바뀐 파일이 없거나 변경을 읽지
 * 못했으면 그 Project의 트리다.
 */
export function changesOf(project: string, changes: ProjectChanges[] | undefined): Opened {
  const mine = changes?.find((one) => one.project === project);
  const first = mine?.kind === "listed" ? mine.files[0] : undefined;
  return first ? { kind: "change", project, path: first.path } : { kind: "project", project, file: null };
}

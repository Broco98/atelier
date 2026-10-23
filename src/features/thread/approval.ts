import type { PendingPermission, PermissionOption } from "./fold";
import { nonEmpty, type Json } from "./json";
import { commandOf, diffPathsOf, locationsOf, mcpOf, toolFields } from "./tool-view";

// v1 티켓 05가 three-axes 승인 카드의 순수 함수를 Thread 접기 위로 옮겼다 — 규칙은 그대로다. 카드의 모양(질문 카드 · 「결정은 내가」)은
// 뒤 장(22)이 고친다.
//
// 승인 카드의 화면 값(three-axes 티켓 21) — 답하지 않은 권한 요청(`PendingPermission`)을 무엇을 하려는지(도구 · 제목 · 명령이나
// 경로 · 까닭)와 선택지 자리로 옮기는 **순수 함수**다. 그리는 것은 `ApprovalCard`이고, 승인 카드가 설 때의 알림(스토리 120)도 같은
// 제목을 말한다.
//
// **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16) — 갈래는 요청 `toolCall`의 kind다. 명령 · 경로는 흐름의 그 도구
// 줄(물음보다 먼저 온 `tool_call`)의 원문이 이긴다: codex-acp는 요청의 제목을 「Run command」로, 명령을 따옴표로 한 번 더 싸서
// 주지만(실측 G2) 도구 줄에는 명령 그대로가 있다. 도구 줄이 없으면 요청의 것을 쓴다.
//
// **선택지는 엔진이 준 그대로다**(스토리 59) — 이름 · 차례 · 수를 고치지 않고 자리만 가른다: 「늘 허용」 갈래(`allow_always`)는
// 카드 가운데 칩 줄에, 거부 갈래는 흰 알약, 한 번 허용은 주 동작이다(캔버스 Tools 보드 「승인 카드」). 계획 승인(kind
// `switch_mode`)만 엔진의 두 선택지를 「구현」 · 「다시 짜기」로 부른다(three-axes 결정 29) — 그 요청의 이름은 엔진의 영어 문장
// 이고(「Yes, implement this plan」), 카드가 묻는 말(「이 계획대로 할까요?」)의 답으로 읽혀야 해서다.

/** 카드 머리의 아이콘 갈래 — 도구의 갈래 하나(명령 · 읽기 · 편집 · 검색 · 가져오기 · MCP · 그 밖)이고, 계획 승인만 따로다. */
export type ApprovalIcon = "execute" | "read" | "edit" | "search" | "fetch" | "mcp" | "other" | "plan";

export interface ApprovalView {
  icon: ApprovalIcon;
  /** 무엇을 다루는 도구인가 — 엔진 줄의 앞(「터미널」 · 「파일」 …). 계획 승인이면 「계획 모드」다. */
  tool: string;
  /** 카드가 묻는 말 — 카드의 이름이기도 하다. */
  title: string;
  /** 명령 · 경로 · 주소 · MCP 도구 — 모르면 null. */
  subject: string | null;
  /** 엔진이 준 까닭 — Claude 변환기가 `can_use_tool`의 `decision_reason`을 싣는다. 없으면 null. */
  reason: string | null;
}

/** 선택지 하나가 카드의 어디에 무엇으로 서나. */
export interface ApprovalChoice {
  option: PermissionOption;
  /** 단추의 글 — 계획 승인이 아니면 엔진의 이름 그대로다. */
  label: string;
  /** `chip` 칩 줄 · `reject` 흰 알약 · `primary` 주 동작. */
  place: "chip" | "reject" | "primary";
}

export function describeApproval(request: PendingPermission): ApprovalView {
  // 흐름의 도구 줄이 이긴다(머리말) — 호스트가 채운 요지는 빈 칸만 채운 것이라, 겹치는 칸은 도구 줄의 원문이 더 정확하다.
  const call: Json = { ...request.toolCall, ...(request.tool?.call ?? {}) };
  const fields = toolFields(call);
  const { claudeCode, toolName, rawInput, title, kind } = fields;
  const requestClaude = toolFields(request.toolCall).claudeCode;
  const reason = nonEmpty(requestClaude.decisionReason) ?? nonEmpty(claudeCode.decisionReason);

  if (request.planReview) return { icon: "plan", tool: "계획 모드", title: "이 계획대로 할까요?", subject: null, reason };

  const mcp = mcpOf(fields);
  if (mcp) {
    return { icon: "mcp", tool: "MCP", title: "이 MCP 도구를 쓰도록 허용할까요?", subject: `${mcp.server} · ${mcp.tool}`, reason };
  }
  const path = pathOf(call, rawInput);
  switch (kind) {
    case "execute":
      return {
        icon: "execute",
        tool: "터미널",
        title: "이 명령을 실행하도록 허용할까요?",
        subject: commandOf(rawInput.command) ?? title,
        reason,
      };
    case "edit":
      return { icon: "edit", tool: "파일", title: "이 파일을 고치도록 허용할까요?", subject: path ?? title, reason };
    case "delete":
      return { icon: "edit", tool: "파일", title: "이 파일을 지우도록 허용할까요?", subject: path ?? title, reason };
    case "move":
      return { icon: "edit", tool: "파일", title: "이 파일을 옮기도록 허용할까요?", subject: path ?? title, reason };
    case "read":
      return { icon: "read", tool: "파일", title: "이 파일을 읽도록 허용할까요?", subject: path ?? title, reason };
    case "fetch":
      return { icon: "fetch", tool: "웹", title: "이 주소를 가져오도록 허용할까요?", subject: nonEmpty(rawInput.url) ?? title, reason };
    case "search":
      return { icon: "search", tool: "검색", title: "이 검색을 하도록 허용할까요?", subject: title, reason };
    default:
      return { icon: "other", tool: "도구", title: "이 도구를 쓰도록 허용할까요?", subject: title ?? toolName, reason };
  }
}

/** 도구가 다루는 파일 — ACP `locations[].path`, 없으면 입력의 경로 칸(Claude `file_path`) · diff 내용의 경로. */
function pathOf(call: Json, rawInput: Json): string | null {
  const paths = [...locationsOf(call), nonEmpty(rawInput.file_path), nonEmpty(rawInput.path), ...diffPathsOf(call)];
  return paths.find((one) => one !== null) ?? null;
}

/** 선택지마다 카드의 자리와 글 — 차례는 엔진이 준 그대로다. */
export function approvalChoices(request: PendingPermission): ApprovalChoice[] {
  const choices = request.options.map((option): ApprovalChoice => {
    const allow = option.kind.startsWith("allow");
    const label = request.planReview ? (allow ? "구현" : option.kind.startsWith("reject") ? "다시 짜기" : option.name) : option.name;
    const place = !allow ? "reject" : option.kind === "allow_always" && !request.planReview ? "chip" : "primary";
    return { option, label, place };
  });
  // 계획 승인의 두 이름이 겹치면(엔진이 허용 갈래를 둘 주면) 엔진의 이름으로 돌아간다 — 같은 글의 단추 둘은 고를 수 없다.
  const seen = new Map<string, number>();
  for (const choice of choices) seen.set(choice.label, (seen.get(choice.label) ?? 0) + 1);
  return choices.map((choice) => ((seen.get(choice.label) ?? 0) > 1 ? { ...choice, label: choice.option.name } : choice));
}

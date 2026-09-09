// 훅 페이로드에서 **한 줄**을 뽑는 자리. 에이전트별 어댑터가 함께 딛는 조각들이라 여기
// 모아 둔다 — 「어느 키를 읽는가」는 에이전트마다 다르지만 「뽑은 것을 어떻게 한 줄로
// 만드는가」는 같다. 에이전트를 더할 때 느는 것은 어댑터 한 파일이고, 이 파일은 안 는다.
//
// **전부 `unknown`을 받는다.** 페이로드는 남의 프로세스가 쓴 JSON이라 앱이 아는 모양대로
// 온다는 보장이 없다 — 타입 단언으로 받으면 `payload.tool_input.command`가 런타임에
// 터지고, 그 자리는 사람이 답을 기다리는 순간이다.

/** 객체면 그대로, 아니면 `null`. 배열도 아니다 — 키로 읽을 것이 없다. */
function objectOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 그 키의 값이 **비지 않은 문자열**일 때만 준다. */
export function stringAt(payload: unknown, key: string): string | null {
  const value = objectOf(payload)?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * 여러 줄짜리 말에서 **첫 줄**만 뽑는다. 화면의 둘째 줄·띠·알림 본문이 다 한 줄이라
 * 자르는 자리가 하나여야 한다 — 읽는 쪽마다 자르면 셋이 서로 다르게 잘린다.
 *
 * **길이로 자르지 않는다.** 넘치는 것은 화면이 페이드로 끝내고(구현 결정 4), 여기서 상수를
 * 정하면 그 수가 화면 폭과 영영 어긋난 채로 산다.
 */
export function firstLine(text: string | null): string | null {
  if (text === null) return null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return null;
}

/**
 * 승인 요청 하나를 한 줄로 요약한다 — `Bash · git status` 꼴이다.
 *
 * **`tool_input`을 통째로 직렬화하지 않는다.** `Edit`의 입력에는 파일 전체가 들어 있어
 * 그대로 실으면 둘째 줄이 파일 한 장이 된다. 사람이 승인 여부를 가르는 데 쓰는 값만 골라
 * 읽고, 아는 키가 하나도 없으면 **도구 이름만** 말한다 — 모르는 것을 지어내지 않는다.
 */
const INPUT_KEYS = ["command", "file_path", "path", "pattern", "url", "description"];

export function permissionLine(payload: unknown): string | null {
  const tool = stringAt(payload, "tool_name") ?? stringAt(payload, "tool");
  const input = objectOf(payload)?.["tool_input"] ?? objectOf(payload)?.["input"];

  let detail: string | null = null;
  if (typeof input === "string") detail = firstLine(input);
  else {
    for (const key of INPUT_KEYS) {
      detail = firstLine(stringAt(input, key));
      if (detail !== null) break;
    }
  }

  if (tool === null) return detail;
  return detail === null ? tool : `${tool} · ${detail}`;
}

/**
 * `SessionEnd` 하나를 정규 이벤트로 접는다. **에이전트 둘이 같은 규칙을 쓴다** — 스펙의
 * 전이 표가 `end` 줄에 「이유가 `clear` 아님」을 달고 그 줄에 claude와 codex를 함께 적었으니,
 * 이유를 보는 자리도 둘 다여야 그 줄이 그대로 선다. codex 쪽 페이로드에 `reason`이 아예
 * 없으면 그냥 `end`라, 넓게 잡아 두는 값이 없다.
 */
export function sessionEnd(payload: unknown): "end" | "clear" {
  return stringAt(payload, "reason") === "clear" ? "clear" : "end";
}

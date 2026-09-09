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
 * `tool_input`에서 **사람이 승인 여부를 가르는 데 쓰는 값**만 골라 읽는 키들. 왜 이 여섯인가:
 * 승인이 뜨는 도구가 실제로 이것들이다 — 셸(`command`), 파일 도구(`file_path`·`path`),
 * 검색(`pattern`), 웹(`url`), 그리고 codex가 `tool_input.description`으로 스스로 요약을
 * 실어 주는 자리(연구 B-1 표). 순서가 곧 우선순위다: 앞선 키가 있으면 그것으로 끝낸다.
 */
const INPUT_KEYS = ["command", "file_path", "path", "pattern", "url", "description"];

/**
 * 승인 요청 하나를 한 줄로 요약한다 — `Bash · git status` 꼴이다.
 *
 * **`tool_input`을 통째로 직렬화하지 않는다.** `Edit`의 입력에는 파일 전체가 들어 있어
 * 그대로 실으면 둘째 줄이 파일 한 장이 된다. 사람이 승인 여부를 가르는 데 쓰는 값만 골라
 * 읽고, 아는 키가 하나도 없으면 **도구 이름만** 말한다 — 모르는 것을 지어내지 않는다.
 *
 * **키는 `tool_name`·`tool_input` 둘뿐이다.** 정본 연구가 claude·codex **둘 다** 이 이름으로
 * 적었고(`spec/research/claude-codex-first-party.md`의 B-2:149 · B-1:317) 다른 이름은 어디에도
 * 없다. 예전에는 `tool`·`input`도 함께 읽었는데, 그 갈래는 근거도 검사도 없어 아무도 안 밟는
 * 길이었다 — 여기서 넓게 읽는 것은 「모르면 아무 주장도 안 한다」와 어긋난다.
 */
export function permissionLine(payload: unknown): string | null {
  const tool = stringAt(payload, "tool_name");
  const input = objectOf(payload)?.["tool_input"];

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
 * claude의 `SessionEnd` 하나를 정규 이벤트로 접는다.
 *
 * **claude 전용이다.** 스펙 전이 표는 `end` 줄에만 codex를 적고 `clear` 줄에서는 뺐다
 * (구현 스펙의 전이 표) — 정본 연구도 codex `SessionEnd`의 고유 페이로드 필드를 `—`(없음)로
 * 적어(B-1 표), 이유가 실려 올 길 자체가 없다. 그래서 codex 어댑터는 이 함수를 안 딛고 늘
 * `end`로 접는다. 이유를 보는 자리를 둘 다로 넓히면 스펙이 갈라 둔 두 줄이 한 줄이 된다.
 *
 * **읽는 키가 `session_end_reason`이다.** 정본 연구가 그렇게 적는다
 * (`spec/research/claude-codex-first-party.md`의 B-2 표 — `session_end_reason`이 matcher이자
 * 고유 필드다). 훅 스크립트는 stdin JSON을 손대지 않고 그대로 나르므로(`atelier-hook.py`)
 * 여기 도착하는 것도 그 이름이다. 예전 구현이 읽던 `reason`을 **뒤에 남겨 둔 것**은 이 work의
 * 실물 확인 관문이 아직 안 닫혔기 때문이다(`spec/훅-실물-확인.md`의 「확인 결과」 — claude가
 * 우리가 가정한 모양으로 주는지를 사람이 아직 한 번도 안 봤다). 견주는 값이 문자열 `clear`
 * 하나뿐이라 둘을 다 읽어 잃는 것이 없고, 반대로 키 하나가 어긋나면 `/clear` 줄이 실물에서
 * 한 번도 안 서서 **방금 지운 화면에 초록이 뜬다.** 둘 다 검사에 줄이 있다.
 */
export function sessionEnd(payload: unknown): "end" | "clear" {
  const reason = stringAt(payload, "session_end_reason") ?? stringAt(payload, "reason");
  return reason === "clear" ? "clear" : "end";
}

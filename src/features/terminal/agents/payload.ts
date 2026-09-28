import type { DialogKind } from "./types";

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
 * 여러 줄짜리 말에서 **첫 줄**만 뽑는다. 호버 카드의 말 칸·띠·알림 본문이 다 한 줄이라
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
 * 그대로 실으면 말 한 줄이 파일 한 장이 된다. 사람이 승인 여부를 가르는 데 쓰는 값만 골라
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
 * 승인 요청이 세운 **창**(티켓 25 리뷰 반영). 도구 이름이 있으면 권한 창이다 — 물음 도구(claude의 `AskUserQuestion`)는 어댑터가
 * 먼저 가른다. **도구 이름이 없으면 모른다**(`null`): 처리기가 페이로드를 못 읽어도 이벤트는 남기는데(`atelier-hook.py`), 그 요청이
 * 물음일 수도 있다. 모르면 승인 추론이 안 서고 옛 동작대로 도구가 끝날 때 풀린다.
 */
export function permissionDialog(payload: unknown): DialogKind | null {
  return stringAt(payload, "tool_name") === null ? null : "permission";
}

/** 그 키의 값이 **참(`true`) 그 자체**인가. 글자 `"true"`나 1은 아니다 — 모르는 모양은 거짓이다. */
export function flagAt(payload: unknown, key: string): boolean {
  return objectOf(payload)?.[key] === true;
}

/**
 * `AskUserQuestion` 도구의 **첫 물음** 한 줄. 입력 모양은 claude 2.1.283 바이너리의 도구 스키마다 —
 * `tool_input.questions[]`의 원소마다 `question`(물음 글) · `header` · `options` · `multiSelect`.
 *
 * **첫 물음만 싣는다.** 한 번에 넷까지 묻지만 셸의 말이 서는 자리(호버 카드의 말 칸 · 행 버튼의 설명 — `callingNote`)와 띠 ·
 * 알림은 한 줄이고, 사람이 창을 열면 전부 보인다.
 * 물음을 못 읽으면 승인 요청과 같은 요약(`permissionLine` — 모르면 도구 이름만)이 바닥이다: 모르는 것을
 * 지어내지 않는다.
 */
export function questionLine(payload: unknown): string | null {
  const questions = objectOf(objectOf(payload)?.["tool_input"])?.["questions"];
  const first = Array.isArray(questions) ? questions[0] : undefined;
  return firstLine(stringAt(first, "question")) ?? permissionLine(payload);
}

/**
 * claude `StopFailure`의 한 줄(프로세스 스펙 S57) — **오류 상세의 첫 줄**, 없으면 **오류 종류**다. 모양은 Claude Code
 * 훅 문서(티켓 18이 읽음): `error`(`rate_limit` · `overloaded` · `server_error` 등 열둘) · 선택 `error_details` ·
 * 선택 `last_assistant_message`(API 오류 글 자체).
 *
 * `last_assistant_message`는 안 읽는다 — 상세가 없을 때 그 글은 대개 `API Error: 429 …` 꼴로 종류와 같은 말을
 * 길게 하고, 두 칸 중 어느 것을 먼저 읽을지를 스펙이 상세 · 종류 둘로만 정했다. 「오류로 끝남」을 앞에 붙이는
 * 것은 상태 기계다(`shell-attention.ts`) — 그 말은 결과의 이름이지 페이로드의 것이 아니다.
 */
export function stopFailureLine(payload: unknown): string | null {
  return firstLine(stringAt(payload, "error_details")) ?? stringAt(payload, "error");
}

/**
 * 이 사건을 낸 **서브에이전트**의 id — 본 에이전트가 낸 사건이면 `null`이다(티켓 20 리뷰 반영). 서브에이전트 안의 훅도
 * 같은 설정으로 불리고 페이로드에 `agent_id`가 실린다(Claude Code 훅 문서의 공통 입력 칸, 연구 B-2). codex도 같은
 * 칸 이름이다(codex-cli 0.155.1 바이너리의 도구 · 서브에이전트 훅 스키마 — 티켓 19 · 20이 읽음).
 *
 * **두 에이전트가 같은 칸이라 어댑터 밖에서 한 번 읽는다** — 처리기가 서브에이전트 수를 접을 때 에이전트를 안 가리고
 * 이 칸을 읽는 것(S51)과 같은 가름이다. 읽는 자리는 `shell-attention.ts`의 `nextAttention` 하나이고, 쓰는 자리는 「도구가
 * 기다림을 푸는가」 하나다.
 */
export function subagentOf(payload: unknown): string | null {
  return stringAt(payload, "agent_id");
}

/**
 * claude의 `SessionEnd` 하나를 정규 이벤트로 접는다.
 *
 * **claude 전용이다.** 스펙 전이 표는 `end` 줄에만 codex를 적고 `clear` 줄에서는 뺐다
 * (구현 스펙의 전이 표) — 정본 연구도 codex `SessionEnd`의 고유 페이로드 필드를 `—`(없음)로
 * 적어(B-1 표), 이유가 실려 올 길 자체가 없다. 그래서 codex 어댑터는 이 함수를 안 딛고 늘
 * `end`로 접는다. 이유를 보는 자리를 둘 다로 넓히면 스펙이 갈라 둔 두 줄이 한 줄이 된다.
 *
 * **읽는 키는 `reason`이다 — 실측이다**(2026-09-10). 진짜 claude 2.1.267에 훅만 걸어 한 턴을
 * 돌리고 훅 프로세스가 stdin으로 받은 JSON을 그대로 봤다: `{ session_id, transcript_path, cwd,
 * prompt_id, hook_event_name: "SessionEnd", reason: "other" }`. 배포된 그 바이너리 안의 훅 입력
 * 스키마도 같은 이름이고(`{ hook_event_name: "SessionEnd", reason: <"clear"|"resume"|"logout"|
 * "prompt_input_exit"|"other"> }`), matcher가 견주는 필드도 `reason`이다.
 *
 * **`session_end_reason`은 걷어냈다.** 이 work의 정본 연구가 그 이름을 적었지만
 * (`spec/research/claude-codex-first-party.md`의 B-2:157) 그 글자는 배포 바이너리 어디에도 없다
 * (0회) — 훅 matcher 문서의 이름을 필드 이름으로 옮겨 적은 것으로 보인다. 실물이 안 흐르는
 * 갈래를 「혹시 몰라」 남겨 두면 **검사만 초록인 죽은 길**이 하나 서고, 다음 사람이 그것을
 * 근거로 읽는다. 같은 이유로 이 파일은 위에서 `tool`·`input` 갈래도 걷어냈다.
 *
 * 이 한 글자가 걸린 자리가 `/clear`다 — 어긋나면 `clear` 줄이 실물에서 한 번도 안 서서
 * **방금 지운 화면에 초록이 뜬다.** 그 실패는 조용해서(사람은 「원래 그런가 보다」로 읽는다)
 * 실측 픽스처 한 장과 「지어낸 키는 안 읽는다」 한 줄을 검사에 함께 걸어 둔다
 * (`shell-attention.test.ts`).
 */
export function sessionEnd(payload: unknown): "end" | "clear" {
  return stringAt(payload, "reason") === "clear" ? "clear" : "end";
}

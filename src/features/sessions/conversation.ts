import type { Envelope, Line, PermissionLine, ToolCall } from "./types";

/**
 * 봉투들을 화면에 그릴 줄로 옮긴다. **라이브 스트림과 재생이 함께 지나는 유일한 자리다.**
 *
 * 그리는 것은 다섯뿐이다 — 내 말, 에이전트의 말, 도구 호출 한 줄, 답을 얻지 못한 이유,
 * 그리고 권한 카드. **나머지는 건너뛴다.**
 * 아직 모르는 종류의 봉투도, 알지만 이 판이 그리지 않기로 한 갱신(`usage_update`는 판 03,
 * 도구 카드와 thought 접기는 판 04)도 같은 규칙으로 지나간다. 그리지 않을 뿐 기록에는
 * 이미 남아 있으므로, 뒤 판이 그리기로 하면 지난 대화까지 함께 살아난다.
 */
export function toLines(envelopes: Envelope[]): Line[] {
  const lines: Line[] = [];
  // 지나간 도구 호출들. 권한 요청이 실어 오는 `toolCall`은 **갱신**이라 앞서 보낸 자리가
  // 비어 있으므로(실물 Codex의 편집 요청에는 이름도 입력도 없다) 여기서 메운다.
  const tools = new Map<string, ToolCall>();

  for (const envelope of envelopes) {
    if (envelope.kind === "user_prompt") {
      lines.push({ kind: "user", text: envelope.text ?? "" });
      continue;
    }
    if (envelope.kind === "turn_failed") {
      lines.push({ kind: "failed", text: envelope.message ?? "답을 얻지 못했어요" });
      continue;
    }
    if (envelope.kind === "permission_request") {
      const asked = envelope.payload?.toolCall ?? {};
      const known = (asked.toolCallId && tools.get(asked.toolCallId)) || {};
      // 입력이 `rawInput`으로 오지 않는 도구도 있다. 그런 것도 **그대로** 펴서 보인다 —
      // 승인 화면에서 대상이 감춰지는 것보다 못생긴 편이 낫다 (예쁘게 그리는 것은 판 04).
      const input = asked.rawInput ?? known.rawInput ?? asked.content ?? known.content;
      lines.push({
        kind: "permission",
        requestId: envelope.requestId ?? "",
        title: asked.title ?? known.title ?? asked.kind ?? "도구",
        input: input === undefined ? "" : JSON.stringify(input, null, 2),
        options: envelope.payload?.options ?? [],
        answered: null,
      });
      continue;
    }
    if (envelope.kind === "permission_response") {
      // 답은 **아직 답하지 않은 가장 가까운 요청**에 붙는다. 요청 번호는 연결마다 다시
      // 세므로, 앱을 껐다 켠 기록에는 같은 번호가 두 번 나올 수 있다.
      const card = lastUnanswered(lines, envelope.requestId ?? "");
      if (card) {
        card.answered = {
          optionId: envelope.optionId ?? "",
          outcome: envelope.outcome ?? "deny",
        };
      }
      continue;
    }
    if (envelope.kind !== "session_update") continue;

    const update = envelope.payload?.update;
    switch (update?.sessionUpdate) {
      case "agent_message_chunk": {
        const text = textOf(update.content);
        const last = lines[lines.length - 1];
        // 조각들은 한 덩이의 말이다. 이어 붙여야 문장으로 읽힌다.
        if (last?.kind === "agent") last.text += text;
        else lines.push({ kind: "agent", text });
        break;
      }
      case "tool_call":
        // 뒤따라올 권한 요청이 이 자리를 가리킬 수 있으므로 기억해 둔다
        if (update.toolCallId) {
          tools.set(update.toolCallId, {
            title: update.title,
            rawInput: update.rawInput,
            content: update.content,
          });
        }
        lines.push({ kind: "tool", text: update.title ?? "도구" });
        break;
    }
  }

  return lines;
}

/** 말 조각이 실어 온 글자. 텍스트가 아닌 블록(이미지 따위)은 이 판이 그리지 않는다. */
function textOf(content: unknown): string {
  const block = content as { type?: string; text?: string } | null | undefined;
  return block?.type === "text" ? (block.text ?? "") : "";
}

/** 뒤에서부터 찾는다 — `findLast`는 이 프로젝트가 겨누는 lib보다 나중에 생겼다. */
function lastUnanswered(lines: Line[], requestId: string): PermissionLine | null {
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at];
    if (line.kind === "permission" && line.requestId === requestId && line.answered === null) {
      return line;
    }
  }
  return null;
}

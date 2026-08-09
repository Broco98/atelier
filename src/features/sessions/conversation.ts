import type { Envelope, Line } from "./types";

/**
 * 봉투들을 화면에 그릴 줄로 옮긴다. **라이브 스트림과 재생이 함께 지나는 유일한 자리다.**
 *
 * 그리는 것은 셋뿐이다 — 내 말, 에이전트의 말, 도구 호출 한 줄. **나머지는 건너뛴다.**
 * 아직 모르는 종류의 봉투도, 알지만 이 판이 그리지 않기로 한 갱신(`usage_update`는 판 03,
 * 도구 카드와 thought 접기는 판 04)도 같은 규칙으로 지나간다. 그리지 않을 뿐 기록에는
 * 이미 남아 있으므로, 뒤 판이 그리기로 하면 지난 대화까지 함께 살아난다.
 */
export function toLines(envelopes: Envelope[]): Line[] {
  const lines: Line[] = [];

  for (const envelope of envelopes) {
    if (envelope.kind === "user_prompt") {
      lines.push({ kind: "user", text: envelope.text ?? "" });
      continue;
    }
    if (envelope.kind === "turn_failed") {
      lines.push({ kind: "failed", text: envelope.message ?? "답을 얻지 못했어요" });
      continue;
    }
    if (envelope.kind !== "session_update") continue;

    const update = envelope.payload?.update;
    switch (update?.sessionUpdate) {
      case "agent_message_chunk": {
        const text = update.content?.type === "text" ? (update.content.text ?? "") : "";
        const last = lines[lines.length - 1];
        // 조각들은 한 덩이의 말이다. 이어 붙여야 문장으로 읽힌다.
        if (last?.kind === "agent") last.text += text;
        else lines.push({ kind: "agent", text });
        break;
      }
      case "tool_call":
        lines.push({ kind: "tool", text: update.title ?? "도구" });
        break;
    }
  }

  return lines;
}

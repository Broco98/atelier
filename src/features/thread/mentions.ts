import type { Avatar } from "./faces";
import type { AgentProblem, AgentRoster, DefinitionSource } from "./types";

// @ 메뉴 · 멘션 · 받는 이(v1 티켓 14 · 구현 스펙 §14 · S9 · 캔버스 Composer 보드 「@ · Agent 부르기」)의 **순수 함수**다. 화면은 엔진과
// 같은 규칙으로 받는 이를 읽는다(v1 티켓 13 노트) — 보내기 전에 칩이 말하는 받는 이와 엔진이 실제로 고르는 받는 이가 갈리면 안 된다.
//
// - **멘션 문법은 엔진의 `first_mention`과 같다**(`crates/atelier-acp/src/host/thread.rs`): `@`가 말의 처음이거나 이름 글자가 아닌
//   것 뒤에 설 때만, 백틱 밖에서만 멘션이다. 이름 글자는 글자 · 숫자와 `_` `-` `.` `/`이고, 끝의 `.` `-` `/`는 문장 부호로 뗀다.
// - **받는 이는 멘션 이름의 가장 긴 앞부분 가운데 아는 이름이다** — 「@reviewer가」의 조사를 뗀다. 아는 이름은 이미 앉은 참여자(handle,
//   Project에서 온 참여자는 `project/handle`도)가 먼저이고, 그다음 범위의 Agent(부르는 이름 · `project/handle`)다.
// - **메뉴의 차례**(스토리 39): 이 Thread에 있는 Agent → Library → Project(slug마다 한 묶음). 깨진 파일은 그 묶음의 끝에 흐리게,
//   까닭과 함께 선다(스토리 71). 새 Thread는 앉은 이가 없어 Host가 Library의 맨 앞이다 — 멘션하지 않으면 받는 이가 Host라서다.
// - 메뉴가 넣는 글은 `@<call> `(뒤에 빈칸)이다 — 조사와 엉키지 않는다(v1 티켓 13 노트).

/** 이름 글자 — 엔진의 `is_name_char`와 같다. */
const NAME_CHAR = /[\p{L}\p{N}_\-./]/u;
const isNameChar = (char: string | undefined): boolean => char !== undefined && NAME_CHAR.test(char);

const HOST = "host";

/** @ 메뉴 · 받는 이 칩의 Agent 하나 — 앉은 참여자이거나 범위에서 찾은(깨진 것도) Agent다. */
export interface AgentChoice {
  /** 부르는 이름 — 메뉴가 `@<call> `으로 넣는다. 앉은 참여자는 handle이다. */
  call: string;
  handle: string;
  name: string;
  description: string;
  avatar: Avatar | null;
  from: DefinitionSource | null;
  /** 메뉴 묶음의 머리 — 「이 Thread에 있음」 · 「Library」 · Project slug. */
  section: string;
  /** 이 Thread에 이미 앉았나. */
  seated: boolean;
  /** 깨졌으면 그 까닭의 글 — 부를 수 없다. */
  broken: string | null;
  /** 정의 파일의 선호 모델 · 생각 깊이 — 아직 앉지 않은 Agent를 받는 이로 고르면 모델 칩이 이 값을 보인다(스토리 33 · 73). */
  model: { prefer: string | null; effort: string | null } | null;
}

/** 앉은 참여자 — handle과 온 곳은 `thread.json`, 이름 · 얼굴은 기록의 `joined` 줄이 정본이다(목록에서 사라져도 부른다, 스토리 52). */
export interface SeatedAgent {
  handle: string;
  from: DefinitionSource | null;
  name: string;
  avatar: Avatar | null;
}

/** 말의 첫 멘션 — 그 이름과 `@`의 자리. 없으면 `null`(받는 이는 Host). */
export function firstMention(text: string): { name: string; start: number } | null {
  let inCode = false;
  const chars = [...text];
  let offset = 0;
  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at];
    if (char === "`") inCode = !inCode;
    else if (char === "@" && !inCode && !isNameChar(chars[at - 1])) {
      let end = at + 1;
      while (end < chars.length && isNameChar(chars[end])) end += 1;
      const name = chars
        .slice(at + 1, end)
        .join("")
        .replace(/[.\-/]+$/u, "");
      if (name !== "") return { name, start: offset };
    }
    offset += char.length;
  }
  return null;
}

/**
 * 커서가 선 멘션 — @ 메뉴가 찾는 말(`@`부터 커서까지)과 고르면 갈아 끼울 자리(`@`부터 이름 끝까지). 커서가 멘션 이름 안에 있지
 * 않으면 `null`이다(멘션이 될 수 없는 `@` · 백틱 안 포함).
 */
export function mentionAt(text: string, caret: number): { start: number; end: number; query: string } | null {
  let start = caret;
  while (start > 0 && text[start - 1] !== "@" && isNameChar(text[start - 1])) start -= 1;
  start -= 1;
  if (start < 0 || text[start] !== "@" || isNameChar(text[start - 1])) return null;
  if ((text.slice(0, start).match(/`/g)?.length ?? 0) % 2 === 1) return null;
  let end = caret;
  while (end < text.length && isNameChar(text[end])) end += 1;
  return { start, end, query: text.slice(start + 1, caret) };
}

/** 고른 Agent를 그 멘션 자리에 넣는다 — `@<call> `, 뒤가 이미 빈칸이면 하나만. 커서는 그 뒤다. */
export function insertMention(text: string, at: { start: number; end: number }, call: string): { text: string; caret: number } {
  const rest = text.slice(at.end);
  const token = /^\s/.test(rest) ? `@${call}` : `@${call} `;
  return { text: `${text.slice(0, at.start)}${token}${rest}`, caret: at.start + token.length + (/^\s/.test(rest) ? 1 : 0) };
}

/** 깨진 까닭의 글(「~요」체) — @ 메뉴에서 그 줄의 설명 자리에 선다. */
export function problemText(problem: AgentProblem): string {
  switch (problem.kind) {
    case "unreadable":
      return `읽지 못했어요 — ${problem.message}`;
    case "unknownTool":
      return `모르는 도구가 있어요: ${problem.tool}`;
    case "runtimeNotAccepted":
      return "Claude Code를 받지 않아요";
    case "hostOutsideLibrary":
      return "host는 Library에만 둘 수 있어요";
  }
}

const sectionOf = (from: DefinitionSource): string => (from === "library" ? "Library" : from.project);
const sameSource = (a: DefinitionSource | null, b: DefinitionSource): boolean =>
  a === "library" || a === null ? b === "library" : b !== "library" && a.project === b.project;

/** @ 메뉴의 줄들 — 앉은 참여자 → Library → Project 차례(머리말). 범위를 아직 못 읽었으면(`null`) 앉은 이만이다. */
export function agentChoices(roster: AgentRoster | null, seated: readonly SeatedAgent[]): AgentChoice[] {
  const here = new Set(seated.map((one) => one.handle));
  const choices: AgentChoice[] = seated.map((one) => {
    const found = roster?.agents.find((agent) => agent.definition.handle === one.handle && sameSource(one.from, agent.from));
    return {
      call: one.handle,
      handle: one.handle,
      name: one.name,
      description: found?.definition.description ?? "",
      avatar: one.avatar,
      from: one.from,
      section: "이 Thread에 있음",
      seated: true,
      broken: null,
      model: found?.definition.model ?? null,
    };
  });
  if (!roster) return choices;
  const sections = ["Library"];
  for (const one of [...roster.agents, ...roster.broken]) {
    const section = sectionOf(one.from);
    if (!sections.includes(section)) sections.push(section);
  }
  for (const section of sections) {
    const agents = roster.agents
      .filter((agent) => sectionOf(agent.from) === section && !here.has(agent.definition.handle))
      // 앉은 이가 없으면 Host가 맨 앞이다 — 멘션하지 않은 말의 받는 이다.
      .sort((a, b) => Number(b.call === HOST) - Number(a.call === HOST));
    for (const agent of agents) {
      choices.push({
        call: agent.call,
        handle: agent.definition.handle,
        name: agent.definition.name || agent.definition.handle,
        description: agent.definition.description,
        avatar: agent.definition.avatar,
        from: agent.from,
        section,
        seated: false,
        broken: null,
        model: agent.definition.model,
      });
    }
    for (const broken of roster.broken) {
      if (sectionOf(broken.from) !== section || here.has(broken.call)) continue;
      choices.push({
        call: broken.call,
        handle: broken.handle,
        name: broken.handle,
        description: "",
        avatar: null,
        from: broken.from,
        section,
        seated: false,
        broken: problemText(broken.problem),
        model: null,
      });
    }
  }
  return choices;
}

/** 친 글자로 거른다 — 부르는 이름 · handle · 이름 가운데 하나가 그 글자를 품은 줄만, 묶음 차례 안에서 그 글자로 시작하는 것이 먼저다. */
export function matchAgents(choices: readonly AgentChoice[], query: string): AgentChoice[] {
  const typed = query.toLowerCase();
  if (typed === "") return [...choices];
  const keys = (one: AgentChoice) => [one.call, one.handle, one.name].map((key) => key.toLowerCase());
  const rank = (one: AgentChoice) => (keys(one).some((key) => key.startsWith(typed)) ? 0 : 1);
  const order = [...new Set(choices.map((one) => one.section))];
  return choices
    .filter((one) => keys(one).some((key) => key.includes(typed)))
    .map((one, at) => ({ one, at }))
    .sort((a, b) => order.indexOf(a.one.section) - order.indexOf(b.one.section) || rank(a.one) - rank(b.one) || a.at - b.at)
    .map(({ one }) => one);
}

/** 그 줄을 이 이름으로 부르나 — 부르는 이름 그대로, 또는 Project에서 왔으면 `project/handle`. */
const answersTo = (one: AgentChoice, call: string): boolean =>
  one.call === call || (one.from !== null && one.from !== "library" && `${one.from.project}/${one.handle}` === call);

/** 받는 이 — 멘션 이름, 고른 Agent(모르면 `null`), 입력칸에서 그 멘션이 차지한 자리(`@`부터 고른 이름 끝까지). */
export interface Recipient {
  mention: string;
  agent: AgentChoice | null;
  at: { start: number; end: number };
}

/**
 * 받는 이 — 멘션이 없으면 `null`(Host). 있으면 그 멘션 이름과, 그 이름의 가장 긴 앞부분 가운데 아는 Agent(앉은 이가 먼저)다.
 * 아는 이름이 없으면 `agent`가 `null`이다 — 보내면 엔진이 거절 글을 준다.
 */
export function recipientOf(text: string, choices: readonly AgentChoice[]): Recipient | null {
  const mention = firstMention(text);
  if (!mention) return null;
  const chars = [...mention.name];
  const span = (call: string) => ({ start: mention.start, end: mention.start + 1 + call.length });
  for (let end = chars.length; end > 0; end -= 1) {
    const call = chars.slice(0, end).join("");
    const agent =
      choices.find((one) => one.seated && answersTo(one, call)) ?? choices.find((one) => !one.seated && answersTo(one, call));
    if (agent) return { mention: mention.name, agent, at: span(call) };
  }
  return { mention: mention.name, agent: null, at: span(mention.name) };
}

/**
 * 보낸 말에서 칠할 멘션(Messages 보드 「길게 · 멘션」) — 첫 멘션의 `@`부터, 그 이름의 앞부분 가운데 그 턴에 답한 이(`who`, 또는
 * `project/<who>`)의 끝까지다. 그 턴의 받는 이를 엔진이 그 멘션으로 골랐다는 뜻이라 조사는 칠하지 않는다. 답한 이와 닿지 않는
 * 멘션(엔진이 거절했다면 말이 남지 않으므로, 옛 기록뿐이다)은 칠하지 않는다.
 */
export function mentionOf(text: string, who: string): { start: number; end: number } | null {
  const mention = firstMention(text);
  if (!mention) return null;
  const chars = [...mention.name];
  for (let end = chars.length; end > 0; end -= 1) {
    const call = chars.slice(0, end).join("");
    const [project, handle, extra] = call.split("/");
    if (call === who || (handle === who && project !== "" && extra === undefined)) {
      return { start: mention.start, end: mention.start + 1 + call.length };
    }
  }
  return null;
}

/**
 * 받는 이 칩에서 고른 받는 이로 말을 고친다 — 말 앞의 멘션(앞 빈칸 뒤 첫 낱말)을 걷고, Host가 아니면 `@<call> `을 앞에 세운다. 말
 * 가운데의 멘션은 사람의 글이라 그대로 둔다 — 앞에 세운 멘션이 첫 멘션이 되어 받는 이가 된다(S9).
 */
export function withRecipient(text: string, call: string | null): string {
  const lead = /^\s*@[\p{L}\p{N}_\-./]+\s*/u.exec(text);
  const body = lead ? text.slice(lead[0].length) : text;
  return call === null ? body : `@${call} ${body}`;
}

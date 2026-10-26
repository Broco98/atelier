import type { AgentChoice } from "@/features/thread/mentions";
import type { ThreadSummary } from "@/features/thread/types";

// Library 화면(v1 티켓 19 · 구현 스펙 §16 S35)의 순수 규칙. 화면은 Agent 목록과 파일 읽기만 한다 — 고치는 길은 대화(Host에게 맡김)와
// 외부 편집기(「Finder에서 열기」) 둘이다.

/** 목록의 묶음 하나 — 「Library」, 또는 지금 Work의 Project 하나. */
export interface LibraryGroup {
  section: string;
  rows: AgentChoice[];
}

/**
 * 목록을 묶는다 — 줄은 @ 메뉴와 같은 차례로 온다(`agentChoices`: Library가 먼저, Host가 맨 앞, 깨진 줄은 묶음 끝). **지금 Work의
 * Project 안 Agent는 Project마다 따로 묶인다**(S35) — 같은 handle이 Library에도 있으면 Project 것이 이겨 Library 묶음에서 빠진다
 * (범위 규칙 — v1 티켓 11).
 */
export function groupsOf(rows: readonly AgentChoice[]): LibraryGroup[] {
  const groups: LibraryGroup[] = [];
  for (const row of rows) {
    const tail = groups[groups.length - 1];
    if (tail && tail.section === row.section) tail.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }
  return groups;
}

/**
 * 오른쪽에 읽을 줄 — 주소가 고른 Agent(`?agent=<call>`), 없거나 목록에서 사라졌으면 첫 줄이다. 깨진 줄도 고른다 — 무엇이 틀렸는지
 * 파일을 읽어야 고친다(스토리 71 · 72).
 */
export function pickedAgent(rows: readonly AgentChoice[], call: string | undefined): AgentChoice | null {
  return rows.find((row) => row.call === call) ?? rows[0] ?? null;
}

/**
 * 문서 보기에 넘길 글 — frontmatter(`---` 사이)를 YAML 코드 블록으로 감싼다. 마크다운은 frontmatter를 모른다: 그대로 넘기면 `---`가
 * 가로줄이 되고 그 위의 YAML 줄이 제목(setext)으로 선다. 울타리 두 줄이 `---` 두 줄을 갈아 끼우므로 **줄 수가 그대로다** — 문서
 * 보기의 블록 복사가 적는 줄 번호가 파일의 줄 번호다. frontmatter가 없거나 닫히지 않은 파일(깨진 파일)은 그대로 둔다.
 */
export function frontmatterAsCode(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const lines = text.split("\n");
  const close = lines.indexOf("---", 1);
  if (close < 0) return text;
  lines[0] = "```yaml";
  lines[close] = "```";
  return lines.join("\n");
}

/** 경로 줄의 조각 — Library의 Agent는 `Library › <handle>.md`, Project의 Agent는 그 레포 안 자리(`<project> › .atelier › agents › …`)다. */
export function agentPathPieces(row: AgentChoice): string[] {
  const file = `${row.handle}.md`;
  if (row.from === null || row.from === "library") return ["Library", file];
  return [row.from.project, ".atelier", "agents", file];
}

/**
 * 사이드바의 Library 줄이 여는 Work — **지금 선 자리의 Work**다(S35 「지금 Work의 Project 안 Agent는 따로 묶는다」). Work에 이은
 * Thread면 그 Work, Work 화면이면 그 slug, Library에 서 있으면 지금 보는 Work(`current`) 그대로다. 그 밖(새 Thread · Work 없는
 * Thread · 지금 화면들)은 없다 — Library만 보인다.
 */
export function workOfPlace(pathname: string, threads: readonly ThreadSummary[] | undefined, current: string | null): string | null {
  const [, root, key] = pathname.split("/");
  switch (root) {
    case "threads":
      return threads?.find((thread) => thread.id === key)?.work ?? null;
    case "works":
      return key ? decodeURIComponent(key) : null;
    case "library":
      return current;
    default:
      return null;
  }
}

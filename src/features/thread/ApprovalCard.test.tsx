import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ApprovalCard from "./ApprovalCard";
import type { PendingPermission } from "./fold";

// 승인 카드의 그림(restart 02b-5 · Cards 보드 「승인 카드 — 입력창 자리에 선다」) — 위 칸은 갈래 · 물음 · 명령이나 줄어든 diff · 아래 한 줄이고, 아래 줄은
// 왼쪽 허락 문구 · 오른쪽 「거부 Esc」 · 「한 번만 허용 ↵」다. 값은 `approval.ts`가 짓고(그 시험이 글을 잰다), 여기서는 그 값이 보드의 자리에 서는지를 본다.

const CLAUDE = [
  { optionId: "allow_once", name: "Yes", kind: "allow_once" },
  { optionId: "reject", name: "No, and tell Claude what to do differently", kind: "reject_once" },
];

const request = (toolCall: Record<string, unknown>, extra: Partial<PendingPermission> = {}): PendingPermission => ({
  requestId: "r1",
  options: CLAUDE,
  toolCall,
  tool: null,
  planReview: false,
  card: "command",
  policy: "매번 묻기",
  grant: [],
  ...extra,
});

const draw = (pending: PendingPermission, runtime = "claude-code", name = "Claude Code") =>
  renderToStaticMarkup(
    <ApprovalCard thread="t" name={name} runtime={runtime} request={pending} scope="work" cwd="/w/api" count={null} />,
  );

/** 그린 글 — 꼬리표를 걷고 빈칸을 하나로. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** 단추들의 글 — 그린 차례 그대로. */
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => words(match[1]));

describe("승인 카드", () => {
  const migrate = {
    toolCallId: "t1",
    kind: "execute",
    title: "cargo test -p atelier-core watcher",
    rawInput: { command: "cargo test -p atelier-core watcher", description: "재시도 테스트를 돌려요" },
  };

  it("명령 — 「터미널」 · 물음 · 명령 상자 · 「사유 · …」, 아래 줄은 허락 문구 · 거부 Esc · 한 번만 허용 ↵ 차례다(보드 「명령」)", () => {
    const html = draw(request(migrate, { grant: ["Bash(cargo test *)"] }));
    expect(html).toContain('aria-label="Claude Code가 이 명령을 실행하도록 허용할까요?"');
    expect(words(html)).toBe(
      "터미널 Claude Code가 이 명령을 실행하도록 허용할까요? cargo test -p atelier-core watcher 사유 · 재시도 테스트를 돌려요 비슷한 명령 허용 거부 Esc 한 번만 허용 ↵",
    );
    expect(buttons(html)).toEqual(["비슷한 명령 허용", "거부 Esc", "한 번만 허용 ↵"]);
    // 거부 · 한 번만 허용은 오른쪽 끝에 붙는다 — 그 앞의 빈칸이 늘어난다(보드 `.ra-grow`).
    expect(html).toMatch(/비슷한 명령 허용<\/button><span aria-hidden="true" class="[^"]*flex-1/);
  });

  it("Codex가 보낸 긴 이름은 단추 안에서 접히고, 그 줄은 접히지 않아 거부와 허용이 오른쪽 한 줄에 남는다(보드 「네트워크 · 샌드박스 밖」 · `.ra-opt.long`)", () => {
    const html = draw(
      request(
        { kind: "fetch", rawInput: { url: "https://registry.npmjs.org/react" } },
        {
          options: [
            { optionId: "allow_once", name: "Yes, proceed", kind: "allow_once" },
            { optionId: "allow_npm", name: "Yes, and don't ask again for commands that start with npm", kind: "allow_always" },
            { optionId: "cancel", name: "No, and tell Codex what to do differently", kind: "reject_once" },
          ],
        },
      ),
      "codex",
      "Codex",
    );
    expect(buttons(html)).toEqual(["Yes, and don't ask again for commands that start with npm", "거부 Esc", "한 번만 허용 ↵"]);
    expect(html).toMatch(/data-acts="[^"]*" class="[^"]*flex-nowrap/);
    expect(html).toMatch(/data-long="true"[^>]*class="[^"]*whitespace-normal/);
  });

  it("MCP — 「세부 정보 보기」는 접혀 선다. 도구 입력은 누르면 카드 안에서 펼친다(보드 「MCP 도구」)", () => {
    const html = draw(
      request({
        kind: "other",
        title: "mcp__github__delete_file",
        rawInput: { path: "docs/old.md" },
        _meta: { claudeCode: { toolName: "mcp__github__delete_file" } },
      }),
    );
    expect(words(html)).toContain("MCP github에 delete_file 도구 실행을 허용할까요? 세부 정보 보기");
    expect(html).toMatch(/aria-expanded="false"[^>]*>세부 정보 보기/);
    expect(html).not.toContain("docs/old.md");
  });

  it("파일 편집 — 줄어든 diff는 더한 줄 `ins` · 지운 줄 `del`이고 아래 한 줄이 파일 자리다(보드 「파일 편집」)", () => {
    const html = draw(
      request(
        {
          kind: "edit",
          content: [{ type: "diff", path: "/w/api/src/watcher.rs", oldText: "a\n", newText: "b\n" }],
        },
        { card: "edit", grant: ["edit"] },
      ),
    );
    expect(words(html)).toContain("파일 편집 Claude Code가 이 파일을 편집하도록 허용할까요?");
    expect(html).toMatch(/<del[^>]*>.*a.*<\/del><ins[^>]*>.*b.*<\/ins>/);
    expect(words(html)).toContain("src/watcher.rs 이 작업공간의 모든 편집 허용 거부 Esc 한 번만 허용 ↵");
  });

  it("계획 — 「계획」 · 「이 계획대로 진행할까요?」 · 다시 짜기 · 구현 ↵(보드 「계획 승인」)", () => {
    const html = draw(
      request(
        { kind: "switch_mode" },
        {
          planReview: true,
          card: "plan",
          options: [
            { optionId: "implement_plan", name: "Yes, implement this plan", kind: "allow_once" },
            { optionId: "revise_plan", name: "No, keep planning", kind: "reject_once" },
          ],
        },
      ),
    );
    expect(words(html)).toBe("계획 이 계획대로 진행할까요? 다시 짜기 구현 ↵");
  });

  it("여럿이 물으면 머리 오른쪽에 차례가 선다(`AskCount`)", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard thread="t" name="Claude Code" runtime="claude-code" request={request(migrate)} scope="work" cwd={null} count={{ at: 1, total: 2 }} />,
    );
    expect(words(html).startsWith("터미널 1 / 2 Claude Code가")).toBe(true);
  });
});

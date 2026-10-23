import { expect, test, type Page } from "./evidence";

import { answerByArg, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls, 작업화면으로 } from "./harness";
import type { AgentRoster, FoundAgent } from "@/features/thread/types";

// v1 티켓 21(PR ② e2e) 흐름 하나 — **사이드바의 Library가 부를 수 있는 Agent 목록과 그 파일을 보이고, 깨진 Agent는 흐린 줄에 까닭이
// 서며 그 파일도 읽히고, 지금 Work의 Project 안 Agent는 따로 묶인다**(v1 티켓 19 · 구현 스펙 §16 S35 · 경계 ② 「Library: 목록 · 파일
// 보기 · 깨진 파일」).
//
// 목록은 `list_agents`(Work 없으면 Library만), 파일은 `read_agent_file`, 「Finder에서 열기」는 `reveal_agent_file`이다 — 셋의 답은 core가
// 내는 꼴 그대로 손으로 적는다(범위 · 깨짐 판정은 L1 `scope.rs` · `agents.rs`가 잰다). Agent 파일은 짧은 합성이다 — 기본
// `host.md` · `reviewer.md`의 지시문을 고칠 때마다 이 층이 깨지지 않게.

const multiWork = WORKS[2];

const agent = (call: string, name: string, description: string, from: FoundAgent["from"] = "library"): FoundAgent => ({
  call,
  from,
  path:
    from === "library"
      ? `/Users/tester/.atelier/library/agents/${call}.md`
      : `/Users/tester/.atelier/works/${multiWork.slug}/trees/${from.project}/.atelier/agents/${call}.md`,
  definition: {
    handle: call,
    name,
    description,
    avatar: call === "reviewer" ? { shape: "circle", color: "green" } : null,
    model: { prefer: null, effort: null },
  },
});

const HOST = agent("host", "Host", "다른 Agent를 부르지 않았을 때 답한다.");
const REVIEWER = agent("reviewer", "리뷰어", "바뀐 코드를 읽고 리뷰한다.");
const DEPLOYER = agent("deployer", "배포 담당", "billing을 스테이징에 올린다.", { project: "billing" });
const TESTER: AgentRoster["broken"][number] = {
  call: "tester",
  handle: "tester",
  from: "library",
  path: "/Users/tester/.atelier/library/agents/tester.md",
  problem: { kind: "unknownTool", tool: "deploy" },
};

/** Work 없이 — Library만. */
const LIBRARY: AgentRoster = { agents: [HOST, REVIEWER], broken: [TESTER] };
/** 두 저장소 일 — Library와 그 Work의 `billing` 안 Agent. */
const IN_WORK: AgentRoster = { agents: [DEPLOYER, HOST, REVIEWER], broken: [TESTER] };

const FILES: Record<string, string> = {
  host: "---\nname: Host\ndescription: 다른 Agent를 부르지 않았을 때 답한다.\n---\n\n너는 이 Thread의 Host다.\n",
  reviewer:
    "---\nname: 리뷰어\ndescription: 바뀐 코드를 읽고 리뷰한다.\navatar:\n  shape: circle\n  color: green\n---\n\n너는 코드 리뷰어다.\n\n## 보는 것\n\n- 버그 · 빠진 경계.\n",
  tester: "---\nname: 테스터\ntools:\n  builtin: [deploy]\n---\n\n검사를 돌린다.\n",
  deployer: "---\nname: 배포 담당\ndescription: billing을 스테이징에 올린다.\n---\n\n스테이징에만 올린다.\n",
};

const 목록 = (page: Page) => page.getByRole("region", { name: "Agent 목록", exact: true });
const 파일 = (page: Page) => page.getByRole("region", { name: "Agent 파일", exact: true });
const 묶음 = (page: Page, section: string) => 목록(page).getByRole("group", { name: section, exact: true });
/** 목록의 줄 — 이름이 「<이름>@<부르는 이름><둘째 줄>」로 읽힌다. */
const 줄 = (page: Page, name: string) => 목록(page).getByRole("button", { name: new RegExp(`^${name}\\s*@`) });

test("사이드바 Library가 Agent 목록과 파일을 보이고, 깨진 Agent는 흐린 줄에 까닭이 서며 그 원문도 읽히고, Work에서 열면 그 Project의 Agent가 따로 묶인다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    list_agents: answerByArg("work", { [multiWork.slug]: IN_WORK }, { otherwise: LIBRARY }),
    read_agent_file: answerByArg("call", FILES),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 새 Thread에서 연 Library — 지금 Work가 없어 Library만이다. Host가 맨 앞, 깨진 줄은 묶음 끝이다. 첫 줄을 고른다.
  await page.locator("aside nav").getByRole("button", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL("/library");
  await expect(묶음(page, "Library").getByRole("button")).toHaveText([/^Host@host/, /^리뷰어@reviewer/, /^tester@tester/]);
  await expect(목록(page).getByRole("group")).toHaveCount(1);
  await expect(줄(page, "Host")).toHaveAttribute("aria-current", "true");
  await expect(파일(page).getByText("너는 이 Thread의 Host다.", { exact: true })).toBeVisible();

  // 줄을 고르면 주소가 그 Agent를 싣고 문서 보기가 선다 — frontmatter는 YAML 코드 블록, 지시문은 마크다운이다.
  await 줄(page, "리뷰어").click();
  await expect(page).toHaveURL("/library?agent=reviewer");
  await expect(줄(page, "리뷰어")).toHaveAttribute("aria-current", "true");
  await expect(파일(page).getByRole("heading", { name: "보는 것", exact: true })).toBeVisible();
  await expect(파일(page)).toContainText("color: green");

  // 원문 보기 — 파일 그대로 줄마다 선다.
  await 파일(page).getByRole("button", { name: "원문 보기", exact: true }).click();
  await expect(파일(page).locator('[data-line="2"]')).toContainText("name: 리뷰어");
  await expect(파일(page).getByRole("heading", { name: "보는 것", exact: true })).toHaveCount(0);

  // 깨진 Agent — 흐린 줄의 둘째 줄이 그 까닭이고, 골라도 파일을 읽는다(무엇이 틀렸는지 봐야 고친다). 원문 보기는 그대로다.
  const 테스터 = 줄(page, "tester");
  await expect(테스터).toHaveAccessibleDescription("모르는 도구가 있어요: deploy");
  await expect(테스터).toContainText("모르는 도구가 있어요: deploy");
  await 테스터.click();
  await expect(page).toHaveURL("/library?agent=tester");
  await expect(파일(page).locator('[data-line="4"]')).toContainText("builtin: [deploy]");

  // Finder에서 열기 — 고른 Agent의 파일을 앱이 연다.
  await 파일(page).getByRole("button", { name: "Finder에서 열기", exact: true }).click();
  expect((await ipcCallArgs(page, "reveal_agent_file", "call")).map(({ args }) => args)).toEqual([{ work: null, call: "tester" }]);

  // Work 화면에서 연 Library — 그 Work를 싣고, Project 안 Agent가 Project 이름의 묶음으로 따로 선다(머리 오른쪽에 그 Work).
  await 작업화면으로(page, multiWork);
  await page.locator("aside nav").getByRole("button", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(`/library?work=${multiWork.slug}`);
  await expect(목록(page).getByRole("group")).toHaveCount(2);
  await expect(묶음(page, "billing")).toContainText(multiWork.title);
  await 묶음(page, "billing").getByRole("button", { name: /^배포 담당\s*@deployer/ }).click();
  await expect(page).toHaveURL(`/library?work=${multiWork.slug}&agent=deployer`);
  await expect(파일(page).getByText("스테이징에만 올린다.", { exact: true })).toBeVisible();
  expect((await ipcCallArgs(page, "read_agent_file", "call")).map(({ args }) => args)).toEqual([
    { work: null, call: "host" },
    { work: null, call: "reviewer" },
    { work: null, call: "tester" },
    { work: multiWork.slug, call: "host" },
    { work: multiWork.slug, call: "deployer" },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

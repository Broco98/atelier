import { describe, expect, it } from "vitest";
import { ownerOf, topTerminal } from "@/features/terminal/shell-registry";
import type { Shell } from "@/features/terminal/shell-registry";
import type { Attention } from "@/features/terminal/shell-attention";
import { worldNameOf } from "@/mode";
import { formatMemory } from "./metrics";
import {
  descendantLabel,
  descendantRowLabel,
  groupRowLabel,
  groupTotals,
  helperLabel,
  shellRowLabel,
  shellStateOf,
  shellTotals,
  shellTree,
  stateText,
  worldRowLabel,
} from "./shell-tree";
import type { ListedItem, ShellNode, TreeInput } from "./shell-tree";
import type { PoolShell, ProcessMetrics, ProcessRow, ProcessSnapshot } from "./types";

// 프로세스 티켓 27 — **`Processes`의 셸 묶음이 서는 차례**(프로세스 결정 9 · 10 · 프로세스 스펙 S53). 화면은 앱 전체를 세계 → work →
// 셸 → 자손으로 세운다. 이 파일이 재는 것은 그 층과 차례를 짓는 순수 함수와 셸 행의 상태 칸 · 접근성 이름이다 — 스냅샷(Rust가
// 가른 셸별 자손)과 스토어(세계 · work)를 **셸 키로** 잇는 자리가 여기 하나다. 화면이 진짜 스토어 · 진짜 스냅샷으로 서는지는 L3가
// 잰다(`processes-tree.spec.ts`).

const 칸 = (id: number, shellKey: string | null, over: Partial<Shell> = {}): Shell => ({
  id,
  status: { kind: "running" },
  title: null,
  shellName: "zsh",
  shellKey,
  owner: ownerOf("atelier", "plain-work"),
  project: null,
  cwd: null,
  running: null,
  attention: null,
  auto: false,
  firstInput: null,
  orphaned: false,
  ...over,
});

/** 못 읽은 지표 — 묶음과 상태 칸의 검사는 숫자를 안 본다. */
const 빈지표: ProcessMetrics = { memory: null, cpu: null, ports: [] };

const 풀 = (ptyId: number, shellKey: string, lastOutputMs = 1_000, metrics = 빈지표): PoolShell => ({
  ptyId,
  shellKey,
  lastOutputMs,
  metrics,
});

/** 스냅샷의 한 행. 시작 시각은 따로 준다 — 차례가 pid 순이 아니라 시작 순인지를 가르려고. */
const 행 = (pid: number, ppid: number, startedUs: number, name: string, over: Partial<ProcessRow> = {}): ProcessRow => ({
  id: { pid, startedUs },
  ppid,
  name,
  argv0: null,
  command: null,
  metrics: 빈지표,
  ...over,
});

const 스냅샷 = (
  pool: PoolShell[],
  descendants: Record<string, ProcessRow[]> = {},
  helpers: ProcessRow[] = [],
): ProcessSnapshot => ({
  verdict: {
    descendants,
    exceptions: [],
    helpers: helpers.map((row) => row.id),
    orphans: { confirmed: {}, unknown: {} },
    otherInstances: {},
  },
  pool,
});

const 목록 = (...items: Array<[slug: string, title: string]>): ListedItem[] => items.map(([slug, title]) => ({ slug, title }));

/** 트리를 한 줄씩 편 모양 — 층이 곧 깊이다. 무엇이 어느 층에 어느 차례로 서는지를 한 번에 본다. */
function 편모양(input: TreeInput): string[] {
  const lines: string[] = [];
  for (const world of shellTree(input)) {
    lines.push(`1 ${world.mode}${world.current ? " (지금)" : ""}`);
    for (const group of world.groups) {
      lines.push(`2 ${group.name}`);
      for (const node of group.shells) {
        lines.push(`3 ${node.shell.shellKey}`);
        if (node.helpers.length > 0) lines.push(`4 도우미 ${node.helpers.map((row) => row.id.pid).join(",")}`);
        for (const { row, depth } of node.descendants) lines.push(`${3 + depth} ${row.id.pid}`);
      }
    }
  }
  return lines;
}

const 기본 = (over: Partial<TreeInput>): TreeInput => ({
  current: "atelier",
  shells: [],
  lists: {},
  snapshot: 스냅샷([]),
  ...over,
});

describe("묶음 순서 — 세계 → work → 셸 → 자손", () => {
  // 두 세계의 셸이 섞여 스토어에 앉아 있다(스토어는 세계마다 갈리지 않는다). 화면은 지금 세계를 위에 세운다(프로세스 결정 9).
  const 두세계 = {
    shells: [
      칸(1, "G-1", { owner: ownerOf("maison") }),
      칸(2, "G-2", { owner: ownerOf("atelier") }),
    ],
    snapshot: 스냅샷([풀(1, "G-1"), 풀(2, "G-2")]),
  };

  it("지금 세계가 먼저다 — Maison에서 열면 Maison이 맨 위다", () => {
    expect(편모양(기본({ ...두세계, current: "maison" }))).toEqual([
      "1 maison (지금)",
      "2 Terminal",
      "3 G-1",
      "1 atelier",
      "2 Terminal",
      "3 G-2",
    ]);
    expect(편모양(기본({ ...두세계, current: "atelier" }))).toEqual([
      "1 atelier (지금)",
      "2 Terminal",
      "3 G-2",
      "1 maison",
      "2 Terminal",
      "3 G-1",
    ]);
  });

  // **셸이 뜬 차례가 아니라 사이드바의 차례다**(S53). 고정이 먼저인 것은 코어의 목록이 정한다(`list_works` — 결정 100) — 여기서
  // 다시 정렬하면 차례를 정하는 자리가 둘이 된다. 그래서 목록을 받은 차례 그대로 따른다. 최상위 터미널(nav `Terminal`)은 work이
  // 아니라 맨 끝이다.
  it("세계 안에서는 사이드바 순서(고정 먼저)이고, 그다음이 Terminal이다 — 셸이 뜬 차례가 아니다", () => {
    const input = 기본({
      shells: [
        칸(1, "G-1", { owner: ownerOf("atelier") }),
        칸(2, "G-2", { owner: ownerOf("atelier", "plain-work") }),
        칸(3, "G-3", { owner: ownerOf("atelier", "pinned-work") }),
      ],
      lists: { atelier: 목록(["pinned-work", "고정된 일"], ["plain-work", "그냥 일"], ["multi-work", "두 저장소 일"]) },
      snapshot: 스냅샷([풀(1, "G-1"), 풀(2, "G-2"), 풀(3, "G-3")]),
    });
    expect(편모양(input)).toEqual([
      "1 atelier (지금)",
      "2 고정된 일",
      "3 G-3",
      "2 그냥 일",
      "3 G-2",
      "2 Terminal",
      "3 G-1",
    ]);
  });

  it("work 행은 목록의 제목과 그 work의 셸을 든다 — 셸은 탭의 차례다", () => {
    const [world] = shellTree(
      기본({
        shells: [칸(5, "G-5"), 칸(2, "G-2"), 칸(9, "G-9", { owner: ownerOf("atelier") })],
        lists: { atelier: 목록(["plain-work", "그냥 일"]) },
        snapshot: 스냅샷([풀(2, "G-2"), 풀(5, "G-5"), 풀(9, "G-9")]),
      }),
    );
    const [work, terminal] = world.groups;
    expect(work.name).toBe("그냥 일");
    expect(work.owner).toBe(ownerOf("atelier", "plain-work"));
    // 스토어의 칸 순서(= 탭 줄의 차례)다. 풀은 pty id 순이라 그것을 따르면 탭을 옮겨도 화면이 안 따라온다.
    expect(work.shells.map((node) => node.shell.id)).toEqual([5, 2]);
    expect(terminal.name).toBe("Terminal");
    expect(terminal.owner).toBe(topTerminal("atelier").owner);
  });

  // 목록에 없는 work — 목록을 아직 못 읽었거나, MCP로 아카이브돼 주인을 잃었다(주인 잃은 셸 묶음은 32의 몫이다). 셸을 숨기면 도는
  // 것이 화면에서 사라진다. 목록의 것 뒤, Terminal 앞에 slug를 이름 삼아 선다.
  it("목록에 없는 work은 목록의 것 뒤 · Terminal 앞에 slug로 선다", () => {
    const input = 기본({
      shells: [
        칸(1, "G-1", { owner: ownerOf("atelier") }),
        칸(2, "G-2", { owner: ownerOf("atelier", "gone-work") }),
        칸(3, "G-3", { owner: ownerOf("atelier", "plain-work") }),
      ],
      lists: { atelier: 목록(["plain-work", "그냥 일"]) },
      snapshot: 스냅샷([풀(1, "G-1"), 풀(2, "G-2"), 풀(3, "G-3")]),
    });
    expect(편모양(input)).toEqual(["1 atelier (지금)", "2 그냥 일", "3 G-3", "2 gone-work", "3 G-2", "2 Terminal", "3 G-1"]);
  });

  it("목록이 아직 없는 세계도 선다 — 이름은 slug다", () => {
    const input = 기본({
      shells: [칸(1, "G-1", { owner: ownerOf("maison", "reading-room") })],
      snapshot: 스냅샷([풀(1, "G-1")]),
    });
    expect(편모양(input)).toEqual(["1 maison", "2 reading-room", "3 G-1"]);
  });

  // 셸이 하나도 없는 세계는 머리만 서는 빈 줄이 된다 — 「셸 0개」를 층으로 말할 까닭이 없다.
  it("셸이 없는 세계는 안 선다", () => {
    const input = 기본({ current: "maison", shells: [칸(1, "G-1", { owner: ownerOf("atelier") })], snapshot: 스냅샷([풀(1, "G-1")]) });
    expect(shellTree(input).map((world) => world.mode)).toEqual(["atelier"]);
    expect(shellTree(기본({}))).toEqual([]);
  });
});

describe("스냅샷의 셸은 셸 키로 스토어의 셸에 붙는다", () => {
  // Rust는 owner를 모른다(티켓 27). 세계 · work는 스토어의 것이고, 자손은 스냅샷의 판정 결과에서 셸 키로 찾는다. pty id는 두 쪽이
  // 같은 값을 쓰지만(픽스처 · 실물 모두) 잇는 값이 아니다 — 스토어의 `id`는 프런트가 따로 발급한 번호다.
  it("자손은 그 셸 키의 것이다 — 스토어의 번호나 pty id가 아니다", () => {
    const [world] = shellTree(
      기본({
        shells: [칸(1, "G-7"), 칸(7, "G-1")],
        snapshot: 스냅샷([풀(1, "G-1"), 풀(7, "G-7")], { "G-7": [행(700, 1, 70, "node")], "G-1": [행(100, 1, 10, "vim")] }),
      }),
    );
    const byId = new Map(world.groups[0].shells.map((node) => [node.shell.id, node]));
    expect(byId.get(1)?.descendants.map(({ row }) => row.name)).toEqual(["node"]);
    expect(byId.get(1)?.pool).toEqual(풀(7, "G-7"));
    expect(byId.get(7)?.descendants.map(({ row }) => row.name)).toEqual(["vim"]);
  });

  // 스토어가 모르는 풀의 셸은 「화면 밖 셸」이다(32 — 따로 묶는다). 풀에 없는 스토어의 셸은 프로세스가 아니다: spawn 답 전이라
  // 키가 없거나(`null`), 이유가 있는 끝으로 칸만 남았거나, 스냅샷 뒤에 막 떴다(2초 뒤에 선다).
  it("양쪽에 다 있는 셸만 선다 — 키 없는 칸 · 풀에 없는 칸 · 스토어가 모르는 풀의 셸은 안 선다", () => {
    const input = 기본({
      shells: [
        칸(1, "G-1"),
        칸(2, null),
        칸(3, "G-3", { status: { kind: "exited", exit: { exitCode: 1, signal: null } } }),
      ],
      snapshot: 스냅샷([풀(1, "G-1"), 풀(4, "G-4")]),
    });
    expect(편모양(input)).toEqual(["1 atelier (지금)", "2 plain-work", "3 G-1"]);
  });

  it("스냅샷에 그 셸의 자손 칸이 없으면 자손이 없다", () => {
    const [world] = shellTree(기본({ shells: [칸(1, "G-1")], snapshot: 스냅샷([풀(1, "G-1")]) }));
    expect(world.groups[0].shells[0].descendants).toEqual([]);
    expect(world.groups[0].shells[0].helpers).toEqual([]);
  });
});

describe("자손 — 시작 순, 트리 들여쓰기, 셸 도우미는 따로", () => {
  // 판정은 pid 순으로 싣는다. 화면은 **시작 순**이다(S53) — pid는 돌고 돌아 작아질 수 있어 뜬 차례를 말하지 않는다.
  it("셸 바로 밑의 자손은 시작 순이다 — pid 순이 아니다", () => {
    const input = 기본({
      shells: [칸(1, "G-1")],
      snapshot: 스냅샷([풀(1, "G-1")], { "G-1": [행(100, 1, 30, "c"), 행(200, 1, 10, "a"), 행(300, 1, 20, "b")] }),
    });
    expect(편모양(input).slice(3)).toEqual(["4 200", "4 300", "4 100"]);
  });

  // 들여쓰기는 부모 pid로 짓는다. 셸 자신의 행은 스냅샷에 없어(판정이 셸 자신을 안 싣는다) 셸 바로 밑의 자식과 트리가 끊겨 표식으로만
  // 잡힌 것(claude Bash 도구가 띄운 dev 서버 — 부모 1)이 같은 깊이 1에 선다. 형제도 시작 순이다.
  it("부모가 그 셸의 자손이면 그 밑에 한 칸 들여 선다 — 깊이 우선으로 편다", () => {
    const input = 기본({
      shells: [칸(1, "G-1")],
      snapshot: 스냅샷([풀(1, "G-1")], {
        "G-1": [
          행(200, 50, 10, "node"),
          행(210, 200, 30, "esbuild"),
          행(220, 200, 20, "tsc"),
          행(230, 220, 40, "tsserver"),
          행(300, 1, 15, "vite"),
        ],
      }),
    });
    expect(편모양(input).slice(3)).toEqual(["4 200", "5 220", "6 230", "5 210", "4 300"]);
  });

  // pid 재사용. 부모 행이 자식보다 늦게 태어났으면 그 pid는 남이다 — 판정이 같은 규칙으로 링크를 끊는다(`verdict.rs`). 끊지 않으면
  // 먼저 뜬 것이 나중에 뜬 것의 밑에 서고, 고리가 생기면 트리가 끝나지 않는다.
  it("부모 pid가 같아도 부모가 나중에 태어났으면 그 밑에 안 선다", () => {
    const input = 기본({
      shells: [칸(1, "G-1")],
      snapshot: 스냅샷([풀(1, "G-1")], { "G-1": [행(200, 300, 10, "old"), 행(300, 1, 20, "new")] }),
    });
    expect(편모양(input).slice(3)).toEqual(["4 200", "4 300"]);
  });

  // P1 — 사람이 처음 입력하기 전에 태어난 자손은 셸 도우미다. 판정은 도우미를 자손에도 그대로 싣고(끝낼 대상이다) 곁 집합으로
  // 표시한다. 화면은 그 표시로 가른다: 도우미는 셸 행 아래 옅은 줄 하나로 따로 서고, 사람이 띄운 것과 섞이지 않는다.
  it("셸 도우미는 자손에서 빠져 따로 선다 — 도우미의 밑에 뜬 사람의 것은 셸 바로 밑이다", () => {
    const gitstatusd = 행(150, 100, 5, "gitstatusd");
    const input = 기본({
      shells: [칸(1, "G-1")],
      snapshot: 스냅샷(
        [풀(1, "G-1")],
        { "G-1": [gitstatusd, 행(160, 150, 50, "git"), 행(200, 100, 40, "node")] },
        [gitstatusd],
      ),
    });
    expect(편모양(input).slice(3)).toEqual(["4 도우미 150", "4 200", "4 160"]);
    const [world] = shellTree(input);
    expect(world.groups[0].shells[0].helpers).toEqual([gitstatusd]);
  });

  // 도우미 표시는 신원(pid + 시작 시각)이다 — pid만 같은 다른 셸의 행은 도우미가 아니다.
  it("도우미는 신원으로 짝짓는다 — pid만 같으면 도우미가 아니다", () => {
    const helper = 행(150, 100, 5, "gitstatusd");
    const input = 기본({
      shells: [칸(1, "G-1")],
      snapshot: 스냅샷([풀(1, "G-1")], { "G-1": [행(150, 100, 99, "node")] }, [helper]),
    });
    expect(편모양(input).slice(3)).toEqual(["4 150"]);
  });
});

/** 셸 하나를 스냅샷과 이은 노드. 상태 칸은 이 노드 하나에서 나온다. */
function 노드(
  shell: Shell,
  descendants: ProcessRow[] = [],
  helpers: ProcessRow[] = [],
  lastOutputMs = 1_000,
  metrics = 빈지표,
): ShellNode {
  const key = shell.shellKey ?? "G-1";
  const [world] = shellTree(
    기본({
      shells: [{ ...shell, shellKey: key }],
      snapshot: 스냅샷([풀(1, key, lastOutputMs, metrics)], { [key]: descendants }, helpers),
    }),
  );
  return world.groups[0].shells[0];
}

const 상태 = (over: Partial<Attention>): Attention => ({
  kind: "working",
  message: null,
  since: 1_000,
  seen: false,
  source: "hook",
  agent: "claude",
  subagents: 0,
  subagentId: null,
  dialog: null,
  ...over,
});

describe("셸 행의 상태 칸", () => {
  // 셸 상태(나를 기다림 · 확인할 것 · 도는 중 · 서브에이전트 N)가 있으면 그것이다. 레지스트리가 내놓는 문(`signalOf` ·
  // `runningSubagents`)을 딛는다 — 셸 탭 · 사이드바 · 띠와 같은 말이어야 한다(스토리 79).
  it("셸 상태가 있으면 그것이다 — 서브에이전트 수까지", () => {
    const now = 1_000 + 3 * 60_000;
    expect(stateText(shellStateOf(노드(칸(1, "G-1", { attention: 상태({ kind: "waiting" }) }))), now)).toBe("나를 기다림 3m");
    expect(stateText(shellStateOf(노드(칸(1, "G-1", { attention: 상태({ kind: "done" }) }))), now)).toBe("확인할 것 3m");
    // 도는 중은 경과를 안 단다 — 사이드바의 둘째 줄과 같은 규칙이다(`showsElapsed`).
    expect(stateText(shellStateOf(노드(칸(1, "G-1", { attention: 상태({ kind: "working" }) }))), now)).toBe("도는 중");
    expect(stateText(shellStateOf(노드(칸(1, "G-1", { attention: 상태({ kind: "working", subagents: 2 }) }))), now)).toBe(
      "도는 중 · 서브에이전트 2",
    );
  });

  // 셸 상태가 앞선다 — 명령(claude)이 돌고 자손이 있어도 사람을 부르는 셸은 부르는 말이 선다.
  it("셸 상태가 명령과 자손보다 앞선다", () => {
    const node = 노드(칸(1, "G-1", { running: "claude", attention: 상태({ kind: "waiting" }) }), [행(200, 1, 10, "claude")]);
    expect(shellStateOf(node)).toMatchObject({ kind: "signal", signal: "waiting" });
  });

  // 본 확인할 것은 화면값이 없다(`signalOf`) — 그 셸은 조용하거나 명령이 돈다.
  it("본 확인할 것은 셸 상태가 아니다", () => {
    const node = 노드(칸(1, "G-1", { attention: 상태({ kind: "done", seen: true }) }));
    expect(shellStateOf(node).kind).toBe("quiet");
  });

  // 조용함 = 명령도 없고 사람이 띄운 자손도 없음(CONTEXT 「조용한 셸」). 셸 도우미는 세지 않는다. 경과는 셸이 마지막으로 무언가를
  // 찍은 때부터다 — 사람이 친 글자의 메아리도, 끝난 명령 뒤의 프롬프트도 출력이라, 그 뒤로 아무 일이 없었던 시간이다.
  it("셸 상태가 없고 조용하면 「조용함」과 마지막 출력부터의 경과다 — 셸 도우미는 안 센다", () => {
    const helper = 행(150, 100, 5, "gitstatusd");
    const node = 노드(칸(1, "G-1"), [helper], [helper], 1_000);
    expect(shellStateOf(node)).toEqual({ kind: "quiet", since: 1_000 });
    expect(stateText(shellStateOf(node), 1_000 + 2 * 3_600_000)).toBe("조용함 2h");
    expect(stateText(shellStateOf(node), 1_000 + 45_000)).toBe("조용함 45s");
  });

  // 둘 다 아니면 도는 명령의 이름이다(마크는 화면이 `agentMarkOf`로 고른다 — 표를 아는 자리가 하나다).
  it("셸 상태가 없고 명령이 돌면 그 명령이다", () => {
    const node = 노드(칸(1, "G-1", { running: "claude" }), [행(200, 1, 10, "claude")]);
    expect(shellStateOf(node)).toEqual({ kind: "command", command: "claude" });
    expect(stateText(shellStateOf(node), 5_000)).toBe("claude");
  });

  // 명령 없이 사람이 띄운 것만 남은 셸(`pnpm dev &`, claude가 띄우고 나간 dev 서버) — 조용하지도 않고 도는 명령도 없다. 그 수를
  // 말한다. 「이 셸에서 띄운 프로세스」는 닫기 확인 창과 같은 화면의 말이다.
  it("명령 없이 사람이 띄운 것만 있으면 그 수다", () => {
    const helper = 행(150, 100, 5, "gitstatusd");
    const node = 노드(칸(1, "G-1"), [helper, 행(200, 1, 10, "node"), 행(210, 200, 11, "esbuild")], [helper]);
    expect(shellStateOf(node)).toEqual({ kind: "spawned", count: 2 });
    expect(stateText(shellStateOf(node), 5_000)).toBe("띄운 프로세스 2개");
  });
});

const MiB = 1024 * 1024;
const 지표 = (memory: number | null, cpu: number | null = null, ports: number[] = []): ProcessMetrics => ({ memory, cpu, ports });

describe("트리 합 — 셸 행과 work 행의 숫자(티켓 28 · S53)", () => {
  // 셸 행의 숫자는 **그 셸의 트리 전부**다: 셸 프로세스 자신(판정은 셸을 행으로 안 싣는다 — 풀의 셸이 싣는다), 셸 도우미, 사람이 띄운
  // 자손. 도우미도 셸을 닫으면 함께 끝나는 그 셸의 것이라 메모리에 든다 — 「조용함」과 확인 창의 수에서만 빠진다(P1).
  it("셸 행은 셸 프로세스 · 셸 도우미 · 자손을 모두 더한다", () => {
    const helper = 행(150, 100, 5, "gitstatusd", { metrics: 지표(2 * MiB, 0.5) });
    const vite = 행(200, 1, 10, "node", { metrics: 지표(300 * MiB, 10, [5173]) });
    const esbuild = 행(210, 200, 11, "esbuild", { metrics: 지표(20 * MiB, 2, [5173, 24678]) });
    const node = 노드(칸(1, "G-1"), [helper, vite, esbuild], [helper], 1_000, 지표(8 * MiB, 0.5));
    expect(shellTotals(node)).toEqual(지표(330 * MiB, 13, [5173, 24678]));
  });

  // work 행은 그 work의 셸의 트리 합을 다시 더한다 — 결정 10 그림의 「process-manager · 셸 2 … 1.2GB 12%」.
  it("work 행은 그 work 셸들의 트리 합을 더한다", () => {
    const input = 기본({
      shells: [칸(1, "G-1"), 칸(2, "G-2")],
      snapshot: 스냅샷([풀(1, "G-1", 1_000, 지표(8 * MiB, 1)), 풀(2, "G-2", 1_000, 지표(6 * MiB, null))], {
        "G-1": [행(200, 1, 10, "node", { metrics: 지표(300 * MiB, 10, [5173]) })],
      }),
    });
    const [world] = shellTree(input);
    expect(groupTotals(world.groups[0])).toEqual(지표(314 * MiB, 11, [5173]));
  });

  // 첫 표본 — CPU를 아무도 못 쟀다. 합은 「—」로 서야 한다(0%는 쟀는데 안 썼다는 말이다).
  it("첫 표본에서는 트리 합의 CPU도 비었다", () => {
    const node = 노드(칸(1, "G-1"), [행(200, 1, 10, "node", { metrics: 지표(MiB) })], [], 1_000, 지표(MiB));
    expect(shellTotals(node)).toEqual(지표(2 * MiB, null));
  });
});

describe("행의 접근성 이름 — 한 문장", () => {
  // S58 — 「셸 이름, 상태, 메모리」를 한 문장으로 잇는다. 셸 이름은 탭 줄과 같은 것이다(`shellRowName` — 프로젝트가 붙는 셸은
  // `프로젝트 · 이름`). 메모리는 셸의 트리 합이고, 표기는 행의 칸과 같은 함수다(`formatMemory`).
  it("셸 행은 셸 이름 · 상태 · 트리 합 메모리를 잇는다", () => {
    const node = 노드(칸(1, "G-1"), [행(200, 1, 10, "node", { metrics: 지표(300 * MiB) })], [], 1_000, 지표(12 * MiB));
    expect(shellRowLabel(node, 61_000)).toBe(`zsh, 띄운 프로세스 1개, ${formatMemory(312 * MiB)}`);
    expect(shellRowLabel(node, 61_000)).toBe("zsh, 띄운 프로세스 1개, 312MB");
  });

  // 메모리를 못 읽은 셸(macOS 밖, 그사이 끝남)은 그 조각이 빠진다 — 「알 수 없음」을 읽어 주는 것은 소리일 뿐이다.
  it("셸 행은 셸 이름과 상태를 잇고, 메모리를 못 읽었으면 그 조각이 빠진다", () => {
    expect(shellRowLabel(노드(칸(1, "G-1"), [], [], 1_000), 61_000)).toBe("zsh, 조용함 1m");
    expect(shellRowLabel(노드(칸(1, "G-1", { project: "billing", attention: 상태({ kind: "waiting" }) })), 1_000)).toBe(
      "billing · zsh, 나를 기다림 0s",
    );
  });

  it("work 행은 이름 · 셸 수 · 트리 합 메모리, 세계 행은 세계의 이름이고 지금 세계면 그렇다고 말한다", () => {
    const input = 기본({ shells: [칸(1, "G-1"), 칸(2, "G-2")], snapshot: 스냅샷([풀(1, "G-1"), 풀(2, "G-2")]) });
    const [world] = shellTree(input);
    expect(groupRowLabel(world.groups[0])).toBe("plain-work, 셸 2개");
    const measured = shellTree(
      기본({
        shells: [칸(1, "G-1"), 칸(2, "G-2")],
        snapshot: 스냅샷([풀(1, "G-1", 1_000, 지표(700 * MiB)), 풀(2, "G-2", 1_000, 지표(500 * MiB))]),
      }),
    );
    expect(groupRowLabel(measured[0].groups[0])).toBe("plain-work, 셸 2개, 1.2GB");
    expect(worldRowLabel(world)).toBe(`${worldNameOf("atelier")}, 지금 세계`);
    expect(worldRowLabel({ ...world, current: false })).toBe(worldNameOf("atelier"));
  });

  // 자손 행은 부른 이름이다 — 커널 이름은 실제로 실행된 파일이라 심링크로 부른 것(`claude` → 버전 경로)이 다른 이름이 된다. 부른
  // 이름을 못 읽은 행(env를 못 읽었다)은 커널 이름이다.
  it("자손 행은 부른 이름의 마지막 조각이고, 없으면 커널 이름이다", () => {
    expect(descendantLabel(행(1, 0, 0, "2.1.3", { argv0: "/Users/me/.local/bin/claude" }))).toBe("claude");
    expect(descendantLabel(행(1, 0, 0, "node", { argv0: "node" }))).toBe("node");
    expect(descendantLabel(행(1, 0, 0, "esbuild"))).toBe("esbuild");
  });

  // 자손 행의 이름은 부른 이름과 그 프로세스의 메모리다 — 셸 행과 같은 모양(이름, …, 메모리)이라 줄마다 같은 자리에서 숫자가 읽힌다.
  it("자손 행은 부른 이름과 메모리를 잇고, 메모리를 못 읽었으면 이름만이다", () => {
    expect(descendantRowLabel(행(1, 0, 0, "node", { argv0: "node", metrics: 지표(320 * MiB, 3, [5173]) }))).toBe("node, 320MB");
    expect(descendantRowLabel(행(1, 0, 0, "esbuild"))).toBe("esbuild");
  });

  it("셸 도우미 줄은 「셸 도우미」와 그 이름들이다", () => {
    expect(helperLabel([행(1, 0, 0, "gitstatusd"), 행(2, 0, 1, "zsh", { argv0: "/bin/zsh" })])).toBe("셸 도우미, gitstatusd · zsh");
  });
});

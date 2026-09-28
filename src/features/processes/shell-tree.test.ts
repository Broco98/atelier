import { describe, expect, it } from "vitest";
import { ownerOf, topTerminal } from "@/features/terminal/shell-registry";
import type { Shell } from "@/features/terminal/shell-registry";
import type { Attention } from "@/features/terminal/shell-attention";
import { modeNameOf } from "@/mode";
import { formatMemory } from "./metrics";
import {
  groupRowLabel,
  groupTotals,
  helperLabel,
  offscreenRowLabel,
  offscreenShells,
  ownerlessGroupRowLabel,
  ownerlessGroups,
  poolKey,
  shellRowLabel,
  shellStateOf,
  shellTotals,
  shellTree,
  stateText,
  worldRowLabel,
} from "./shell-tree";
import type { ListedItem, ShellNode, TreeInput } from "./shell-tree";
import { metricsOf as 지표, NO_METRICS, poolShell, processRow as 행, snapshotFixture } from "./process-fixture";
import type { PoolShell, ProcessRow } from "./types";

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
  ownerless: false,
  ...over,
});

/** 풀의 셸 — 마지막 출력은 에포크 1_000ms가 기본이다(경과를 재는 검사가 그 뒤의 지금을 준다). 묶음과 상태 칸의 검사는 숫자를 안 본다. */
const 풀 = (ptyId: number, shellKey: string, lastOutputMs = 1_000, metrics = NO_METRICS): PoolShell =>
  poolShell(ptyId, shellKey, lastOutputMs, metrics);

/** 풀과 셸 키마다의 자손 · 셸 도우미만 선 스냅샷. 도우미는 행으로 받아 신원만 싣는다 — 자손 행과 신원으로 짝짓는 판정 그대로다. */
const 스냅샷 = (pool: PoolShell[], descendants: Record<string, ProcessRow[]> = {}, helpers: ProcessRow[] = []) =>
  snapshotFixture({ pool, verdict: { descendants, helpers: helpers.map((row) => row.id) } });

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

  // 목록에 없는 work — 목록을 아직 못 읽었다(주인 잃은 셸은 표시가 서서 제 묶음으로 간다 — 아래 「주인 잃은 셸 묶음」). 셸을 숨기면
  // 도는 것이 화면에서 사라진다. 목록의 것 뒤, Terminal 앞에 slug를 이름 삼아 선다.
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

describe("자손 — 셸 밑의 트리, 셸 도우미는 따로", () => {
  // 자손은 프로세스 줄의 트리 규칙(시작 순 · 부모 pid로 들여쓰기 · 늦게 태어난 부모에 안 잇기 — `process-tree.test.ts`)으로 셸 밑에
  // 선다. 셸 자신의 행은 스냅샷에 없어(판정이 셸 자신을 안 싣는다) 셸 바로 밑의 자식과 트리가 끊겨 표식으로만 잡힌 것(claude Bash
  // 도구가 띄운 dev 서버 — 부모 1)이 같은 깊이 1에 선다. 형제도 시작 순이다.
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
  metrics = NO_METRICS,
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
    // 도는 중은 경과를 안 단다 — 사이드바 행의 오른쪽 메타와 같은 규칙이다(`showsElapsed`).
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

  // work 행은 그 work의 셸의 트리 합을 다시 더한다 — 프로세스 결정 10 그림의 「process-manager · 셸 2 … 1.2GB 12%」.
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
    expect(worldRowLabel(world)).toBe(`${modeNameOf("atelier")}, 지금 세계`);
    expect(worldRowLabel({ ...world, current: false })).toBe(modeNameOf("atelier"));
  });

  // 도우미의 이름은 프로세스 줄과 같은 부른 이름이다. 자손 행의 이름(부른 이름, 메모리)은 `process-tree.test.ts`가 잰다.
  it("셸 도우미 줄은 「셸 도우미」와 그 이름들이다", () => {
    expect(helperLabel([행(1, 0, 0, "gitstatusd"), 행(2, 0, 1, "zsh", { argv0: "/bin/zsh" })])).toBe("셸 도우미, gitstatusd · zsh");
  });
});

// 프로세스 티켓 32 — **주인 잃은 셸 묶음**(프로세스 결정 4). 12가 스토어에 「주인 잃음」으로 표시한 셸이다. 그 셸의 work은 목록에 없어
// 세계 트리에 서면 slug 이름의 work 행으로 선다(27) — 표시가 선 셸은 거기서 빠져 이 묶음으로 옮긴다. 한 셸이 두 묶음에 서면 [닫기]
// 자리가 둘이고 수가 두 번 읽힌다.
describe("주인 잃은 셸 묶음", () => {
  it("표시가 선 셸은 세계 트리에 안 서고 이 묶음에 선다 — 목록에 없을 뿐인 셸은 트리에 그대로다", () => {
    const input = 기본({
      shells: [
        칸(1, "G-1", { owner: ownerOf("atelier", "gone-work"), ownerless: true }),
        칸(2, "G-2", { owner: ownerOf("atelier", "unread-work") }),
        칸(3, "G-3", { owner: ownerOf("atelier") }),
      ],
      snapshot: 스냅샷([풀(1, "G-1"), 풀(2, "G-2"), 풀(3, "G-3")]),
    });
    expect(편모양(input)).toEqual(["1 atelier (지금)", "2 unread-work", "3 G-2", "2 Terminal", "3 G-3"]);
    expect(ownerlessGroups(input).map((group) => [group.name, group.shells.map((node) => node.shell.shellKey)])).toEqual([
      ["gone-work", ["G-1"]],
    ]);
  });

  // 두 세계가 함께 선다 — 화면이 앱 전체다(프로세스 결정 9). 지금 세계의 것이 먼저이고, 세계 안은 스토어의 차례(탭의 차례)다.
  // 풀에 없는 칸(끝난 칸 · 아직 안 앉은 칸)은 프로세스가 아니라 안 선다 — [모두 닫기]는 그 칸도 함께 거둔다(12).
  it("두 세계의 주인 잃은 셸이 지금 세계부터 work마다 서고, 풀에 없는 칸은 안 선다", () => {
    const shells = [
      칸(1, "G-1", { owner: ownerOf("maison", "gone-room"), ownerless: true }),
      칸(2, "G-2", { owner: ownerOf("atelier", "gone-work"), ownerless: true }),
      칸(3, "G-3", { owner: ownerOf("atelier", "gone-work"), ownerless: true }),
      칸(4, "G-4", { owner: ownerOf("atelier", "gone-work"), ownerless: true, status: { kind: "exited", exit: { exitCode: 1, signal: null } } }),
    ];
    const snapshot = 스냅샷([풀(1, "G-1"), 풀(2, "G-2"), 풀(3, "G-3")], { "G-3": [행(300, 1, 30, "node")] });
    const 모양 = (current: "atelier" | "maison") =>
      ownerlessGroups(기본({ current, shells, snapshot })).map((group) => [
        group.owner,
        group.shells.map((node) => [node.shell.id, node.descendants.map(({ row }) => row.id.pid)]),
      ]);
    expect(모양("atelier")).toEqual([
      [ownerOf("atelier", "gone-work"), [[2, []], [3, [300]]]],
      [ownerOf("maison", "gone-room"), [[1, []]]],
    ]);
    expect(모양("maison").map(([owner]) => owner)).toEqual([ownerOf("maison", "gone-room"), ownerOf("atelier", "gone-work")]);
  });

  it("주인 잃은 셸이 없으면 묶음이 비었다", () => {
    expect(ownerlessGroups(기본({ shells: [칸(1, "G-1")], snapshot: 스냅샷([풀(1, "G-1")]) }))).toEqual([]);
  });

  // 두 세계가 한 묶음에 서므로 work 줄이 세계를 말한다 — 두 세계에 같은 slug가 설 수 있다(결정 10). 세계 트리의 work 줄은 세계
  // 줄 밑에 서서 말할 까닭이 없다.
  it("work 줄은 이름 · 세계 · 셸 수 · 메모리다", () => {
    const [group] = ownerlessGroups(
      기본({
        shells: [칸(1, "G-1", { owner: ownerOf("maison", "gone-room"), ownerless: true })],
        snapshot: 스냅샷([풀(1, "G-1", 1_000, 지표(8 * MiB))]),
      }),
    );
    expect(ownerlessGroupRowLabel(group)).toBe(`gone-room, ${modeNameOf("maison")}, 셸 1개, 8MB`);
  });
});

// 프로세스 티켓 32 — **화면 밖 셸**(프로세스 스펙 S42). 풀에는 있는데 화면 스토어가 모르는 셸이다 — 새로고침 중에 끝난 spawn이 남길 수
// 있다(조사의 경로 7, 추정). **연달아 두 박자 모두 스토어가 모른 셸만** 센다: Rust는 셸을 풀에 앉힌 뒤에 spawn에 답하고(`pty.rs`의
// `spawn`), 프런트는 답이 온 뒤에야 칸에 셸 키를 앉힌다 — 그 사이 찍힌 스냅샷에는 방금 뜬 멀쩡한 셸이 한 번 스토어가 모르는 셸로 선다.
// 닫는 쪽에도 같은 창이 있다 — 닫기는 칸을 곧바로 빼는데 풀은 다음 박자까지 앞 장이다(리뷰 반영).
describe("화면 밖 셸 가르기 — 풀의 셸 + 스토어의 셸 키 + 지난 박자", () => {
  /** `previous`는 앞 박자의 풀이다. 그 박자의 스토어는 지금과 같다 — 스토어가 박자 사이에 안 바뀐 모양이다. */
  const 가르기 = (shells: Shell[], pool: PoolShell[], previous: PoolShell[] | undefined, descendants = {}, helpers: ProcessRow[] = []) =>
    offscreenShells({
      shells,
      snapshot: 스냅샷(pool, descendants, helpers),
      previous: previous === undefined ? undefined : { pool: previous, shells },
    });

  it("스토어가 모르는 셸이 지난 스냅샷에도 있었으면 화면 밖 셸이다", () => {
    const found = 가르기([칸(1, "G-1")], [풀(1, "G-1"), 풀(4, "G-4")], [풀(1, "G-1"), 풀(4, "G-4")]);
    expect(found.map((node) => node.pool)).toEqual([풀(4, "G-4")]);
  });

  // spawn 왕복 창 — 방금 뜬 셸이 한 스냅샷에만 스토어가 모르는 셸로 선다. 다음 스냅샷에는 스토어가 키를 안다.
  it("한 스냅샷에만 선 셸은 화면 밖 셸이 아니다", () => {
    expect(가르기([칸(1, "G-1")], [풀(1, "G-1"), 풀(4, "G-4")], undefined)).toEqual([]);
    expect(가르기([칸(1, "G-1")], [풀(1, "G-1"), 풀(4, "G-4")], [풀(1, "G-1")])).toEqual([]);
  });

  // 끝난 칸도, 주인 잃은 셸도 스토어가 아는 셸이다 — 키가 칸에 있다. 주인 잃은 셸은 그 묶음에 서고 여기 안 선다.
  it("스토어에 셸 키가 있는 셸은 화면 밖 셸이 아니다 — 주인 잃은 셸 · 끝난 칸도", () => {
    const shells = [
      칸(1, "G-1", { ownerless: true }),
      칸(2, "G-2", { status: { kind: "exited", exit: { exitCode: 1, signal: null } } }),
      칸(3, null),
    ];
    const pool = [풀(1, "G-1"), 풀(2, "G-2"), 풀(3, "G-3")];
    expect(가르기(shells, pool, pool).map((node) => node.pool.shellKey)).toEqual(["G-3"]);
  });

  // 닫는 쪽의 창 — 닫기는 스토어에서 칸을 곧바로 빼는데(`closeShell`) 스냅샷은 다음 박자까지 앞 장이라 그 셸이 두 풀에 다 있다. 지금
  // 스토어만 보면 방금 닫은 셸이 「화면 밖 셸」로 선다. 앞 박자에 스토어가 알던 셸이면 두 박자 연달아 모른 셸이 아니다.
  it("앞 박자에 스토어가 알던 셸은 지금 스토어에서 빠져도(닫힘) 화면 밖 셸이 아니다", () => {
    const pool = [풀(1, "G-1"), 풀(4, "G-4")];
    const found = offscreenShells({
      shells: [],
      snapshot: 스냅샷(pool),
      previous: { pool, shells: [칸(1, "G-1")] },
    });
    // 앵커: 앞 박자에도 스토어가 몰랐던 4는 선다.
    expect(found.map((node) => node.pool.shellKey)).toEqual(["G-4"]);
  });

  // 뜨는 쪽의 창은 거꾸로다 — 앞 박자에 스토어가 몰랐어도 지금 알면 화면 밖 셸이 아니다(spawn 답이 그 사이 왔다).
  it("앞 박자에 스토어가 몰랐어도 지금 알면 화면 밖 셸이 아니다", () => {
    const pool = [풀(4, "G-4")];
    expect(offscreenShells({ shells: [칸(4, "G-4")], snapshot: 스냅샷(pool), previous: { pool, shells: [] } })).toEqual([]);
  });

  // **화면 밖 셸의 [닫기]로 닫은 셸은 곧바로 안 선다**(티켓 32의 남은 것) — 스토어가 모르는 셸이라 스토어에서 뺄 칸이 없고, 스냅샷은
  // 다음 박자까지 앞 장이라 그 셸이 풀에 남는다. 화면이 닫은 셸(pty id · 셸 키)을 넘기면 그것은 가린다.
  it("화면이 닫은 셸은 풀에 남아 있어도 화면 밖 셸로 안 선다", () => {
    const pool = [풀(4, "G-4"), 풀(5, "G-5")];
    const found = offscreenShells({
      shells: [],
      snapshot: 스냅샷(pool),
      previous: { pool, shells: [] },
      closed: new Set([poolKey(풀(4, "G-4"))]),
    });
    // 앵커: 닫지 않은 5는 선다.
    expect(found.map((node) => node.pool.shellKey)).toEqual(["G-5"]);
    // pty id와 셸 키가 함께 같아야 같은 셸이다 — 같은 키의 다른 pty는 가리지 않는다.
    const other = offscreenShells({
      shells: [],
      snapshot: 스냅샷(pool),
      previous: { pool, shells: [] },
      closed: new Set([poolKey(풀(9, "G-4"))]),
    });
    expect(other.map((node) => node.pool.shellKey)).toEqual(["G-4", "G-5"]);
  });

  // 셸은 pty id와 셸 키가 함께 같아야 같은 셸이다 — 키만 보면 같은 키의 셸이 닫혔다 다시 뜬 것을(다른 pty id) 두 박자에 선 것으로
  // 읽는다. 셸 키가 pty id를 꼬리로 품으니 실물에서는 늘 함께 간다 — 한쪽만 맞는 것은 흉내로만 선다.
  it("pty id와 셸 키가 함께 같아야 두 스냅샷에 선 셸이다", () => {
    expect(가르기([], [풀(4, "G-4")], [풀(5, "G-4")])).toEqual([]);
    expect(가르기([], [풀(4, "G-4")], [풀(4, "H-4")])).toEqual([]);
  });

  it("화면 밖 셸도 그 셸 키의 자손을 들고, 셸 도우미는 따로 든다", () => {
    const helper = 행(150, 1, 5, "gitstatusd");
    const vite = 행(200, 1, 10, "node");
    const esbuild = 행(210, 200, 11, "esbuild");
    const [node] = 가르기([], [풀(4, "G-4")], [풀(4, "G-4")], { "G-4": [helper, vite, esbuild] }, [helper]);
    expect(node.helpers.map((row) => row.id.pid)).toEqual([150]);
    expect(node.descendants.map(({ row, depth }) => [row.id.pid, depth])).toEqual([
      [200, 1],
      [210, 2],
    ]);
  });

  // 이름은 모른다 — 셸 이름은 스토어의 칸이 든다(`shellRowName`). 「셸」 뒤에 상태와 트리 합 메모리를 잇는다. 명령은 스토어의 1초
  // 폴링 값이라 여기 없다 — 사람이 띄운 자손이 있으면 그 수, 없으면 「조용함」과 마지막 출력부터의 경과다.
  it("화면 밖 셸의 행 이름은 「셸, 상태, 메모리」다", () => {
    const [quiet] = 가르기([], [풀(4, "G-4", 1_000)], [풀(4, "G-4", 1_000)]);
    expect(offscreenRowLabel(quiet, 61_000)).toBe("셸, 조용함 1m");
    const [busy] = 가르기(
      [],
      [풀(4, "G-4", 1_000, 지표(8 * MiB))],
      [풀(4, "G-4")],
      { "G-4": [행(200, 1, 10, "node", { metrics: 지표(300 * MiB) })] },
    );
    expect(offscreenRowLabel(busy, 61_000)).toBe("셸, 띄운 프로세스 1개, 308MB");
  });
});

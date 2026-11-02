// 스트리밍 부하 점검(restart 티켓 01b-9 · 스펙 「Testing Decisions · 소유자의 live 점검」).
//
//   node scripts/stream-load.mjs                     초당 100조각을 2분 흘려 최대 프레임 간격을 잰다(한 메시지)
//   node scripts/stream-load.mjs --message-ms 5000   5초마다 새 메시지로 넘어가 흐르는 동안 기록 줄이 선다(접기가 돈다)
//   node scripts/stream-load.mjs --seconds 20 --out r.json
//   node scripts/stream-load.mjs --check-bundle      배포 번들에 부하 점검이 들지 않았는지 잰다
//
// 임시 폴더에 1,000줄 기록이 든 채팅을 짓고, 가짜 로그인 셸을 `SHELL`로 주어 앱이 `fake-claude`를 찾게 `pnpm tauri dev`로 띄운다. 시험의 가짜
// Runtime과 같은 길이고 `ATELIER_HOME`이 임시 폴더라 진짜 `~/.atelier`에 닿지 않는다. 앱 쪽 일은 `src/features/thread/stream-load.ts`가 한다 —
// 여기 작은 서버에서 할 일을 받아 재고 그 값을 돌려준다. 진짜 앱이라 포트 1420이 비어 있어야 하고, 재는 동안 창이 앞에 있어야 값이 유효하다.
// 끝나면 프로세스를 거두고 `~/.claude/settings.json`과 `~/.atelier/threads`가 그대로인지 본다.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, homedir, loadavg, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORDS = join(REPO, "crates/atelier-acp/tests/records");
const PORT = 1420;
const LIMIT_MS = 50;
const THREAD = "20261102-120000";
const SESSION = "fake-session";
/** 앱 쪽 모듈의 표지(`stream-load.ts`의 `MARK`). */
const MARK = "atelier-stream-load";
/** 번들을 지을 때 주는 값 — 입구가 남았으면 이 글이 번들에 든다. */
const BUNDLE_SINK = "127.0.0.1:59999";

const { values: options } = parseArgs({
  options: {
    seconds: { type: "string", default: "120" },
    "gap-ms": { type: "string", default: "10" },
    "message-ms": { type: "string" },
    lines: { type: "string", default: "1000" },
    "idle-seconds": { type: "string", default: "10" },
    out: { type: "string" },
    "check-bundle": { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});

const seconds = Number(options.seconds);
const gapMs = Number(options["gap-ms"]);
const lineCount = Number(options.lines);

function run(command, args, spawnOptions = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: REPO, ...spawnOptions });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 실패(${result.status ?? result.error})`);
  return result;
}

/** 폴더 안의 모든 파일에서 글 하나를 찾는다. */
function filesWith(dir, needle) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesWith(path, needle);
    return readFileSync(path).includes(needle) ? [path] : [];
  });
}

/** 배포 번들에 부하 점검이 들지 않았나 — `VITE_STREAM_LOAD`가 있어도 빠져야 한다. */
function checkBundle() {
  const out = mkdtempSync(join(tmpdir(), "atelier-stream-bundle-"));
  try {
    run("pnpm", ["exec", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"], {
      env: { ...process.env, VITE_STREAM_LOAD: `http://${BUNDLE_SINK}` },
    });
    const found = [MARK, BUNDLE_SINK].flatMap((needle) => filesWith(out, needle).map((file) => `${needle}: ${file}`));
    if (found.length > 0) throw new Error(`배포 번들에 부하 점검이 들었다:\n${found.join("\n")}`);
    console.log(`배포 번들 ${readdirSync(join(out, "assets")).length}개 파일에 부하 점검이 없다.`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const portBusy = () => spawnSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN"]).status === 0;

/** 실제 자료의 지문 — 끝나고 같은지 본다. */
function ownerPrint() {
  const settings = join(homedir(), ".claude/settings.json");
  const threads = join(homedir(), ".atelier/threads");
  return {
    settings: existsSync(settings) ? createHash("sha256").update(readFileSync(settings)).digest("hex") : null,
    threads: existsSync(threads) ? readdirSync(threads).map((name) => `${name}:${statSync(join(threads, name)).mtimeMs}`).sort().join("\n") : null,
  };
}

/** 지난 턴의 답 — 한 턴이 답 한 덩어리는 보이므로 실제 채팅처럼 짧은 마크다운으로 둔다. */
const pastAnswer = (turn) =>
  `${turn}번째 턴의 답이다. 바뀐 것은 \`notes.txt\` 하나이고 **바이트 수**를 세어 확인했다.\n\n- 쓴 글: gate\n- 읽은 글: gate\n- 크기: ${turn}바이트\n\n\`\`\`sh\nwc -c notes.txt\n\`\`\`\n`;

/**
 * 1,000줄 기록 — 축복 기록의 줄을 그대로 쓴다. 머리 두 줄(띄움 · 열림) 뒤에 도구가 든 턴 둘을 번갈아 되풀이하고, 도구 id · 메시지 id는 턴마다 가른다.
 * 턴 끝에서 끝나 Session이 없는 채팅이다.
 */
function seedRecord(wanted) {
  const read = (name) =>
    readFileSync(join(RECORDS, `${name}.jsonl`), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
  const two = read("thread-two-turns");
  const sub = read("thread-subagent");
  const shapes = [two.slice(8), sub.slice(13)];
  const lines = two.slice(0, 2).map((line) => JSON.parse(line));
  for (let turn = 1; lines.length < wanted; turn += 1) {
    for (const raw of shapes[turn % shapes.length]) {
      const line = JSON.parse(raw.replace(/toolu_[0-9A-Za-z]+/g, (id) => `${id}_${turn}`).replace(/msg_[0-9A-Za-z]+/g, (id) => `${id}_${turn}`));
      const update = line.payload?.update;
      if (update?.sessionUpdate === "agent_message_chunk") update.content.text = pastAnswer(turn);
      if (line.kind === "sent") line.payload.text = `${turn}번째 말`;
      lines.push(line);
    }
  }
  return lines.map((line, at) => JSON.stringify({ ...line, seq: at + 1 }));
}

/** 임시 자리 — 자료 자리 · `claude` 링크 · 가짜 로그인 셸 · 영수증. */
function stage(root) {
  const home = join(root, "home");
  const bin = join(root, "bin");
  const receipts = join(root, "receipts");
  const cwd = join(root, "cwd");
  const threadDir = join(home, "threads", THREAD);
  for (const dir of [bin, receipts, cwd, threadDir]) mkdirSync(dir, { recursive: true });
  symlinkSync(join(REPO, "target/debug/fake-claude"), join(bin, "claude"));

  const record = seedRecord(lineCount);
  writeFileSync(join(threadDir, "events.jsonl"), `${record.join("\n")}\n`);
  writeFileSync(
    join(threadDir, "thread.json"),
    JSON.stringify({
      title: "스트리밍 부하",
      createdAt: "2026-11-02T12:00:00.000+09:00",
      work: null,
      mode: "edits",
      runtime: "claude-code",
      sessionId: SESSION,
      cwd,
      additionalDirectories: [],
      model: null,
      effort: null,
      lastRead: record.length,
    }),
  );
  // 앞서 뜬 세션 — 가짜 claude가 `--resume`을 받아 준다.
  writeFileSync(join(receipts, `${SESSION}.json`), "{}\n");
  writeFileSync(join(root, "auth"), "{}\n");

  const values = {
    FAKE_CLAUDE_FIXTURE: "2.1.316/stream-turns",
    FAKE_CLAUDE_RECEIPTS: receipts,
    FAKE_CLAUDE_AUTH: join(root, "auth"),
    FAKE_CLAUDE_STREAM_GAP_MS: String(gapMs),
    FAKE_CLAUDE_STREAM_FOR_MS: String(seconds * 1000),
    ...(options["message-ms"] ? { FAKE_CLAUDE_STREAM_MESSAGE_MS: options["message-ms"] } : {}),
  };
  const exports_ = Object.entries(values)
    .map(([name, value]) => `${name}='${value}'`)
    .join(" ");
  const shell = join(root, "login-shell");
  writeFileSync(shell, `#!/bin/sh\n# 가짜 로그인 셸 — 앱이 \`-l -i -c <명령>\`으로 부른다. 앱의 Runtime은 이 env로만 뜬다.\nexec /usr/bin/env -i PATH='${bin}:/usr/bin:/bin' HOME='${home}' ${exports_} /bin/sh -c "$4"\n`);
  chmodSync(shell, 0o755);
  return { home, shell, receipts, lines: record.length };
}

/** 앱이 할 일을 받고 값을 돌려주는 작은 서버. */
function startSink(plan, onPlan) {
  let reported;
  const report = new Promise((resolve) => {
    reported = resolve;
  });
  let plans = 0;
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.url === "/plan") {
      plans += 1;
      void onPlan().then(() => response.end(JSON.stringify(plan)));
      return;
    }
    const body = [];
    request.on("data", (part) => body.push(part));
    request.on("end", () => {
      response.end("ok");
      reported(JSON.parse(Buffer.concat(body).toString("utf8")));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, report, close: () => server.close(), plans: () => plans }));
  });
}

/** 지금 기계 — 부하와 CPU를 먹는 프로세스들. */
function sampleMachine() {
  const rows = spawnSync("ps", ["-axo", "pcpu=,rss=,comm="], { encoding: "utf8" })
    .stdout.split("\n")
    .map((row) => row.trim().match(/^([\d.]+)\s+(\d+)\s+(.*)$/))
    .filter((row) => row !== null)
    .map(([, cpu, rss, command]) => ({ cpu: Number(cpu), rssMb: Math.round(Number(rss) / 1024), name: command.split("/").pop() }));
  const busiest = [...rows].sort((a, b) => b.cpu - a.cpu).slice(0, 4);
  // 앱의 WKWebView 프로세스 — 지금 CPU를 가장 많이 쓰는 것으로 본다.
  const webview = rows.filter((row) => row.name === "com.apple.WebKit.WebContent").sort((a, b) => b.cpu - a.cpu)[0];
  return {
    load1: loadavg()[0],
    webviewMb: webview?.rssMb ?? null,
    cpu: Math.round(rows.reduce((sum, row) => sum + row.cpu, 0)),
    building: rows.some((row) => /^(rustc|cargo|clang|cc|ld)$/.test(row.name) && row.cpu > 20),
    busiest: busiest.map((row) => `${row.name} ${Math.round(row.cpu)}%`),
  };
}

function machineSummary(samples) {
  const load = samples.map((sample) => sample.load1);
  return {
    cores: cpus().length,
    samples: samples.length,
    load1: { min: Math.min(...load), max: Math.max(...load) },
    cpuMax: Math.max(...samples.map((sample) => sample.cpu)),
    buildingSamples: samples.filter((sample) => sample.building).length,
    busiest: samples.reduce((a, b) => (b.cpu > a.cpu ? b : a)).busiest,
    webviewMb: samples.map((sample) => sample.webviewMb),
  };
}

/** 앱 창을 앞으로 — 뒤에 있으면 WKWebView가 프레임을 줄인다. */
function bringToFront() {
  const found = spawnSync("pgrep", ["-f", "target/debug/atelier-app"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
  if (!found) return false;
  const pid = Number(found);
  return spawnSync("cua-driver", ["call", "bring_to_front", JSON.stringify({ pid })], { encoding: "utf8" }).status === 0;
}

function launchApp(stageAt, sink, logPath) {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "CARGO_HOME", "RUSTUP_HOME"];
  const env = Object.fromEntries(keep.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  const log = spawn("tee", [logPath], { stdio: ["pipe", "ignore", "ignore"] });
  const app = spawn("pnpm", ["tauri", "dev"], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, LANG: "ko_KR.UTF-8", SHELL: stageAt.shell, ATELIER_HOME: stageAt.home, VITE_STREAM_LOAD: sink.url },
  });
  app.stdout.pipe(log.stdin);
  app.stderr.pipe(log.stdin);
  return app;
}

async function endApp(app) {
  const group = (signal) => {
    try {
      process.kill(-app.pid, signal);
    } catch {
      // 이미 끝났다.
    }
  };
  group("SIGTERM");
  for (let waited = 0; waited < 50 && portBusy(); waited += 1) await new Promise((done) => setTimeout(done, 100));
  group("SIGKILL");
}

function timed(promise, limitMs, what) {
  let timer;
  const expired = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what}: ${limitMs / 1000}초를 넘겼다`)), limitMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

async function measure() {
  if (portBusy()) throw new Error(`포트 ${PORT}이 쓰이고 있다 — 진짜 앱은 기계에 하나만 뜬다`);
  const before = ownerPrint();
  run("cargo", ["build", "-p", "atelier-acp", "--bin", "fake-claude"]);

  const root = mkdtempSync(join(tmpdir(), "atelier-stream-load-"));
  const place = stage(root);
  const idleMs = Number(options["idle-seconds"]) * 1000;
  const plan = { thread: THREAD, lines: place.lines, say: "부하를 흘려 줘", idleMs, settleMs: 3000 };
  const samples = [];
  let front = false;
  const sink = await startSink(plan, async () => {
    front = bringToFront();
    // 앱이 떴다 — 앞의 빌드는 표본에 넣지 않는다.
    samples.length = 0;
  });
  const app = launchApp(place, sink, join(root, "app.log"));
  const sampling = setInterval(() => samples.push(sampleMachine()), 5000);
  let report;
  try {
    report = await timed(sink.report, 600_000 + (seconds + 60) * 1000, "앱의 보고를 기다리기");
  } finally {
    clearInterval(sampling);
    await endApp(app);
    sink.close();
  }
  const after = ownerPrint();
  if (report.error) throw new Error(`앱이 재지 못했다: ${report.error} (${join(root, "app.log")})`);

  const receiptPath = join(place.receipts, `${SESSION}.stream`);
  const load = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8").trim().split("\n").pop()) : null;
  const result = {
    at: new Date().toISOString(),
    load: { seconds, gapMs, messageMs: options["message-ms"] ?? null, sent: load, rate: load ? Math.round((load.chunks / load.ms) * 1000) : null },
    record: { seeded: place.lines, ...report.lines, turns: report.turns },
    idle: report.idle,
    stream: report.stream,
    flowUpdates: report.flowUpdates,
    chunks: report.chunks,
    foldMs: report.foldMs,
    wordsLeft: report.wordsLeft,
    away: report.away,
    view: report.view,
    front,
    planRequests: sink.plans(),
    machine: samples.length > 0 ? machineSummary(samples) : null,
    owner: { settingsSame: before.settings === after.settings, threadsSame: before.threads === after.threads },
    root,
  };
  return result;
}

function say(result) {
  const { idle, stream, load, record, machine, owner, away, view } = result;
  console.log(`\n기록 ${record.before}줄, 턴 ${record.turns}개, 창 ${view.width}x${view.height}`);
  console.log(`부하 ${load.seconds}초, 조각 간격 ${load.gapMs}ms, 메시지 길이 ${load.messageMs ?? "턴 전체"}: 보낸 조각 ${load.sent?.chunks}, 메시지 ${load.sent?.messages}, 실제 초당 ${load.rate}조각, 화면 갱신 ${result.flowUpdates}번`);
  console.log(`기준선 최대 ${idle.maxGap.toFixed(1)}ms, 보통 ${idle.medianGap.toFixed(1)}ms, ${LIMIT_MS}ms 넘음 ${idle.overLimit}번 (프레임 ${idle.frames})`);
  console.log(`부하 중 최대 ${stream.maxGap.toFixed(1)}ms, 보통 ${stream.medianGap.toFixed(1)}ms, ${LIMIT_MS}ms 넘음 ${stream.overLimit}번 (프레임 ${stream.frames})`);
  console.log(`조각 이벤트 ${result.chunks.events}개, 차례가 어긋난 것 ${result.chunks.outOfOrder}개`);
  console.log(`기록 전체를 한 번 접는 데 ${result.foldMs.toFixed(1)}ms`);
  console.log(`긴 간격: ${stream.worst.slice(0, 6).map(({ gap, note }) => `${gap.toFixed(0)}ms@${note?.chars ?? 0}자/${note?.lines ?? 0}줄`).join(", ")}`);
  if (machine) console.log(`기계: 코어 ${machine.cores}, load1 ${machine.load1.min.toFixed(1)}~${machine.load1.max.toFixed(1)}, CPU 합 최대 ${machine.cpuMax}%, 빌드 표본 ${machine.buildingSamples}/${machine.samples}, 많이 먹은 것 ${machine.busiest.join(", ")}`);
  console.log(`끝난 뒤 낱말 감쌈 ${result.wordsLeft}개`);
  console.log(`창이 앞에 없던 일: ${away.length === 0 ? "없음" : away.join(", ")}`);
  console.log(`소유자 자료: settings ${owner.settingsSame ? "그대로" : "바뀜"}, threads ${owner.threadsSame ? "그대로" : "바뀜"}`);
}

if (options["check-bundle"]) {
  checkBundle();
} else {
  const result = await measure();
  say(result);
  if (options.out) writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
  if (!options.keep) rmSync(result.root, { recursive: true, force: true });
  const valid = result.away.length === 0 && result.chunks.outOfOrder === 0 && result.owner.settingsSame && result.owner.threadsSame;
  process.exit(valid && result.stream.maxGap <= LIMIT_MS ? 0 : 1);
}

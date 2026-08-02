// spec 파일 목록을 **판 구획과 상시 구획으로 가르는 유일한 지점.**
//
// 구획의 정의(무엇이 판 안이고 밖인지, 폴더 이름)는 이 화면이 정하지 않는다 —
// `work-루프-정의`·`work-문턱-낮추기`가 정본이고 여기서는 그것을 읽어 나눌 뿐이다.
// 그 정의가 바뀔 때 고칠 곳이 하나여야 해서 순수 함수로 떼어 둔다.
//
// SpecTree도 같은 관습(`NN-<이름>/`)을 읽지만 그쪽은 **정렬**에만 쓴다. 두 곳이 같은
// 정규식을 갖는 것은 중복이 아니라 쓰임이 다른 것이다 — 트리는 한 줄로 늘어놓고,
// 여기는 판을 접을 수 있는 덩어리로 만든다.

// `NN-<이름>/` 디렉터리 하나가 판 하나다 (SpecTree의 ITERATION과 같은 관습).
const ITERATION = /^(\d+)-/;

export interface Iteration {
  // 판 폴더 이름 그대로. 화면에도 이 이름이 나온다 — 경로 복사가 붙어 있는 자리라
  // 디스크의 이름과 어긋나면 안 된다.
  dir: string;
  number: number;
  // 판 폴더 **기준** 상대 경로. 트리가 판 폴더 노드를 한 번 더 그리지 않게 접두어를 뗀다.
  files: string[];
}

export interface SpecSections {
  // 최신 판이 먼저다 — 지난 판은 접힌 채 아래에 쌓인다.
  iterations: Iteration[];
  // 판 밖의 모든 것. 규칙에 없는 폴더·파일도 여기 남는다 — 아틀리에가 특정 스킬의
  // 산출물 이름에 묶이면 안 되기 때문이다(SpecTree와 같은 근거).
  standing: string[];
}

export function splitSpecFiles(files: readonly string[]): SpecSections {
  const byDir = new Map<string, Iteration>();
  const standing: string[] = [];

  for (const file of files) {
    const slash = file.indexOf("/");
    // 판은 **폴더**다. 슬래시가 없으면 파일이므로 `01-계획.md`는 판이 아니다.
    const dir = slash > 0 ? file.slice(0, slash) : "";
    const match = dir ? ITERATION.exec(dir) : null;
    if (!match) {
      standing.push(file);
      continue;
    }
    let iteration = byDir.get(dir);
    if (!iteration) {
      iteration = { dir, number: Number(match[1]), files: [] };
      byDir.set(dir, iteration);
    }
    iteration.files.push(file.slice(slash + 1));
  }

  // 숫자로 센다 — 문자열로 정렬하면 100이 02보다 앞선다
  const iterations = [...byDir.values()].sort((a, b) => b.number - a.number);
  return { iterations, standing };
}

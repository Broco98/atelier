#!/usr/bin/env python3
"""아틀리에 셸 신호 훅 — 에이전트가 말한 것을 이 셸의 상태 파일 한 장에 옮겨 적는다.

앱이 `~/.atelier/hooks/`에 이 파일을 세우고, 사용자의 claude·codex 설정이 이것을 부른다.
받는 것은 argv 둘(에이전트 이름 · 훅 이벤트 이름)과 stdin의 페이로드 JSON이고, 남기는 것은
`~/.atelier/shells/<셸 ID>.json` 한 장이다. 그 파일을 앱의 감시가 보고 화면까지 나른다.

**아무것도 안 하고 0으로 끝나는 길이 정상 경로다.** 사용자가 이 훅을 깔면 그것은 아틀리에
밖에서 띄운 터미널의 claude·codex에서도 돈다 — 거기엔 `ATELIER_SHELL`이 없다. 그때 파일을
남기면 남의 홈에 쓰레기를 쌓는 것이고, 0이 아닌 코드로 끝나거나 무언가를 출력하면 Claude·
Codex 둘 다 그것을 훅 실패로 읽어 사람에게 오류를 보인다(둘 다 「출력 없이 종료 코드 0이면
성공」이다). 그래서 이 스크립트에는 실패로 끝나는 길이 없다.

**외부 프로세스를 안 부른다.** 훅은 에이전트의 턴 안에서 돌아 그 시간이 그대로 사람이
기다리는 시간이 된다 — 신호의 값을 속도로 물어내면 안 된다. `mv`도 `date`도 부르지 않고
파이썬의 시스템 호출로만 끝낸다(그래서 셸 스크립트가 아니다: 원자적 rename을 부를 builtin이
sh에 없다).

**해석은 여기서 안 한다.** 페이로드를 그대로 싣고 「무슨 뜻인가」는 앱의 어댑터가 접는다 —
정규 이벤트로 접는 규칙은 에이전트마다 다르고 화면과 함께 바뀌는데, 그것이 사용자 홈에
설치된 이 파일에 있으면 앱을 고쳐도 낡은 스크립트가 남아 있는 셸에서는 안 바뀐다.
"""

import json
import os
import sys
import time


def main():
    # **env를 stdin보다 먼저 본다.** 아틀리에 밖에서는 여기서 끝나야 하고, stdin을 먼저
    # 읽으면 그 터미널의 훅이 파이프를 기다리며 에이전트의 턴을 붙잡는다.
    shell = os.environ.get("ATELIER_SHELL", "")
    if not shell:
        return
    # 이 값은 그대로 **파일 이름**이 된다. `/`나 `..`가 섞이면 상태 폴더 밖에 쓰게 되므로,
    # 앱이 만드는 모양(`<접두사>-<번호>`)만 통과시킨다. 아니면 아무 일도 안 한다.
    if not all(c.isalnum() or c == "-" for c in shell):
        return

    # argv가 이벤트의 이름을 든다. 페이로드에도 이름이 있는 에이전트가 있지만 그 키가
    # 에이전트마다 달라서, 설치할 때 앱이 아는 이름을 그대로 넘기는 쪽이 어긋날 자리가 없다.
    if len(sys.argv) < 3:
        return
    agent, event = sys.argv[1], sys.argv[2]

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else None
    except ValueError:
        # 페이로드를 못 읽어도 「이 셸에서 그 이벤트가 났다」는 여전히 참이다. 그 사실까지
        # 버리면 상태가 안 바뀌어 사람이 부르는 셸을 못 본다.
        payload = None

    root = os.environ.get("ATELIER_HOME") or os.path.expanduser("~/.atelier")
    directory = os.path.join(root, "shells")
    os.makedirs(directory, exist_ok=True)

    state = {
        "agent": agent,
        "event": event,
        "at": int(time.time() * 1000),
        "payload": payload,
    }

    # **원자적으로 쓴다.** 감시가 반쯤 쓰인 파일을 읽으면 그 셸의 상태가 조용히 사라진다
    # (깨진 파일은 무시하는 것이 감시의 규칙이다). 같은 폴더의 임시 파일에 다 쓰고
    # `os.replace`로 갈아 끼우면 파일이 반쯤인 순간이 없다 — 다른 폴더에 두면 파일시스템
    # 경계를 넘어 복사-삭제가 되어 그 보장이 깨진다.
    #
    # 점 접두사는 이 저장소의 규약이다(`watcher.rs`의 「dotfile은 무시한다」) — 감시가 자기
    # 쓰기의 중간 단계를 되돌려주지 않게 한다. 이름에 pid를 붙이는 것은 한 셸에서 훅 둘이
    # 겹쳐 돌 때 서로의 임시 파일을 옮기지 않게 하려는 것이다.
    tmp = os.path.join(directory, ".%s.json.%d.tmp" % (shell, os.getpid()))
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(state, ensure_ascii=False))
        os.replace(tmp, os.path.join(directory, shell + ".json"))
    except OSError:
        # 쓰다 실패했으면 임시 파일을 걷는다. 남겨 두면 사용자 폴더에 우리 자국이 쌓인다.
        try:
            os.remove(tmp)
        except OSError:
            pass


try:
    main()
except Exception:
    # **여기가 이 스크립트의 마지막 방어선이다.** 무엇이 터지든 에이전트의 턴은 성공으로
    # 끝나야 한다 — 신호를 못 남기는 것보다 사람의 대화를 오류로 끊는 것이 훨씬 나쁘다.
    pass
raise SystemExit(0)

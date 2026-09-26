#!/bin/zsh -f
# 아틀리에 셸 신호 처리기 — 에이전트가 말한 것을 이 셸의 상태 파일 한 장에 접어 적는다(프로세스 스펙 S26 · S27 · S28).
#
# 앱이 `~/.atelier/hooks/`에 이 파일을 세우고, 사용자의 claude · codex 설정이 이것을 부른다. 받는 것은 argv 둘(에이전트
# 이름 · 훅 이벤트 이름)과 stdin의 페이로드 JSON이고, 남기는 것은 `~/.atelier/shells/<셸 키>.json` 한 장이다:
#   {"agent":…,"event":…,"at":…,"subagents":[…],"stopped":…,"payload":…}
# 그 파일을 앱의 감시(`shells.rs`)가 보고 화면까지 나른다. 옛 python 처리기(`atelier-hook.py`)를 대신한다 — 이름이 다른
# 것은 두 빌드가 같은 루트를 쓰기 때문이다: 옛 이름에 두면 이 기능 전의 설치본이 뜰 때마다 옛 계약의 스크립트로 덮는다.
#
# **왜 zsh인가 — 재서 골랐다.** 기준은 에이전트가 부르는 모양으로 p50 ≤ 5ms, python 없음이다. 옛 python 처리기는 호출당
# 23ms였다. POSIX sh는 ms 시계 · 잠금 · rename이 모두 바깥 프로세스라 기준을 못 채운다. `/bin/zsh -f`는 그 셋을 내장 모듈로
# 한다(`zsh/datetime`의 시계, `zsh/system`의 fcntl 잠금, `zsh/files`의 rename). 두 에이전트가 부르는 모양 그대로 재면
# p50이 claude(`args`, 셸 없이) 3ms 안팎, codex(제 셸의 `-c`, 아래) 4.2~4.7ms다. macOS에 늘 있고, 지금 스크립트처럼 앱이
# 굽혀 데이터 루트에 쓰면 된다. 작은 네이티브 처리기는 1.5ms쯤 더 빠르지만 실을 자리가 새로 든다(번들에 따로 싣는 바이너리 +
# 서명, 또는 앱 바이너리의 훅 갈래 — 어느 쪽이든 빌드 · 서명 · 설정에 적을 경로가 는다). codex 쪽 여유가 0.3~0.8ms로 얇아,
# 21이 진짜 codex로 잰 값이 5ms를 넘으면 네이티브(같은 모양 3.0~3.4ms)가 다음 후보다. 후보마다 잰 값은 구현 기록 19절에 있다.
# 모듈 하나를 싣는 데 0.25ms 남짓이 들어, 꼭 쓰는 것만 싣는다.
#
# **부르는 모양.** claude는 `args`가 있는 command 훅을 셸 없이 곧바로 띄운다(exec form):
#   {"type":"command","command":"<이 파일의 경로>","args":["claude","Stop"]}
# `args`가 없으면 `/bin/sh -c '<명령줄>'`로 셸 한 벌이 더해진다. codex에는 `args`가 없어 명령줄을 **제 환경의 셸**로 부른다 —
# `/bin/sh`가 아니라 사용자 셸의 `-c`(macOS 기본 `/bin/zsh -c`, 사용자의 `~/.zshenv`가 든다)다. 그래서 이 파일은 실행 권한과
# 위 첫 줄(shebang)로 스스로 뜬다.
#
# **아무것도 안 남기고 0으로 끝나는 길이 정상 경로다.** 사용자가 이 훅을 깔면 아틀리에 밖 터미널의 claude · codex에서도 돈다
# — 거기엔 `ATELIER_SHELL`이 없다. 그때 파일을 남기면 남의 홈에 쓰레기를 쌓는 것이고, 0이 아닌 코드로 끝나거나 무언가를
# 출력하면 에이전트가 그것을 훅 실패로 읽어 사람에게 보인다(claude는 UserPromptSubmit의 stdout을 대화에 싣기까지 한다).
# 그래서 맨 앞에서 stderr를 닫고, 몸통 전체를 `always`로 감싸 늘 0으로 끝난다(fail-open).
#
# **바깥 프로세스를 안 부른다.** 훅은 에이전트의 턴 안에서 돌아 그 시간이 그대로 사람이 기다리는 시간이다. 바깥 명령도
# `$(…)`도 파이프도 서브셸도 없다 — 모두 fork다. 검사 `the_handler_never_reaches_for_another_process`가 이 파일을 fork가
# 안 되는 몸(`RLIMIT_NPROC` 1)으로 띄워 잰다. 그 검사는 아래 침묵 줄 하나를 뺀 사본을 띄우므로, stderr를 돌리는 줄은 그 줄
# 하나뿐이어야 한다.
#
# **해석은 조금만 한다.** 페이로드는 그대로 싣고 「무슨 뜻인가」는 앱의 어댑터가 접는다 — 그 규칙이 사용자 홈에 설치된 이
# 파일에 있으면 앱을 고쳐도 낡은 처리기가 남은 셸에서는 안 바뀐다. 여기서 접는 것은 **파일이 마지막 사건 하나만 담아서
# 화면이 못 세는 둘**뿐이다: 도는 서브에이전트의 id 집합(S51)과 「턴이 멈췄다」(S50).

exec 2>/dev/null

# **시각을 가장 먼저 잰다 — stdin을 읽기 전이다.** 순서 가드는 「누가 먼저 불렸나」를 이 값으로 가른다(S27). 다 읽은 뒤에
# 재면 긴 페이로드를 받은 처리기가 늦게 불린 것으로 읽힌다. 단위는 ms(옛 처리기와 화면이 쓰는 그 단위)다.
zmodload zsh/datetime || exit 0
integer at=$(( epochtime[1] * 1000 + epochtime[2] / 1000000 ))

setopt extended_glob

{
  zmodload zsh/system || exit 0
  zmodload -F zsh/files b:zf_mkdir b:zf_mv b:zf_rm || exit 0

  # **stdin을 무엇보다 먼저, 끝까지 비운다 — 여기서 그냥 나갈 때도 그렇다.** 안 읽고 나가면 페이로드를 쓰던 에이전트가 파이프
  # 반대편에서 `EPIPE`를 받는다. 짧은 페이로드는 파이프 버퍼(64KB)에 다 들어가 안 터지고 긴 프롬프트만 터진다 — 가끔만
  # 터지는 모양이라 더 나쁘다. `read` 내장은 파이프를 한 바이트씩 읽으므로(넘겨 읽지 않으려고) 큰 덩이로 읽는 `sysread`를 쓴다.
  raw=
  while sysread -s 65536 chunk; do
    raw+=$chunk
  done

  # 셸 키는 그대로 **파일 이름**이 된다. `/`나 `..`가 섞이면 상태 폴더 밖에 쓰게 되므로, 앱이 짓는 모양(`<세대>-<번호>`)의
  # 글자만 받는다. 에이전트 · 사건 이름은 JSON 글자가 되므로 따옴표가 섞이면 파일이 깨진다 — 설치기가 거는 글자만 받는다.
  shell=${ATELIER_SHELL-}
  [[ $shell == [A-Za-z0-9-]## ]] || exit 0
  (( $# >= 2 )) || exit 0
  [[ $1 == [A-Za-z0-9_-]## && $2 == [A-Za-z0-9_-]## ]] || exit 0

  # 데이터 루트는 앱(`atelier_core::data_root`)과 같다 — `ATELIER_HOME`, 없으면 `~/.atelier`.
  root=${ATELIER_HOME-}
  if [[ -z $root ]]; then
    [[ -n ${HOME-} ]] || exit 0
    root=$HOME/.atelier
  fi
  dir=$root/shells
  zf_mkdir -p $dir || exit 0

  # 페이로드는 **글자 그대로** 싣는다. 객체 모양이 아니면(비었거나 잘렸으면) `null` — 그때도 「이 셸에서 그 이벤트가 났다」는
  # 참이다. 여기서 JSON을 다 풀지는 않는다: 에이전트는 온전한 JSON을 주고, 다 푸는 값은 앱의 어댑터가 치른다.
  if [[ $raw == [[:space:]]#\{*\}[[:space:]]# ]]; then
    payload=$raw
  else
    payload=null
  fi

  # **순서 가드의 잠금**(S27). 셸마다 따로 선 파일을 쥔다 — 상태 파일은 rename으로 갈아 끼워 inode가 바뀌므로 잠금 자리가 못
  # 된다. 잠금 없이 비교하고 쓰면, 비교와 쓰기 사이에 다른 처리기가 끼어 더 새로운 값을 덮는다. 파일은 잠그기 **전에** 만든다
  # (fcntl 잠금은 그 파일의 아무 fd를 닫아도 풀린다). 기다림에 끝을 둔다 — 멈춘 처리기 하나가 에이전트의 턴을 붙잡으면 안 된다.
  lock=$dir/.$shell.lock
  : >> $lock || exit 0
  zsystem flock -t 1 -i 0.001 -f lockfd $lock || exit 0

  # 지금 파일을 읽는다. **이 처리기가 쓴 모양만** 읽는다 — 칸의 순서가 늘 같으니 한 패턴으로 가른다. 옛 python 처리기의
  # 파일이나 깨진 파일, 없는 파일은 「앞 사건 없음」(빈 집합, 안 멈춤)이다. 읽기는 stdin과 같은 `sysread`다 — 모듈 하나
  # (`zsh/mapfile`)를 더 싣는 값이 몸통의 다른 일보다 크다(모듈 하나에 0.25ms 남짓).
  file=$dir/$shell.json
  old=
  if [[ -f $file ]]; then
    while sysread -s 65536 chunk; do
      old+=$chunk
    done < $file
  fi
  integer old_at=-1
  old_ids=()
  old_stopped=false
  if [[ $old == (#b)'{"agent":"'([A-Za-z0-9_-]##)'","event":"'([A-Za-z0-9_-]##)'","at":'([0-9]##)',"subagents":['([^\]]#)'],"stopped":'(true|false)',"payload":'(*)'}' ]]; then
    old_agent=$match[1]
    old_event=$match[2]
    old_at=$match[3]
    old_ids=( ${(s:,:)match[4]//\"/} )
    old_stopped=$match[5]
    old_payload=$match[6]
  fi

  # **접기 — 순서 가드에 막힌 사건도 접는다**(S27). 수와 멈춤은 사건의 도착 순서와 무관한 사실이라서다: 늦게 온 SubagentStop도
  # 그 서브에이전트가 끝났다는 뜻이다.
  #
  # 서브에이전트는 +1/−1이 아니라 **id 집합**이다(S51) — 늦게 온 Stop이나 빠진 Start(claude 자신의 에이전트는 Start 없이
  # Stop만 낸다)에도 수가 안 샌다. id 칸은 claude · codex 모두 `agent_id`다. 따옴표째 `"agent_id"`를 찾는다 — 문자열 값 안의
  # 흉내는 따옴표가 `\"`로 풀려 있어 안 걸린다. 정규식은 이 두 사건에서만 돈다(긴 페이로드에서는 ms가 든다).
  ids=( $old_ids )
  stopped=$old_stopped
  case $2 in
    (SubagentStart|SubagentStop)
      zmodload zsh/regex || exit 0
      if [[ $raw =~ '"agent_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9._:-]+)"' ]]; then
        id=$match[1]
        if [[ $2 == SubagentStart ]]; then
          (( ${ids[(Ie)$id]} )) || ids+=( $id )
        else
          ids=( ${ids:#${(b)id}} )
        fi
      fi
      ;;
    # 멈춤(S50): 턴이 끝나면 참, 새 턴 · 세션 끝 · 중단이면 거짓. 새 턴과 세션 끝은 도는 서브에이전트도 비운다.
    (UserPromptSubmit|SessionEnd)
      ids=()
      stopped=false
      ;;
    (Stop|StopFailure)
      stopped=true
      ;;
    (Interrupt)
      stopped=false
      ;;
    (PostToolUseFailure)
      zmodload zsh/regex || exit 0
      [[ $raw =~ '"is_interrupt"[[:space:]]*:[[:space:]]*true' ]] && stopped=false
      ;;
  esac

  # **순서 가드**(S27). 내 `at`이 파일의 것보다 같거나 새로울 때만 사건 이름 · `at` · 페이로드를 쓴다 — 같으면 뒤에 온 것이
  # 이긴다(같은 ms의 빠른 PostToolUse → Stop에서 Stop을 버리면 안 된다). 막혔으면 파일의 셋을 그대로 두고 수와 멈춤만 고친다.
  # 그마저 그대로면 쓰지 않는다 — 감시가 깰 까닭이 없다.
  if (( at >= old_at )); then
    agent=$1
    event=$2
    when=$at
    body=$payload
  else
    [[ ${(j:,:)ids} == "${(j:,:)old_ids}" && $stopped == "$old_stopped" ]] && exit 0
    agent=$old_agent
    event=$old_event
    when=$old_at
    body=$old_payload
  fi

  list=
  for id in $ids; do
    list+=${list:+,}\"$id\"
  done

  # **원자적으로 쓴다.** 감시가 반쯤 쓰인 파일을 읽으면 그 셸의 상태가 조용히 사라진다(깨진 파일은 버리는 것이 감시의
  # 규칙이다). 같은 폴더의 임시 파일에 다 쓰고 rename으로 갈아 끼운다 — 다른 폴더면 파일시스템 경계를 넘어 그 보장이 깨진다.
  # 점 접두사는 감시가 이 중간 단계를 셸로 안 읽게 하고, pid는 한 셸의 처리기 둘이 서로의 임시 파일을 옮기지 않게 한다.
  tmp=$dir/.$shell.json.$$.tmp
  print -rn -- '{"agent":"'$agent'","event":"'$event'","at":'$when',"subagents":['$list'],"stopped":'$stopped',"payload":'$body'}' > $tmp &&
    zf_mv -f $tmp $file ||
    zf_rm -f $tmp
} always {
  # 무엇이 터지든 에이전트의 턴은 성공으로 끝나야 한다 — 신호를 못 남기는 것보다 사람의 대화를 오류로 끊는 것이 훨씬 나쁘다.
  exit 0
}

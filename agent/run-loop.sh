#!/usr/bin/env bash
#
# Project BADA — 자율 에이전트 상시 루프 (self-hosted runner용)
#
# npm run agent를 반복 실행하되, 종료 코드로 다음 동작을 분기한다:
#   0  (clean/budget/iteration-cap) → 짧게 쉬고 다음 iteration
#   75 (rate-limit)                 → 리셋 시각까지(신호 파일) 또는 폴백만큼 sleep 후 재실행
#   그 외 (interrupted 등)          → 루프 종료 (사람 개입 대기)
#
# 중지: 레포 루트에서 `touch agent/STOP` — 현재 iteration이 끝나면 깔끔히 종료.
#       (agent/STOP은 .gitignore됨. 재개하려면 rm agent/STOP)
#
# 환경변수(선택):
#   AGENT_ITER_GOALS   iteration당 -n 값 (기본 5)
#   AGENT_IDLE_SLEEP   clean 종료 후 대기 초 (기본 60)
#   AGENT_RL_FALLBACK  리셋 시각 파싱 실패 시 대기 초 (기본 1800 = 30분)
#
# 실행: bash agent/run-loop.sh   (또는 chmod +x 후 ./agent/run-loop.sh)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STOP_FILE="agent/STOP"
SIGNAL_FILE="agent/rate-limit-reset"
ITER_GOALS="${AGENT_ITER_GOALS:-5}"
IDLE_SLEEP="${AGENT_IDLE_SLEEP:-60}"
RL_FALLBACK="${AGENT_RL_FALLBACK:-1800}"

log() { echo "[run-loop $(date '+%H:%M:%S')] $*"; }

# 리셋 신호 파일(ISO 시각)을 읽어 지금부터의 대기 초를 계산. 없거나 과거면 폴백.
compute_rl_wait() {
  if [[ ! -f "$SIGNAL_FILE" ]]; then
    echo "$RL_FALLBACK"
    return
  fi
  local reset_iso clean now_epoch reset_epoch diff
  reset_iso="$(cat "$SIGNAL_FILE" 2>/dev/null)"
  # ISO는 UTC(Z). BSD date는 -u 없이 파싱하면 로컬 시각으로 오해해 TZ만큼 틀어진다.
  # 소수 초와 트레일링 Z를 벗겨 초 단위로 자른 뒤, UTC로 명시해 파싱.
  clean="${reset_iso%.*}"; clean="${clean%Z}"
  reset_epoch="$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$clean" +%s 2>/dev/null \
              || date -u -d "$reset_iso" +%s 2>/dev/null)"
  if [[ -z "$reset_epoch" ]]; then
    log "리셋 시각 파싱 실패('$reset_iso') — 폴백 ${RL_FALLBACK}s 사용"
    echo "$RL_FALLBACK"
    return
  fi
  now_epoch="$(date +%s)"
  diff=$(( reset_epoch - now_epoch ))
  # 여유 60초 추가(경계에서 또 걸리지 않도록). 음수/과소면 폴백.
  diff=$(( diff + 60 ))
  if (( diff < 60 )); then
    echo "$RL_FALLBACK"
  else
    echo "$diff"
  fi
}

log "자율 루프 시작 (iteration당 -n ${ITER_GOALS}, 중지: touch ${STOP_FILE})"

while true; do
  if [[ -f "$STOP_FILE" ]]; then
    log "STOP 파일 감지 — 남은 커밋 대기열 flush 후 루프 종료. 재개하려면: rm ${STOP_FILE}"
    # threshold 미달로 대기 중인 완료 goal이 STOP으로 방치되지 않게 마지막에 밀어낸다.
    npm run agent:flush || log "flush 실패(무시) — 다음 실행에서 재시도됨"
    exit 0
  fi

  log "iteration 시작: npm run agent -- -n ${ITER_GOALS}"
  npm run agent -- -n "$ITER_GOALS"
  code=$?

  case "$code" in
    0)
      log "clean 종료(code 0) — ${IDLE_SLEEP}s 후 다음 iteration"
      sleep "$IDLE_SLEEP"
      ;;
    75)
      wait_s="$(compute_rl_wait)"
      log "rate-limit(code 75) — ${wait_s}s 대기 후 재실행"
      sleep "$wait_s"
      ;;
    *)
      log "예기치 않은 종료(code ${code}) — 루프 중단. 로그 확인 후 재시작 필요."
      exit "$code"
      ;;
  esac
done

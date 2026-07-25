# 자율 에이전트 자동화 (self-hosted runner)

에이전트 루프를 사람 트리거 없이 상시 실행하기 위한 설정. **2026-07-25 커밋 + live 검증 완료**
(검증 상세는 `agent/CHANGELOG.md` [2026-07-25] 항목 및 아래 "검증 결과" 참조).

## 설계 결정

세 후보(GitHub CI / 직접 웹훅 서버 / self-hosted runner) 중 **self-hosted runner + 프로세스 내부 bash 루프**를 택함.

- **왜 self-hosted**: CI(매번 새 VM)는 ① 완료했지만 threshold 미달로 push 안 된 커밋 유실 ② rate-limit으로 프로세스가 죽으면 재기동 불가 ③ push→재트리거에 PAT 필요(GITHUB_TOKEN은 재트리거 차단) 같은 문제가 있음. 상시 머신이면 이 셋이 전부 사라짐.
- **왜 내부 루프**: 프로세스가 안 죽으니 "다시 트리거"가 필요 없음. rate-limit은 "다음 실행을 못 깨우는 문제"가 아니라 "지금 프로세스가 리셋 시각까지 sleep하면 되는 문제"로 바뀜.
- **auth 주의(중요)**: 대화형 쉘에선 claude가 macOS 키체인의 로그인 세션을 쓰지만, **launchd 서비스(헤드리스)는 로그인 키체인을 못 읽어** `Not logged in`으로 죽는다. 따라서 "로그인 세션 재사용 → 시크릿 불요"는 **헤드리스에선 거짓**. `claude setup-token`으로 장기 토큰(`CLAUDE_CODE_OAUTH_TOKEN`)을 발급해 repo secret으로 주입해야 한다.

## 동작

```
agent/run-loop.sh (상시 실행되는 한 프로세스)
 └─ while STOP 파일 없으면:
     ├─ npm run agent -- -n 5
     ├─ exit 0  (clean/budget/iteration-cap) → AGENT_IDLE_SLEEP(기본 60s) 후 다음 iteration
     ├─ exit 75 (rate-limit)                 → 리셋 시각까지 sleep 후 재실행
     └─ exit 그 외 (interrupted 등)           → 루프 종료(사람 개입 대기)
```

### 종료 코드 계약 (loop.ts `stopReasonToExitCode`)
- `0` — clean / budget / iteration-cap: 할 일 다 했거나 이번 몫 소진
- `75` — rate-limit (EX_TEMPFAIL): 래퍼가 리셋까지 대기 후 재시도
- `1` — interrupted: 예기치 않은 단계 실패

### rate-limit 리셋 시각 전달
- loop.ts가 단계 출력에서 리셋 시각을 파싱(`parseRateLimitReset`, runner.ts) → `agent/rate-limit-reset`에 ISO로 기록.
- run-loop.sh의 `compute_rl_wait`가 이를 읽어 그 시각까지 sleep. 파싱 실패 시 `AGENT_RL_FALLBACK`(기본 1800s).
- **주의**: ISO는 UTC(Z). BSD(macOS) `date`는 `-u` 없이 파싱하면 로컬로 오해해 TZ만큼 틀어짐 → 스크립트는 `date -j -u -f ...` 사용(이미 반영·검증됨).
- loop.ts는 시작 시 이전 실행의 stale 신호 파일을 제거함.

## 운영

```bash
bash agent/run-loop.sh          # 시작 (또는 workflow_dispatch)
touch agent/STOP                # 중지: 현재 iteration 끝나고 대기열 flush 후 종료
rm agent/STOP                   # 재개
```

환경변수(선택): `AGENT_ITER_GOALS`(iteration당 -n, 기본 5), `AGENT_IDLE_SLEEP`(기본 60), `AGENT_RL_FALLBACK`(기본 1800).

`agent/rate-limit-reset`·`agent/STOP`은 .gitignore됨.

## 변경 파일

- `agent/run-loop.sh` (신규) — 상시 루프 래퍼
- `agent/flushCommits.ts` (신규) + `npm run agent:flush` — threshold 미달 대기열 강제 push (STOP 시 호출)
- `agent/loop.ts` — 종료 코드 매핑, rate-limit 신호 파일 쓰기, 시작 시 stale 제거
- `agent/pipeline/runner.ts` — `runText`(신규, **Ollama 우선 + claude 폴백**), `runOllama`/`OllamaError` 유지, `parseRateLimitReset` 추가
- `agent/pipeline/goals.ts` — 텍스트 생성 5곳을 `runText`로 전환(목표 생성 2곳은 마커 검증자 전달) + `flushPendingCommits`
- `agent/pipeline/types.ts` — `RATE_LIMIT_SIGNAL_FILE` 상수
- `.github/workflows/agent-loop.yml` — `runs-on: self-hosted`, run-loop.sh 한 번 띄우는 얇은 래퍼
- `.gitignore` — `agent/rate-limit-reset`, `agent/STOP`, `agent/evolution/`, `actions-runner/`, 테스트 출력

**Ollama 폴백 (전면 제거 아님)**: `generateGoalsFromChecklist`/`generateGoalsFromReview`가 `runOllama`의 `OllamaError`를 안 잡아, pending goal 소진 시 로컬 Ollama 없는 러너에서 파이프라인 전체가 죽었음. 이를 **"Ollama 우선 + claude(haiku) 폴백"**으로 고침 — 러너에 Ollama가 있으면 값싼 텍스트 생성을 무료/로컬로 처리해 claude 사용량(rate-limit 창)을 아끼고, 없거나 죽거나 형식을 어기면 claude가 자동으로 이어받는다. Ollama 모델은 `OLLAMA_TEXT_MODEL`(env, 기본 `qwen2.5-coder:7b`)로 교체. **러너에 Ollama를 두려면** `qwen2.5-coder:7b` 등 모델을 `ollama pull` 해두면 되고, 없어도 claude 폴백으로 동작한다.

## 검증 결과 (2026-07-25 live)

- `npm run agent -- -n 1` 실제 1회 완주 — Observer(Playwright 32샘플, 콘솔에러 0)→Evolver→Aesthetic→Vision Judge→Planner→Implementer→Reviewer 전 단계 실행, **exit 0**. (~202s, $0.66)
- 뽑힌 목표가 씬 불변식 위반(Ocean에 ConeGeometry 갓레이 재추가)이라 Planner·Implementer·Reviewer 3단계가 모두 정확히 거부 → no-op REVIEW_PASS. **가드레일 실전 확인.**
- 커밋 대기열 2/3(threshold 미달)로 push 없음, `warnUncommittedAgentChanges`가 미커밋 `agent/**` 파일 경고+stage 제외 확인.
- `compute_rl_wait`의 BSD `date -u` UTC 파싱 4케이스(미래/과거/무파일/손상) 전부 기대치 통과.
- 타입체크 양쪽 tsconfig 통과(`npx tsc --noEmit` / `-p tsconfig.agent.json`).

## 러너 가동 상태 (2026-07-25)

- **위치**: 프로젝트 **밖** `~/actions-runner`로 이전함. 처음엔 프로젝트 안에 뒀다가 ① Node가 상위 `type:module` package.json을 러너의 CommonJS 부트스트랩에 적용해 `require is not defined` 크래시 ② `_work/bada/bada`에 프로젝트 전체가 다시 checkout되는 중첩 구조 — 이 둘 때문에 밖으로 뺐다(밖으로 빼면 둘 다 사라짐). 등록 시크릿(`.credentials`) 포함하므로 어디 두든 비공개.
- **서비스**: `cd ~/actions-runner && ./svc.sh install && ./svc.sh start` (launchd, sudo 불필요). 서비스명 `actions.runner.utfw-bada.loop`, 로그 `~/Library/Logs/actions.runner.utfw-bada.loop/`. 러너 머신에 Node/npm/`claude`/Playwright 브라우저 필요. 현재 상태: 연결됨·Listening.
- **트리거**: 러너는 대기만 하고, 루프는 Actions UI "Autonomous Agent Loop" → Run workflow로 dispatch해야 시작(이 머신엔 `gh`/토큰 없어 CLI dispatch 불가).
- **⛔ auth (필수 선행)**: 헤드리스라 `claude setup-token` 발급 토큰을 repo secret `CLAUDE_CODE_OAUTH_TOKEN`으로 등록해야 함. 안 하면 Planner/Vision 단계가 `Not logged in`으로 exit 1(2026-07-25 첫 dispatch가 이걸로 실패). 워크플로가 이 secret을 `CLAUDE_CODE_OAUTH_TOKEN` env로 넘긴다.

## 아직 확인 필요

- **실제 rate-limit exit 75 경로** — 단위 검증(`compute_rl_wait` 4/4)은 마쳤으나, 실제 rate-limit이 exit 75로 나가 리셋까지 대기하는 전 과정은 러너 첫 자연 발생 시 최종 확인 권장.
Analyze the latest autonomous-agent run and report prioritized findings. Read-only — no edits, no commits.

이번 프로젝트에서 반복해온 "런 로그 진단" 절차를 정형화한 것. 러너/로컬 실행 로그를 읽고 무엇이 잘 됐고 무엇이 낭비/버그인지 근거와 함께 정리한다. **수정은 하지 않는다** — findings만 내고, 실제 수정은 `/agent-ship`으로.

## 1. 대상 로그 찾기

인자로 로그 경로가 주어지면 그걸 쓰고, 아니면 최신 실행분을 찾는다:

```bash
# 러너 실행분 우선
ls -dt ~/actions-runner/_work/bada/bada/agent/logs/*/ | head -1
# 없으면 로컬 실행분
ls -dt agent/logs/*/ | head -1
```

`<latest>/summary.md`를 읽는다(목표별 결과·변경 파일·시작/종료).

## 2. 점검 항목 (각 goal에 대해)

- **no-op 낭비**: `변경 파일: 없음`인데 ✅완료면 `goal-NN-impl.md`에서 `IMPL_NOOP:` 이유를 확인.
  - `IMPL_NOOP` 이유 있음 → 정상(정직한 보류). 이유를 인용해 **"사람 판단 필요"** 지점으로 표시(예: "uExposure는 GODRAY_EXPOSURE로 덮임").
  - `IMPL_NOOP` 없이 `IMPL_COMPLETE`인데 변경 0 → **가짜 완료(silent no-op) 의심** → 지적.
- **수렴 vs 버그 판별**: no-op goal이 요구한 값이 이미 코드에 있는지 확인.
  ```bash
  git show origin/main:src/scene/SceneManager.ts | grep -i EXPOSURE   # 예
  ```
  이미 목표값 → 수렴(정상). 아직인데 안 바뀜 → Implementer 회피/버그 또는 **목표가 잘못된 노브 지목**.
- **커밋 무결성**: 이번 실행이 push한 `[agent]` 커밋을 확인 — 미완료 goal의 파일 누출·본문 bullet ↔ 실제 diff 불일치.
  ```bash
  git show --stat <agent-commit>
  ```
- **재시도 낭비**: 한 goal에 impl-retry 다수 → 불변식 위반이면 `PLAN_ABANDON` 대상.
- **rate-limit**: `⏸ 한도`/exit 75 → 리셋 시각·대기 계산 정상인지.
- **비용**: `agent/metrics.jsonl` 또는 커밋 본문 `Metrics:`로 이번 배치 $·토큰 집계.

## 3. 출력 형식

1. **✅ 정상 확인**(회귀 감시용) — auth·커밋·push·rate-limit·게이팅 등 이번에 제대로 작동한 것.
2. **🐛 findings (심각도순 표)** — 각 항목: `[증상 / 근거(파일·값 인용) / 근본원인 가설 / 권장 수정 부류]`.
3. **메커니즘 해결 가능** vs **사람 판단 필요**(judge↔impl 교착 등)를 **명확히 구분**한다. 후자를 "고칠 수 있다"고 과장하지 말 것.

새 버그 패턴을 발견하면 `/agent-ship`에서 REVIEW_CHECKLIST에 항목으로 추가되도록 넘긴다.

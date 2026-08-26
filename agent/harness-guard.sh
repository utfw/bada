#!/usr/bin/env bash
#
# Project BADA — PreToolUse 하네스 가드
#
# 자율 파이프라인이 CLI(claude -p)를 호출할 때 --settings 로 이 스크립트를
# PreToolUse hook(matcher: Edit|Write|Bash)으로 배선한다. 목적: 에이전트가
# 실행 하네스(agent/loop.ts, agent/pipeline/**, runner 등 파이프라인 자신)를
# 수정하지 못하게 물리적으로 차단한다.
#
# 경계(정책 vs 하네스)는 agent/pipeline/types.ts의 AGENT_POLICY_FILES / isHarnessFile
# 과 반드시 일치해야 한다. 여기 POLICY_FILES 목록을 그 상수와 동기화할 것.
#
# 계약(공식):
#   - stdin  : tool_input JSON. Edit/Write는 .tool_input.file_path, Bash는 .tool_input.command
#   - exit 0 : 허용(정책 파일·src·agent 밖). permission 규칙으로 흐름 넘김.
#   - exit 2 : 차단. stderr의 사유가 모델에 피드백됨. permission 평가 이전에 막힘.
#
# deny가 항상 이기는 permissions 규칙으로는 "agent/** 차단 + 정책 파일 예외" carve-out이
# 불가하므로(공식 문서), 경계 판정을 이 단일 hook의 exit code로 한다.

set -uo pipefail

# ── 정책 파일 allowlist (agent/pipeline/types.ts:AGENT_POLICY_FILES 와 동기화) ──
POLICY_FILES=(
  "agent/REVIEW_CHECKLIST.md"
  "agent/vision/labels.json"
)

# ── 사람 소유 문서 denylist (types.ts:HUMAN_OWNED_DOC_FILES 와 동기화) ──
# 프로젝트가 무엇인지 사람에게 설명하는 문서. agent/** 밖(repo 루트)이라
# 위 하네스 판정에 걸리지 않으므로 별도 목록으로 막는다.
HUMAN_DOC_FILES=(
  "README.md"
  "CLAUDE.md"
)

input="$(cat)"

# jq 우선, 없으면 node 폴백(파이프라인은 Node/tsx 환경이라 node는 항상 있음).
extract() { # $1 = jq 필터(예: .tool_name)
  if command -v jq >/dev/null 2>&1; then
    jq -r "$1 // empty" <<<"$input" 2>/dev/null
  else
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const f=process.argv[1].replace(/^\./,"").split(".").filter(Boolean);let v=o;for(const k of f)v=v==null?undefined:v[k];process.stdout.write(v==null?"":String(v));}catch{process.stdout.write("");}})' "$1" <<<"$input"
  fi
}

tool_name="$(extract '.tool_name')"
file_path="$(extract '.tool_input.file_path')"
command="$(extract '.tool_input.command')"

# 절대경로/`./` 접두어를 repo-상대로 정규화. repo 루트 경로 조각을 잘라낸다.
# (paths가 /Users/.../<repo>/agent/loop.ts 형태로 올 수 있음)
normalize() {
  local p="$1"
  p="${p#./}"
  # 마지막 "agent/" 또는 "src/" 이후를 repo-상대로 간주.
  # 그 외 절대경로(예: /Users/.../project_bada/README.md)는 basename만 남겨
  # repo 루트 문서와 대조 가능하게 한다.
  case "$p" in
    */agent/*) echo "agent/${p##*/agent/}" ;;
    */src/*)   echo "src/${p##*/src/}" ;;
    /*)        echo "${p##*/}" ;;
    *)         echo "$p" ;;
  esac
}

is_human_doc() { # $1 = repo-상대 경로
  local p="$1" f
  for f in "${HUMAN_DOC_FILES[@]}"; do
    [[ "$p" == "$f" ]] && return 0
  done
  return 1
}

is_policy() { # $1 = repo-상대 경로
  local p="$1" f
  for f in "${POLICY_FILES[@]}"; do
    [[ "$p" == "$f" ]] && return 0
  done
  return 1
}

deny() { # $1 = 사유
  echo "harness-guard: $1" >&2
  exit 2
}

# ── Edit/Write: 대상 파일 경로 판정 ──
if [[ "$tool_name" == "Edit" || "$tool_name" == "Write" || "$tool_name" == "NotebookEdit" ]]; then
  [[ -z "$file_path" ]] && exit 0
  rel="$(normalize "$file_path")"
  if [[ "$rel" == agent/* ]] && ! is_policy "$rel"; then
    deny "실행 하네스 '$rel' 는 수정 금지. src/** 또는 정책 파일(agent/REVIEW_CHECKLIST.md, agent/vision/labels.json)만 편집하라."
  fi
  if is_human_doc "$rel"; then
    deny "'$rel' 은 사람이 소유하는 프로젝트 설명 문서로 수정 금지. 코드 변경은 src/** 에만 하라."
  fi
  exit 0
fi

# ── Bash: 하네스 경로에 쓰는 shell 우회 차단 ──
if [[ "$tool_name" == "Bash" ]]; then
  [[ -z "$command" ]] && exit 0
  # 쓰기성 연산이 agent/ 경로를 향하면 차단. 정책 파일 대상은 허용.
  # 대표 쓰기 벡터: 리다이렉트(>,>>), tee, sed -i, cp, mv, install, dd, truncate,
  # 그리고 node/python -e 로 파일 여는 우회.
  if echo "$command" | grep -Eq '(>|>>|\btee\b|\bsed\b[^|]*-i|\bcp\b|\bmv\b|\binstall\b|\bdd\b|\btruncate\b|\bnode\b[^|]*-e|\bpython3?\b[^|]*-c)'; then
    if echo "$command" | grep -Eq '(^|[^a-zA-Z0-9_./])agent/'; then
      # agent/ 를 건드리되 정책 파일만 대상인지 확인 — 정책 파일 경로만 등장하면 허용
      only_policy=1
      for tok in $(echo "$command" | grep -oE 'agent/[A-Za-z0-9._/-]+'); do
        rel="$(normalize "$tok")"
        if [[ "$rel" == agent/* ]] && ! is_policy "$rel"; then only_policy=0; break; fi
      done
      [[ "$only_policy" -eq 0 ]] && deny "Bash가 실행 하네스(agent/**)에 쓰기를 시도. src/** 또는 정책 파일만 허용."
    fi
    # 사람 소유 문서(README 등)로의 쓰기 리다이렉트도 같은 벡터로 차단.
    for f in "${HUMAN_DOC_FILES[@]}"; do
      if echo "$command" | grep -Eq "(^|[^a-zA-Z0-9_./])(\./)?${f}(\$|[^a-zA-Z0-9_.-])"; then
        deny "Bash가 사람 소유 문서 '$f' 에 쓰기를 시도. 이 문서는 수정 금지."
      fi
    done
  fi
  exit 0
fi

# 그 외 도구는 통과
exit 0

/// <reference types="node" />
/**
 * 결정론적 수치 검증 모음.
 *
 * REVIEW_CHECKLIST.md 의 [코드 수치 검증] 항목을 LLM 대신 코드로 수행한다.
 * - LLM 산술 오류 제거
 * - Reviewer 토큰 절감
 * - 회귀 테스트로도 활용 가능
 *
 * 한계: 정적 위치/상수 검증만 가능. body undulation 중 동적으로 벌어지는
 * 시각적 gap은 잡지 못한다 (그건 Reviewer 시각 검증 영역).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface CheckResult {
  name: string;
  ok: boolean;
  reason?: string;
  severity: "fail" | "warn";
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** 정규식 1개 캡처에서 숫자 추출. 못 찾으면 null. */
function extractNumber(src: string, re: RegExp): number | null {
  const m = src.match(re);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ── WhaleShark 지느러미 접합 위치 ────────────────────────────────────────────

/** 가슴지느러미 X 위치 vs 몸체 X 반지름(2.1×1.1=2.31). gap ≤ 0.3 이어야 함. */
function checkPectoralPositionX(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  const x = extractNumber(src, /this\.leftPectoral\.position\.set\(\s*([-\d.]+)/);
  const target = 2.1 * 1.1;
  if (x === null) {
    return { name: "pectoral.position.x", ok: false, severity: "fail",
      reason: "leftPectoral.position.set 의 x값을 찾을 수 없음" };
  }
  const gap = Math.abs(x - target);
  return gap <= 0.3
    ? { name: "pectoral.position.x", ok: true, severity: "fail" }
    : { name: "pectoral.position.x", ok: false, severity: "fail",
        reason: `x=${x}, body radius×scale=${target.toFixed(2)}, gap=${gap.toFixed(2)} > 0.3` };
}

/** 가슴지느러미 rotation.x 가 ±π/2 근처여야 (수평 평면). |rot.x| ≥ 0.5 필수. */
function checkPectoralRotationX(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  // leftPectoral.rotation.set(rotX, rotY, rotZ)
  const m = src.match(/this\.leftPectoral\.rotation\.set\(\s*([^,]+),/);
  if (!m) {
    return { name: "pectoral.rotation.x", ok: false, severity: "fail",
      reason: "leftPectoral.rotation.set 의 rotation.x 표현을 찾을 수 없음" };
  }
  const expr = m[1].trim();
  // -Math.PI / 2, Math.PI / 2, ±π/2 등 패턴 통과. 0 또는 작은 리터럴이면 실패.
  const numLit = parseFloat(expr);
  if (Number.isFinite(numLit) && Math.abs(numLit) < 0.5) {
    return { name: "pectoral.rotation.x", ok: false, severity: "fail",
      reason: `rotation.x=${numLit}, |x| < 0.5 → 가슴지느러미가 수직 평면(막대기처럼 보임)` };
  }
  if (!/Math\.PI\s*\/\s*2/.test(expr)) {
    return { name: "pectoral.rotation.x", ok: false, severity: "warn",
      reason: `rotation.x="${expr}" — Math.PI/2 표현이 아님, 시각 검증 필요` };
  }
  return { name: "pectoral.rotation.x", ok: true, severity: "fail" };
}

/** 등지느러미 rotation.y 가 음수(-π/2 계열)여야 함. 양수면 앞으로 젖혀짐. */
function checkDorsalRotationYSign(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  const m = src.match(/this\.dorsal\.rotation\.y\s*=\s*([^;]+);/);
  if (!m) {
    return { name: "dorsal.rotation.y sign", ok: false, severity: "fail",
      reason: "this.dorsal.rotation.y 초기 대입을 찾을 수 없음" };
  }
  const expr = m[1].trim();
  // 첫 번째 sign이 마이너스인지 확인. -Math.PI/2, -Math.PI / 2 등
  if (/^-\s*Math\.PI/.test(expr)) {
    return { name: "dorsal.rotation.y sign", ok: true, severity: "fail" };
  }
  return { name: "dorsal.rotation.y sign", ok: false, severity: "fail",
    reason: `rotation.y="${expr}" — 음수(-Math.PI/2 계열)가 아님 → 지느러미가 앞으로 젖혀짐` };
}

/** 꼬리지느러미 이중 회전 버그: tailGroup 자식 mesh 에 rotation.y 가 있으면 안 됨. */
function checkCaudalDoubleRotation(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  // createCaudalFin 영역만 추출 (다음 메서드 시작 전까지)
  const start = src.indexOf("createCaudalFin");
  if (start === -1) {
    return { name: "caudal double rotation", ok: false, severity: "fail",
      reason: "createCaudalFin 함수를 찾을 수 없음" };
  }
  const next = src.indexOf("\n  private ", start + 1);
  const region = src.slice(start, next === -1 ? src.length : next);
  // upperFin/lowerFin 등 mesh 변수명에 rotation.y 대입이 있으면 의심
  const offenders = region.match(/(upperFin|lowerFin|caudalFin)\.rotation\.y/g);
  if (offenders && offenders.length > 0) {
    return { name: "caudal double rotation", ok: false, severity: "fail",
      reason: `tailGroup 내부 mesh에 rotation.y 발견: ${offenders.join(", ")} — tailGroup 자체 회전과 합산되어 0이 됨` };
  }
  return { name: "caudal double rotation", ok: true, severity: "fail" };
}

// ── Boids 가중치 비율 ────────────────────────────────────────────────────────

/** FISH_ORBIT_WEIGHT ≤ BOID_SEPARATION_WEIGHT × 0.5 이어야 자연스러운 분산. */
function checkOrbitVsSeparationWeight(): CheckResult {
  const src = readSrc("src/utils/constants.ts");
  const orbit = extractNumber(src, /FISH_ORBIT_WEIGHT\s*=\s*([-\d.]+)/);
  const sep = extractNumber(src, /BOID_SEPARATION_WEIGHT\s*=\s*([-\d.]+)/);
  if (orbit === null || sep === null) {
    return { name: "FISH_ORBIT_WEIGHT vs SEPARATION", ok: false, severity: "fail",
      reason: `상수 추출 실패 (orbit=${orbit}, sep=${sep})` };
  }
  const limit = sep * 0.5;
  return orbit <= limit
    ? { name: "FISH_ORBIT_WEIGHT vs SEPARATION", ok: true, severity: "fail" }
    : { name: "FISH_ORBIT_WEIGHT vs SEPARATION", ok: false, severity: "fail",
        reason: `FISH_ORBIT_WEIGHT=${orbit} > SEPARATION×0.5=${limit.toFixed(2)} → 군집 밀집` };
}

/** BOID_SEPARATION_WEIGHT ≥ BOID_COHESION_WEIGHT × 3 이어야 함. */
function checkSeparationVsCohesion(): CheckResult {
  const src = readSrc("src/utils/constants.ts");
  const sep = extractNumber(src, /BOID_SEPARATION_WEIGHT\s*=\s*([-\d.]+)/);
  const coh = extractNumber(src, /BOID_COHESION_WEIGHT\s*=\s*([-\d.]+)/);
  if (sep === null || coh === null) {
    return { name: "SEPARATION vs COHESION", ok: false, severity: "fail",
      reason: `상수 추출 실패 (sep=${sep}, coh=${coh})` };
  }
  const ratio = coh === 0 ? Infinity : sep / coh;
  return ratio >= 3
    ? { name: "SEPARATION vs COHESION", ok: true, severity: "fail" }
    : { name: "SEPARATION vs COHESION", ok: false, severity: "fail",
        reason: `SEPARATION/COHESION=${ratio.toFixed(2)} < 3 → 응집 우세로 덩어리 형성` };
}

// ── 시각 효과 상수 ──────────────────────────────────────────────────────────

/** GOD_RAY_MAX_OPACITY > 0. 0이면 갓레이 비가시. */
function checkGodRayOpacity(): CheckResult {
  const src = readSrc("src/utils/constants.ts");
  const op = extractNumber(src, /GOD_RAY_MAX_OPACITY\s*=\s*([-\d.]+)/);
  if (op === null) {
    return { name: "GOD_RAY_MAX_OPACITY", ok: false, severity: "fail",
      reason: "상수를 찾을 수 없음" };
  }
  return op > 0
    ? { name: "GOD_RAY_MAX_OPACITY", ok: true, severity: "fail" }
    : { name: "GOD_RAY_MAX_OPACITY", ok: false, severity: "fail",
        reason: `opacity=${op} → 갓레이 비가시` };
}

// ── 반점 스케일 일치 ─────────────────────────────────────────────────────────

/** createSpots 의 X·Y multiplier가 body scale(1.1, 0.75) 과 일치해야 함. */
function checkSpotScale(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  // 메서드 선언만 찾기 (호출 사이트는 무시)
  const declMatch = src.match(/private\s+createSpots\s*\([^)]*\)[^{]*\{/);
  if (!declMatch || declMatch.index === undefined) {
    return { name: "createSpots scale", ok: false, severity: "fail",
      reason: "createSpots 메서드 선언을 찾을 수 없음" };
  }
  const start = declMatch.index;
  const next = src.indexOf("\n  private ", start + declMatch[0].length);
  const region = src.slice(start, next === -1 ? src.length : next);
  const hasX = /\*\s*1\.1\b/.test(region) || /1\.1\s*\*/.test(region);
  const hasY = /\*\s*0\.75\b/.test(region) || /0\.75\s*\*/.test(region);
  if (hasX && hasY) {
    return { name: "createSpots scale", ok: true, severity: "fail" };
  }
  return { name: "createSpots scale", ok: false, severity: "warn",
    reason: `createSpots 에 X×1.1·Y×0.75 multiplier 미검출 — 반점이 표면에서 떠 있을 수 있음 (시각 검증 필요)` };
}

// ── 통합 실행 ────────────────────────────────────────────────────────────────

const ALL_CHECKS: (() => CheckResult)[] = [
  checkPectoralPositionX,
  checkPectoralRotationX,
  checkDorsalRotationYSign,
  checkCaudalDoubleRotation,
  checkOrbitVsSeparationWeight,
  checkSeparationVsCohesion,
  checkGodRayOpacity,
  checkSpotScale,
];

export function runNumericChecks(): CheckResult[] {
  return ALL_CHECKS.map((fn) => {
    try {
      return fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { name: fn.name, ok: false, severity: "fail" as const, reason: `검사 실행 예외: ${msg}` };
    }
  });
}

export function summarizeChecks(results: CheckResult[]): string {
  const failed = results.filter((r) => !r.ok && r.severity === "fail");
  const warned = results.filter((r) => !r.ok && r.severity === "warn");
  const passed = results.filter((r) => r.ok);

  const lines: string[] = [];
  lines.push(`## 결정론적 코드 수치 검증 (LLM 미사용)`);
  lines.push(`- 통과: ${passed.length}/${results.length}`);
  if (failed.length > 0) {
    lines.push(`- 실패 ${failed.length}건:`);
    for (const r of failed) lines.push(`  - ${r.name}: ${r.reason}`);
  }
  if (warned.length > 0) {
    lines.push(`- 경고 ${warned.length}건:`);
    for (const r of warned) lines.push(`  - ${r.name}: ${r.reason}`);
  }
  if (failed.length === 0 && warned.length === 0) {
    lines.push(`- 모든 항목 정상`);
  }
  return lines.join("\n");
}

// CLI에서 단독 실행 가능 (디버그용): npx tsx agent/checks/numeric.ts
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const results = runNumericChecks();
  console.log(summarizeChecks(results));
  const hasFail = results.some((r) => !r.ok && r.severity === "fail");
  process.exit(hasFail ? 1 : 0);
}

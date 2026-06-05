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

/**
 * 가슴지느러미 X 위치 검증.
 * 실제 구현: leftPectoralGroup.position.set(this.pectoralBaseX, ...) 로 변수 참조.
 * pectoralBaseX는 의도적으로 body 반지름(2.31)보다 안쪽이며(gap-hiding, WhaleShark.ts 주석),
 * shape의 최대 X extent로 fin tip이 body 바깥까지 충분히 뻗는지를 §3 규칙대로 판정한다.
 *   group.position.x + shape_max_x > body_radius(2.31) 이면 tip 노출 → 통과.
 */
function checkPectoralPositionX(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  const bodyRadius = 2.1 * 1.1; // 2.31

  // group.position.set(...) 의 x — 리터럴 또는 this.pectoralBaseX 변수 참조 모두 해석
  let baseX = extractNumber(
    src, /this\.leftPectoralGroup\.position\.set\(\s*([-\d.]+)/);
  if (baseX === null) {
    const refMatch = src.match(
      /this\.leftPectoralGroup\.position\.set\(\s*this\.(\w+)/);
    if (refMatch) {
      baseX = extractNumber(
        src, new RegExp(`${refMatch[1]}\\s*=\\s*([-\\d.]+)`));
    }
  }
  if (baseX === null) {
    return { name: "pectoral.position.x", ok: false, severity: "fail",
      reason: "leftPectoralGroup.position.set 의 x(리터럴/변수) 값을 찾을 수 없음" };
  }

  // shape 정의에서 최대 X extent 추출 (moveTo/quadraticCurveTo/lineTo 의 X 좌표들)
  const shapeStart = src.indexOf("const shape = new THREE.Shape()");
  const shapeEnd = src.indexOf("ExtrudeGeometryOptions", shapeStart);
  const shapeRegion = shapeStart === -1 ? "" : src.slice(shapeStart, shapeEnd);
  const xs: number[] = [];
  for (const m of shapeRegion.matchAll(/(?:moveTo|lineTo)\(\s*([-\d.]+)/g)) xs.push(parseFloat(m[1]));
  // quadraticCurveTo(cx, cy, x, y) — 제어점·끝점 X 모두 후보
  for (const m of shapeRegion.matchAll(/quadraticCurveTo\(\s*([-\d.]+)\s*,\s*[-\d.]+\s*,\s*([-\d.]+)/g)) {
    xs.push(parseFloat(m[1]), parseFloat(m[2]));
  }
  const shapeMaxX = xs.length ? Math.max(...xs) : null;
  if (shapeMaxX === null) {
    return { name: "pectoral.position.x", ok: false, severity: "warn",
      reason: `baseX=${baseX} 확인됐으나 shape X extent 파싱 불가 — 시각 검증 필요` };
  }

  const tipReach = Math.abs(baseX) + shapeMaxX;
  return tipReach > bodyRadius
    ? { name: "pectoral.position.x", ok: true, severity: "fail" }
    : { name: "pectoral.position.x", ok: false, severity: "fail",
        reason: `tipReach=|${baseX}|+${shapeMaxX}=${tipReach.toFixed(2)} ≤ body radius=${bodyRadius.toFixed(2)} → fin tip이 몸통 밖으로 안 나옴` };
}

/**
 * 가슴지느러미 수평 전개 검증.
 * 실제 구현은 mesh.rotation.x 가 아니라 **geometry 레벨** `leftGeo.rotateX(±π/2)` 로
 * shape(XY평면)을 XZ 수평 평면(날개 방향)에 눕힌다. createPectoralFins() 영역에서
 * `<geo>.rotateX(±Math.PI/2)` 호출을 찾는다. 없으면 fin이 수직 막대로 보일 위험.
 */
function checkPectoralRotationX(): CheckResult {
  const src = readSrc("src/entities/WhaleShark.ts");
  const start = src.indexOf("createPectoralFins");
  if (start === -1) {
    return { name: "pectoral.rotation.x", ok: false, severity: "fail",
      reason: "createPectoralFins 함수를 찾을 수 없음" };
  }
  const next = src.indexOf("\n  private ", start + 1);
  const region = src.slice(start, next === -1 ? src.length : next);

  // geometry 레벨 수평 눕힘: Geo.rotateX(±Math.PI/2)
  if (/\w+\.rotateX\(\s*-?\s*Math\.PI\s*\/\s*2\s*\)/.test(region)) {
    return { name: "pectoral.rotation.x", ok: true, severity: "fail" };
  }
  // 대체 구현: mesh/group 의 rotation.x = ±π/2 (구버전 호환)
  const rotMatch = region.match(/\.rotation\.x\s*=\s*([^;]+);/);
  if (rotMatch) {
    const expr = rotMatch[1].trim();
    const numLit = parseFloat(expr);
    if (Number.isFinite(numLit) && Math.abs(numLit) < 0.5) {
      return { name: "pectoral.rotation.x", ok: false, severity: "fail",
        reason: `rotation.x=${numLit}, |x| < 0.5 → 가슴지느러미가 수직 평면(막대기)` };
    }
    if (/Math\.PI\s*\/\s*2/.test(expr)) {
      return { name: "pectoral.rotation.x", ok: true, severity: "fail" };
    }
  }
  return { name: "pectoral.rotation.x", ok: false, severity: "warn",
    reason: "createPectoralFins 에서 geometry.rotateX(±π/2) 또는 rotation.x=±π/2 패턴 미검출 — 시각 검증 필요" };
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

// ── FishSchool 궤도 다양성 ───────────────────────────────────────────────────

/** Fish.ts 에 orbitPaths(복수형, CatmullRomCurve3[]) 필드가 선언되어 있어야 함. 단일 경로 공유면 fail. */
function checkOrbitPathsArrayExists(): CheckResult {
  const src = readSrc("src/entities/Fish.ts");
  if (/private\s+readonly\s+orbitPaths/.test(src) ||
      /orbitPaths\s*:\s*THREE\.CatmullRomCurve3\[\]/.test(src) ||
      /orbitPaths\s*=\s*this\.schoolDefs\.map/.test(src)) {
    return { name: "Fish.orbitPaths array", ok: true, severity: "fail" };
  }
  return { name: "Fish.orbitPaths array", ok: false, severity: "fail",
    reason: "orbitPaths(CatmullRomCurve3[]) 필드/초기화 미검출 — 단일 경로 공유로 씬 단조로움 위험" };
}

/** schoolDefs 의 (cx,cz) 좌표 중 하나라도 원점에서 5 초과 거리여야 함. 전부 5 이하면 원점 집중. */
function checkOrbitCentersSpread(): CheckResult {
  const src = readSrc("src/entities/Fish.ts");
  // schoolDefs 리터럴 영역만 추출 (buildOrbitPath 이전까지)
  const defsStart = src.indexOf("this.schoolDefs = [");
  const defsEnd = src.indexOf("this.orbitPaths =", defsStart);
  if (defsStart === -1 || defsEnd === -1) {
    return { name: "Fish.orbitCenters spread", ok: false, severity: "warn",
      reason: "schoolDefs 리터럴 또는 this.orbitPaths 초기화를 찾을 수 없음 — 시각 검증 필요" };
  }
  const region = src.slice(defsStart, defsEnd);
  // [cx, cz, ...] 형태에서 첫 두 숫자 추출
  const distances: number[] = [];
  for (const m of region.matchAll(/\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/g)) {
    const cx = parseFloat(m[1]);
    const cz = parseFloat(m[2]);
    distances.push(Math.sqrt(cx * cx + cz * cz));
  }
  if (distances.length === 0) {
    return { name: "Fish.orbitCenters spread", ok: false, severity: "warn",
      reason: "schoolDefs 에서 (cx,cz) 좌표를 파싱할 수 없음 — 시각 검증 필요" };
  }
  const anyFar = distances.some((d) => d > 5);
  return anyFar
    ? { name: "Fish.orbitCenters spread", ok: true, severity: "fail" }
    : { name: "Fish.orbitCenters spread", ok: false, severity: "fail",
        reason: `모든 궤도 중심이 원점 5 이내 (${distances.map((d) => d.toFixed(1)).join(", ")}) — 씬 단조로움` };
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
  checkOrbitPathsArrayExists,
  checkOrbitCentersSpread,
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

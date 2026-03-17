// Shared simple pose helpers for single-figure joint maps

export function basePose(x = 0, y = 0, z = 0) {
  return {
    head: [x, y + 1.7, z],
    neck: [x, y + 1.55, z],
    shoulderL: [x - 0.2, y + 1.5, z],
    shoulderR: [x + 0.2, y + 1.5, z],
    elbowL: [x - 0.4, y + 1.3, z],
    elbowR: [x + 0.4, y + 1.3, z],
    handL: [x - 0.45, y + 1.0, z],
    handR: [x + 0.45, y + 1.0, z],
    hipL: [x - 0.15, y + 1.0, z],
    hipR: [x + 0.15, y + 1.0, z],
    kneeL: [x - 0.15, y + 0.55, z],
    kneeR: [x + 0.15, y + 0.55, z],
    footL: [x - 0.15, y + 0.05, z],
    footR: [x + 0.15, y + 0.05, z]
  };
}

export function lyingOnBack(x = 0, y = 0, z = 0) {
  const torsoZ = 0.5;
  const neckZ = torsoZ + 0.12;
  const headZ = torsoZ + 0.26;
  const yBase = y + 0.06;
  return {
    head: [x, yBase + 0.10, z + headZ],
    neck: [x, yBase + 0.08, z + neckZ],
    shoulderL: [x - 0.2, yBase + 0.06, z + torsoZ],
    shoulderR: [x + 0.2, yBase + 0.06, z + torsoZ],
    elbowL: [x - 0.28, yBase + 0.05, z + 0.32],
    elbowR: [x + 0.28, yBase + 0.05, z + 0.32],
    handL: [x - 0.35, yBase + 0.03, z + 0.20],
    handR: [x + 0.35, yBase + 0.03, z + 0.20],
    hipL: [x - 0.15, yBase + 0.04, z],
    hipR: [x + 0.15, yBase + 0.04, z],
    kneeL: [x - 0.15, yBase + 0.12, z + 0.22],
    kneeR: [x + 0.15, yBase + 0.12, z + 0.22],
    footL: [x - 0.15, yBase + 0.02, z + 0.40],
    footR: [x + 0.15, yBase + 0.02, z + 0.40]
  };
}

export function lyingOnSide(x = 0, y = 0, z = 0) {
  const torsoZ = 0.46;
  const yBase = y + 0.06;
  return {
    head: [x + 0.04, yBase + 0.10, z + 0.60],
    neck: [x + 0.04, yBase + 0.08, z + 0.52],
    shoulderL: [x - 0.18, yBase + 0.06, z + torsoZ],
    shoulderR: [x + 0.18, yBase + 0.06, z + (torsoZ - 0.04)],
    elbowL: [x - 0.22, yBase + 0.05, z + 0.34],
    elbowR: [x + 0.22, yBase + 0.05, z + 0.34],
    handL: [x - 0.26, yBase + 0.03, z + 0.20],
    handR: [x + 0.26, yBase + 0.03, z + 0.20],
    hipL: [x - 0.15, yBase + 0.04, z],
    hipR: [x + 0.15, yBase + 0.04, z],
    kneeL: [x - 0.15, yBase + 0.12, z + 0.18],
    kneeR: [x + 0.15, yBase + 0.12, z + 0.18],
    footL: [x - 0.15, yBase + 0.02, z + 0.36],
    footR: [x + 0.15, yBase + 0.02, z + 0.36]
  };
}


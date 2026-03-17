import { lyingOnSide, basePose } from "./util.js";
import kneeShieldPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-kneeShield.json";

// No bundled JSON provided; define a reasonable static builder
export default function kneeShield(x = 0, y = -0.02, z = 0) {
  if (kneeShieldPreset?.A?.joints) return kneeShieldPreset.A.joints;
  const A = lyingOnSide(x, y, z);
  // Light adjustments to create a shield-like position
  const hipCY = (A.hipL[1] + A.hipR[1]) / 2;
  A.hipL[1] = hipCY; A.hipR[1] = hipCY;
  A.kneeL = [A.kneeL[0] - 0.06, hipCY + 0.28, A.kneeL[2] + 0.16];
  A.footL = [A.footL[0] - 0.04, hipCY + 0.02, A.footL[2] + 0.24];
  A.kneeR = [A.kneeR[0] + 0.02, hipCY + 0.08, A.kneeR[2] + 0.10];
  A.footR = [A.footR[0] + 0.02, hipCY + 0.02, A.footR[2] + 0.16];
  return A;
}

export function forB() {
  if (kneeShieldPreset?.B?.joints) return kneeShieldPreset.B.joints;
  return basePose(0.7, 0, 0.7);
}

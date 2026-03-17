import openGuardPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-openGuard.json";
import neutralPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-neutral.json";
import { lyingOnBack, basePose } from "./util.js";

export default function openGuard(x = 0, y = -0.05, z = 0) {
  if (openGuardPreset?.A?.joints) return openGuardPreset.A.joints;
  // Fallback approximation
  const A = lyingOnBack(x, y, z);
  const hipCAz = (A.hipL[2] + A.hipR[2]) / 2;
  A.kneeL = [A.hipL[0], A.hipL[1] + 0.28, hipCAz + 0.16];
  A.kneeR = [A.hipR[0], A.hipR[1] + 0.28, hipCAz + 0.16];
  A.footL[2] = hipCAz + 0.26; A.footR[2] = hipCAz + 0.26;
  return A;
}

export function forB() {
  if (openGuardPreset?.B?.joints) return openGuardPreset.B.joints;
  if (neutralPreset?.B?.joints) return neutralPreset.B.joints;
  return basePose(0.7, 0, 0.7);
}

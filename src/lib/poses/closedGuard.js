import closedGuardPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-closedGuard.json";
import neutralPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-neutral.json";
import { lyingOnBack, basePose } from "./util.js";

export default function closedGuard(x = 0, y = -0.02, z = 0) {
  if (closedGuardPreset?.A?.joints) return closedGuardPreset.A.joints;
  const A = lyingOnBack(x, y, z);
  const hipCX = (A.hipL[0] + A.hipR[0]) / 2;
  const hipCZ = (A.hipL[2] + A.hipR[2]) / 2;
  A.kneeL = [hipCX - 0.18, A.hipL[1] + 0.26, hipCZ + 0.06];
  A.kneeR = [hipCX + 0.18, A.hipR[1] + 0.26, hipCZ + 0.06];
  A.footL = [hipCX - 0.12, A.hipL[1] - 0.06, hipCZ + 0.12];
  A.footR = [hipCX + 0.12, A.hipR[1] - 0.06, hipCZ + 0.12];
  return A;
}

export function forB() {
  if (closedGuardPreset?.B?.joints) return closedGuardPreset.B.joints;
  if (neutralPreset?.B?.joints) return neutralPreset.B.joints;
  return basePose(0.7, 0, 0.7);
}

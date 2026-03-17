import neutralPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-neutral.json";
import { basePose } from "./util.js";

// Yellow figure (default)
export default function neutral(x = 0, y = 0, z = 0) {
  if (neutralPreset?.A?.joints) return neutralPreset.A.joints;
  const A = basePose(x, y, z);
  A.handL[1] += 0.05; A.handR[1] += 0.05;
  return A;
}

// Orange figure variant
export function forB(x = 0.7, y = 0, z = 0.7) {
  if (neutralPreset?.B?.joints) return neutralPreset.B.joints;
  const B = basePose(x, y, z);
  B.handL[1] += 0.05; B.handR[1] += 0.05;
  return B;
}

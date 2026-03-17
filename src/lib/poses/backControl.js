import backControlPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-backControl.json";
import { basePose } from "./util.js";

export default function backControl(x = 0, y = -0.03, z = 0) {
  if (backControlPreset?.A?.joints) return backControlPreset.A.joints;
  // Fallback: reclined baseline
  const A = basePose(x, y, z);
  return A;
}

export function forB() {
  if (backControlPreset?.B?.joints) return backControlPreset.B.joints;
  // Behind A with light hooks approximation
  const B = basePose(-0.02, 0, -0.30);
  return B;
}

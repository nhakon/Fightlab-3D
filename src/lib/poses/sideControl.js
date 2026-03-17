import sideControlPreset from "../../routes/fightlab3d/figures/jiu-jitsu-assets/pose-sideControl.json";
import { lyingOnSide, basePose } from "./util.js";

export default function sideControl(x = 0, y = -0.03, z = 0) {
  if (sideControlPreset?.A?.joints) return sideControlPreset.A.joints;
  // Fallback: side-lying approximation
  return lyingOnSide(x, y, z);
}

export function forB() {
  if (sideControlPreset?.B?.joints) return sideControlPreset.B.joints;
  return basePose(0.3, 0.0, 0.1);
}

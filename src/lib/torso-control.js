import { Quaternion, Vector3 } from 'three';

// Meshy's spine runs from Spine02 at the pelvis to Spine at the chest.
export function torsoBones(rig) {
  return ['Spine02', 'Spine01', 'Spine']
    .map(name => rig?.object?.getObjectByName(name)).filter(bone => bone?.isBone);
}

export function torsoMarkerVisible(handle, mode, active = false, highlight = true) {
  if (!torsoHandleSelectable(handle, mode)) return false;
  if (active && highlight) return true;
  if (mode === 'hidden') return false;
  if (mode === 'all' || handle.userData.torsoControl) return true;
  return /^(hips|pelvis)$/.test(handle.userData.bone?.name?.toLowerCase() || '');
}

export function torsoHandleSelectable(handle, mode) {
  if (handle.userData.torsoControl) return true;
  const name = handle.userData.bone?.name?.toLowerCase() || '';
  // Marker modes change visibility, never which control a drag selects.
  return !/spine|headfront|chin|twist|end|nub|^(left|right)shoulder$/.test(name);
}

export function captureTorsoDrag(rig, mode = 'bend') {
  const bones = torsoBones(rig);
  if (!bones.length) return null;
  rig.object.updateMatrixWorld(true);
  const parent = bones[0].parent;
  const parentInverse = parent.getWorldQuaternion(new Quaternion()).invert();
  const chest = bones.at(-1);
  const left = rig.object.getObjectByName('LeftShoulder');
  const right = rig.object.getObjectByName('RightShoulder');
  const chestRotation = chest.getWorldQuaternion(new Quaternion());
  const up = chest.getWorldPosition(new Vector3()).sub(bones[0].getWorldPosition(new Vector3()));
  if (up.lengthSq() < 1e-10) up.set(0, 1, 0).applyQuaternion(chestRotation);
  up.normalize();
  const side = left && right
    ? right.getWorldPosition(new Vector3()).sub(left.getWorldPosition(new Vector3()))
    : new Vector3(1, 0, 0).applyQuaternion(chestRotation);
  side.addScaledVector(up, -side.dot(up));
  if (side.lengthSq() < 1e-10) side.set(1, 0, 0).applyQuaternion(chestRotation).projectOnPlane(up);
  if (side.lengthSq() < 1e-10) side.set(0, 0, 1).applyQuaternion(chestRotation).projectOnPlane(up);
  side.normalize();
  const forward = new Vector3().crossVectors(side, up).normalize();
  const weights = { Spine02: 0.35, Spine01: 0.4, Spine: 0.25 };
  const total = bones.reduce((sum, bone) => sum + weights[bone.name], 0);
  let cumulative = 0;
  return {
    rig, parent,
    side: side.applyQuaternion(parentInverse),
    up: up.applyQuaternion(parentInverse),
    forward: forward.applyQuaternion(parentInverse),
    // Lean rotates only the spine root: every joint above it keeps its pose.
    joints: (mode === 'lean' ? bones.slice(0, 1) : bones).map(bone => ({
      bone,
      local: bone.quaternion.clone(),
      relative: bone.getWorldQuaternion(new Quaternion()).premultiply(parentInverse),
      weight: mode === 'lean' ? 1 : (cumulative += weights[bone.name] / total)
    }))
  };
}

// Angles are measured from the gesture's starting pose, so retracing a drag
// restores that pose regardless of pointer-event frequency or previous bends.
export function applyTorsoDrag(state, { pitch = 0, side = 0, twist = 0 } = {}) {
  if (!state || ![pitch, side, twist].every(Number.isFinite)) return false;
  const parentRotation = state.parent.getWorldQuaternion(new Quaternion());
  const rotation = state.side.clone().multiplyScalar(pitch)
    .addScaledVector(state.forward, side).addScaledVector(state.up, twist)
    .applyQuaternion(parentRotation);
  const angle = rotation.length();
  if (angle > 0) rotation.divideScalar(angle);
  for (const joint of state.joints) {
    if (angle === 0) joint.bone.quaternion.copy(joint.local);
    else {
      const desired = joint.relative.clone().premultiply(parentRotation)
        .premultiply(new Quaternion().setFromAxisAngle(rotation, angle * joint.weight));
      const inverseParent = joint.bone.parent.getWorldQuaternion(new Quaternion()).invert();
      joint.bone.quaternion.copy(desired.premultiply(inverseParent)).normalize();
    }
    joint.bone.updateMatrixWorld(true);
  }
  return true;
}

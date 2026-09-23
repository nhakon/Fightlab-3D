import { Quaternion, Vector3 } from 'three';

// Rotate the selected bone, never its parent. Descendants retain their local pose.
export function captureJointPivot(rig, bone, camera) {
  rig.object.updateMatrixWorld(true);
  const parentInverse = bone.parent.getWorldQuaternion(new Quaternion()).invert();
  const view = camera.getWorldQuaternion(new Quaternion());
  let hinge = null;
  let minBend = -Infinity, maxBend = Infinity;
  if (/^(Left|Right)(ForeArm|Leg)$/.test(bone.name)) {
    const child = bone.children.find(node => node.isBone);
    const incoming = rig.bindPositions.get(bone);
    const outgoing = rig.bindPositions.get(child);
    const bind = rig.bindQuaternions.get(bone);
    if (incoming && outgoing && bind) {
      hinge = incoming.clone().cross(outgoing.clone().applyQuaternion(bind));
      if (hinge.lengthSq() < 1e-12) hinge.set(1, 0, 0);
      else hinge.normalize().applyQuaternion(bind.clone().invert());
      const restBend = incoming.angleTo(outgoing.clone().applyQuaternion(bind));
      const relative = bind.clone().invert().multiply(bone.quaternion).normalize();
      if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
      const bend = restBend + 2 * Math.atan2(new Vector3(relative.x, relative.y, relative.z).dot(hinge), relative.w);
      // Stop at straight or fully folded without disturbing an existing unusual pose.
      minBend = -Math.max(0, bend);
      maxBend = Math.max(0, Math.PI - .08 - bend);
    }
  }
  const origin=bone.getWorldPosition(new Vector3());
  const child=bone.children.find(n=>n.isBone);
  const tip=child?child.getWorldPosition(new Vector3()):origin.clone().add(new Vector3(0,.15,0).applyQuaternion(bone.getWorldQuaternion(new Quaternion())));
  return { origin, tip, parentInverse, world:bone.getWorldQuaternion(new Quaternion()), bone, initial: bone.quaternion.clone(), hinge, minBend, maxBend,
    right: new Vector3(1, 0, 0).applyQuaternion(view).applyQuaternion(parentInverse),
    up: new Vector3(0, 1, 0).applyQuaternion(view).applyQuaternion(parentInverse) };
}

export function applyJointPivot(state, dx, dy) {
  if (!state || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  const { bone, initial, hinge, right, up } = state;
  bone.quaternion.copy(initial);
  if (hinge) {
    bone.quaternion.multiply(new Quaternion().setFromAxisAngle(hinge, Math.max(state.minBend, Math.min(state.maxBend, (dx - dy) * .006))));
  } else {
    const rotation = right.clone().multiplyScalar(-dy * .006).addScaledVector(up, dx * .006);
    const angle = rotation.length();
    if (angle) bone.quaternion.premultiply(new Quaternion().setFromAxisAngle(rotation.divideScalar(angle), angle));
  }
  bone.updateMatrixWorld(true);
  return true;
}

export function applyJointPivotTarget(state, target) {
  const from=state.tip.clone().sub(state.origin),to=state.tip.clone().add(target.clone().sub(state.origin)).sub(state.origin);
  if(from.lengthSq()<1e-12||to.lengthSq()<1e-12)return false;
  if(state.hinge){
    const axis=state.hinge.clone().applyQuaternion(state.world).normalize();
    from.addScaledVector(axis,-from.dot(axis));to.addScaledVector(axis,-to.dot(axis));
    if(from.lengthSq()<1e-12||to.lengthSq()<1e-12)return false;
    from.normalize();to.normalize();
    return applyJointPivot(state,Math.atan2(axis.dot(from.clone().cross(to)),from.dot(to))/.006,0);
  }
  const delta=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
  state.bone.quaternion.copy(state.parentInverse).multiply(delta).multiply(state.world);
  state.bone.updateMatrixWorld(true);return true;
}

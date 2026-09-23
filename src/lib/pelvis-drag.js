import { Vector3, Quaternion, MathUtils } from 'three';

export const isPelvisDragJoint = (bone) => /^(Left|Right)UpLeg$/.test(bone?.name || '');
const position = (bone) => bone.getWorldPosition(new Vector3());
const rotation = (bone) => bone.getWorldQuaternion(new Quaternion());
const smooth = (low, high, value) => MathUtils.smoothstep(value, low, high);
// An anatomical axis in bone coordinates, not a previous gesture's direction.
// It survives straightening and is unaffected by pose undo/restoration.
const kneeBendAxes = new WeakMap();

function restKneeAxis(rig, knee, foot) {
  if (kneeBendAxes.has(knee)) return kneeBendAxes.get(knee);
  const upper = rig.bindPositions?.get(knee);
  const lower = rig.bindPositions?.get(foot);
  const jointRotation = rig.bindQuaternions?.get(knee);
  if (!upper || !lower || !jointRotation) return null;
  const axis = lower.clone().applyQuaternion(jointRotation).cross(upper);
  if (axis.lengthSq() < upper.lengthSq() * lower.lengthSq() * 1e-10) return null;
  axis.normalize().applyQuaternion(jointRotation.clone().invert());
  kneeBendAxes.set(knee, axis);
  return axis;
}

function perpendicular(direction, preferred) {
  const result = preferred.clone().addScaledVector(direction, -preferred.dot(direction));
  if (result.lengthSq() < 1e-12) {
    const fallback = Math.abs(direction.y) < 0.8 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    result.copy(fallback).addScaledVector(direction, -fallback.dot(direction));
  }
  return result.normalize();
}

// Capture contact preferences once per gesture. Hip motion stays authoritative;
// the lower body yields continuously when its preferred contacts are unreachable.
export function capturePelvisDrag(rig, selected, floorY = 0) {
  if (!isPelvisDragJoint(selected) || !rig?.object) return null;
  rig.object.updateMatrixWorld(true);
  const hips = rig.object.getObjectByName('Hips');
  if (!hips) return null;
  const legs = [];
  for (const side of ['Left', 'Right']) {
    const thigh = rig.object.getObjectByName(`${side}UpLeg`);
    const knee = rig.object.getObjectByName(`${side}Leg`);
    const foot = rig.object.getObjectByName(`${side}Foot`);
    if (!thigh || knee?.parent !== thigh || foot?.parent !== knee) return null;
    const hipStart = position(thigh), kneeStart = position(knee), footStart = position(foot);
    const upperLength = hipStart.distanceTo(kneeStart), lowerLength = kneeStart.distanceTo(footStart);
    if (Math.min(upperLength, lowerLength) < 1e-8) return null;
    const size = upperLength + lowerLength;
    const toe = rig.object.getObjectByName(`${side}ToeBase`);
    const footHeight = Math.min(footStart.y, toe ? position(toe).y : footStart.y);
    const footContact = 1 - smooth(size * 0.08, size * 0.22, footHeight - floorY);
    const kneeContact = 1 - smooth(size * 0.08, size * 0.22, kneeStart.y - floorY);
    const uprightThigh = smooth(0.25, 0.75, (hipStart.y - kneeStart.y) / upperLength);
    const horizontalShin = 1 - smooth(0.2, 0.65, Math.abs(footStart.y - kneeStart.y) / lowerLength);
    // Low knees, horizontal shins and hips above the knees suggest kneeling.
    // Seated/butterfly legs have outward thighs, so their feet take precedence.
    const kneePreference = kneeContact * uprightThigh * horizontalShin;
    const reachDirection = footStart.clone().sub(hipStart);
    if (reachDirection.lengthSq() < 1e-12) reachDirection.copy(kneeStart).sub(hipStart);
    reachDirection.normalize();
    const bend = kneeStart.clone().sub(hipStart);
    bend.addScaledVector(reachDirection, -bend.dot(reachDirection));
    const restAxis = restKneeAxis(rig, knee, foot);
    // A straight leg has no geometric bend plane. Recover its anatomical
    // axis; the foot is only a fallback for rigs without a known rest axis.
    if (bend.lengthSq() < size * size * 1e-10) {
      if (restAxis) bend.copy(restAxis).applyQuaternion(rotation(knee)).cross(reachDirection);
      else bend.copy(toe ? position(toe).sub(footStart) : new Vector3(0, 0, 1).applyQuaternion(rotation(hips)));
    }
    const pole = perpendicular(reachDirection, bend);
    // Almost straight knees provide a weak bend direction: a few millimetres
    // of sideways offset can otherwise become a large splay when sitting.
    // Use the foot's forward track for that case, keeping the authored offset
    // as a distance rather than multiplying it by the growing bend radius.
    // Clearly bent poses keep their own plane, including butterfly's flare.
    const bendOffset = kneeStart.clone().sub(hipStart);
    bendOffset.addScaledVector(reachDirection, -bendOffset.dot(reachDirection));
    const forward = toe ? position(toe).sub(footStart) : pole.clone();
    const forwardPole = perpendicular(reachDirection, forward);
    const trackWeight = (1 - smooth(0.06, 0.2, bendOffset.length() / size))
      * smooth(0, 0.5, pole.dot(forwardPole));
    const normal = new Vector3().crossVectors(reachDirection, pole).normalize();
    if (!restAxis) kneeBendAxes.set(knee, normal.clone().applyQuaternion(rotation(knee).invert()));
    const up = new Vector3(0, 1, 0).applyQuaternion(rotation(rig.object));
    const forwardNormal = new Vector3().crossVectors(perpendicular(up, forward), up).normalize();
    if (forwardNormal.dot(normal) < 0) forwardNormal.negate();
    const lineNormal = normal.clone().lerp(forwardNormal, trackWeight).normalize();
    const linePole = new Vector3().crossVectors(lineNormal, reachDirection).normalize();
    const lineSide = new Vector3().crossVectors(reachDirection, linePole).normalize();
    const lineOffset = bendOffset.dot(lineSide);
    const foldedAtStart = 1 - smooth(Math.abs(upperLength - lowerLength) + size * 0.03, Math.abs(upperLength - lowerLength) + size * 0.2, hipStart.distanceTo(footStart));
    const foldReference = linePole.clone().lerp(kneeStart.clone().sub(hipStart).normalize(), foldedAtStart).normalize();
    // Capture both authored segment rotations against the same hinge axis.
    // Aiming just the child leaves axial twist unconstrained on a skinned rig.
    const frames = [[thigh, knee], [knee, foot]].map(([bone, child]) => {
      const world = rotation(bone);
      return {
        bone, world,
        direction: position(child).sub(position(bone)).normalize(),
        normal: normal.clone()
      };
    });
    legs.push({
      thigh, knee, foot, hipStart, kneeStart, footStart, upperLength, lowerLength,
      kneePreference, footResistance: Math.max(0.75, footContact, kneePreference),
      frames, normal, reachDirection, linePole, lineOffset,
      lineNormal, lineRadius: bendOffset.length(),
      foldReference, footRotation: rotation(foot),
      locals: [thigh, knee, foot].map((bone) => ({ bone, quaternion: bone.quaternion.clone() }))
    });
  }
  return { rig, hips, origin: position(hips), selectedStart: position(selected), legs };
}

function setWorldRotation(bone, world) {
  const parent = bone.parent ? rotation(bone.parent) : new Quaternion();
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

function orientSegment(frame, target, normal) {
  const direction = target.clone().sub(position(frame.bone)).normalize();
  const swing = new Quaternion().setFromUnitVectors(frame.direction, direction);
  const swungNormal = frame.normal.clone().applyQuaternion(swing);
  const desiredNormal = perpendicular(direction, normal);
  const twist = Math.atan2(
    new Vector3().crossVectors(swungNormal, desiredNormal).dot(direction),
    swungNormal.dot(desiredNormal)
  );
  const world = new Quaternion().setFromAxisAngle(direction, twist).multiply(swing).multiply(frame.world);
  setWorldRotation(frame.bone, world);
}

function transportedPole(leg, direction, planeWeight) {
  // Keep the starting plane's orientation wherever the current reach allows
  // it. Project its normal, not its forward direction: a knee must rise when
  // sitting back, rather than turn sideways as the reach becomes horizontal.
  // Where the plane is ambiguous, transport from the captured pose. Every
  // target is evaluated independently of previous mouse events.
  const reference = leg.linePole.clone().applyQuaternion(new Quaternion().setFromUnitVectors(leg.reachDirection, direction));
  const projectedNormal = leg.lineNormal.clone().addScaledVector(direction, -leg.lineNormal.dot(direction));
  const planeConfidence = smooth(0.01, 0.16, projectedNormal.lengthSq()) * planeWeight;
  if (planeConfidence > 0) {
    const tracked = new Vector3().crossVectors(projectedNormal.normalize(), direction).normalize();
    if (tracked.dot(reference) < 0) tracked.negate();
    reference.lerp(tracked, planeConfidence).normalize();
  }
  return reference;
}

function solveLeg(leg, hip, delta) {
  const maxReach = leg.upperLength + leg.lowerLength;
  // Preserve reachable support instead of pulling the feet toward the hips
  // merely because the pointer has travelled far. Unreachable and completely
  // folded legs can still yield below, so hip travel remains unrestricted.
  const footAnchor = leg.footStart.clone().addScaledVector(delta, 1 - leg.footResistance);
  const towardKnee = leg.kneeStart.clone().sub(hip);
  if (towardKnee.lengthSq() < 1e-12) towardKnee.copy(leg.kneeStart).sub(leg.hipStart);
  const kneePreferred = hip.clone().addScaledVector(towardKnee.normalize(), leg.upperLength);
  const towardFoot = footAnchor.clone().sub(kneePreferred);
  if (towardFoot.lengthSq() < 1e-12) towardFoot.copy(leg.footStart).sub(leg.kneeStart);
  const footForKnee = kneePreferred.clone().addScaledVector(towardFoot.normalize(), leg.lowerLength);
  const footTarget = footAnchor.clone().lerp(footForKnee, leg.kneePreference);
  // Contacts are preferences. Once the hip reaches/passes its support, let
  // that support follow rather than reversing the entire leg's reach axis.
  // This is a pose-based correction, independent of pointer speed or history.
  const depth = footTarget.clone().sub(hip).dot(leg.reachDirection);
  const margin = Math.max(maxReach * 1e-6, Math.min(maxReach * 0.04, leg.hipStart.distanceTo(leg.footStart) * 0.5));
  if (depth < margin * 2 && margin > 1e-10) {
    const release = Math.max(0, margin * 2 - depth);
    const correction = depth > 0 ? release * release / (4 * margin) : margin - depth;
    footTarget.addScaledVector(leg.reachDirection, correction);
  }
  const direction = footTarget.clone().sub(hip);
  const rawDistance = direction.length();
  if (rawDistance < 1e-10) direction.copy(leg.reachDirection); else direction.divideScalar(rawDistance);
  const minReach = Math.max(Math.abs(leg.upperLength - leg.lowerLength), maxReach * 1e-7);
  const distance = MathUtils.clamp(rawDistance, minReach, maxReach);
  // Keep the preferred contact while reachable, then yield by the amount
  // required to preserve bone lengths. The hip is free.
  const foot = hip.clone().addScaledVector(direction, distance);
  const along = (leg.upperLength ** 2 - leg.lowerLength ** 2 + distance ** 2) / (2 * distance);
  const center = hip.clone().addScaledVector(direction, along);
  // Tight folds have no reliable plane. Relax the lane smoothly before that
  // region and preserve the captured bend rather than forcing a turn.
  const planeWeight = smooth(minReach + maxReach * 0.2, minReach + maxReach * 0.27, rawDistance);
  const linePole = transportedPole(leg, direction, planeWeight);
  const height = Math.sqrt(Math.max(0, leg.upperLength ** 2 - along ** 2));
  // Ease from the captured shallow bend into the lane, avoiding a twist on
  // the first pixels of a drag. Once bent, extra flex does not amplify splay.
  const initialOffset = leg.lineRadius > maxReach * 1e-10 ? leg.lineOffset * height / leg.lineRadius : 0;
  const laneWeight = smooth(0, maxReach * 0.12, height - leg.lineRadius);
  const sideOffset = MathUtils.clamp(MathUtils.lerp(initialOffset, leg.lineOffset, laneWeight), -height, height);
  const lineSide = new Vector3().crossVectors(direction, linePole).normalize();
  const pole = linePole.clone().multiplyScalar(Math.sqrt(Math.max(0, height ** 2 - sideOffset ** 2)))
    .addScaledVector(lineSide, sideOffset);
  if (height > maxReach * 1e-10) pole.normalize(); else pole.copy(linePole);
  const kneePole = perpendicular(direction, kneePreferred.clone().sub(center));
  // Kneeling favors the previous knee location; other poses preserve the
  // original bend plane, including outward knees in butterfly guard.
  if (kneePole.dot(pole) > 0) pole.lerp(kneePole, leg.kneePreference).normalize();
  const knee = center.addScaledVector(pole, height);
  // Near a completely folded leg, a few pixels can reverse the hip-to-foot
  // axis. Favor the existing bend direction and let the foot contact yield
  // instead of forcing the knee around an ill-conditioned intersection circle.
  const foldWeight = 1 - smooth(minReach + maxReach * 0.03, minReach + maxReach * 0.2, rawDistance);
  if (foldWeight > 0) {
    const kneeDirection = knee.clone().sub(hip).normalize();
    const stableDirection = leg.foldReference;
    if (foldWeight === 1) {
      kneeDirection.copy(stableDirection);
    } else if (kneeDirection.dot(stableDirection) < -0.999999) {
      kneeDirection.applyAxisAngle(perpendicular(kneeDirection, leg.reachDirection), Math.PI * foldWeight);
    } else {
      const turn = new Quaternion().setFromUnitVectors(kneeDirection, stableDirection);
      kneeDirection.applyQuaternion(new Quaternion().slerp(turn, foldWeight));
    }
    knee.copy(hip).addScaledVector(kneeDirection, leg.upperLength);
    const lowerDirection = footTarget.clone().sub(knee);
    if (lowerDirection.lengthSq() < 1e-12) lowerDirection.copy(leg.footStart).sub(leg.kneeStart);
    foot.copy(knee).addScaledVector(lowerDirection.normalize(), leg.lowerLength);
  }
  const kneeDirection = knee.clone().sub(hip).normalize();
  const normal = new Vector3().crossVectors(foot.clone().sub(hip), knee.clone().sub(hip));
  const referenceNormal = perpendicular(kneeDirection, leg.normal);
  const sineSquared = normal.lengthSq() / (leg.upperLength * leg.lowerLength) ** 2;
  if (sineSquared < 1e-12) {
    normal.copy(referenceNormal);
  } else {
    normal.normalize();
    // A reachable, bent knee has a definite signed bend. Never choose its
    // opposite just because a previous pointer sample carried a flipped axis.
    // Nearly collinear segments provide a noisy roll axis even when their
    // endpoints move smoothly. Fade to the captured frame and let the ankle
    // yield slightly within that plane, preserving both lengths and the hinge.
    normal.copy(referenceNormal.lerp(normal, smooth(0.0004, 0.01, sineSquared)).normalize());
  }
  if (sineSquared < 0.01) {
    const lowerDirection = perpendicular(normal, foot.clone().sub(knee));
    foot.copy(knee).addScaledVector(lowerDirection, leg.lowerLength);
  }
  return { knee, foot, normal };
}

export function applyPelvisDrag(state, target) {
  if (!state || !target || ![target.x, target.y, target.z].every(Number.isFinite)) return false;
  const delta = target.clone().sub(state.selectedStart);
  // Only the root position and leg rotations change. Every upper-body local
  // transform stays intact, so the torso, head, arms and hands keep their pose.
  for (const leg of state.legs) for (const local of leg.locals) local.bone.quaternion.copy(local.quaternion);
  const rootTarget = state.origin.clone().add(delta);
  state.hips.position.copy(state.hips.parent ? state.hips.parent.worldToLocal(rootTarget) : rootTarget);
  state.rig.positionOverrides.set(state.hips, state.hips.position.clone());
  state.rig.object.updateMatrixWorld(true);
  if (delta.lengthSq() < 1e-20) return true;
  for (const leg of state.legs) {
    const targets = solveLeg(leg, position(leg.thigh), delta);
    orientSegment(leg.frames[0], targets.knee, targets.normal);
    orientSegment(leg.frames[1], targets.foot, targets.normal);
    // Foot orientation cannot correct twist in its parent knee. Preserve the
    // authored orientation while the shared hinge frame controls the leg.
    setWorldRotation(leg.foot, leg.footRotation);
  }
  state.rig.object.updateMatrixWorld(true);
  return true;
}

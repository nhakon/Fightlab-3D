import { Quaternion, Vector3 } from 'three';
import { captureJointPivot, applyJointPivot } from './joint-pivot.js';

const states = new WeakMap();
const tolerance = .003;
export const isGripJoint = bone => !!bone?.isBone && !/headfront|chin|twist|end|nub|^(Left|Right)Shoulder$|^Spine02$/i.test(bone.name || '');
export function getGripLink(rigs) { return rigs.find(rig => rig.person === 'A')?.gripLink || null; }

function resolve(rigs, link) {
  if (!link || !Array.isArray(link.offset) || link.offset.length !== 3 || !link.offset.every(Number.isFinite)) return null;
  const endpoints = [link.a, link.b].map(end => {
    const rig = rigs.find(r => r.person === end?.person);
    const bone = rig?.object.getObjectByName(end?.bone || '');
    return rig && isGripJoint(bone) ? {rig, bone} : null;
  });
  if (endpoints.some(end => !end) || endpoints[0].rig === endpoints[1].rig) return null;
  return endpoints;
}

function capture(rig) {
  const nodes = [rig.object];
  rig.object.traverse(node => { if (node.isBone) nodes.push(node); });
  return nodes.map(node => ({node, p:node.position.clone(), q:node.quaternion.clone(), s:node.scale.clone()}));
}
function restore(snapshot) {
  for (const {node,p,q,s} of snapshot) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); }
  snapshot[0].node.updateMatrixWorld(true);
}
function changed(snapshot) {
  return snapshot.some(({node,p,q,s}) => node.position.distanceToSquared(p) > 1e-16
    || node.scale.distanceToSquared(s) > 1e-16 || node.quaternion.toArray().some((v,i) => Math.abs(v-q.toArray()[i]) > 1e-9));
}
function blend(before, after, amount) {
  before.forEach(({node,p,q,s},i) => {
    node.position.copy(p).lerp(after[i].p,amount);
    if (node.isBone && !p.equals(after[i].p) && p.lengthSq() > 1e-12 && Math.abs(p.length() - after[i].p.length()) < 1e-8) {
      if (node.position.lengthSq() < 1e-12) node.position.copy(p);
      else node.position.setLength(p.length());
    }
    node.quaternion.copy(q);
    if (!q.equals(after[i].q)) node.quaternion.slerp(after[i].q,amount);
    node.scale.copy(s).lerp(after[i].s,amount);
  });
  before[0].node.updateMatrixWorld(true);
}

// Only the connected limb participates. Elbows and knees keep their bend plane.
export function solveGripArm(end, localPoint, target, shoulderRest = null, iterations = 64) {
  const chain = [];
  let node = end.bone.parent;
  while (node?.isBone && /^(Left|Right)(ForeArm|Arm|Leg|UpLeg)$/.test(node.name)) {
    chain.push(node); node = node.parent;
  }
  if (!chain.length) return false;
  const shoulder = node?.isBone && /^(Left|Right)Shoulder$/.test(node.name) && shoulderRest?.has(node) ? node : null;
  if (shoulder) chain.push(shoulder);
  const hinges = new Map(chain.filter(joint => /^(Left|Right)(ForeArm|Leg)$/.test(joint.name))
    .map(joint => [joint, captureJointPivot(end.rig, joint, end.rig.object)]));
  const hingeAngles = new Map([...hinges.keys()].map(joint => [joint, 0]));
  const point = () => end.bone.localToWorld(localPoint.clone());
  const root = chain.at(-1);
  let reach = point().distanceTo(end.bone.getWorldPosition(new Vector3()));
  let child = end.bone;
  while (child !== root) {
    reach += child.getWorldPosition(new Vector3()).distanceTo(child.parent.getWorldPosition(new Vector3()));
    child = child.parent;
  }
  if (target.distanceTo(root.getWorldPosition(new Vector3())) > reach + tolerance) return false;
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (point().distanceTo(target) <= tolerance) return true;
    for (const joint of chain) {
      const pivot = joint.getWorldPosition(new Vector3());
      const from = point().sub(pivot), to = target.clone().sub(pivot);
      if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) continue;
      const hinge = hinges.get(joint);
      if (hinge?.hinge) {
        const axis = hinge.hinge.clone().applyQuaternion(joint.getWorldQuaternion(new Quaternion())).normalize();
        from.addScaledVector(axis, -from.dot(axis)); to.addScaledVector(axis, -to.dot(axis));
        if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) continue;
        from.normalize(); to.normalize();
        const angle = Math.atan2(axis.dot(from.clone().cross(to)), from.dot(to));
        const next = Math.max(hinge.minBend, Math.min(hinge.maxBend, hingeAngles.get(joint) + Math.max(-.22, Math.min(.22, angle))));
        hingeAngles.set(joint, next);
        applyJointPivot(hinge, next / .006, 0);
        continue;
      }
      from.normalize(); to.normalize();
      const delta = new Quaternion().setFromUnitVectors(from,to);
      const angle = 2*Math.acos(Math.max(-1, Math.min(1, delta.w)));
      const step = angle > .22 ? new Quaternion().slerp(delta,.22/angle) : delta;
      const parent = joint.parent.getWorldQuaternion(new Quaternion());
      joint.quaternion.premultiply(parent.clone().invert().multiply(step).multiply(parent)).normalize();
      if (joint === shoulder) {
        const rest = shoulderRest.get(joint);
        const deviation = rest.angleTo(joint.quaternion);
        const limit = Math.PI / 30; // Six degrees total, not six degrees per update.
        if (deviation > limit) { const desired=joint.quaternion.clone(); joint.quaternion.copy(rest).slerp(desired, limit / deviation); }
      }
      joint.updateMatrixWorld(true);
    }
  }
  return point().distanceTo(target) <= tolerance;
}

export function createGripLink(rigs, first, second, { beforeConnect } = {}) {
  const a = first, b = second;
  if (!a || !b || a.rig === b.rig || !isGripJoint(a.bone) || !isGripJoint(b.bone)) return {error:'Choose a usable joint on each figure.'};
  const owner = rigs.find(rig => rig.person === 'A');
  if (!owner || !rigs.includes(a.rig) || !rigs.includes(b.rig)) return {error:'Both figures must be loaded.'};
  if (a.rig.object.getObjectByName(a.bone.name) !== a.bone || b.rig.object.getObjectByName(b.bone.name) !== b.bone) return {error:'Choose a joint belonging to the selected figure.'};
  a.rig.object.updateWorldMatrix(true, true);
  b.rig.object.updateWorldMatrix(true, true);
  const anchor = a.bone.getWorldPosition(new Vector3());
  const delta = anchor.sub(b.bone.getWorldPosition(new Vector3()));
  const destination = b.rig.object.getWorldPosition(new Vector3()).add(delta);
  if (b.rig.object.parent) b.rig.object.parent.worldToLocal(destination);
  if (!destination.toArray().every(Number.isFinite)) return {error:'Cannot connect these joints.'};
  const link = {
    a:{person:a.rig.person,bone:a.bone.name}, b:{person:b.rig.person,bone:b.bone.name},
    offset:[0, 0, 0]
  };
  // Capture the old position and connection together, before either changes.
  beforeConnect?.();
  b.rig.object.position.copy(destination);
  b.rig.object.updateMatrixWorld(true);
  owner.gripLink = link;
  states.set(link,{snapshots:[capture(a.rig),capture(b.rig)],limited:false, shoulderRest:new Map([...capture(a.rig),...capture(b.rig)].filter(e=>/^(Left|Right)Shoulder$/.test(e.node.name)).map(e=>[e.node,e.q.clone().normalize()]))});
  return {link};
}

export function releaseGripLink(rigs) {
  for (const rig of rigs) rig.gripLink = null;
}

// Only the manipulated arm adapts. The untouched figure remains completely fixed.
export function maintainGripLink(rigs, { allowArmAdjustment = true } = {}) {
  const link = getGripLink(rigs), ends = resolve(rigs,link);
  if (!ends || rigs.some(rig => rig.restoringPose)) return {link:ends ? link : null, limited:false};
  let state = states.get(link);
  if (!state) {
    state = {snapshots:ends.map(end => capture(end.rig)),limited:false};
    state.shoulderRest = new Map(state.snapshots.flat().filter(e=>/^(Left|Right)Shoulder$/.test(e.node.name)).map(e=>[e.node,e.q.clone().normalize()]));
    states.set(link,state);
    return {link,limited:false};
  }
  const driver = state.snapshots.findIndex(changed);
  if (driver < 0) return {link,limited:state.limited};
  const follower = 1-driver;
  const offset = new Vector3(...link.offset);
  const requested = capture(ends[driver].rig);
  const point = index => index === 0
    ? ends[0].bone.getWorldPosition(new Vector3()) : ends[1].bone.localToWorld(offset.clone());
  const target = point(follower);
  const solve = () => {
    if (point(driver).distanceTo(target) <= tolerance) return true;
    if (!allowArmAdjustment) return false;
    const before = capture(ends[driver].rig), local = driver === 1 ? offset : new Vector3();
    if (solveGripArm(ends[driver], local, target)) return true;
    restore(before);
    return solveGripArm(ends[driver], local, target, state.shoulderRest);
  };
  if (solve()) {
    state.snapshots = ends.map(end => capture(end.rig)); state.limited = false;
    return {link,limited:false};
  }
  let low = 0, high = 1, accepted = state.snapshots;
  for (let i=0; i<9; i++) {
    const fraction = (low+high)/2;
    state.snapshots.forEach(restore);
    blend(state.snapshots[driver],requested,fraction);
    if (solve()) { low=fraction; accepted=ends.map(end => capture(end.rig)); }
    else high=fraction;
  }
  accepted.forEach(restore);
  state.snapshots = accepted; state.limited = true;
  // Preserve translations used by the hip solver after a shortened body move.
  for (const end of ends) for (const bone of end.rig.positionOverrides?.keys() || []) {
    end.rig.positionOverrides.set(bone,bone.position.clone());
  }
  return {link,limited:true};
}

// Rebase after another constraint corrects a pose; retain the bounded shoulder allowance.
export function rebaseGripLink(rigs) {
  const link=getGripLink(rigs),ends=resolve(rigs,link),state=link&&states.get(link);
  if(state&&ends)state.snapshots=ends.map(end=>capture(end.rig));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Bone, Group, Vector3, Quaternion } from 'three';
import { capturePelvisDrag, applyPelvisDrag, isPelvisDragJoint } from './pelvis-drag.js';

function loadRig(scale = 1) {
  const file = new URL('../../static/fightlab3d/meshy/Meshy_AI_Low_Poly_Humanoid_Fig_biped/Meshy_AI_Low_Poly_Humanoid_Fig_biped_Character_output.glb', import.meta.url);
  const bytes = readFileSync(file);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const nodes = gltf.nodes.map((node) => {
    const bone = new Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    return bone;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach((child) => nodes[i].add(nodes[child])));
  const object = new Group();
  nodes.filter((bone) => !bone.parent).forEach((bone) => object.add(bone));
  object.scale.setScalar(scale);
  object.rotation.set(0.3, 0.8, -0.2);
  object.updateMatrixWorld(true);
  return { object, positionOverrides: new Map(),
    bindPositions: new Map(nodes.map(bone => [bone, bone.position.clone()])),
    bindQuaternions: new Map(nodes.map(bone => [bone, bone.quaternion.clone()])) };
}
const pos = (bone) => bone.getWorldPosition(new Vector3());

function fixture(pose, scale = 1) {
  const object = new Group();
  const hips = new Bone(); hips.name = 'Hips'; object.add(hips);
  const hipY = pose === 'standing' ? 2 : pose === 'kneeling' ? 1.1 : 0.25;
  hips.position.set(0, hipY, 0);
  const add = (name, parent, local) => { const b = new Bone(); b.name = name; b.position.fromArray(local); parent.add(b); return b; };
  const spine = add('Spine', hips, [0, 0.5, 0]);
  add('Head', spine, [0, 0.3, 0]);
  for (const [side, sign] of [['Left', -1], ['Right', 1]]) {
    const shoulder = add(side + 'Shoulder', spine, [sign * 0.3, 0, 0]);
    const arm = add(side + 'Arm', shoulder, [sign * 0.3, -0.2, 0.15]);
    add(side + 'Hand', arm, [0, -0.25, 0.2]);
    const hip = [sign * 0.2, hipY, 0];
    const knee = pose === 'butterfly' ? [sign * 0.8, 0.18, 0.45] : [sign * 0.2, pose === 'standing' ? 1 : 0.08, pose === 'standing' ? 0.08 : 0];
    const foot = pose === 'butterfly' ? [sign * 0.16, 0.08, 0.85] : [sign * 0.2, pose === 'standing' ? 0 : 0.08, pose === 'standing' ? 0 : -1];
    const thigh = add(side + 'UpLeg', hips, [hip[0], 0, 0]);
    const lower = add(side + 'Leg', thigh, knee.map((n, i) => n - hip[i]));
    const ankle = add(side + 'Foot', lower, foot.map((n, i) => n - knee[i]));
    add(side + 'ToeBase', ankle, [0, -0.03, 0.1]);
  }
  object.scale.setScalar(scale); object.rotation.y = 0.6; object.updateMatrixWorld(true);
  return { object, positionOverrides: new Map() };
}
function setup(rig, side = 'Left', floorY = 0) {
  const bone = rig.object.getObjectByName(side + 'UpLeg');
  const state = capturePelvisDrag(rig, bone, floorY);
  assert.ok(state);
  const upper = [], lengths = [];
  state.hips.traverse((node) => {
    if (!node.isBone) return;
    if (node.parent?.isBone && node.name !== 'Hips') lengths.push([node, pos(node).distanceTo(pos(node.parent))]);
    if (!/Leg|Foot|Toe/.test(node.name)) upper.push([node, pos(node), node.getWorldQuaternion(new Quaternion())]);
  });
  const verify = (delta) => {
    for (const [node, before, q] of upper) {
      assert.ok(pos(node).distanceTo(before.clone().add(delta)) < 1e-5, node.name + ' changed upper-body pose');
      assert.ok(1 - Math.abs(node.getWorldQuaternion(new Quaternion()).dot(q)) < 1e-5, node.name + ' rotated');
    }
    for (const [node, length] of lengths) assert.ok(Math.abs(pos(node).distanceTo(pos(node.parent)) - length) < 1e-5, node.name + ' stretched');
    assert.ok(pos(bone).distanceTo(state.selectedStart.clone().add(delta)) < 1e-5, 'hips missed pointer target');
  };
  const move = (delta) => { assert.ok(applyPelvisDrag(state, state.selectedStart.clone().add(delta))); verify(delta); };
  return { state, move, verify };
}
const worldDelta = (rig, x, y, z) => new Vector3(x, y, z).applyQuaternion(rig.object.quaternion).multiplyScalar(rig.object.scale.x);

function legTransforms(state) {
  return state.legs.flatMap(leg => [leg.thigh, leg.knee, leg.foot].map(bone => ({
    position: pos(bone), rotation: bone.getWorldQuaternion(new Quaternion()).normalize()
  })));
}

function assertSameLegs(actual, expected, tolerance = 1e-5) {
  actual.forEach((transform, i) => {
    assert.ok(transform.position.distanceTo(expected[i].position) < tolerance, 'leg position depends on earlier pointer path: ' + i);
    assert.ok(transform.rotation.angleTo(expected[i].rotation) < tolerance, 'leg twist depends on earlier pointer path: ' + i);
  });
}

for (const pose of ['standing', 'kneeling', 'butterfly', 'asymmetric', 'actual']) test(pose + ': returning from origin experiments restores the same seated result', () => {
  const rig = pose === 'actual' ? loadRig() : fixture(pose === 'asymmetric' ? 'standing' : pose);
  if (pose === 'asymmetric') {
    rig.object.getObjectByName('LeftLeg').rotation.x = 0.65;
    rig.object.updateMatrixWorld(true);
  }
  const {state, move} = setup(rig);
  const size = state.legs[0].upperLength + state.legs[0].lowerLength;
  const destination = worldDelta(rig, 0, -size * 0.25, -size * 0.2);
  move(destination);
  const expected = legTransforms(state);
  const origin = state.legs[0].footStart.clone().sub(state.legs[0].hipStart);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 1; i <= 120; i++) move(origin.clone().multiplyScalar(i / 100));
    for (let i = 0; i < 60; i++) {
      const a = i * Math.PI / 30;
      move(origin.clone().add(worldDelta(rig, size * 0.01 * Math.cos(a), 0, size * 0.01 * Math.sin(a))));
    }
    for (let i = 120; i >= 10; i--) move(origin.clone().multiplyScalar(i / 100));
    move(destination);
    assertSameLegs(legTransforms(state), expected);
  }
});

test('symmetrical origin experiments keep the knees and feet symmetrical and continuous', () => {
  const rig = fixture('standing'); const {state, move} = setup(rig);
  let previous = null;
  for (let cycle = 0; cycle < 3; cycle++) for (let i = 0; i <= 320; i++) {
    const t = Math.sin(i / 320 * Math.PI);
    move(worldDelta(rig, 0, -2.3 * t, 0));
    for (const name of ['knee', 'foot']) {
      const left = rig.object.worldToLocal(pos(state.legs[0][name]));
      const right = rig.object.worldToLocal(pos(state.legs[1][name]));
      assert.ok(Math.abs(left.x + right.x) < 1e-5 && Math.abs(left.y - right.y) < 1e-5 && Math.abs(left.z - right.z) < 1e-5, name + ' lost symmetry');
    }
    const current = legTransforms(state);
    if (previous) current.forEach((value, j) => {
      assert.ok(value.position.distanceTo(previous[j].position) < 0.15, 'joint jumped while support yielded');
      assert.ok(value.rotation.angleTo(previous[j].rotation) < 0.3, 'joint flipped while support yielded');
    });
    previous = current;
  }
});

test('loading a fully straight pose recovers the knee side from bind data without earlier drags', () => {
  const original = loadRig(); const {state, move} = setup(original);
  const axisLocals = state.legs.map(leg => leg.normal.clone().applyQuaternion(leg.thigh.getWorldQuaternion(new Quaternion()).invert()));
  move(worldDelta(original, 0, 0.5, 0));
  const loaded = loadRig();
  loaded.object.traverse(bone => {
    const source = original.object.getObjectByName(bone.name);
    if (!bone.isBone || !source) return;
    bone.position.copy(source.position); bone.quaternion.copy(source.quaternion);
  });
  loaded.object.updateMatrixWorld(true);
  const {state: fresh, move: sit} = setup(loaded);
  sit(worldDelta(loaded, 0, -0.4, -0.15));
  fresh.legs.forEach((leg, i) => {
    const bend = pos(leg.foot).sub(pos(leg.thigh)).cross(pos(leg.knee).sub(pos(leg.thigh)));
    const axis = axisLocals[i].clone().applyQuaternion(leg.thigh.getWorldQuaternion(new Quaternion()));
    assert.ok(bend.dot(axis) > 0.001, 'loaded straight knee bent backwards');
  });
});

for (const steps of [1, 12, 200]) test('a fast or slow descent chooses the same folded pose: ' + steps, () => {
  const rig = loadRig(); const {state, move} = setup(rig);
  const target = state.legs[0].footStart.clone().sub(state.legs[0].hipStart).multiplyScalar(1.02);
  move(target);
  const expected = legTransforms(state);
  move(new Vector3());
  for (let i = 1; i <= steps; i++) move(target.clone().multiplyScalar(i / steps));
  assertSameLegs(legTransforms(state), expected);
});

for (const regrab of [false, true]) test('knees bend on their original side after straightening and sitting again; regrab=' + regrab, () => {
  const rig = loadRig(); const {state, move} = setup(rig);
  const localAxes = state.legs.map(leg => leg.normal.clone().applyQuaternion(leg.thigh.getWorldQuaternion(new Quaternion()).invert()));
  const size = state.legs[0].upperLength + state.legs[0].lowerLength;
  const descent = state.legs[0].footStart.clone().sub(state.legs[0].hipStart);
  let active = state;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const delta of [descent.clone().multiplyScalar(1.1), worldDelta(rig, 0, size * 0.3, 0), worldDelta(rig, 0, -size * 0.3, -size * 0.15)]) {
      const target = state.selectedStart.clone().add(delta);
      const start = pos(active.legs[0].thigh);
      for (let i = 1; i <= 100; i++) applyPelvisDrag(active, start.clone().lerp(target, i / 100));
      if (regrab) {
        const before = legTransforms(active);
        active = capturePelvisDrag(rig, active.legs[0].thigh);
        applyPelvisDrag(active, active.selectedStart);
        assertSameLegs(legTransforms(active), before);
      }
    }
    state.legs.forEach((leg, i) => {
      const bend = pos(leg.foot).sub(pos(leg.thigh)).cross(pos(leg.knee).sub(pos(leg.thigh)));
      const axis = localAxes[i].clone().applyQuaternion(leg.thigh.getWorldQuaternion(new Quaternion()));
      assert.ok(bend.dot(axis) > size * size * 0.01, 'knee bent backwards after lifting and sitting');
    });
  }
});

test('only side hip joints select the body-drag control', () => {
  for (const name of ['LeftUpLeg', 'RightUpLeg']) assert.ok(isPelvisDragJoint({ name }));
  for (const name of ['Hips', 'Spine', 'LeftLeg']) assert.ok(!isPelvisDragJoint({ name }));
});

for (const side of ['Left', 'Right']) for (const scale of [1, 2.5]) {
  test(side + ' butterfly scoot preserves feet and outward knee bends (' + scale + ')', () => {
    const rig = fixture('butterfly', scale);
    const {state, move} = setup(rig, side);
    assert.ok(state.legs.every(l => l.kneePreference < 0.05));
    move(worldDelta(rig, 0, 0, 0.25));
    for (const [i, leg] of state.legs.entries()) {
      assert.ok(pos(leg.foot).distanceTo(leg.footStart) < 1e-5);
      assert.ok(pos(leg.knee).distanceTo(leg.kneeStart) > scale * 0.04, 'knee did not bend for scoot');
      const local = rig.object.worldToLocal(pos(leg.knee));
      assert.ok(local.x * (i === 0 ? -1 : 1) > 0.4, 'knee collapsed inward');
    }
    move(new Vector3());
    for (const leg of state.legs) assert.ok(pos(leg.knee).distanceTo(leg.kneeStart) < 1e-5);
  });
}

test('standing to squat bends knees while feet remain planted', () => {
  const rig = fixture('standing'); const {state, move} = setup(rig);
  assert.ok(state.legs.every(l => l.kneePreference < 0.05));
  move(worldDelta(rig, 0, -0.9, -0.9));
  for (const leg of state.legs) {
    assert.ok(pos(leg.foot).distanceTo(leg.footStart) < 1e-5);
    const angle = pos(leg.thigh).sub(pos(leg.knee)).angleTo(pos(leg.foot).sub(pos(leg.knee))) * 180 / Math.PI;
    assert.ok(angle > 75 && angle < 105, 'squat knee angle ' + angle);
  }
});

test('a reachable deep seat keeps the feet supported without inheriting shin twist', () => {
  const rig = fixture('standing'); const {state, move} = setup(rig);
  const starts = state.legs.map((leg) => ({
    position: leg.footStart.clone(),
    rotation: leg.footRotation.clone()
  }));
  move(worldDelta(rig, 0.7, -1.75, -1.1));
  state.legs.forEach((leg, index) => {
    const footPosition = pos(leg.foot);
    assert.ok(footPosition.distanceTo(starts[index].position) < 1e-5, 'reachable foot slid with the hips');
    assert.ok(Math.abs(footPosition.y - starts[index].position.y) < 1e-5, 'floor contact moved vertically');
    const footRotation = leg.foot.getWorldQuaternion(new Quaternion());
    assert.ok(footRotation.angleTo(starts[index].rotation) < 1e-6, 'foot inherited shin twist');
  });
});

for (const actual of [false, true]) test('knee remains a hinge during sideways and deep sitting: ' + (actual ? 'GLB' : 'fixture'), () => {
  const rig = actual ? loadRig() : fixture('standing');
  const {state, move} = setup(rig);
  // Derive each hinge axis independently from the starting geometry. Both
  // segments must carry this same axis through the drag, including mesh twist.
  const hinges = state.legs.map(leg => {
    const axis = leg.footStart.clone().sub(leg.hipStart)
      .cross(leg.kneeStart.clone().sub(leg.hipStart)).normalize();
    return [leg.thigh, leg.knee].map(bone => axis.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()));
  });
  const size = state.legs[0].upperLength + state.legs[0].lowerLength;
  let previous = null;
  for (let i = 0; i <= 320; i++) {
    const t = i / 320;
    move(worldDelta(rig, size * 0.22 * Math.sin(t * Math.PI * 2), -size * 1.1 * t, -size * 0.08 * Math.sin(t * Math.PI)));
    const current = [];
    state.legs.forEach((leg, index) => {
      const quats = [leg.thigh, leg.knee].map(bone => bone.getWorldQuaternion(new Quaternion()));
      const axes = quats.map((q, j) => hinges[index][j].clone().applyQuaternion(q));
      assert.ok(axes[0].dot(axes[1]) > 0.99999, 'shin twisted relative to thigh at step ' + i);
      const upper = pos(leg.knee).sub(pos(leg.thigh)).normalize();
      const lower = pos(leg.foot).sub(pos(leg.knee)).normalize();
      assert.ok(Math.abs(axes[0].dot(upper)) < 1e-5 && Math.abs(axes[0].dot(lower)) < 1e-5, 'hinge left the bend plane');
      current.push(...quats);
    });
    if (previous) current.forEach((q, j) => assert.ok(q.angleTo(previous[j]) < 0.2, 'segment rotation jumped at step ' + i));
    previous = current;
  }
  move(new Vector3());
  for (const leg of state.legs) for (const local of leg.locals) {
    assert.ok(local.bone.quaternion.equals(local.quaternion), 'returning to origin changed the authored rotation');
  }
});

for (const scale of [1, 2.5]) test('actual standing knees keep their lanes during a deep backward sit: ' + scale, () => {
  const rig = loadRig(scale);
  rig.object.rotation.set(0, 0.6, 0);
  rig.object.updateMatrixWorld(true);
  const {state, move} = setup(rig);
  for (let i = 0; i <= 180; i++) {
    move(worldDelta(rig, 0, -0.68 * i / 180, -0.35 * i / 180));
    for (const leg of state.legs) {
      const hip = rig.object.worldToLocal(pos(leg.thigh));
      const knee = rig.object.worldToLocal(pos(leg.knee));
      const start = rig.object.worldToLocal(leg.kneeStart.clone());
      // A shallow sideways offset in the standing mesh must not grow into a
      // wide-legged seat when the user only drags down and backward.
      assert.ok(Math.abs(knee.x - start.x) < leg.upperLength / scale * 0.15, 'backward sit pushed a knee out of its lane');
      if (i === 180) assert.ok(knee.y > hip.y + leg.upperLength / scale * 0.5, 'deep sitting knee did not rise');
    }
  }
});

test('kneeling gives knees priority without freezing hip movement', () => {
  const rig = fixture('kneeling'); const {state, move} = setup(rig);
  assert.ok(state.legs.every(l => l.kneePreference > 0.9));
  const delta = worldDelta(rig, 0.12, 0, 0);
  move(delta);
  for (const leg of state.legs) assert.ok(pos(leg.knee).distanceTo(leg.kneeStart) < delta.length() * 0.15);
});

test('straight legs begin bending forward, and fresh drags do not snap the pose', () => {
  const rig = fixture('standing');
  for (const side of ['Left', 'Right']) {
    rig.object.getObjectByName(side + 'Leg').position.z = 0;
    rig.object.getObjectByName(side + 'Foot').position.z = 0;
  }
  rig.object.updateMatrixWorld(true);
  const {state, move} = setup(rig);
  move(worldDelta(rig, 0, -0.5, -0.5));
  for (const leg of state.legs) {
    const knee = rig.object.worldToLocal(pos(leg.knee));
    const hip = rig.object.worldToLocal(pos(leg.thigh));
    assert.ok(knee.z > hip.z, 'knee bent backward');
    assert.ok(Math.abs(knee.x - hip.x) < 1e-5, 'knee bent sideways');
  }
  const before = state.legs.map(leg => pos(leg.knee));
  for (let i = 0; i < 30; i++) {
    const fresh = capturePelvisDrag(rig, state.legs[0].thigh, 0);
    applyPelvisDrag(fresh, fresh.selectedStart);
  }
  state.legs.forEach((leg, i) => assert.ok(pos(leg.knee).distanceTo(before[i]) < 1e-5, 'new drag moved a knee'));
});

for (const pose of ['butterfly', 'standing', 'kneeling']) {
  test(pose + ': smooth contact release, circular drags, unlimited travel and reversal', () => {
    const rig = fixture(pose); const {state, move} = setup(rig);
    let previous = null;
    for (let i = 0; i <= 80; i++) {
      move(worldDelta(rig, i * 0.03, 0, 0));
      const current = state.legs.map(l => pos(l.knee));
      if (previous) current.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < 0.25, 'knee jumped on release'));
      previous = current;
    }
    move(worldDelta(rig, 20, 12, -10));
    move(new Vector3());
    for (const leg of state.legs) {
      assert.ok(pos(leg.knee).distanceTo(leg.kneeStart) < 1e-5);
      assert.ok(pos(leg.foot).distanceTo(leg.footStart) < 1e-5);
    }
    previous = null;
    for (let i = 0; i <= 64; i++) {
      const a = i * 2 * Math.PI / 64;
      move(worldDelta(rig, 0.1 * Math.sin(a), 0, 0.1 * (1 - Math.cos(a))));
      const current = state.legs.map(l => pos(l.knee));
      if (previous) current.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < 0.15, 'circular drag flipped knee'));
      previous = current;
    }
  });
}

for (const side of ['Left', 'Right']) test('actual GLB preserves the upper-body pose and lengths: ' + side, () => {
  const rig = loadRig(); const {state, move} = setup(rig, side, -0.55);
  for (const d of [new Vector3(), new Vector3(0.2, -0.3, 0.2), new Vector3(-1, 0.5, 0.6), new Vector3(20, -4, 10), new Vector3()]) move(d);
  for (const leg of state.legs) assert.ok(pos(leg.foot).distanceTo(leg.footStart) < 1e-5);
  const before = pos(state.hips);
  assert.equal(applyPelvisDrag(state, new Vector3(NaN, 0, 0)), false);
  assert.ok(pos(state.hips).equals(before));
});

for (const scale of [1, 2.5]) test('unequal legs remain stable when hips cross the original floor point: ' + scale, () => {
  const rig = fixture('standing', scale);
  for (const side of ['Left', 'Right']) {
    rig.object.getObjectByName(side + 'Foot').position.y *= 1.12;
  }
  rig.object.updateMatrixWorld(true);
  const {state, move} = setup(rig, 'Left', -0.12 * scale);
  let previous = null;
  // Descend through the ankle anchors, with tiny sideways pointer jitter.
  for (let i = 0; i <= 480; i++) {
    move(worldDelta(rig, Math.sin(i * 0.31) * 0.0001, -i * 0.005, 0));
    const current = state.legs.map(leg => pos(leg.knee));
    if (previous) current.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < scale * 0.06, 'knee flipped at step ' + i + ': ' + p.distanceTo(previous[j]) / scale));
    previous = current;
  }
  // Once folded, tiny pointer circles must not spin the knees around the hips.
  previous = null;
  for (let i = 0; i <= 100; i++) {
    const a = i * Math.PI * 2 / 100;
    move(worldDelta(rig, 0.0001 * Math.cos(a), -2.12, 0.0001 * Math.sin(a)));
    const current = state.legs.map(leg => pos(leg.knee));
    if (previous) current.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < scale * 0.01, 'knee spun around a collapsed leg'));
    previous = current;
  }
  const seated = state.legs.map(leg => pos(leg.knee));
  const fresh = capturePelvisDrag(rig, state.legs[0].thigh, -0.12 * scale);
  applyPelvisDrag(fresh, fresh.selectedStart);
  state.legs.forEach((leg, i) => assert.ok(pos(leg.knee).distanceTo(seated[i]) < scale * 1e-5, 'grabbing a folded pose changed it'));
  applyPelvisDrag(fresh, fresh.selectedStart.clone().add(worldDelta(rig, 0.0001, 0, 0)));
  state.legs.forEach((leg, i) => assert.ok(pos(leg.knee).distanceTo(seated[i]) < scale * 0.01, 'a new drag snapped a folded knee'));
  move(new Vector3());
});

for (const side of ['Left', 'Right']) test('actual model remains stable through its ankle anchor: ' + side, () => {
  const rig = loadRig();
  const floor = Math.min(pos(rig.object.getObjectByName('LeftFoot')).y, pos(rig.object.getObjectByName('RightFoot')).y);
  const {state, move} = setup(rig, side, floor);
  const selectedLeg = state.legs.find(leg => leg.thigh.name === side + 'UpLeg');
  const toFloor = selectedLeg.footStart.clone().sub(selectedLeg.hipStart);
  let previous = null;
  let previousRotations = null;
  for (let i = 0; i <= 500; i++) {
    const delta = toFloor.clone().multiplyScalar(i / 400);
    delta.x += Math.sin(i * 0.2) * 0.00001;
    move(delta);
    const current = state.legs.map(leg => pos(leg.knee));
    if (previous) current.forEach((p, j) => assert.ok(p.distanceTo(previous[j]) < state.legs[j].upperLength * 0.08, 'actual knee flipped at step ' + i));
    const rotations = state.legs.flatMap(leg => [leg.thigh, leg.knee, leg.foot].map(bone => bone.getWorldQuaternion(new Quaternion()).normalize()));
    if (previousRotations) rotations.forEach((q, j) => assert.ok(q.angleTo(previousRotations[j]) < 0.2, 'actual mesh rolled at step ' + i));
    previousRotations = rotations;
    previous = current;
  }
});

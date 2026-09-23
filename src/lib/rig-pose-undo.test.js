import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Bone, Group, Vector3 } from 'three';
import {capturePelvisDrag, applyPelvisDrag} from './pelvis-drag.js';

// Exercise the editor's actual serialization/restoration functions, including
// snapshots from before the first drag (which have no position overrides).
const source = readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte', import.meta.url), 'utf8');
const start = source.indexOf('  function serializeMeshyRigPose()');
const end = source.indexOf('  function restoreMeshyRigBindOffsets', start);
assert.ok(start >= 0 && end > start);
const api = new Function('meshyRigFigures', `
  let pendingMeshyRigPose = null;
  const meshyRigByPerson = person => meshyRigFigures.find(rig => rig.person === person);
  const updateMeshyRigHandles = () => {};
  ${source.slice(start, end)}
  return { save: serializeMeshyRigPose, restore: applyMeshyRigPose };
`);

test('undo restores position and pose across first and subsequent hip drags', () => {
  const object = new Group(); object.position.set(3, 0, -2);
  const hips = new Bone(); hips.name = 'Hips'; hips.position.set(0, 1, 0); object.add(hips);
  const knee = new Bone(); knee.name = 'LeftLeg'; knee.position.set(0, -0.5, 0); hips.add(knee);
  const rig = { person: 'A', object, bindPositions: new Map([[hips, hips.position.clone()], [knee, knee.position.clone()]]), positionOverrides: new Map() };
  const {save, restore} = api([rig]);
  const initial = save();
  assert.deepEqual(initial.A.positions, {});
  hips.position.set(0.2, 0.3, -0.4);
  rig.positionOverrides.set(hips, hips.position.clone());
  knee.rotation.x = 0.8;
  const first = save();
  hips.position.set(-0.5, 0.1, 0.9);
  rig.positionOverrides.set(hips, hips.position.clone());
  knee.rotation.x = 1.4;
  object.position.x = 7;
  restore(first);
  assert.deepEqual(save(), first);
  restore(initial);
  assert.deepEqual(save(), initial);
  assert.ok(hips.position.equals(new Vector3(0, 1, 0)));
  // Restoring a later frame after undo also reinstates its explicit translation.
  restore(first);
  assert.deepEqual(save(), first);
});

test('undoing hip experiments also restores how the next drag bends', () => {
  const object = new Group();
  const hips = new Bone(); hips.name = 'Hips'; hips.position.y = 2; object.add(hips);
  const add = (name, parent, x, y, z) => { const bone = new Bone(); bone.name = name; bone.position.set(x, y, z); parent.add(bone); return bone; };
  for (const [side, sign] of [['Left', -1], ['Right', 1]]) {
    const thigh = add(side + 'UpLeg', hips, sign * 0.2, 0, 0);
    const knee = add(side + 'Leg', thigh, 0, -1, 0.08);
    const foot = add(side + 'Foot', knee, 0, -1, -0.08);
    add(side + 'ToeBase', foot, 0, 0, 0.1);
  }
  object.updateMatrixWorld(true);
  const bones = []; object.traverse(bone => { if (bone.isBone) bones.push(bone); });
  const rig = {person: 'A', object, positionOverrides: new Map(),
    bindPositions: new Map(bones.map(b => [b, b.position.clone()])),
    bindQuaternions: new Map(bones.map(b => [b, b.quaternion.clone()]))};
  const {save, restore} = api([rig]);
  const initial = save();
  const selected = object.getObjectByName('LeftUpLeg');
  const sit = () => { const drag = capturePelvisDrag(rig, selected); applyPelvisDrag(drag, drag.selectedStart.clone().add(new Vector3(0, -0.9, -0.7))); };
  sit();
  const expected = bones.map(b => ({position: b.position.clone(), rotation: b.quaternion.clone()}));
  restore(initial);
  const experiment = capturePelvisDrag(rig, selected);
  for (const delta of [new Vector3(0.1, -2.1, 0), new Vector3(-0.3, -2, 0.2), new Vector3(0, 0.4, 0)]) {
    applyPelvisDrag(experiment, experiment.selectedStart.clone().add(delta));
  }
  restore(initial);
  sit();
  bones.forEach((bone, i) => {
    assert.ok(bone.position.distanceTo(expected[i].position) < 1e-8);
    assert.ok(bone.quaternion.angleTo(expected[i].rotation) < 1e-6, 'undo left stale bend direction');
  });
});

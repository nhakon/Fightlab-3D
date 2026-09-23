import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parse } from 'svelte/compiler';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { torsoBones, captureTorsoDrag, applyTorsoDrag, torsoMarkerVisible, torsoHandleSelectable } from './torso-control.js';

// Run the editor's actual head IK, including its chain selection and reach clamp.
const editorSource = readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const headFunctions = new Set([
  'meshyRigIkChainForBone', 'isMeshyRigHeadOrChinBone', 'isMeshyRigKneeBone',
  'isMeshyRigSpineBendControl', 'solveMeshyRigBoneToTarget', 'solveMeshyRigSingleJointToTarget',
  'restoreMeshyRigBindOffsets', 'snapshotMeshyRigBoneRotations', 'restoreMeshyRigBoneRotationsExcept',
  'clampMeshyRigTargetToReach', 'stableMeshyRigDeltaFromUnitVectors', 'meshyRigPerpendicularAxis',
  'applyMeshyRigWorldRotationDelta', 'meshyRigRotationLimitForBone', 'meshyRigBoneRelativeAngle',
  'clampMeshyRigBoneRotation'
]);
const headCode = parse(editorSource).instance.content.body
  .filter(node => node.type === 'FunctionDeclaration' && headFunctions.has(node.id.name))
  .map(node => editorSource.slice(node.start, node.end)).join('\n');
const headApi = new Function('THREE', 'singleJointMode', `
  const isPelvisDragJoint = () => false;
  const isJointPinned = (rig,bone) => !!rig.jointPins?.some(pin=>pin.bone===bone.name);
  ${headCode}
  return { solve: solveMeshyRigBoneToTarget, chain: meshyRigIkChainForBone };
`);

function loadRig(pose = 'standing') {
  const bytes = readFileSync(new URL('../../static/fightlab3d/meshy/Meshy_AI_Low_Poly_Humanoid_Fig_biped/Meshy_AI_Low_Poly_Humanoid_Fig_biped_Character_output.glb', import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const joints = new Set(gltf.skins.flatMap(skin => skin.joints));
  const nodes = gltf.nodes.map((node, i) => {
    const bone = joints.has(i) ? new Bone() : new Group();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    return bone;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const object = new Group();
  nodes.filter(node => !node.parent).forEach(node => object.add(node));
  const bones = nodes.filter(node => node.isBone);
  const rig = { person: 'A', object, positionOverrides: new Map(),
    bindPositions: new Map(bones.map(bone => [bone, bone.position.clone()])),
    bindQuaternions: new Map(bones.map(bone => [bone, bone.quaternion.clone()])) };
  object.position.set(2, 0.3, -1);
  object.rotation.y = 0.7;
  object.scale.setScalar(1.3);
  if (pose === 'lying') object.rotateX(Math.PI / 2);
  if (pose === 'seated') {
    for (const side of ['Left', 'Right']) {
      object.getObjectByName(side + 'UpLeg').rotateX(-1.2);
      object.getObjectByName(side + 'Leg').rotateX(1.4);
    }
  }
  object.getObjectByName('Spine01').rotateX(0.25);
  object.getObjectByName('LeftArm').rotateY(0.8);
  object.getObjectByName('LeftForeArm').rotateZ(-1.1);
  object.getObjectByName('RightForeArm').rotateY(1.3);
  object.getObjectByName('neck').rotateZ(0.2);
  object.getObjectByName('Head').rotateY(-0.4);
  object.updateMatrixWorld(true);
  return rig;
}

function transforms(rig) {
  const result = new Map();
  rig.object.traverse(bone => result.set(bone, {
    local: bone.quaternion.clone(), position: bone.position.clone(),
    world: bone.matrixWorld.clone()
  }));
  return result;
}
function nearArray(a, b, label) {
  assert.equal(a.length, b.length);
  a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-8, label));
}

for (const pose of ['standing', 'seated', 'lying']) for (const singleJoint of [false, true]) {
  test(`${pose}: head and face drags leave the torso and limbs fixed (single joint: ${singleJoint})`, () => {
    for (const name of ['Head', 'headfront']) {
      const rig = loadRig(pose);
      rig.lastClampDirections = new Map();
      rig.rotationFallbackAxes = new Map();
      const { solve, chain } = headApi(THREE, singleJoint);
      const head = rig.object.getObjectByName(name);
      const before = transforms(rig);
      const start = head.getWorldPosition(new Vector3());
      assert.ok(chain(head).length > 0);
      assert.ok(chain(head).every(bone => /head|neck/i.test(bone.name)));
      for (const offset of [new Vector3(.2, -.1, .15), new Vector3(-.3, .2, -.1), new Vector3(0, -2, 0)]) {
        assert.ok(solve(rig, head, start.clone().add(offset)));
        for (const [bone, original] of before) {
          assert.ok(bone.position.equals(original.position), bone.name + ' translated');
          if (!/head|neck/i.test(bone.name)) {
            assert.ok(bone.quaternion.equals(original.local), bone.name + ' rotated with the head');
            nearArray(bone.matrixWorld.elements, original.world.elements, bone.name + ' moved with the head');
          }
        }
      }
      assert.ok(head.getWorldPosition(new Vector3()).distanceTo(start) > .001, name + ' must still respond to dragging: ' + head.getWorldPosition(new Vector3()).distanceTo(start));
    }
  });
}

for (const pose of ['standing', 'seated', 'lying']) {
  test(pose + ': torso bends/twists while preserving the arm/head pose and lower body', () => {
    const rig = loadRig(pose), spine = torsoBones(rig), chest = spine.at(-1);
    const initial = transforms(rig), relative = new Map();
    chest.traverse(bone => relative.set(bone, chest.matrixWorld.clone().invert().multiply(bone.matrixWorld)));
    const state = captureTorsoDrag(rig);
    for (const angles of [{pitch: 0.9}, {pitch: -0.7}, {side: 0.6}, {side: -0.6}, {twist: 1.1}, {pitch: 0.6, side: 0.4}]) {
      assert.ok(applyTorsoDrag(state, angles));
      for (const [bone, before] of initial) {
        assert.ok(bone.position.equals(before.position), bone.name + ' translated locally');
        if (!spine.includes(bone)) assert.ok(bone.quaternion.equals(before.local), bone.name + ' lost its pose');
        if (/Hips|Leg|Foot|Toe/.test(bone.name)) nearArray(bone.matrixWorld.elements, before.world.elements, bone.name + ' moved');
      }
      for (const [bone, before] of relative) nearArray(chest.matrixWorld.clone().invert().multiply(bone.matrixWorld).elements, before.elements, bone.name + ' changed relative to chest');
      for (const bone of spine) assert.ok(bone.quaternion.angleTo(initial.get(bone).local) > 0.01, bone.name + ' did not share the bend');
      assert.ok(chest.getWorldPosition(new Vector3()).distanceTo(new Vector3().setFromMatrixPosition(initial.get(chest).world)) > 0.001);
    }
    assert.deepEqual([...rig.positionOverrides], []);
  });

  test(pose + ': retracing large bends restores the same result and exact starting pose', () => {
    const rig = loadRig(pose), state = captureTorsoDrag(rig), initial = transforms(rig);
    const target = { pitch: 0.7, side: -0.35 };
    applyTorsoDrag(state, target);
    const expected = transforms(rig);
    for (let i = 0; i < 100; i++) applyTorsoDrag(state, { pitch: Math.sin(i) * 8, side: Math.cos(i) * 6, twist: i / 8 });
    applyTorsoDrag(state, target);
    for (const [bone, before] of expected) nearArray(bone.matrixWorld.elements, before.world.elements, bone.name + ' depends on pointer history');
    applyTorsoDrag(state, {});
    for (const [bone, before] of initial) {
      assert.ok(bone.quaternion.equals(before.local));
      nearArray(bone.matrixWorld.elements, before.world.elements, bone.name + ' did not return');
    }
  });
}

test('torso movement follows the body axes when the figure is rotated or lying down', () => {
  const a = loadRig(), b = loadRig();
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.5);
  b.object.quaternion.premultiply(rotation);
  b.object.position.applyQuaternion(rotation);
  b.object.updateMatrixWorld(true);
  const angles = {pitch: 0.8, side: -0.3, twist: 0.4};
  applyTorsoDrag(captureTorsoDrag(a), angles);
  applyTorsoDrag(captureTorsoDrag(b), angles);
  a.object.traverse(bone => {
    if (bone.isBone) assert.ok(bone.quaternion.clone().normalize().angleTo(b.object.getObjectByName(bone.name).quaternion.clone().normalize()) < 1e-6, bone.name);
  });
});

for (const pose of ['standing', 'seated', 'lying']) for (const rounded of [false, true]) {
  test(`${pose}: lean preserves ${rounded ? 'rounded' : 'straight'} back and arm/head pose`, () => {
    const rig = loadRig(pose);
    for (const bone of torsoBones(rig)) bone.quaternion.copy(rig.bindQuaternions.get(bone));
    if (rounded) applyTorsoDrag(captureTorsoDrag(rig), {pitch: .9, side: .2});
    rig.object.updateMatrixWorld(true);
    const root = torsoBones(rig)[0], before = transforms(rig), relative = new Map();
    root.traverse(bone => relative.set(bone, root.matrixWorld.clone().invert().multiply(bone.matrixWorld)));
    const state = captureTorsoDrag(rig, 'lean');
    for (const angles of [{pitch: 1.1}, {pitch: -.8}, {side: .7}, {side: -.7}, {twist: .8}, {pitch: 5, side: 2}]) {
      assert.ok(applyTorsoDrag(state, angles));
      for (const [bone, original] of before) {
        assert.ok(bone.position.equals(original.position), bone.name + ' translated');
        if (bone !== root) assert.ok(bone.quaternion.equals(original.local), bone.name + ' changed its pose');
        if (/Hips|Leg|Foot|Toe/.test(bone.name)) nearArray(bone.matrixWorld.elements, original.world.elements, bone.name + ' moved');
      }
      for (const [bone, original] of relative) nearArray(root.matrixWorld.clone().invert().multiply(bone.matrixWorld).elements, original.elements, bone.name + ' changed relative to the waist');
      assert.ok(root.quaternion.angleTo(before.get(root).local) > .01);
    }
    applyTorsoDrag(state, {});
    for (const [bone, original] of before) assert.ok(bone.quaternion.equals(original.local));
  });
}

test('Few shows only pelvis, Lean and Bend; All and Hide share the usable controls', () => {
  const rig = loadRig();
  const handles = [...rig.bindPositions.keys()].map(bone => ({userData: {bone}}));
  const torso = {userData: {bone: torsoBones(rig).at(-1), torsoControl: 'bend'}};
  const lean = {userData: {bone: torsoBones(rig)[1], torsoControl: 'lean'}};
  handles.push(torso, lean);
  assert.deepEqual(handles.filter(h => torsoMarkerVisible(h, 'few')).map(h => h.userData.torsoControl || h.userData.bone.name).sort(), ['Hips','bend','lean']);
  for (const handle of handles) {
    const usable = !!handle.userData.torsoControl || !/spine|headfront|chin|end|nub|twist|^(left|right)shoulder$/i.test(handle.userData.bone.name);
    for (const mode of ['few','all','hidden']) assert.equal(torsoHandleSelectable(handle, mode),usable);
    assert.equal(torsoMarkerVisible(handle, 'all'), usable);
    assert.equal(torsoMarkerVisible(handle, 'hidden'), false);
  }
});

test('undo restores the torso and the next gesture starts from that restored pose', () => {
  const source = readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte', import.meta.url), 'utf8');
  const start = source.indexOf('  function serializeMeshyRigPose()');
  const end = source.indexOf('  function restoreMeshyRigBindOffsets', start);
  const rig = loadRig('seated');
  const {save, restore} = new Function('meshyRigFigures', `
    let pendingMeshyRigPose = null;
    const meshyRigByPerson = person => meshyRigFigures.find(rig => rig.person === person);
    const updateMeshyRigHandles = () => {};
    ${source.slice(start, end)}
    return {save: serializeMeshyRigPose, restore: applyMeshyRigPose};
  `)([rig]);
  const initial = save();
  applyTorsoDrag(captureTorsoDrag(rig), {pitch: 0.7, side: 0.2});
  const bent = save();
  applyTorsoDrag(captureTorsoDrag(rig, 'lean'), {pitch: .8, side: -.2});
  const leaned = save();
  applyTorsoDrag(captureTorsoDrag(rig), {twist: -0.8});
  restore(leaned);
  assert.deepEqual(save(), leaned);
  restore(bent);
  assert.deepEqual(save(), bent);
  restore(initial);
  assert.deepEqual(save(), initial);
  applyTorsoDrag(captureTorsoDrag(rig), {pitch: 0.7, side: 0.2});
  assert.deepEqual(save(), bent);
});

test('active markers remain visible in Hide by default; disabled highlight and removed controls stay hidden',()=>{
  for(const name of ['LeftForeArm','RightLeg','Hips']) {
    const handle={userData:{bone:{name}}};
    assert.equal(torsoMarkerVisible(handle,'hidden',true),true);
    assert.equal(torsoMarkerVisible(handle,'hidden',true,false),false);
    assert.equal(torsoMarkerVisible(handle,'hidden',false),false);
  }
  for(const name of ['LeftShoulder','RightShoulder','Spine02','HeadFront']) {
    const handle={userData:{bone:{name}}};
    assert.equal(torsoHandleSelectable(handle,'all'),false);
    assert.equal(torsoMarkerVisible(handle,'all',true),false);
    assert.equal(torsoMarkerVisible(handle,'hidden',true),false);
  }
});

test('Natural hand movement stops at a pinned shoulder, including unreachable targets',()=>{
  const rig=loadRig(),arm=rig.object.getObjectByName('LeftArm'),hand=rig.object.getObjectByName('LeftHand');
  rig.rotationFallbackAxes=new Map();rig.lastClampDirections=new Map();rig.jointPins=[{bone:arm.name}];
  const api=headApi(THREE,false),before=transforms(rig),start=hand.getWorldPosition(new Vector3());
  const movable=new Set();arm.traverse(n=>movable.add(n));
  assert.deepEqual(api.chain(hand,rig).map(n=>n.name),['LeftForeArm','LeftArm']);
  for(const delta of [new Vector3(.2,.2,.1),new Vector3(9,-4,7)]) {
    api.solve(rig,hand,start.clone().add(delta));rig.object.updateMatrixWorld(true);
    for(const [bone,entry] of before)if(!movable.has(bone)){
      assert.ok(bone.quaternion.equals(entry.local),bone.name+' rotated');
      assert.ok(bone.position.equals(entry.position),bone.name+' translated');
    }
    assert.ok(arm.getWorldPosition(new Vector3()).distanceTo(new Vector3().setFromMatrixPosition(before.get(arm).world))<1e-8);
  }
});

for(const pose of ['standing','seated','lying'])test('whole spine spin preserves '+pose+' shape, pelvis position and is reversible',()=>{
 const rig=loadRig(pose),before=transforms(rig),hips=rig.object.getObjectByName('Hips'),chest=rig.object.getObjectByName('Spine');
 const pivot=hips.getWorldPosition(new Vector3()),axis=chest.getWorldPosition(new Vector3()).sub(pivot).normalize();
 const n=parse(editorSource).instance.content.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='applyMeshyRigSpineSpin');
 let checked=false;const spin=new Function('THREE','findMeshyRigBone','updateMeshyRigHandles',editorSource.slice(n.start,n.end)+';return applyMeshyRigSpineSpin;')(THREE,(r,name)=>r.object.getObjectByName(name),(r,options)=>{assert.equal(options.singleJointEdit,true);checked=true;});
 const handle={userData:{meshyRig:rig}},delta=new Quaternion().setFromAxisAngle(axis,.7);
 assert.equal(spin(handle,.7),true);assert.equal(checked,true);
 assert.ok(hips.getWorldPosition(new Vector3()).distanceTo(pivot)<1e-8);
 for(const [node,state]of before){
  if(node!==rig.object){assert.ok(node.position.equals(state.position));assert.ok(node.quaternion.equals(state.local));}
  const expected=new Vector3().setFromMatrixPosition(state.world).sub(pivot).applyQuaternion(delta).add(pivot);
  assert.ok(node.getWorldPosition(new Vector3()).distanceTo(expected)<1e-8,node.name);
 }
 spin(handle,-.7);for(const [node,state]of before)nearArray(node.matrixWorld.elements,state.world.elements,node.name);
});

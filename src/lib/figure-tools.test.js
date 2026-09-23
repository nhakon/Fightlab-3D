import {toggleJointPin,releaseJointPins,maintainJointPins,isJointPinned} from './joint-pins.js';
import { captureJointMove, applyJointMove } from './joint-move.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { captureJointPivot, applyJointPivot, applyJointPivotTarget } from './joint-pivot.js';
import { PerspectiveCamera } from 'three';
import { FIGURE_POSES, applyFigurePose, poseWheelIndex } from './figure-poses.js';
import { createGripLink, maintainGripLink, releaseGripLink, solveGripArm } from './grip-link.js';

function rig(person = 'A') {
  const b = readFileSync(new URL('../../static/fightlab3d/meshy/Meshy_AI_Low_Poly_Humanoid_Fig_biped/Meshy_AI_Low_Poly_Humanoid_Fig_biped_Character_output.glb',import.meta.url));
  const g = JSON.parse(b.subarray(20,20+b.readUInt32LE(12))), joints = new Set(g.skins.flatMap(s => s.joints));
  const nodes = g.nodes.map((n,i) => {
    const node = joints.has(i) ? new Bone() : new Group(); node.name=n.name;
    if(n.translation)node.position.fromArray(n.translation);if(n.rotation)node.quaternion.fromArray(n.rotation);if(n.scale)node.scale.fromArray(n.scale);return node;
  });
  g.nodes.forEach((n,i) => n.children?.forEach(j => nodes[i].add(nodes[j])));
  const object = new Group();nodes.filter(n=>!n.parent).forEach(n=>object.add(n));
  const bones=nodes.filter(n=>n.isBone);
  const result={object,person,bindPositions:new Map(bones.map(n=>[n,n.position.clone()])),bindQuaternions:new Map(bones.map(n=>[n,n.quaternion.clone()])),positionOverrides:new Map()};
  object.position.set(person==='A' ? -.7 : .7,.2,.3);object.rotation.y=.4;
  object.getObjectByName('LeftForeArm').rotateY(.6);object.updateMatrixWorld(true);return result;
}
const pos = bone => bone.getWorldPosition(new Vector3());
const transforms = r => [r.object,...r.bindPositions.keys()].map(node=>({node,p:node.position.toArray(),q:node.quaternion.toArray(),world:node.matrixWorld.clone()}));
function pair() {
  const a=rig('A'),b=rig('B');
  const hand=a.object.getObjectByName('LeftHand'),elbow=b.object.getObjectByName('LeftForeArm');
  a.object.position.add(pos(elbow).sub(pos(hand))).add(new Vector3(.03,0,0));a.object.updateMatrixWorld(true);
  const result=createGripLink([a,b],{rig:a,bone:hand},{rig:b,bone:elbow});assert.ok(result.link);
  return {a,b,hand,elbow,link:result.link,rigs:[a,b]};
}
function contact(p) { return pos(p.hand).distanceTo(p.elbow.localToWorld(new Vector3(...p.link.offset))); }
function fixedBody(before) {
  for(const {node,p,q,world} of before) {
    assert.deepEqual(node.position.toArray(),p,node.name+' translated');assert.deepEqual(node.quaternion.toArray(),q,node.name+' rotated');
    assert.ok(node.matrixWorld.elements.every((v,i)=>Math.abs(v-world.elements[i])<1e-8),node.name+' moved');
  }
}

test('moving a linked figure adjusts its own arm and leaves the entire other figure fixed',()=>{
  const p=pair(),before=transforms(p.b),start=p.a.object.position.clone();
  for(let i=1;i<=12;i++) {
    p.a.object.position.add(new Vector3(.004,.003,0));p.a.object.updateMatrixWorld(true);
    maintainGripLink(p.rigs);assert.ok(contact(p)<.0031);fixedBody(before);
  }
  assert.ok(p.a.object.position.distanceTo(start)>.008,'Manipulated figure could not move');
});
test('moving the target figure adjusts only its own arm and leaves the gripping figure fixed',()=>{
  const p=pair(),before=transforms(p.a);
  p.b.object.position.z+=.045;p.b.object.updateMatrixWorld(true);
  maintainGripLink(p.rigs);assert.ok(contact(p)<.0031);fixedBody(before);
});
test('an unreachable pull is shortened; reversing and release both work',()=>{
  const p=pair(),before=transforms(p.b),initial=p.a.object.position.clone();
  p.a.object.position.x+=4;p.a.object.updateMatrixWorld(true);
  assert.equal(maintainGripLink(p.rigs).limited,true);assert.ok(contact(p)<.0031);fixedBody(before);
  assert.ok(p.a.object.position.x<initial.x+1,'Unreachable driver was not constrained');
  p.a.object.position.copy(initial);p.a.object.updateMatrixWorld(true);maintainGripLink(p.rigs);assert.ok(contact(p)<.0031);
  releaseGripLink(p.rigs);p.a.object.position.x+=4;p.a.object.updateMatrixWorld(true);
  assert.equal(maintainGripLink(p.rigs).link,null);assert.ok(p.a.object.position.x>initial.x+3);
});
test('creation rejects same-figure and removed joints without moving either figure or recording undo',()=>{
  const a=rig(),b=rig('B'),beforeA=transforms(a),beforeB=transforms(b);let snapshots=0;
  const options={beforeConnect:()=>snapshots++};
  assert.ok(createGripLink([a,b],{rig:a,bone:a.object.getObjectByName('LeftHand')},{rig:a,bone:a.object.getObjectByName('RightHand')},options).error);
  assert.ok(createGripLink([a,b],{rig:a,bone:a.object.getObjectByName('LeftShoulder')},{rig:b,bone:b.object.getObjectByName('Hips')},options).error);
  assert.equal(snapshots,0);fixedBody(beforeA);fixedBody(beforeB);
});
for(const reverse of [false,true]) test('connecting distant joints moves only the second figure, preserves pose, and captures one undo: reverse='+reverse,()=>{
  const rigs=[rig('A'),rig('B')],a=rigs[reverse?1:0],b=rigs[reverse?0:1];
  const parent=new Group();parent.position.set(2,.5,-3);parent.rotation.y=.8;parent.scale.setScalar(1.3);parent.add(b.object);parent.updateMatrixWorld(true);
  const first=a.object.getObjectByName('LeftHand'),second=b.object.getObjectByName('RightForeArm');
  const beforeA=transforms(a),beforeB=transforms(b),oldPosition=b.object.position.clone();let snapshots=0;
  const result=createGripLink(rigs,{rig:a,bone:first},{rig:b,bone:second},{beforeConnect:()=>{snapshots++;assert.ok(b.object.position.equals(oldPosition));assert.equal(rigs[0].gripLink,undefined);}});
  assert.ok(result.link);assert.equal(snapshots,1);assert.ok(pos(first).distanceTo(pos(second))<1e-8);fixedBody(beforeA);
  for(const entry of beforeB){assert.deepEqual(entry.node.quaternion.toArray(),entry.q);if(entry.node!==b.object)assert.deepEqual(entry.node.position.toArray(),entry.p);}
  const connected=transforms(b);maintainGripLink(rigs);fixedBody(connected);
});
test('undo/frame serialization restores connections, poses and an unlinked older frame',()=>{
  const p=pair(),source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
  const start=source.indexOf('  function serializeMeshyRigPose()'),end=source.indexOf('  function restoreMeshyRigBindOffsets',start);
  const api=new Function('meshyRigFigures','maintainGripLink',`
    let pendingMeshyRigPose=null;const meshyRigByPerson=person=>meshyRigFigures.find(r=>r.person===person);
    const updateMeshyRigHandles=()=>maintainGripLink(meshyRigFigures);
    ${source.slice(start,end)} return {save:serializeMeshyRigPose,restore:applyMeshyRigPose};
  `)(p.rigs,maintainGripLink);
  releaseGripLink(p.rigs);p.b.object.position.z+=3;p.b.object.updateMatrixWorld(true);
  toggleJointPin(p.rigs,p.a,p.a.object.getObjectByName('LeftFoot'));
  const beforeConnection=api.save();let undoSnapshot;
  createGripLink(p.rigs,{rig:p.a,bone:p.hand},{rig:p.b,bone:p.elbow},{beforeConnect:()=>{undoSnapshot=api.save();}});
  const afterConnection=api.save();assert.deepEqual(undoSnapshot,beforeConnection);
  api.restore(undoSnapshot);assert.deepEqual(api.save(),beforeConnection);
  api.restore(afterConnection);assert.deepEqual(api.save(),afterConnection);
  const saved=api.save();releaseGripLink(p.rigs);applyFigurePose(p.b,'supine');api.restore(saved);
  assert.deepEqual(api.save(),saved);maintainGripLink(p.rigs);assert.deepEqual(api.save(),saved);
  const old=JSON.parse(JSON.stringify(saved));delete old.A.grip;delete old.B.grip;delete old.A.pins;delete old.B.pins;api.restore(old);assert.equal(p.a.gripLink,null);assert.deepEqual(p.a.jointPins,[]);
});

for(const pose of FIGURE_POSES) test(pose.id+': individual pose retains mat position, facing and size; is repeatable',()=>{
  const a=rig(),b=rig('B'),other=transforms(b),hips=a.object.getObjectByName('Hips');
  const anchor=pos(hips),facing=a.object.quaternion.clone(),scale=a.object.scale.clone();
  assert.ok(applyFigurePose(a,pose.id,-.5));
  assert.ok(Math.abs(pos(hips).x-anchor.x)<1e-8&&Math.abs(pos(hips).z-anchor.z)<1e-8);
  assert.ok(a.object.quaternion.angleTo(facing)<1e-6);assert.ok(a.object.scale.equals(scale));
  const first=transforms(a);
  applyFigurePose(a,'turtle',-.5);applyFigurePose(a,pose.id,-.5);
  for(const original of first) {
    assert.ok(original.node.position.distanceTo(new Vector3(...original.p))<1e-7);
    assert.ok(original.node.quaternion.clone().normalize().angleTo(new Quaternion(...original.q).normalize())<1e-6);
    assert.ok(original.node.quaternion.toArray().every(Number.isFinite));
  }
  fixedBody(other);
});
test('pose wheel has a cancel centre, predictable sectors, and an outside cancel area',()=>{
  assert.equal(poseWheelIndex(0,0),-1);assert.equal(poseWheelIndex(0,-110),0);assert.equal(poseWheelIndex(110,0),2);
  assert.equal(poseWheelIndex(0,110),4);assert.equal(poseWheelIndex(-110,0),6);assert.equal(poseWheelIndex(300,0),-1);
});

for (const name of ['LeftForeArm','RightForeArm','LeftLeg','RightLeg','LeftArm','RightArm','Head','LeftHand','LeftUpLeg','Hips','Spine','Spine01']) {
  test(name + ': single pivot fixes the parent and joint centre, preserves lengths, and reverses exactly', () => {
    const r=rig(),bone=r.object.getObjectByName(name), before=transforms(r), centre=pos(bone);
    const camera=new PerspectiveCamera();camera.position.set(3,2,4);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
    const state=captureJointPivot(r,bone,camera);
    const descendants=new Set();bone.traverse(n=>descendants.add(n));
    applyJointPivot(state,35,-50);
    assert.ok(pos(bone).distanceTo(centre)<1e-8);
    for(const entry of before) {
      assert.deepEqual(entry.node.position.toArray(),entry.p,'Bone offset changed');
      if(entry.node!==bone) assert.deepEqual(entry.node.quaternion.toArray(),entry.q,'Another joint rotated');
      if(!descendants.has(entry.node)) assert.ok(entry.node.matrixWorld.elements.every((v,i)=>Math.abs(v-entry.world.elements[i])<1e-8),'Surrounding joint moved');
    }
    assert.ok(bone.quaternion.angleTo(state.initial)>.01);
    applyJointPivot(state,0,0);fixedBody(before);
  });
}
test('single pivot with an active grip cannot recruit surrounding joints',()=>{
  const p=pair(),before=transforms(p.a),other=transforms(p.b),bone=p.a.object.getObjectByName('LeftForeArm');
  bone.rotateX(.8);p.a.object.updateMatrixWorld(true);
  maintainGripLink(p.rigs,{allowArmAdjustment:false});
  fixedBody(other);assert.ok(contact(p)<.0031);
  for(const entry of before) if(entry.node!==bone) assert.deepEqual(entry.node.quaternion.toArray(),entry.q);
});

test('orbiting around a linked figure keeps every opponent transform fixed',()=>{
  const p=pair(),before=transforms(p.b),anchor=pos(p.elbow),axis=new Vector3(0,1,0);
  for(let i=0;i<24;i++) {
    p.a.object.position.sub(anchor).applyAxisAngle(axis,.015).add(anchor);
    p.a.object.rotateY(.015);p.a.object.updateMatrixWorld(true);
    maintainGripLink(p.rigs);fixedBody(before);assert.ok(contact(p)<.0031);
  }
});
test('elbow and knee pivots stop at straight and folded instead of bending backwards',()=>{
  for(const name of ['LeftForeArm','RightForeArm','LeftLeg','RightLeg']) {
    const r=rig(),bone=r.object.getObjectByName(name),state=captureJointPivot(r,bone,new PerspectiveCamera());
    applyJointPivot(state,-10000,0);const straight=bone.quaternion.clone();
    applyJointPivot(state,-20000,0);assert.deepEqual(bone.quaternion.toArray(),straight.toArray());
    applyJointPivot(state,10000,0);const folded=bone.quaternion.clone();
    applyJointPivot(state,20000,0);assert.deepEqual(bone.quaternion.toArray(),folded.toArray());
    applyJointPivot(state,0,0);assert.deepEqual(bone.quaternion.toArray(),state.initial.toArray());
  }
});

for(const names of [['LeftFoot','Hips'],['Head','RightHand'],['LeftForeArm','RightForeArm'],['Spine','Spine01']]) test('connection accepts '+names.join(' to ')+' and restores it',()=>{
  const a=rig(),b=rig('B'),first=a.object.getObjectByName(names[0]),second=b.object.getObjectByName(names[1]);
  a.object.position.add(pos(second).sub(pos(first)));a.object.updateMatrixWorld(true);
  const result=createGripLink([a,b],{rig:a,bone:first},{rig:b,bone:second});assert.ok(result.link);
  a.gripLink=JSON.parse(JSON.stringify(result.link));assert.ok(maintainGripLink([a,b]).link);
  const before=transforms(b);a.object.position.z+=.1;a.object.updateMatrixWorld(true);maintainGripLink([a,b]);fixedBody(before);
  assert.ok(pos(first).distanceTo(second.localToWorld(new Vector3(...result.link.offset)))<.0031);
});
test('repeated depth and sideways moves retain elbow hinge, bone offsets, and untouched figure',()=>{
  const p=pair(),before=transforms(p.b),elbow=p.a.object.getObjectByName('LeftForeArm');
  const hinge=captureJointPivot(p.a,elbow,new PerspectiveCamera()),initial=elbow.quaternion.clone();
  const offsets=new Map([...p.a.bindPositions.keys()].map(n=>[n,n.position.clone()]));
  for(let i=0;i<80;i++) {
    p.a.object.position.add(new Vector3(.006*Math.sin(i),0,i<40?.03:-.03));p.a.object.updateMatrixWorld(true);
    maintainGripLink(p.rigs);fixedBody(before);assert.ok(contact(p)<.0031);
    for(const [bone,offset] of offsets)assert.ok(bone.position.equals(offset));
    const q=initial.clone().invert().multiply(elbow.quaternion).normalize();
    assert.ok(new Vector3(q.x,q.y,q.z).cross(hinge.hinge).length()<1e-6,'Elbow left its bend plane');
  }
});

for(const name of ['LeftForeArm','RightLeg','LeftArm','LeftHand','Head','LeftUpLeg','Spine01','Hips'])test('single move preserves every bone length and keeps unrelated joint positions fixed: '+name,()=>{
  const r=rig(),bone=r.object.getObjectByName(name),state=captureJointMove(r,bone),initial=pos(bone);
  const relatives=new Set();bone.traverse(n=>relatives.add(n));
  const lengths=new Map(state.nodes.filter(e=>e.node.parent?.isBone).map(e=>[e.node,e.p.distanceTo(pos(e.node.parent))]));
  applyJointMove(state,initial.clone().add(new Vector3(.12,.08,-.06)));
  assert.ok(pos(bone).distanceTo(initial)>.001,'Selected joint did not move');
  for(const entry of state.nodes){
    if(!relatives.has(entry.node))assert.ok(pos(entry.node).distanceTo(entry.p)<1e-7,'Unrelated joint moved');
    if(lengths.has(entry.node))assert.ok(Math.abs(pos(entry.node).distanceTo(pos(entry.node.parent))-lengths.get(entry.node))<1e-7,'Bone length changed');
  }
  applyJointMove(state,initial);
  for(const entry of state.nodes)assert.ok(pos(entry.node).distanceTo(entry.p)<1e-7,'Reversal drift');
});
test('pivot follows a world-space cursor target and retains a stiff arm pose',()=>{
  const r=rig(),bone=r.object.getObjectByName('LeftArm'),child=r.object.getObjectByName('LeftForeArm'),hand=r.object.getObjectByName('LeftHand');
  const state=captureJointPivot(r,bone,new PerspectiveCamera()),q=child.quaternion.clone(),w=hand.quaternion.clone(),before=pos(child);
  const delta=new Vector3(.03,.06,0);applyJointPivotTarget(state,state.origin.clone().add(delta));
  assert.ok(pos(bone).distanceTo(state.origin)<1e-8);assert.deepEqual(child.quaternion.toArray(),q.toArray());assert.deepEqual(hand.quaternion.toArray(),w.toArray());
  assert.ok(pos(child).sub(before).dot(delta)>0);applyJointPivotTarget(state,state.origin);assert.ok(pos(child).distanceTo(before)<1e-7);
});

test('grip-limited single joint movement preserves all bone lengths',()=>{
  const p=pair(),bone=p.a.object.getObjectByName('LeftForeArm'),state=captureJointMove(p.a,bone);
  const lengths=new Map(state.nodes.filter(e=>e.node.parent?.isBone).map(e=>[e.node,e.p.distanceTo(pos(e.node.parent))]));
  applyJointMove(state,pos(bone).add(new Vector3(.3,.2,.1)));maintainGripLink(p.rigs,{allowArmAdjustment:false});
  for(const [node,length] of lengths)assert.ok(Math.abs(pos(node).distanceTo(pos(node.parent))-length)<1e-7);
});

test('grip reach gives slightly at the shoulder, remains capped, and never stretches bones or moves the other figure',()=>{
  const p=pair(),shoulder=p.a.object.getObjectByName('LeftShoulder'),start=shoulder.quaternion.clone().normalize(),other=transforms(p.b);
  const offsets=new Map([...p.a.bindPositions.keys()].map(n=>[n,n.position.clone()]));
  const upper=p.a.object.getObjectByName('LeftArm');const away=pos(upper).sub(pos(p.hand)).normalize().multiplyScalar(.025);
  let maximum=0;
  for(let i=0;i<36;i++){
    p.a.object.position.add(away);p.a.object.updateMatrixWorld(true);maintainGripLink(p.rigs);
    const angle=start.angleTo(shoulder.quaternion.clone().normalize());maximum=Math.max(maximum,angle);
    assert.ok(angle<=Math.PI/30+1e-6,'Shoulder allowance accumulated');assert.ok(contact(p)<.0031);fixedBody(other);
    for(const [node,offset] of offsets)assert.ok(node.position.equals(offset),'Bone offset changed');
  }
  assert.ok(maximum>.001,'No shoulder give was available');
});

for(const [joint,terminal] of [['LeftForeArm','LeftHand'],['RightArm','RightHand'],['LeftLeg','LeftFoot'],['RightUpLeg','RightFoot'],['LeftHand','LeftHand'],['LeftFoot','LeftFoot']])test('single movement keeps '+terminal+' angle relative to its parent when moving '+joint,()=>{
  const r=rig(),bone=r.object.getObjectByName(joint),end=r.object.getObjectByName(terminal);
  end.rotateX(.35);end.rotateZ(-.2);r.object.updateMatrixWorld(true);
  const state=captureJointMove(r,bone),rotation=end.quaternion.clone(),descendants=[];
  end.traverse(n=>{if(n.isBone&&n!==end)descendants.push({node:n,p:n.position.clone(),q:n.quaternion.clone()});});
  for(const delta of [new Vector3(.1,.1,.05),new Vector3(-.1,.04,-.1),new Vector3()]){
    applyJointMove(state,state.nodes.find(e=>e.node===bone).p.clone().add(delta));
    assert.deepEqual(end.quaternion.toArray(),rotation.toArray());
    for(const e of descendants){assert.ok(e.node.position.equals(e.p));assert.deepEqual(e.node.quaternion.toArray(),e.q.toArray());}
  }
});

const maintainPins=rigs=>maintainJointPins(rigs,()=>maintainGripLink(rigs));
const pinErrors=rigs=>rigs.flatMap(r=>r.jointPins||[]).map(pin=>{const r=rigs.find(r=>r.jointPins?.includes(pin));return pos(r.object.getObjectByName(pin.bone)).distanceTo(new Vector3(...pin.position));});
for(const names of [['LeftHand'],['LeftFoot','RightFoot'],['LeftLeg','LeftFoot'],['Hips']])test('pins retain world positions and limb lengths: '+names.join(', '),()=>{
  const r=rig(),other=rig('B'),rigs=[r,other],beforeOther=transforms(other),initial=r.object.position.clone();
  const offsets=new Map([...r.bindPositions.keys()].map(n=>[n,n.position.clone()]));
  for(const name of names)toggleJointPin(rigs,r,r.object.getObjectByName(name));
  for(let i=0;i<12;i++){
    r.object.position.add(new Vector3(.003,-.01,.002));r.object.updateMatrixWorld(true);maintainPins(rigs);
    assert.ok(pinErrors(rigs).every(error=>error<=.0031));fixedBody(beforeOther);
    for(const [bone,offset]of offsets)assert.ok(bone.position.equals(offset),'Bone translated');
  }
  if(names.length===1&&names[0]==='LeftHand')assert.ok(r.object.position.distanceTo(initial)>.03,'Pin froze the entire figure');
  releaseJointPins(rigs);r.object.position.x+=1;r.object.updateMatrixWorld(true);maintainPins(rigs);assert.equal(r.jointPins.length,0);
});
test('multiple pins reach a limit, remain stable under repeated attempts and allow rotation',()=>{
  const r=rig(),rigs=[r];for(const name of ['LeftFoot','RightFoot','LeftLeg','RightLeg'])toggleJointPin(rigs,r,r.object.getObjectByName(name));
  let limited=false;
  for(let i=0;i<15;i++){r.object.position.x+=.5;r.object.updateMatrixWorld(true);limited=maintainPins(rigs).limited||limited;assert.ok(pinErrors(rigs).every(e=>e<=.0031));}
  assert.ok(limited);
  releaseJointPins(rigs);const hips=r.object.getObjectByName('Hips');toggleJointPin(rigs,r,hips);const q=r.object.quaternion.clone();r.object.rotateY(.3);r.object.updateMatrixWorld(true);maintainPins(rigs);
  assert.ok(pinErrors(rigs).every(e=>e<=.0031));assert.ok(r.object.quaternion.angleTo(q)>.2);
});
test('pins and a grip either remain satisfied together or reject the movement',()=>{
  const p=pair();toggleJointPin(p.rigs,p.b,p.elbow);toggleJointPin(p.rigs,p.a,p.a.object.getObjectByName('LeftFoot'));
  for(let i=0;i<8;i++){p.a.object.position.z+=.025;p.a.object.updateMatrixWorld(true);maintainPins(p.rigs);assert.ok(contact(p)<.0031);assert.ok(pinErrors(p.rigs).every(e=>e<=.0031));}
});
test('toggle and restoring pin descriptors rebase constraints without moving the saved pose',()=>{
  const r=rig(),rigs=[r],hand=r.object.getObjectByName('LeftHand');toggleJointPin(rigs,r,hand);assert.ok(isJointPinned(r,hand));
  const saved=JSON.parse(JSON.stringify(r.jointPins));toggleJointPin(rigs,r,hand);assert.equal(isJointPinned(r,hand),false);
  r.jointPins=saved;const before=transforms(r);maintainPins(rigs);fixedBody(before);assert.ok(isJointPinned(r,hand));
});

for(const side of ['Left','Right'])test(side+' toe dragging turns the foot at the ankle without displacing the toe inside the foot',()=>{
  const r=rig(),toe=r.object.getObjectByName(side+'ToeBase'),foot=r.object.getObjectByName(side+'Foot'),state=captureJointMove(r,toe);
  const toeOffset=toe.position.clone(),toeAngle=toe.quaternion.clone(),footAngle=foot.quaternion.clone(),ankle=pos(foot),before=transforms(r),start=pos(toe);
  applyJointMove(state,start.clone().add(new Vector3(.08,.08,.03)));
  assert.ok(pos(toe).distanceTo(start)>.01,'Toe did not follow drag');
  assert.ok(toe.position.distanceTo(toeOffset)<1e-7,'Toe slid inside the foot: '+toe.position.distanceTo(toeOffset));
  assert.ok(foot.quaternion.angleTo(footAngle)>.01,'Foot did not turn at ankle');
  assert.ok(pos(foot).distanceTo(ankle)<1e-7,'Ankle moved');assert.deepEqual(toe.quaternion.toArray(),toeAngle.toArray());
  const subtree=new Set();foot.traverse(n=>subtree.add(n));
  for(const entry of before)if(!subtree.has(entry.node))assert.ok(entry.node.matrixWorld.elements.every((v,i)=>Math.abs(v-entry.world.elements[i])<1e-7),'Other limb moved');
  applyJointMove(state,start);for(const entry of state.nodes)assert.ok(pos(entry.node).distanceTo(entry.p)<1e-7,'Reversal drift');
});

test('two pins per figure independently; an existing pin can be released at the cap',()=>{
  const a=rig('A'),b=rig('B'),rigs=[a,b];
  for(const r of rigs){
    for(const name of ['LeftHand','RightFoot'])assert.equal(toggleJointPin(rigs,r,r.object.getObjectByName(name)),true);
    assert.equal(toggleJointPin(rigs,r,r.object.getObjectByName('Head')),false);
    assert.equal(r.jointPins.length,2);
  }
  assert.equal(toggleJointPin(rigs,a,a.object.getObjectByName('LeftHand')),true);
  assert.equal(toggleJointPin(rigs,a,a.object.getObjectByName('Head')),true);
  assert.equal(a.jointPins.length,2);assert.equal(b.jointPins.length,2);
});

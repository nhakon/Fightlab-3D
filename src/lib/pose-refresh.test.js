import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {parse} from 'svelte/compiler';
import {FIGURE_POSES,applyFigurePose} from './figure-poses.js';

test('refresh after every wheel pose grounds the actual skinned standing figure using fresh bounds',async()=>{
  const bytes=readFileSync(new URL('../../static/fightlab3d/meshy/Meshy_AI_Low_Poly_Humanoid_Fig_biped/Meshy_AI_Low_Poly_Humanoid_Fig_biped_Character_output.glb',import.meta.url));
  const jsonSize=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonSize));
  const binStart=20+jsonSize,binSize=bytes.readUInt32LE(binStart);
  gltf.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(binStart+8,binStart+8+binSize).toString('base64');
  // Skinning and geometry are real; textures are irrelevant to bounds and require a browser.
  delete gltf.images;delete gltf.textures;delete gltf.materials;
  for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  const oldProgress=globalThis.ProgressEvent;
  globalThis.ProgressEvent ??= class ProgressEvent{constructor(type,init){this.type=type;Object.assign(this,init);}};
  let object;
  try{object=(await new GLTFLoader().parseAsync(JSON.stringify(gltf),'' )).scene;}finally{if(!oldProgress)delete globalThis.ProgressEvent;}
  const bones=[];object.traverse(n=>{if(n.isBone)bones.push(n);});
  const rig={object,bindPositions:new Map(bones.map(n=>[n,n.position.clone()])),bindQuaternions:new Map(bones.map(n=>[n,n.quaternion.clone()])),positionOverrides:new Map()};
  const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
  const functions=parse(source).instance.content.body.filter(n=>n.type==='FunctionDeclaration'&&['resetMeshyRigToBindPose','placeMeshyRigNeutralStanding'].includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
  const reset=new Function('THREE','FLOOR_Y','updateMeshyRigHandles',functions+';return placeMeshyRigNeutralStanding;')(THREE,-.5,()=>{});
  for(const person of ['A','B'])for(const pose of FIGURE_POSES){
    applyFigurePose(rig,pose.id,-.5);reset(rig,person);
    object.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();n.computeBoundingBox();}});
    const box=new THREE.Box3().setFromObject(object);
    assert.ok(Math.abs(box.min.y-(-.48))<1e-6,person+' after '+pose.id+' started below the floor: '+box.min.y);
    assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x-(person==='A'?-.55:.55))<1e-6);
  }
  // Check contact on the real skin, normalized to a two-unit figure.
  object.rotation.set(0,0,0);object.updateMatrixWorld(true);
  object.scale.setScalar(2/new THREE.Box3().setFromObject(object,true).getSize(new THREE.Vector3()).y);
  const point=name=>object.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const surfaceMin=names=>{
    let min=Infinity;
    object.traverse(mesh=>{
      if(!mesh.isSkinnedMesh)return;
      mesh.skeleton.update();
      const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,v=new THREE.Vector3();
      for(let i=0;i<indices.count;i++){
        let weight=0;
        for(let c=0;c<4;c++)if(names.includes(mesh.skeleton.bones[indices.getComponent(i,c)].name))weight+=weights.getComponent(i,c);
        if(weight>.5){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld);min=Math.min(min,v.y);}
      }
    });
    return min;
  };
  applyFigurePose(rig,'seated');applyFigurePose(rig,'standing');
  for(const [bone,q] of rig.bindQuaternions)assert.deepEqual(bone.quaternion.toArray(),q.toArray(),bone.name+' differs from Neutral');
  applyFigurePose(rig,'crouching');
  for(const side of ['Left','Right']){
    assert.ok(surfaceMin([side+'Foot',side+'ToeBase'])<.035,side+' crouch foot floats');
    assert.ok(point(side+'Leg').z>point(side+'Foot').z+.1,'Knee must advance over ankle');
  }
  applyFigurePose(rig,'split');
  assert.ok(surfaceMin(['RightToeBase'])<.025,'Rear toes float');
  assert.ok(surfaceMin(['LeftFoot','LeftToeBase'])<.04,'Front foot floats');
  assert.ok(point('RightFoot').y>point('RightToeBase').y+.1,'Rear heel must be raised');
  const rearThigh=point('RightLeg').sub(point('RightUpLeg')).normalize();
  const rearShin=point('RightFoot').sub(point('RightLeg')).normalize();
  assert.ok(rearThigh.angleTo(rearShin)>Math.PI/3,'Split squat needs a clearly bent rear knee');
  applyFigurePose(rig,'supine');
  assert.ok(surfaceMin(['LeftShoulder','RightShoulder'])<.015,'Upper back floats');
  assert.ok(surfaceMin(['Hips'])<.015,'Pelvis floats while shoulder blades support the pose');
  for(const side of ['Left','Right'])assert.ok(Math.abs(point(side+'ForeArm').x-point(side+'Arm').x)<.06,'Elbow flares sideways');
  applyFigurePose(rig,'side');
  assert.ok(surfaceMin(['Hips'])<.03,'Side-lying pelvis floats');
  assert.ok(surfaceMin(['LeftShoulder'])<.03,'Side-lying shoulder floats');
  for(const pose of FIGURE_POSES){
    applyFigurePose(rig,pose.id);
    const bounds=new THREE.Box3().setFromObject(object,true);
    assert.ok(bounds.min.y<=1e-6,pose.id+' has a ground gap');
    assert.ok(bounds.min.y>=-.011,pose.id+' sinks too far into the mat');
    for(const [bone,p] of rig.bindPositions)assert.deepEqual(bone.position.toArray(),p.toArray(),pose.id+' changes bone length');
  }
});

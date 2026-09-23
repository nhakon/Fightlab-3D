import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'svelte/compiler';
import * as THREE from 'three';
const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
const names=['normalizeSavedFigurePoses','saveFigurePose','loadFigurePose','deleteFigurePose','persistFigurePoses','serializeMeshyRigPose','applyMeshyRigPose'];
const code=parse(source).instance.content.body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
function setup(){
 const rigs=['A','B'].map((person,i)=>{const object=new THREE.Group(),bone=new THREE.Bone();bone.name='Hips';object.add(bone);object.position.set(i*2,0,3);return {person,object,bindPositions:new Map([[bone,bone.position.clone()]]),bindQuaternions:new Map([[bone,bone.quaternion.clone()]]),positionOverrides:new Map(),jointPins:[{bone:'Hips',position:[0,0,0]}]};});
 const env={THREE,FLOOR_Y:-.55,meshyRigFigures:rigs,pendingMeshyRigPose:null,savedFigurePoses:[],poseLibraryPerson:'B',gripNotice:'',localStorage:{setItem(k,v){env.stored=JSON.parse(v);}},meshyRigByPerson:p=>rigs.find(r=>r.person===p),updateMeshyRigHandles(){},updateAllMeshyRigHandles(){},pushUndoSnapshot(){env.undo=api.serializeMeshyRigPose();}};
 const api=new Function('env','with(env){'+code+';return {'+names.join(',')+'};}')(env);return {env,api,rigs};
}
for(const scope of ['A','B'])test('custom pose saves '+scope+' and excludes world pins',()=>{
 const {env,api}=setup();api.saveFigurePose('Test',scope);
 assert.deepEqual(Object.keys(env.stored[0].data),scope==='both'?['A','B']:[scope]);
 for(const data of Object.values(env.stored[0].data)){assert.deepEqual(data.pins,[]);assert.equal(data.grip,null);}
 api.deleteFigurePose(0);assert.deepEqual(env.stored,[]);
});
test('single custom pose loads onto chosen figure, retains its facing/location and leaves other figure unchanged',()=>{
 const {env,api,rigs}=setup();rigs[0].object.children[0].rotation.x=.7;api.saveFigurePose('A pose','A');
 rigs[1].object.rotation.y=.8;rigs[1].object.scale.setScalar(1.4);const before=api.serializeMeshyRigPose();
 api.loadFigurePose(0);const after=api.serializeMeshyRigPose();assert.deepEqual(after.A,before.A);
 assert.ok(Math.abs(rigs[1].object.children[0].rotation.x-.7)<1e-8);assert.equal(after.B.object.position[0],before.B.object.position[0]);assert.equal(after.B.object.position[2],before.B.object.position[2]);
 assert.ok(Math.abs(after.B.object.rotation[1]-.8)<1e-8);assert.deepEqual(after.B.object.scale,before.B.object.scale);assert.deepEqual(env.undo,before);assert.equal(env.poseLibraryPerson,null);
});
test('saved pairs become independent reusable poses without losing either figure',()=>{
 const {env,api}=setup();const pair={id:'old',name:'Guard',scope:'both',data:api.serializeMeshyRigPose()};
 const migrated=api.normalizeSavedFigurePoses([pair]);assert.deepEqual(migrated.map(p=>p.scope),['A','B']);assert.deepEqual(migrated.map(p=>p.name),['Guard (A)','Guard (B)']);
 assert.deepEqual(migrated[0].data.A,pair.data.A);assert.deepEqual(migrated[1].data.B,pair.data.B);
 assert.deepEqual(api.normalizeSavedFigurePoses(migrated),migrated);api.saveFigurePose('Pair','both');assert.equal(env.savedFigurePoses.length,0);
});

test('offset hips stay at the same mat location when a saved tilted pose is applied to both',()=>{
 const {env,api,rigs}=setup();
 rigs[0].object.rotation.x=1.1;rigs[0].object.children[0].position.set(.3,1,.2);rigs[0].positionOverrides.set(rigs[0].object.children[0],true);
 api.saveFigurePose('Tilted','A');rigs[0].object.rotation.x=0;
 rigs[1].object.rotation.y=1.4;rigs[1].object.scale.setScalar(1.2);
 const anchors=rigs.map(r=>r.object.children[0].getWorldPosition(new THREE.Vector3()));
 api.loadFigurePose(0,'both');
 rigs.forEach((r,i)=>{const now=r.object.children[0].getWorldPosition(new THREE.Vector3());assert.ok(Math.abs(now.x-anchors[i].x)<1e-8);assert.ok(Math.abs(now.z-anchors[i].z)<1e-8);assert.deepEqual(r.object.children[0].quaternion.toArray(),env.savedFigurePoses[0].data.A.bones.Hips);});
});

import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {applyFigurePose} from './figure-poses.js';
test('custom seated and lying poses touch the real floor while keeping the hips mat position',async()=>{
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

  rig.person='B';const {env,api,rigs}=setup();rigs[1]=rig;
  for(const pose of ['seated','supine','prone']){
    applyFigurePose(rig,pose,env.FLOOR_Y);rig.object.rotation.set(.45,.7,.2);rig.object.updateMatrixWorld(true);api.saveFigurePose(pose,'B');
    applyFigurePose(rig,'standing',env.FLOOR_Y);rig.object.position.x+=1;rig.object.position.z-=.7;rig.object.updateMatrixWorld(true);
    const hips=rig.object.getObjectByName('Hips'),anchor=hips.getWorldPosition(new THREE.Vector3());env.poseLibraryPerson='B';api.loadFigurePose(env.savedFigurePoses.length-1);
    rig.object.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();n.computeBoundingBox();}});
    const bounds=new THREE.Box3();const vertex=new THREE.Vector3();
    rig.object.traverse(mesh=>{if(mesh.isMesh)for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,vertex);bounds.expandByPoint(vertex.applyMatrix4(mesh.matrixWorld));}});
    const now=hips.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(bounds.min.y-(env.FLOOR_Y+.015))<1e-6,pose+' floor contact '+bounds.min.y);
    assert.ok(Math.abs(now.x-anchor.x)<1e-8);assert.ok(Math.abs(now.z-anchor.z)<1e-8);
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'svelte/compiler';
import {Vector3,Plane} from 'three';
const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
const editorNodes=parse(source).instance.content.body;
function editor(name,env){
  const node=editorNodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);
  return new Function('env','with(env){'+source.slice(node.start,node.end)+'; return '+name+';}')(env);
}
const event=()=>({button:0,ctrlKey:true,clientX:10,clientY:20,pointerId:1,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
test('Ctrl-drag remains available with joint pin gestures',()=>{
  let started=false,chosen=false;const rig={};
  const env={blurActiveTextField(){},renderer:{},camera:{},meshyRigFigures:[rig],poseWheel:null,poseLibraryPerson:null,lastJointTap:null,jointTapStart:null,
    chooseGripEndpoint(){chosen=true},isMobileViewport:()=>false,meshyRigDrag:null,
    pickMeshyRigFigure:()=>({rig,hit:{}}),startMeshyFigureDrag(){started=true}};
  editor('handleMeshyRigPointerDown',env)(event());assert.equal(started,true);assert.equal(chosen,false);
});
test('depth drag plane tracks accepted movement instead of requested movement at a grip limit',()=>{
  const rig={object:{position:new Vector3(),updateMatrixWorld(){}}};let reanchored=false;
  const env={scrollSensitivity:.015,pickMeshyRigFigure:()=>({rig}),meshyFigureDrag:{rig},meshyRigDrag:null,dragSnapshotTaken:true,
    setMeshyRigPointerFromEvent(){},meshyRigRaycaster:{setFromCamera(){},ray:{direction:new Vector3(0,0,1)}},meshyRigPointer:{},camera:{},
    meshyRigDragPlane:new Plane(new Vector3(0,0,1),0),updateMeshyRigHandles(){rig.object.position.z=-.02;},reanchorMeshyFigureDrag(){reanchored=true;}};
  editor('nudgeMeshyFigureAtPointerDepth',env)(event(),1);
  assert.equal(env.meshyRigDragPlane.constant,.02);assert.equal(reanchored,true);
});
test('wheel and keyboard depth reuse whole-figure depth movement during a drag',()=>{
  const calls=[];const env={meshyFigureDrag:{clientX:10,clientY:20,pointerId:1},meshyRigDrag:null,
    nudgeMeshyFigureAtPointerDepth:(e,d)=>{calls.push(d);return true;}};
  editor('wheelHandler',env)({...event(),ctrlKey:false,deltaY:1});
  editor('nudgeActiveMeshyDepth',env)(-1);
  assert.deepEqual(calls,[1,-1]);
});

test('wheel and keyboard depth distance scale with the same sensitivity setting',()=>{
  for(const sensitivity of [.005,.015,.03]){
    const rig={object:{position:new Vector3(),updateMatrixWorld(){}}};
    const env={scrollSensitivity:sensitivity,pickMeshyRigFigure:()=>({rig}),meshyFigureDrag:{rig},meshyRigDrag:null,dragSnapshotTaken:true,
      setMeshyRigPointerFromEvent(){},meshyRigRaycaster:{setFromCamera(){},ray:{direction:new Vector3(0,0,1)}},meshyRigPointer:{},camera:{},
      meshyRigDragPlane:new Plane(new Vector3(0,0,1),0),updateMeshyRigHandles(){},reanchorMeshyFigureDrag(){}};
    env.nudgeMeshyFigureAtPointerDepth=editor('nudgeMeshyFigureAtPointerDepth',env);
    editor('wheelHandler',env)({...event(),deltaY:1});assert.ok(Math.abs(rig.object.position.z+sensitivity)<1e-10);
    editor('nudgeActiveMeshyDepth',env)(1);assert.ok(Math.abs(rig.object.position.z+2*sensitivity)<1e-10);
  }
});

for(const pointerType of ['mouse','touch'])test('double '+pointerType+' on the same joint toggles the pin',()=>{
  const handle={},calls=[];
  const env={blurActiveTextField(){},renderer:{},camera:{},meshyRigFigures:[{}],poseWheel:null,poseLibraryPerson:null,
    lastJointTap:{handle,time:Date.now(),x:10,y:20},jointTapStart:null,pickMeshyRigJoint:()=>handle,
    choosePinEndpoint:h=>calls.push(h)};
  const down=editor('handleMeshyRigPointerDown',env);env.lastJointTap.time=Date.now();
  down({...event(),ctrlKey:false,pointerType});
  assert.deepEqual(calls,[handle]);assert.equal(env.lastJointTap,null);assert.equal(env.jointTapStart,null);
});
test('a released drag does not count as the first tap',()=>{
  const env={jointTapStart:{handle:{},time:Date.now(),x:10,y:20},lastJointTap:null,
    meshyRigBodyTwistDrag:null,meshyRigTwistDrag:null,meshyFigureDrag:null,meshyRigDrag:null};
  editor('handleMeshyRigPointerUp',env)({...event(),type:'pointerup',clientX:40});
  assert.equal(env.lastJointTap,null);
});

for(const mode of ['natural','single','pivot'])test('pelvis right-drag uses lower-body rotation in '+mode+' mode',()=>{
  const bone={name:'Hips'},rig={},handle={userData:{bone,meshyRig:rig}},calls=[];
  const env={singleJointMode:mode!=='natural',pivotJointMode:mode==='pivot',
    isMeshyRigHipsBone:b=>b.name==='Hips',
    applyMeshyRigLowerBodyYaw:(h,r)=>{calls.push({handle:h,radians:r});return true;},
    meshyRigTwistDrag:{handle,pointerId:1,lastX:10,lastY:20},
    meshyRigTwistAxisForBone(){throw Error('Pelvis must not use generic whole-chain joint rotation');}};
  env.applyMeshyRigJointTwist=editor('applyMeshyRigJointTwist',env);
  const move=editor('moveMeshyRigTwistDrag',env);
  move({...event(),clientX:30,clientY:90});
  move({...event(),clientX:20,clientY:10});
  assert.deepEqual(calls,[{handle,radians:.24},{handle,radians:-.12}]);
});

for(const button of [0,2])test('Ctrl Shift button '+button+' selects the intended whole-figure rotation',()=>{
 const handle={},calls=[];const env={blurActiveTextField(){},renderer:{},camera:{},meshyRigFigures:[{}],poseWheel:null,poseLibraryPerson:null,lastJointTap:null,jointTapStart:null,isMobileViewport:()=>false,meshyRigDrag:null,pickMeshyRigJoint:()=>handle,startMeshyRigBodyTwistDrag:(e,h,mode)=>calls.push(mode)};
 editor('handleMeshyRigPointerDown',env)({...event(),button,shiftKey:true});
 assert.deepEqual(calls,[button===2?'spine-spin':'whole']);
});
test('spine spin uses only horizontal movement',()=>{
 const calls=[],handle={};const env={meshyRigBodyTwistDrag:{handle,mode:'spine-spin',pointerId:1,lastX:10,lastY:20},meshyRigGestureRadians:x=>x*.012,applyMeshyRigSpineSpin:(h,r)=>calls.push(r)};
 const move=editor('moveMeshyRigBodyTwistDrag',env);move({...event(),clientX:10,clientY:100});move({...event(),clientX:15,clientY:100});assert.deepEqual(calls,[0,.06]);
});
test('context menu is suppressed for spine spin, including after release with modifiers held',()=>{
 const canvas={};const env={renderer:{domElement:canvas},meshyRigBodyTwistDrag:{mode:'spine-spin'},meshyRigDrag:null};let prevented=0;const menu=editor('handleMeshyRigContextMenuModifier',env);
 menu({...event(),preventDefault(){prevented++}});env.meshyRigBodyTwistDrag=null;
 menu({...event(),shiftKey:true,target:canvas,preventDefault(){prevented++}});assert.equal(prevented,2);
});

import { Vector3 } from 'three';
import { isGripJoint, solveGripArm, getGripLink, rebaseGripLink } from './grip-link.js';

const states=new WeakMap(), tolerance=.003;
export const isJointPinned=(rig,bone)=>!!rig.jointPins?.some(pin=>pin.bone===bone?.name);
const validPins=rig=>(rig.jointPins||[]).filter(pin=>Array.isArray(pin.position)&&pin.position.length===3&&pin.position.every(Number.isFinite)&&isGripJoint(rig.object.getObjectByName(pin.bone)));
function capture(rigs){return rigs.flatMap(rig=>{
  rig.object.updateMatrixWorld(true);const nodes=[rig.object];rig.object.traverse(n=>{if(n.isBone)nodes.push(n);});
  return nodes.map(node=>({node,p:node.position.clone(),q:node.quaternion.clone(),s:node.scale.clone()}));
});}
function restore(snapshot,rigs){for(const e of snapshot){e.node.position.copy(e.p);e.node.quaternion.copy(e.q);e.node.scale.copy(e.s);}for(const rig of rigs)rig.object.updateMatrixWorld(true);}
function remember(rigs){states.set(rigs,{refs:rigs.map(r=>r.jointPins),snapshot:capture(rigs),limited:false});}
export function toggleJointPin(rigs,rig,bone){
  if(!rigs.includes(rig)||!isGripJoint(bone)||rig.object.getObjectByName(bone.name)!==bone)return false;
  if(!isJointPinned(rig,bone)&&(rig.jointPins?.length||0)>=2)return false;
  rig.object.updateMatrixWorld(true);
  rig.jointPins=isJointPinned(rig,bone)?rig.jointPins.filter(p=>p.bone!==bone.name):[...(rig.jointPins||[]),{bone:bone.name,position:bone.getWorldPosition(new Vector3()).toArray()}];
  remember(rigs);return true;
}
export function releaseJointPins(rigs,onlyRig=null){for(const rig of rigs)if(!onlyRig||rig===onlyRig)rig.jointPins=[];remember(rigs);}
function contactValid(rigs){
  const link=getGripLink(rigs);if(!link)return true;
  const a=rigs.find(r=>r.person===link.a.person)?.object.getObjectByName(link.a.bone),b=rigs.find(r=>r.person===link.b.person)?.object.getObjectByName(link.b.bone);
  return !!a&&!!b&&a.getWorldPosition(new Vector3()).distanceTo(b.localToWorld(new Vector3(...link.offset)))<=tolerance+.0001;
}
function pinDistance({bone,target}){return bone.getWorldPosition(new Vector3()).distanceTo(target);}
function solvePin(pin){
  if(pinDistance(pin)<=tolerance)return;
  if(/^(Left|Right)(Hand|ForeArm|Foot|Leg)$/.test(pin.bone.name)){
    solveGripArm({rig:pin.rig,bone:pin.bone},new Vector3(),pin.target,null,32);return;
  }
  // A torso/hip/head anchor moves this figure rigidly; it never recruits the other figure.
  const delta=pin.target.clone().sub(pin.bone.getWorldPosition(new Vector3()));
  const root=pin.rig.object,next=root.getWorldPosition(new Vector3()).add(delta);
  root.position.copy(root.parent?root.parent.worldToLocal(next):next);root.updateMatrixWorld(true);
}
export function maintainJointPins(rigs,applyGrip,{allowAdjustment=true}={}){
  if(rigs.some(r=>r.restoringPose))return {grip:applyGrip(),limited:false};
  const pins=rigs.flatMap(rig=>validPins(rig).map(pin=>({rig,bone:rig.object.getObjectByName(pin.bone),target:new Vector3(...pin.position)})));
  if(!pins.length){states.delete(rigs);return {grip:applyGrip(),limited:false};}
  let state=states.get(rigs);
  if(!state||rigs.some((r,i)=>r.jointPins!==state.refs[i])){remember(rigs);state=states.get(rigs);}
  const requested=capture(rigs);
  const changed=requested.some((e,i)=>!e.p.equals(state.snapshot[i]?.p)||!e.q.equals(state.snapshot[i]?.q)||!e.s.equals(state.snapshot[i]?.s));
  if(!changed)return {grip:applyGrip(),limited:state.limited};
  let grip;
  const solve=()=>{
    grip=applyGrip();
    if(allowAdjustment)for(let pass=0;pass<4;pass++){
      if(pins.every(p=>pinDistance(p)<=tolerance))break;
      for(const pin of pins)solvePin(pin);
    }
    return pins.every(p=>pinDistance(p)<=tolerance)&&contactValid(rigs);
  };
  let limited=false;
  if(!solve()){
    limited=true;let low=0,high=1,accepted=state.snapshot;
    for(let attempt=0;attempt<7;attempt++){
      const t=(low+high)/2;restore(state.snapshot,rigs);rebaseGripLink(rigs);
      for(let i=0;i<requested.length;i++){
        const start=state.snapshot[i],end=requested[i],node=end.node;
        node.position.copy(start.p).lerp(end.p,t);
        if(node.isBone&&!start.p.equals(end.p)&&start.p.lengthSq()>1e-12&&Math.abs(start.p.length()-end.p.length())<1e-8){
          if(node.position.lengthSq()<1e-12)node.position.copy(start.p);else node.position.setLength(start.p.length());
        }
        node.quaternion.copy(start.q);if(!start.q.equals(end.q))node.quaternion.slerp(end.q,t);
        node.scale.copy(start.s).lerp(end.s,t);
      }
      for(const rig of rigs)rig.object.updateMatrixWorld(true);
      if(solve()){low=t;accepted=capture(rigs);}else high=t;
    }
    restore(accepted,rigs);
  }
  rebaseGripLink(rigs);
  for(const rig of rigs)for(const bone of rig.positionOverrides?.keys()||[])rig.positionOverrides.set(bone,bone.position.clone());
  state.snapshot=capture(rigs);state.limited=limited;
  return {grip:{...grip,link:getGripLink(rigs)},limited};
}

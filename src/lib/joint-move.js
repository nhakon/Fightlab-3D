import { Quaternion, Vector3 } from 'three';

export function captureJointMove(rig, bone) {
  rig.object.updateMatrixWorld(true);
  const nodes=[];rig.object.traverse(node=>{if(node.isBone)nodes.push({node,p:node.getWorldPosition(new Vector3()),q:node.getWorldQuaternion(new Quaternion()),localQ:node.quaternion.clone(),localP:node.position.clone()});});
  return {rig,bone,nodes};
}

// Keep the parent and unrelated joints fixed. Descendants move only as far as
// their fixed-length connection requires to stay near their starting positions.
export function applyJointMove(state,target) {
  if(!state || !target.toArray().every(Number.isFinite))return false;
  const {rig,bone,nodes}=state, original=new Map(nodes.map(n=>[n.node,n]));
  if (/^(Left|Right)ToeBase$/.test(bone.name) && /^(Left|Right)Foot$/.test(bone.parent?.name || '')) {
    // A toe handle aims the rigid foot around the ankle, never slides the toe.
    const foot=bone.parent,footStart=original.get(foot),toeStart=original.get(bone);
    const from=toeStart.p.clone().sub(footStart.p),to=target.clone().sub(footStart.p);
    foot.quaternion.copy(footStart.localQ);
    if(to.lengthSq()>1e-12 && from.lengthSq()>1e-12 && target.distanceToSquared(toeStart.p)>1e-16){
      const delta=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
      const parent=foot.parent.getWorldQuaternion(new Quaternion());
      foot.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent));
    }
    bone.position.copy(toeStart.localP);bone.quaternion.copy(toeStart.localQ);
    foot.updateMatrixWorld(true);
    return true;
  }
  const positions=new Map(nodes.map(n=>[n.node,n.p.clone()]));
  const project=(point,centre,length,fallback)=>{
    const direction=point.clone().sub(centre);
    if(direction.lengthSq()<1e-12)direction.copy(fallback);
    if(direction.lengthSq()<1e-12)return centre.clone();
    return centre.clone().add(direction.normalize().multiplyScalar(length));
  };
  const entry=original.get(bone),parent=original.get(bone.parent);
  positions.set(bone,parent?project(target,parent.p,entry.p.distanceTo(parent.p),entry.p.clone().sub(parent.p)):target.clone());
  function descend(node){
    for(const child of node.children.filter(n=>original.has(n))){
      const old=original.get(child).p,centre=positions.get(node),oldParent=original.get(node).p;
      positions.set(child,project(old,centre,old.distanceTo(oldParent),old.clone().sub(oldParent)));
      descend(child);
    }
  }
  descend(bone);
  const rotations=new Map(nodes.map(n=>[n.node,n.q.clone()]));
  for(const entry of nodes){
    const child=entry.node.children.find(n=>positions.has(n));if(!child)continue;
    const from=original.get(child).p.clone().sub(entry.p),to=positions.get(child).clone().sub(positions.get(entry.node));
    if(from.lengthSq()>1e-12&&to.lengthSq()>1e-12)rotations.set(entry.node,new Quaternion().setFromUnitVectors(from.normalize(),to.normalize()).multiply(entry.q));
  }
  for(const entry of nodes){
    const node=entry.node;
    node.position.copy(node.parent.worldToLocal(positions.get(node).clone()));
    let terminal=node;
    while(terminal?.isBone && !/^(Left|Right)(Hand|Foot)$/.test(terminal.name)) terminal=terminal.parent;
    if(terminal?.isBone && /^(Left|Right)(Hand|Foot)$/.test(terminal.name)) {
      // Wrists/ankles follow their parent, except when dragging a toe directly.
      // A direct toe drag turns the foot; toes retain their angle within it.
      node.quaternion.copy(entry.localQ);
      if(node!==terminal && node!==bone)node.position.copy(entry.localP);
    } else {
      node.quaternion.copy(node.parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotations.get(node)));
    }
    node.updateMatrixWorld(true);
    if(rig.positionOverrides)rig.positionOverrides.set(node,node.position.clone());
  }
  return true;
}

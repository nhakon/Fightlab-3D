import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';

// Directions are in the figure's own frame: Y up, Z forward.
export const FIGURE_POSES = [
  {id: 'standing', label: 'Standing', icon: 'M20 10v18m0-12-10 9m10-9 10 9m-10 3-8 17m8-17 8 17'},
  {id: 'crouching', label: 'Crouching', icon: 'M19 12 25 25 12 31 21 43m4-18 9 7-5 11m-7-25 12 7'},
  {id: 'kneeling', label: 'Kneeling', icon: 'M20 10v22l-4 9h16m-12-24 9 10m-9-10-8 10'},
  {id: 'seated', label: 'Seated', icon: 'M13 11v22l15-5 7 13m-22-8 12 7h12m-24-22 10 12'},
  {id: 'supine', label: 'On back', icon: 'M10 35h17l4-19 8 19m-19 0-5-14m0 0 9-6'},
  {id: 'turtle', label: 'Turtle', icon: 'M10 22 27 18 34 33 24 40h13m-22-19-3 17h10'},
  {id: 'side', label: 'Side-lying', icon: 'M10 30h16l8 8-10 5m2-13 8-7-4-8m-13 15-5-8'},
  {id: 'split', label: 'Split squat', icon: 'M20 10v20l-10 1v12m10-13 5 12h12m-17-25 12 9'}
];

const presets = {
  standing: {neutral:true},
  crouching: {stableLegs:true, flatFeet:true, up:[0,.86,.5], head:[0,1,.08], thigh:[.18,-.60,.80], shin:[0,-.85,-.52], arm:[.18,-.8,.5], forearm:[-.12,.45,.85], foot:[.12,-.28,1]},
  kneeling: {up:[0,1,.06], thigh:[.16,-.28,.98], shin:[0,-.02,-1], arm:[.14,-1,.12], forearm:[-.05,-.55,.8], foot:[0,-.16,-1]},
  seated: {stableLegs:true, up:[0,.99,.12], head:[0,1,.04], thigh:[.5,.38,.85], shin:[-.12,-.15,.98], arm:[.24,-.7,.55], forearm:[-.1,.25,.9], foot:[.08,.2,1]},
  supine: {stableLegs:true, rigidBack:true, backTilt:.09, up:[0,-.04,-1], head:[0,.08,-1], thigh:[.32,.94,.4], shin:[-.04,-.35,1], arm:[.04,.12,.95], forearm:[0,1,-.15], foot:[0,.25,1]},
  turtle: {up:[0,-.25,1], chest:[0,-.05,1], head:[0,-.3,1], thigh:[.3,-.85,.5], shin:[0,-.04,-1], arm:[.12,-1,-.12], forearm:[-.06,-.08,1], foot:[0,-.12,-1]},
  side: {stableLegs:true, rigidBack:true, backTilt:.55, roll:1.3, up:[0,0,-1], head:[0,.1,-1], thigh:[.02,.6,.8], shin:[0,-.6,.8], arm:[-.15,.3,.95], forearm:[0,1,-.15], foot:[0,0,1]},
  split: {stableLegs:true, flatFeet:true, up:[0,.97,.20], head:[0,1,.02], thigh:[.12,-.295,.94], shin:[0,-.95,-.3], rightThigh:[-.1,-1,.10], rightShin:[0,-.22,-.98], arm:[.18,-.75,.48], forearm:[-.1,.4,.9], foot:[.05,-.28,1], rightFoot:[0,-.95,.3]}
};

export function applyFigurePose(rig, id, floorY = 0) {
  const pose = presets[id === 'combat' ? 'split' : id === 'prone' ? 'side' : id], hips = rig?.object?.getObjectByName('Hips');
  if (!pose || !hips) return false;
  const anchor = hips.getWorldPosition(new Vector3());
  const yaw = new Euler().setFromQuaternion(rig.object.quaternion, 'YXZ').y;
  rig.object.quaternion.setFromAxisAngle(new Vector3(0,1,0), yaw);
  rig.positionOverrides?.clear();
  for (const [bone, position] of rig.bindPositions) bone.position.copy(position);
  for (const [bone, rotation] of rig.bindQuaternions) bone.quaternion.copy(rotation);
  rig.object.updateMatrixWorld(true);
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), yaw);
  const rest = new Map();
  rig.object.traverse(bone=>{if(bone.isBone)rest.set(bone.name,{rotation:bone.getWorldQuaternion(new Quaternion()),position:bone.getWorldPosition(new Vector3())});});
  const setWorld = (bone, world) => {
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));bone.updateMatrixWorld(true);
  };
  const orient = (name, childName, direction, normal) => {
    const bone=rig.object.getObjectByName(name);if(!bone||!rest.has(childName))return;
    const start=rest.get(name),from=rest.get(childName).position.clone().sub(start.position).normalize();
    const basis=(d,n)=>{n=n.clone().addScaledVector(d,-n.dot(d)).normalize();return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(n,d,new Vector3().crossVectors(n,d).normalize()));};
    const to=new Vector3(...direction).applyQuaternion(facing).normalize();
    const delta=basis(to,normal).multiply(basis(from,new Vector3(1,0,0).applyQuaternion(facing)).invert());
    setWorld(bone,delta.multiply(start.rotation));
  };
  const aim = (name, childName, direction) => {
    const bone = rig.object.getObjectByName(name), child = rig.object.getObjectByName(childName);
    if (!bone || !child) return;
    const from = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
    const to = new Vector3(...direction).applyQuaternion(facing).normalize();
    const delta = new Quaternion().setFromUnitVectors(from, to);
    const parent = bone.parent.getWorldQuaternion(new Quaternion());
    bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent)).normalize();
    bone.updateMatrixWorld(true);
  };
  if (!pose.neutral) {
    if(pose.rigidBack){
      const delta=new Quaternion().setFromAxisAngle(new Vector3(1,0,0).applyQuaternion(facing),-Math.PI/2+(pose.backTilt||0));
      setWorld(hips,delta.multiply(rest.get('Hips').rotation));
    } else {
      aim('Hips', 'Spine02', pose.up);
      aim('Spine02', 'Spine01', pose.chest || pose.up);
    }
    aim('neck', 'Head', pose.head || pose.chest || pose.up);
    for (const [side, sign] of [['Left',1], ['Right',-1]]) {
      const mirror = vector => [vector[0] * sign, vector[1], vector[2]];
      aim(side+'UpLeg', side+'Leg', side === 'Right' && pose.rightThigh ? pose.rightThigh : mirror(pose.thigh));
      aim(side+'Leg', side+'Foot', side === 'Right' && pose.rightShin ? pose.rightShin : mirror(pose.shin));
      if(pose.stableLegs){
        const thigh=side==='Right'&&pose.rightThigh?pose.rightThigh:mirror(pose.thigh);
        const shin=side==='Right'&&pose.rightShin?pose.rightShin:mirror(pose.shin);
        const normal=new Vector3().crossVectors(new Vector3(...thigh),new Vector3(...shin)).normalize().applyQuaternion(facing);
        orient(side+'UpLeg',side+'Leg',thigh,normal);orient(side+'Leg',side+'Foot',shin,normal);
      }
      if(pose.flatFeet && !(side==='Right'&&pose.rightFoot))setWorld(rig.object.getObjectByName(side+'Foot'),rest.get(side+'Foot').rotation);
      else if(pose.stableLegs)orient(side+'Foot',side+'ToeBase',side==='Right'&&pose.rightFoot?pose.rightFoot:mirror(pose.foot||[0,-.28,1]),new Vector3(1,0,0).applyQuaternion(facing));
      else aim(side+'Foot', side+'ToeBase', side === 'Right' && pose.rightFoot ? pose.rightFoot : mirror(pose.foot || [0,-.28,1]));
      if(side==='Right'&&pose.rightFoot&&pose.flatFeet)setWorld(rig.object.getObjectByName(side+'ToeBase'),rest.get(side+'ToeBase').rotation);
      aim(side+'Arm', side+'ForeArm', mirror(pose.arm));
      aim(side+'ForeArm', side+'Hand', mirror(pose.forearm));
    }
  }
  if(pose.roll){
    const axis=new Vector3(...pose.up).applyQuaternion(facing).normalize();
    setWorld(hips,new Quaternion().setFromAxisAngle(axis,pose.roll).multiply(hips.getWorldQuaternion(new Quaternion())));
  }
  const movedAnchor = hips.getWorldPosition(new Vector3());
  rig.object.position.x += anchor.x - movedAnchor.x;
  rig.object.position.z += anchor.z - movedAnchor.z;
  rig.object.updateMatrixWorld(true);
  rig.object.traverse(node => {
    if (node.isSkinnedMesh) { node.skeleton.update(); node.computeBoundingBox(); }
  });
  const bounds = new Box3().setFromObject(rig.object, true);
  let minY = bounds.min.y;
  if (!Number.isFinite(minY)) {
    minY = Infinity;
    rig.object.traverse(node => { if (node.isBone) minY = Math.min(minY, node.getWorldPosition(new Vector3()).y - .025); });
  }
  // Settle a small surface patch into the mat instead of balancing on one
  // protruding vertex. The overlap is capped at 0.5% of standing height.
  const heights = [], vertex = new Vector3();
  rig.object.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i=0;i<mesh.geometry.attributes.position.count;i++) {
      mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);
      heights.push(vertex.y);
    }
  });
  let settle = 0;
  if (heights.length) {
    heights.sort((a,b)=>a-b);
    const head = rest.get('Head')?.position, toe = rest.get('LeftToeBase')?.position;
    const standingHeight = head && toe ? Math.abs(head.y-toe.y) : bounds.getSize(new Vector3()).y;
    settle = Math.min(Math.max(0,heights[Math.floor(heights.length*.02)]-minY),standingHeight*.005);
  }
  rig.object.position.y += floorY - minY - settle;
  rig.object.updateMatrixWorld(true);
  return true;
}

export function poseWheelIndex(x, y, count = FIGURE_POSES.length) {
  if (Math.hypot(x, y) < 42 || Math.hypot(x, y) > 190) return -1;
  return Math.floor(((Math.atan2(y,x) + Math.PI/2 + Math.PI/count + Math.PI*2) % (Math.PI*2)) / (Math.PI*2/count));
}

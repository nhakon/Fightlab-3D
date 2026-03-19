<script>
  import { onMount, tick, onDestroy } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
  import { GUI } from "lil-gui";
  import * as Poses from "$lib/poses";
  import { isSupabaseConfigured, requireSupabase } from "$lib/supabase";
  import poseNeutralPreset from "./jiu-jitsu-assets/pose-neutral.json";
  import poseOpenGuardPreset from "./jiu-jitsu-assets/pose-openGuard.json";
  import poseClosedGuardPreset from "./jiu-jitsu-assets/pose-closedGuard.json";
  import poseSideControlPreset from "./jiu-jitsu-assets/pose-sideControl.json";
  import poseBackControlPreset from "./jiu-jitsu-assets/pose-backControl.json";
  import poseKneeShieldPreset from "./jiu-jitsu-assets/pose-kneeShield.json";
  import poseHalfGuardPreset from "./jiu-jitsu-assets/pose-halfGuard.json";
  import poseMountPreset from "./jiu-jitsu-assets/pose-mount.json";

  // ---------- Config / State ----------
  let canvas;
  let scene, camera, renderer, controls;
  let groundMesh = null;
  // 4-view mode cameras
  let fourViewMode = false;
  let camFront = null, camSide = null, camTop = null; // orthographic cameras
  let dragCamera = null; // camera used when a drag starts (per-view)
  let dragView = 'persp';
  // Ortho view state (pan centers and zoom)
  let frontCenter = new THREE.Vector3(0, 0.9, 0);
  let sideCenter = new THREE.Vector3(0, 0.9, 0);
  let topCenter = new THREE.Vector3(0, 0.9, 0);
  let frontZoom = 1, sideZoom = 1, topZoom = 1;
  const ORTHO_BASE_SIZE = 2.2; // half-extent for ortho frustums before zoom
  const ORTHO_DIST = 6; // camera distance for ortho views
  let activePointerView = 'persp';
  let orthoPan = { active: false, view: null, startX: 0, startY: 0, startCenter: new THREE.Vector3() };
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  // Independent drag state per figure
  const dragState = {
    A: { plane: null, offset: null, camera: null, view: 'persp', lastTarget: null, atLimit: false, justScrolled: false },
    B: { plane: null, offset: null, camera: null, view: 'persp', lastTarget: null, atLimit: false, justScrolled: false }
  };

  // Preserve torso/head yaw+roll during Natural-mode drags
  let natLock = { active:false, person:null, spineBefore:null, headBefore:null, headDrag:false };
  // Preferred head local rotation per figure; updated when user explicitly drags the head/neck
  let headPreferredA = null, headPreferredB = null;
  let headDragPerson = null; // 'A' | 'B' while head is being dragged
  let hoverUpperHandlePerson = null;
  let lastHandleHover = { person: null, time: 0 };

  // Upper-body rotation drag state
  const upperDrag = {
    active: false,
    person: null, // 'A' | 'B'
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    pivot: new THREE.Vector3(), // hip center
    baseRel: new Map(), // key -> Vector3 relative to pivot at drag start
    baseRelOther: new Map(), // synced rotation map for other figure
    accumQ: new THREE.Quaternion(),
    view: 'persp',
    camera: null,
    // when true (Ctrl+click on upper handle), rotate the whole figure instead of just upper body
    wholeBody: false,
    // drag rotation mode: 'yawPitch' for handle, 'pendulum' for torso click
    mode: 'yawPitch',
    // base direction from hip center to shoulder center at drag start
    baseDir: new THREE.Vector3(),
    // synced rotation state
    syncBoth: false,
    otherPerson: null,
    pivotOther: new THREE.Vector3()
  };
  // Lower-body rotation via upper handle + Ctrl+Shift
  const lowerHandleDrag = {
    active: false,
    person: null,
    lastX: 0,
    lastY: 0,
    pivot: new THREE.Vector3(),
    baseRel: new Map(),
    accumQ: new THREE.Quaternion(),
    view: 'persp',
    camera: null
  };

  const CTRL_DOUBLE_TAP_MS = 420;
  const ROTATE_SYNC_ARM_MS = 1400;
  let lastCtrlTapMs = 0;
  let rotateSyncArmUntil = 0;
  const timeNowMs = ()=> (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();

  function upperBodyKeys(){
    return ['head','neck','shoulderL','shoulderR','elbowL','elbowR','handL','handR'];
  }
  function lowerBodyKeys(){
    return ['hipL','hipR','kneeL','kneeR','footL','footR'];
  }
  function startLowerHandleDrag(event, person, joints, view, cam){
    lowerHandleDrag.active = true;
    lowerHandleDrag.person = person;
    lowerHandleDrag.lastX = event.clientX; lowerHandleDrag.lastY = event.clientY;
    lowerHandleDrag.view = view; lowerHandleDrag.camera = cam;
    lowerHandleDrag.accumQ.identity();
    const hL = new THREE.Vector3(...joints.hipL);
    const hR = new THREE.Vector3(...joints.hipR);
    lowerHandleDrag.pivot = hL.clone().add(hR).multiplyScalar(0.5);
    lowerHandleDrag.baseRel.clear();
    for (const key of lowerBodyKeys()){
      const p = joints[key]; if (!p) continue;
      lowerHandleDrag.baseRel.set(key, new THREE.Vector3(p[0]-lowerHandleDrag.pivot.x, p[1]-lowerHandleDrag.pivot.y, p[2]-lowerHandleDrag.pivot.z));
    }
    activeJointIdx = null;
    controls.enabled = false; orbitEnabled = false;
    try{ const el2 = renderer?.domElement; if (el2) el2.style.cursor = 'grabbing'; }catch(e){}
  }

  function startUpperHandleDrag(event, handlePerson, view, cam, ctrlOnly, ctrlShift){
    if (!handlePerson) return false;
    const el = renderer?.domElement;
    dragging = (handlePerson==='A') ? upperHandleA : upperHandleB;
    activePerson = handlePerson;
    selectedPerson = handlePerson;
    activeJointIdx = null;
    const joints = (handlePerson==='A') ? jointsA : jointsB;
    dragCamera = cam; dragView = view;
    try{ if (el?.setPointerCapture) el.setPointerCapture(event.pointerId); }catch(e){}
    if (ctrlOnly){
      if (!dragSnapshotTaken) { pushUndoSnapshot(); dragSnapshotTaken = true; }
      startLowerHandleDrag(event, handlePerson, joints, view, cam);
      return true;
    }
    if (ctrlShift){
      if (!dragSnapshotTaken) { pushUndoSnapshot(); dragSnapshotTaken = true; }
      upperDrag.wholeBody = true;
    }
    if (!dragSnapshotTaken) { pushUndoSnapshot(); dragSnapshotTaken = true; }
    upperDrag.active = true; upperDrag.person = handlePerson; upperDrag.startX = event.clientX; upperDrag.startY = event.clientY; upperDrag.lastX = event.clientX; upperDrag.lastY = event.clientY; upperDrag.view = view; upperDrag.camera = cam; upperDrag.accumQ.identity(); upperDrag.mode = 'yawPitch';
    upperDrag.baseRelOther.clear(); upperDrag.syncBoth = false; upperDrag.otherPerson = null; upperDrag.pivotOther.set(0,0,0);
    // Ctrl+Shift rotates whole figure; otherwise just upper body
    upperDrag.wholeBody = ctrlShift;
    const hL = new THREE.Vector3(...joints.hipL); const hR = new THREE.Vector3(...joints.hipR); upperDrag.pivot = hL.clone().add(hR).multiplyScalar(0.5);
    upperDrag.baseRel.clear();
    const keys = upperDrag.wholeBody ? Object.keys(joints||{}) : upperBodyKeys();
    for (const k of keys){
      const p = joints[k]; if (!p) continue;
      upperDrag.baseRel.set(k, new THREE.Vector3(p[0]-upperDrag.pivot.x, p[1]-upperDrag.pivot.y, p[2]-upperDrag.pivot.z));
    }
    // Optionally arm synced rotation when Control was double-tapped
    const syncBoth = consumeRotateSyncArm();
    if (syncBoth){
      upperDrag.syncBoth = true;
      upperDrag.otherPerson = handlePerson === 'A' ? 'B' : 'A';
      const otherJoints = upperDrag.otherPerson === 'A' ? jointsA : jointsB;
      try{
        const ohL = new THREE.Vector3(...otherJoints.hipL);
        const ohR = new THREE.Vector3(...otherJoints.hipR);
        upperDrag.pivotOther = ohL.clone().add(ohR).multiplyScalar(0.5);
        const otherKeys = upperDrag.wholeBody ? Object.keys(otherJoints||{}) : upperBodyKeys();
        upperDrag.baseRelOther.clear();
        for (const k of otherKeys){
          const p = otherJoints[k]; if (!p) continue;
          upperDrag.baseRelOther.set(k, new THREE.Vector3(p[0]-upperDrag.pivotOther.x, p[1]-upperDrag.pivotOther.y, p[2]-upperDrag.pivotOther.z));
        }
      } catch(e){
        upperDrag.syncBoth = false;
        upperDrag.otherPerson = null;
        upperDrag.baseRelOther.clear();
      }
    }
    // Baseline torso direction from hips to shoulders at drag start
    try{
      const sL = joints.shoulderL ? new THREE.Vector3(...joints.shoulderL) : null;
      const sR = joints.shoulderR ? new THREE.Vector3(...joints.shoulderR) : null;
      if (sL && sR){
        const shoulderCenter = sL.clone().add(sR).multiplyScalar(0.5);
        upperDrag.baseDir.copy(shoulderCenter.clone().sub(upperDrag.pivot).normalize());
      } else {
        upperDrag.baseDir.set(0,1,0);
      }
    }catch(e){ upperDrag.baseDir.set(0,1,0); }
    orbitEnabled = false; controls.enabled = false;
    try{ if (el) el.style.cursor = 'grabbing'; }catch(e){}
    return true;
  }

  function pickUpperHandle(event){
    try{
      const el = renderer.domElement; const rect = el.getBoundingClientRect();
      const view = viewAtEvent(event);
      const cam = cameraForView(view) || camera;
      const ndc = ndcForEventInView(event, view);
      raycaster.setFromCamera(ndc, cam);
      const objs = [upperHandleA, upperHandleB].filter(Boolean);
      const hits = raycaster.intersectObjects(objs, true);
      if (hits && hits.length){
        let o = hits[0].object;
        if (o?.userData?.handleRoot) o = o.userData.handleRoot;
        let root = o;
        while (root && !root.userData?.person && !root.userData?.isUpperHandle) root = root.parent;
        if (root?.userData?.person) return root.userData.person;
        if (root === upperHandleA) return 'A';
        if (root === upperHandleB) return 'B';
      }
      const vps = getViewports();
      const r = (!fourViewMode || !vps) ? { x: 0, y: 0, w: rect.width, h: rect.height } : (vps[view]?.dom || { x: 0, y: 0, w: rect.width, h: rect.height });
      const screenDistForWorld = (world)=>{
        const proj = world.project(cam);
        const sx = (proj.x * 0.5 + 0.5) * r.w + rect.left + r.x;
        const sy = (-proj.y * 0.5 + 0.5) * r.h + rect.top + r.y;
        const dx = event.clientX - sx;
        const dy = event.clientY - sy;
        return Math.hypot(dx, dy);
      };
      const pickRadius = 42;
      // Fallback: screen-space hit around the handle center
      const hitByScreen = (handle, person)=>{
        if (!handle) return null;
        const world = new THREE.Vector3();
        handle.getWorldPosition(world);
        const dist = screenDistForWorld(world);
        if (dist <= pickRadius) return person;
        return null;
      };
      const screenHitA = hitByScreen(upperHandleA, 'A');
      if (screenHitA) return screenHitA;
      const screenHitB = hitByScreen(upperHandleB, 'B');
      if (screenHitB) return screenHitB;
      // Legacy fallback: compute handle position from joints if the handle mesh isn't hit
      const hitByJoints = (joints, person)=>{
        if (!joints?.head) return null;
        const world = new THREE.Vector3(joints.head[0], joints.head[1] + HEAD_HANDLE_OFFSET, joints.head[2]);
        const dist = screenDistForWorld(world);
        if (dist <= pickRadius) return person;
        return null;
      };
      const jointHitA = hitByJoints(jointsA, 'A');
      if (jointHitA) return jointHitA;
      const jointHitB = hitByJoints(jointsB, 'B');
      if (jointHitB) return jointHitB;
    }catch(e){}
    return null;
  }

  let reloadHandleTexture = null;
  function getReloadHandleTexture(){
    if (reloadHandleTexture) return reloadHandleTexture;
    if (typeof document === 'undefined') return null;
    try{
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.clearRect(0, 0, size, size);
      const scale = size / 24;
      ctx.save();
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const cx = 12;
      const cy = 12;
      const r = 6.2;
      const start = Math.PI * 0.08;
      const end = Math.PI * 1.78;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end, false);
      ctx.stroke();
      const tipX = cx + Math.cos(end) * r;
      const tipY = cy + Math.sin(end) * r;
      const headLen = 2.6;
      const headAngle = Math.PI / 7;
      const forwardAngle = end + Math.PI / 2;
      const backAngle = forwardAngle + Math.PI;
      const left = backAngle + headAngle;
      const right = backAngle - headAngle;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(left) * headLen, tipY + Math.sin(left) * headLen);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(right) * headLen, tipY + Math.sin(right) * headLen);
      ctx.stroke();
      ctx.restore();
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      reloadHandleTexture = tex;
      return reloadHandleTexture;
    }catch(e){
      return null;
    }
  }

  // Preserve bone lengths for the actively dragged joint (no IK). We snapshot
  // the parent/child lengths at drag start and constrain the joint to those.
  let dragLengthConstraint = {
    active: false,
    person: null,        // 'A' | 'B'
    jointKey: null,      // name string
    parentKey: null,     // neighbor toward parent (null for root)
    childKey: null,      // neighbor toward child if single chain (null for end)
    lParent: 0,          // distance to parent at drag start
    lChild: 0            // distance to child at drag start (if any)
  };

  // Track heel-to-toe relationship while dragging a foot joint so toes rotate with the heel
  let footDrag = {
    active: false,
    person: null,              // 'A' | 'B'
    side: null,                // 'L' | 'R'
    heelStart: new THREE.Vector3(),
    kneeStart: new THREE.Vector3(),
    toeOffsetStart: new THREE.Vector3()
  };
let toeRotateDrag = { active:false, person:null, side:null, startOffset:new THREE.Vector3(), startToeWorld:new THREE.Vector3(), startX:0, startY:0, camera:null };

  // Bridge drag: clicking the hip/pelvis structure moves both hips together (bridge-like motion)
  let bridgeDrag = {
    active: false,
    person: null,             // 'A' | 'B'
    hipLStart: new THREE.Vector3(),
    hipRStart: new THREE.Vector3(),
    hipCenterStart: new THREE.Vector3()
  };

  // Arm translate drag: in Natural mode, dragging a shoulder moves the entire arm rigidly
  let armTranslateDrag = {
    active: false,
    person: null,             // 'A' | 'B'
    side: null                // 'L' | 'R'
  };

  // Elbow translate drag: in Natural mode, dragging an elbow moves elbow+hand rigidly
  let elbowTranslateDrag = {
    active: false,
    person: null,             // 'A' | 'B'
    side: null                // 'L' | 'R'
  };
  // Hand translate drag: in Natural mode, dragging a hand moves hand+elbow only
  let handTranslateDrag = {
    active: false,
    person: null,             // 'A' | 'B'
    side: null                // 'L' | 'R'
  };

  let dragging = null;           // sphere mesh being dragged
  let activePerson = null;       // "A" or "B"
  let activeJointIdx = null;     // index in hierarchical skeleton
  let shiftDragging = false;     // true if Shift+Ctrl held at pointerdown
  let ctrlDragging = false;      // true if Ctrl held at pointerdown (move one figure)
  let touchOrbitDrag = { active: false, pointerId: null, lastX: 0, lastY: 0 };
  let touchOrbitRotateRestore = false;
  let tabToeRotate = false;      // true while Tab held (rotate toe joint instead of translate)
  let orbitEnabled = true;
  let selectedPerson = 'A';      // current selected figure for ctrl-drag
  // Quick UI hide/show toggle (H) ? only hides pose editor (lil-gui)
  let uiHidden = false;
  // Hide only the preset selector/label in the top-left bar
  let hidePresetControls = false;
  let singleJointMode = false; // false = Natural (IK) mode (default); true = Single-Joint mode
  let toolbarEl; // toolbar element for measuring height
  // Comment overlay state
  let commentEl;
  let commentText = '';
  let commentVisible = false;
  let commentPos = { left: 12, top: 12 };
  let showFrameComments = true;

  // Undo history for any drag move (joint IK, ctrl/shift drags)
  let undoHistory = []; // stack of { jointsA, jointsB, rootA, rootB, toeOffsetsA?, toeOffsetsB? }
  let dragSnapshotTaken = false;
  let undoing = false; // when true, skip solvers so undo restore doesn't drift
  let playbackApplying = false; // skip solvers/grounding while applying playback frames

  function cloneJoints(j){
    const out = {};
    for (const k of Object.keys(j||{})){
      const v = j[k];
      out[k] = Array.isArray(v) ? [v[0], v[1], v[2]] : [0,0,0];
    }
    return out;
  }

  function pushUndoSnapshot(){
    if (!skeletonA || !skeletonB) return;
    const snap = {
      jointsA: cloneJoints(jointsA),
      jointsB: cloneJoints(jointsB),
      rootA: skeletonA.rootPos.clone(),
      rootB: skeletonB.rootPos.clone(),
      toeOffsetsA: {
        L: toeOffsets.A.L.clone(),
        R: toeOffsets.A.R.clone()
      },
      toeOffsetsB: {
        L: toeOffsets.B.L.clone(),
        R: toeOffsets.B.R.clone()
      }
    };
    undoHistory.push(snap);
    if (undoHistory.length > 100) undoHistory.shift();
  }

  function undoLastFigureMove(){
    if (dragging) return; // avoid interfering mid-drag
    const snap = undoHistory.pop();
    if (!snap) return;
    // Restore joints first
    jointsA = cloneJoints(snap.jointsA);
    jointsB = cloneJoints(snap.jointsB);
    if (snap.toeOffsetsA && snap.toeOffsetsB){
      toeOffsets.A.L.copy(snap.toeOffsetsA.L);
      toeOffsets.A.R.copy(snap.toeOffsetsA.R);
      toeOffsets.B.L.copy(snap.toeOffsetsB.L);
      toeOffsets.B.R.copy(snap.toeOffsetsB.R);
    }
    // Align skeletons to joints
    try {
      skeletonA = buildBindFromNeutral(POSES.neutral.A);
      applyWorldPoseToSkeleton(skeletonA, jointsA);
      skeletonA.rootPos.copy(snap.rootA);
      groundSkeleton(skeletonA);
    } catch(e){}
    try {
      skeletonB = buildBindFromNeutral(POSES.neutral.B);
      applyWorldPoseToSkeleton(skeletonB, jointsB);
      skeletonB.rootPos.copy(snap.rootB);
      groundSkeleton(skeletonB);
    } catch(e){}
    // If torso lock is active, keep the freeze reference aligned to the restored pose
    if (torsoFreeze){
      try{
        if (skeletonA && torsoFreezeRefA){
          torsoFreezeRefA.rootPos.copy(skeletonA.rootPos);
          torsoFreezeRefA.spineLocal.copy(skeletonA.angleRot[IDX.spine]);
          if (torsoFreezeRefA.shoulderL && skeletonA.angleRot[IDX.shoulderL]) torsoFreezeRefA.shoulderL.copy(skeletonA.angleRot[IDX.shoulderL]);
          if (torsoFreezeRefA.shoulderR && skeletonA.angleRot[IDX.shoulderR]) torsoFreezeRefA.shoulderR.copy(skeletonA.angleRot[IDX.shoulderR]);
          if (torsoFreezeRefA.neck && skeletonA.angleRot[IDX.neck]) torsoFreezeRefA.neck.copy(skeletonA.angleRot[IDX.neck]);
          if (torsoFreezeRefA.head && skeletonA.angleRot[IDX.head]) torsoFreezeRefA.head.copy(skeletonA.angleRot[IDX.head]);
        }
        if (skeletonB && torsoFreezeRefB){
          torsoFreezeRefB.rootPos.copy(skeletonB.rootPos);
          torsoFreezeRefB.spineLocal.copy(skeletonB.angleRot[IDX.spine]);
          if (torsoFreezeRefB.shoulderL && skeletonB.angleRot[IDX.shoulderL]) torsoFreezeRefB.shoulderL.copy(skeletonB.angleRot[IDX.shoulderL]);
          if (torsoFreezeRefB.shoulderR && skeletonB.angleRot[IDX.shoulderR]) torsoFreezeRefB.shoulderR.copy(skeletonB.angleRot[IDX.shoulderR]);
          if (torsoFreezeRefB.neck && skeletonB.angleRot[IDX.neck]) torsoFreezeRefB.neck.copy(skeletonB.angleRot[IDX.neck]);
          if (torsoFreezeRefB.head && skeletonB.angleRot[IDX.head]) torsoFreezeRefB.head.copy(skeletonB.angleRot[IDX.head]);
        }
      }catch(e){}
    }
    undoing = true;
    updateMeshesFromJoints();
    undoing = false;
  }

  let jointsA = {}, jointsB = {};let jointMeshesA = [], jointMeshesB = [];
  let boneMeshesA = [], boneMeshesB = [];
  let torsoA = null, torsoB = null; // invisible torso anchor (for clamping)
  let pelvisA = null, pelvisB = null;
  let spineA = null, spineB = null;
  let chestA = null, chestB = null; // visible chest ellipsoid
  let shoulderBarA = null, shoulderBarB = null;
  let upperHandleA = null, upperHandleB = null; // 3D control icons for upper-body rotation
  const HANDLE_COLOR_A = 0x4f7bff;
  const HANDLE_COLOR_B = 0x2fb6a7;
  const HANDLE_COLOR_HOVER = 0x5cd47a;
  const HEAD_HANDLE_OFFSET = 0.30; // height above head joint (0.25?0.35m)
  const UPPER_HANDLE_ROT_SENS_YAW = 0.005;  // radians per pixel (horizontal move)
  const UPPER_HANDLE_ROT_SENS_PITCH = 0.004; // radians per pixel (vertical move)
  const TOE_ROTATE_SENS = 0.01; // radians per pixel for Ctrl-drag toe rotation
  let handBoxesA = { L: null, R: null }, handBoxesB = { L: null, R: null };
  let footBoxesA = { L: null, R: null }, footBoxesB = { L: null, R: null };
  let toeJointsA = { L: null, R: null }, toeJointsB = { L: null, R: null };
  let toeOffsets = {
    A: { L: new THREE.Vector3(), R: new THREE.Vector3() },
    B: { L: new THREE.Vector3(), R: new THREE.Vector3() }
  };
  // Torso freeze (global): prevent torso translation and hip bending (spine rotation)
  let torsoFreeze = false;
  let torsoFreezeRefA = null; // { rootPos, spineLocal, shoulderL, shoulderR, neck, head }
  let torsoFreezeRefB = null;
  const TORSO_FREEZE_COLOR = 0x2563eb; // torso highlight color when locked (aligned to UI accent)
  const TORSO_NORMAL_COLOR_A = 0x5b8def; // base color for figure A torso (soft blue)
  const TORSO_NORMAL_COLOR_B = 0x60c2a8; // base color for figure B torso (seafoam)

  // Controls/settings
  let showControlSettings = false;
  let scrollSensitivity = 0.04; // world-units per wheel step for joint Z movement

  // Colorblind display modes for figure body colors
  let colorblindMode = 'normal';
  const COLORBLIND_SCHEMES = {
    normal:      { label: 'Normal',       A: TORSO_NORMAL_COLOR_A, B: TORSO_NORMAL_COLOR_B, lock: TORSO_FREEZE_COLOR },
    deuteranopia:{ label: 'Deuteranopia', A: 0x4c9bce, B: 0xe3a24c, lock: 0x4b5563 },
    protanopia:  { label: 'Protanopia',   A: 0x2f9e93, B: 0xb174d6, lock: 0x4b5563 },
    tritanopia:  { label: 'Tritanopia',   A: 0x3b82f6, B: 0xd97757, lock: 0xffffff }
  };

  let dragTorsoAnchorA = null, dragTorsoAnchorB = null; // per-drag torso anchors
  let dragTorsoForwardA = null, dragTorsoForwardB = null; // projected forward vectors for clamp
  let dragRootAnchorA = null, dragRootAnchorB = null; // keep figure rooted while dragging non-hip joints
  let dragSpineAnchorA = null, dragSpineAnchorB = null;
  let dragHeadAnchorA = null, dragHeadAnchorB = null;
  let dragHeadOffsetA = null, dragHeadOffsetB = null;
  const shoulderAnchors = {
    A: { L: null, R: null },
    B: { L: null, R: null }
  };
  const TORSO_BACK_LIMIT = 0.18;   // max backward shift relative to drag start
  const TORSO_FORWARD_LIMIT = 0.35; // allow moderate forward lean
  const TORSO_SIDE_LIMIT = 0.22;   // limit sideways slide during drag
  const TORSO_ROT_LIMIT_RAD = Math.PI / 2; // allow torso to follow spine fully
  const TORSO_WIDTH_MIN = 0.28, TORSO_WIDTH_MAX = 0.6;
  const TORSO_HEIGHT_MIN = 0.4, TORSO_HEIGHT_MAX = 0.9;
  const TORSO_DEPTH_FIXED = 0.3;
  const ELBOW_MAX_DEG = 179.0; // allow near-full extension
  const KNEE_MAX_DEG = 170;
  // Shoulder extension (arm driven behind the torso) breaking point and tolerance
  // Prevents arms from going unrealistically far behind the back. Allow 10% beyond
  // the breaking point, then clamp.
  const SHOULDER_EXTENSION_BREAK_DEG = 60; // approx human shoulder extension limit
  const OVERREACH_TOL_FRAC = 0.10;         // 10% extra permitted before hard clamp

  // Visual anatomy helpers
  const HEAD_RADIUS = 0.14; // joint sphere radius used for head
  const HEAD_DIAM = HEAD_RADIUS * 2;
  const JOINT_BASE_R = 0.06; // default joint marker radius (hips/knees/etc.)
  const SHOULDER_JOINT_SCALE = 1.18; // 10?20% larger shoulders
  // Base geometry reference sizes for scaling (unit frustums)
  const TORSO_BASE_TOP_R = 0.5;
  const TORSO_BASE_BOTTOM_R = 0.35;
  const TORSO_BASE_H = 1.0;
  const PELVIS_BASE_TOP_R = 0.46;
  const PELVIS_BASE_BOTTOM_R = 0.54;
  const PELVIS_BASE_H = 1.0;
  // Rounded limb accessory targets (ellipsoids, not boxes)
  const HAND_W = 0.12, HAND_H = 0.06, HAND_L = 0.18; // previous box dims, now ellipsoid
  const HAND_SPHERE_R = 0.06; // base radius for hand ellipsoid
  const FOOT_W = 0.14, FOOT_H = 0.06, FOOT_L = 0.22; // compact, slightly narrower/shorter feet
  // Additional toe reach beyond ankle joint (moves foot joint to toes)
  const TOE_EXTEND = 0.18;
  const FOOT_SPHERE_R = 0.09; // base radius for foot ellipsoid
  const TOE_JOINT_SCALE = 0.5; // toe control joints smaller
  // Slightly extend arms to more human-like proportions
  const ARM_LENGTH_SCALE = 1.08;

  let figureGroupA = null, figureGroupB = null; // top-level groups (assigned after dummies created)

  // desired bone lengths (per person), recomputed on pose/frame change
let desiredLengthsA = new Map();
let desiredLengthsB = new Map();
let neutralTorsoLenA = 0; // hipCenter -> shoulderCenter distance in neutral
let neutralTorsoLenB = 0;
let shoulderCenterToNeckLenA = 0;
let shoulderCenterToNeckLenB = 0;
  let skeletonA = null, skeletonB = null; // hierarchical skeletons

  // Baseline (from accepted Mount) to keep proportions/axes consistent
  let baselineReady = false;
  let baselineA = null; // { lenMap, torsoLen, shoulderW, hipW, floorY }
  let baselineB = null;

  // GUI state
  let gui = null;
  const ENABLE_LIL_GUI = false; // hide built-in lil-gui pose editor
  let guiPosA = {}, guiPosB = {};
  let guiRotA = {}, guiRotB = {};
  let guiControllers = []; // store to update displays on refresh
  // optional extra torso rotations applied visually to torso meshes (all poses)
  let torsoGuiA = { rotX: 0, rotY: 0, rotZ: 0 };
  let torsoGuiB = { rotX: 0, rotY: 0, rotZ: 0 };
  function applyUiVisibility(){
    try{
      if (gui && typeof gui.hide === 'function' && typeof gui.show === 'function'){
        if (uiHidden) gui.hide(); else gui.show();
      } else if (gui?.domElement){
        gui.domElement.style.display = uiHidden ? 'none' : '';
      }
    }catch(e){}
  }
  // Constraint visuals
  let showConstraintHighlights = true;
  let highlightA = {}; // { jointKey: untilTimestampMs }
  let highlightB = {};
  let debugLinesGroup = null;
  const HIGHLIGHT_MS = 500;
  const HIGHLIGHT_COLOR = 0xff2d2d;
  const JOINT_BASE_COLOR_LIGHT = 0x111111;
  const JOINT_BASE_COLOR_DARK = 0xffffff;
  const FACE_FEATURE_COLOR = 0xdddddd;
  // Active snap animations for constraints (linear root translation)
  let activeSnaps = []; // { follower:'A'|'B', initialRoot:THREE.Vector3, delta:THREE.Vector3, t0:number, dur:number }
  // Camera WASD navigation
  const CAM_MOVE_SPEED = 0.9; // meters per second (legacy free-fly, unused for orbit)
  const CAM_ORBIT_SPEED = 3.5; // radians per second for WASD orbit
  let lastWASDActive = false; // track transitions to avoid snap on release
  let mouseLockedToJoint = false; // lock pointer mapping to the dragged joint while WASD held
  const moveKeys = { w:false, a:false, s:false, d:false };
  let pointerLocked = false; // browser pointer lock state during drag (disabled)
  let virtCursorX = 0, virtCursorY = 0; // legacy virtual cursor (unused when not locked)
  let lockCursorEl; // overlay element to draw a crosshair at joint
  let lastAnimTimeMs = (typeof performance!=='undefined'? performance.now() : Date.now());

  // During normal joint dragging, freeze both figure roots to prevent subtle hip drift
  let dragRootFreezeActive = false;
  let dragFreezeWhich = 'none'; // 'none'|'A'|'B' (freeze the non-dragging figure)
  let dragRootA = null, dragRootB = null;
  let dragSpineRefA = null, dragSpineRefB = null;

  // ---------- Joint Locking (multi-state) ----------
  let lockState = 'normal'; // 'select' -> click to toggle locks, 'active' -> locks enforced
let lockedA = new Set();
let lockedB = new Set();
// Temporary locks used during specific operations (e.g., Natural-mode drag to keep torso/head fixed)
let tempLockedA = new Set();
let tempLockedB = new Set();
  let lockedPosA = new Map(); // key -> THREE.Vector3 (world)
  let lockedPosB = new Map(); // key -> THREE.Vector3 (world)
function isLocked(person, key){
  if (person === 'A') return lockedA.has(key) || tempLockedA.has(key);
  return lockedB.has(key) || tempLockedB.has(key);
}
  function clearAllLocks(){
    lockedA.clear(); lockedB.clear(); lockedPosA.clear(); lockedPosB.clear();
    try{ for (const m of [...jointMeshesA, ...jointMeshesB]){ if (m.material?.emissive) m.material.emissive.setHex(0x000000); m.userData.locked = false; } }catch(e){}
  }
  function toggleLockForMesh(mesh){
    const key = mesh?.userData?.key; if (!key) return;
    const person = jointMeshesA.includes(mesh) ? 'A' : (jointMeshesB.includes(mesh) ? 'B' : null);
    if (!person) return;
    const set = person==='A' ? lockedA : lockedB;
    if (set.has(key)) {
      set.delete(key);
      if (person==='A') lockedPosA.delete(key); else lockedPosB.delete(key);
      mesh.userData.locked = false;
      try{ if (mesh.material?.emissive) mesh.material.emissive.setHex(0x000000); }catch(e){}
    } else {
      set.add(key);
      const wp = mesh.getWorldPosition(new THREE.Vector3());
      if (person==='A') lockedPosA.set(key, wp.clone()); else lockedPosB.set(key, wp.clone());
      mesh.userData.locked = true;
      try{ if (mesh.material?.emissive) mesh.material.emissive.setHex(0x661111); }catch(e){}
    }
  }
  // Preview highlight while in lock selection mode
  let lockPreviewMesh = null;
  function setLockPreview(mesh){
    if (lockPreviewMesh === mesh) return;
    try{
      if (lockPreviewMesh && !lockPreviewMesh.userData.locked && lockPreviewMesh.material?.emissive){
        lockPreviewMesh.material.emissive.setHex(0x000000);
      }
    }catch(e){}
    lockPreviewMesh = mesh || null;
    try{
      if (lockPreviewMesh && !lockPreviewMesh.userData.locked && lockPreviewMesh.material?.emissive){
        lockPreviewMesh.material.emissive.setHex(0x888800); // preview glow
      }
    }catch(e){}
  }

  // ---------- Viewport helpers (4-view mode) ----------
  function getViewports(){
    const el = renderer?.domElement;
    if (!el) return null;
    const w = el.clientWidth|0, h = el.clientHeight|0;
    // Reserve bottom space for toolbar when 4-view is enabled
    const gap = (fourViewMode && toolbarEl && toolbarEl.offsetHeight) ? (toolbarEl.offsetHeight + 16) : 0;
    const hAvail = Math.max(1, h - gap);
    const hw = Math.floor(w/2), hh = Math.floor(hAvail/2);
    // WebGL viewport origin is bottom-left; DOM math for hit-testing uses top-left
    // We'll return both pixel rect (DOM coords) and GL viewport
    return {
      persp: { dom: { x: 0, y: 0, w: hw, h: hh },              gl: { x: 0,  y: gap + hh, w: hw,   h: hh } },          // top-left
      front: { dom: { x: hw, y: 0, w: w-hw, h: hh },           gl: { x: hw, y: gap + hh, w: w-hw, h: hh } },          // top-right
      side:  { dom: { x: 0,  y: hh, w: hw, h: hAvail - hh },   gl: { x: 0,  y: gap,     w: hw,   h: hAvail - hh } },  // bottom-left
      top:   { dom: { x: hw, y: hh, w: w-hw, h: hAvail - hh }, gl: { x: hw, y: gap,     w: w-hw, h: hAvail - hh } }   // bottom-right
    };
  }
  function viewAtEvent(event){
    if (!fourViewMode) return 'persp';
    const el = renderer?.domElement; if (!el) return 'persp';
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const vps = getViewports(); if (!vps) return 'persp';
    for (const k of ['persp','front','side','top']){
      const r = vps[k].dom;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return k;
    }
    return 'persp';
  }
  function cameraForView(view){
    if (view === 'persp') return camera;
    if (view === 'front') return camFront;
    if (view === 'side') return camSide;
    if (view === 'top') return camTop;
    return camera;
  }
  function ndcForEventInView(event, view){
    const el = renderer?.domElement; if (!el) return {x:0,y:0};
    const rect = el.getBoundingClientRect();
    const vps = getViewports(); if (!vps) return {x:0,y:0};
    if (!fourViewMode) {
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = (event.clientY - rect.top) / rect.height;
      return { x: nx*2 - 1, y: -(ny*2 - 1) };
    }
    const r = vps[view]?.dom || {x:0,y:0,w:rect.width,h:rect.height};
    const nx = (event.clientX - rect.left - r.x) / Math.max(1, r.w);
    const ny = (event.clientY - rect.top  - r.y) / Math.max(1, r.h);
    return { x: nx*2 - 1, y: -(ny*2 - 1) };
  }
  function updateOrthoCameras(){
    if (!camFront || !camSide || !camTop) return;
    // Keep cameras positioned relative to their centers
    camFront.position.copy(frontCenter.clone().add(new THREE.Vector3(0, 0, -ORTHO_DIST)));
    camFront.up.set(0,1,0);
    camFront.lookAt(frontCenter);
    camSide.position.copy(sideCenter.clone().add(new THREE.Vector3(-ORTHO_DIST, 0, 0)));
    camSide.up.set(0,1,0);
    camSide.lookAt(sideCenter);
    camTop.position.copy(topCenter.clone().add(new THREE.Vector3(0, ORTHO_DIST, 0)));
    camTop.up.set(0,0,-1);
    camTop.lookAt(topCenter);
    camFront.zoom = frontZoom; camFront.updateProjectionMatrix();
    camSide.zoom = sideZoom; camSide.updateProjectionMatrix();
    camTop.zoom = topZoom; camTop.updateProjectionMatrix();
  }
  function setOrthoFrustums(){
    if (!renderer || !camFront || !camSide || !camTop) return;
    // Each viewport is half-screen; compute aspect for those tiles
    const el = renderer.domElement; const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const vw = Math.max(1, Math.floor(w/2)), vh = Math.max(1, Math.floor(h/2));
    const aspect = vw / vh;
    const halfH = ORTHO_BASE_SIZE;
    const halfW = ORTHO_BASE_SIZE * aspect;
    for (const cam of [camFront, camSide, camTop]){
      cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
      cam.near = 0.01; cam.far = 1000; cam.updateProjectionMatrix();
    }
  }
  function isTypingFocus(target){
    try{
      const t = target;
      if (!t) return false;
      const tag = (t.tagName||'').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (t.isContentEditable) return true;
      return false;
    } catch(e){ return false; }
  }
  function handleWASDKeyDown(e){
    if (isTypingFocus(e.target)) return;
    const k = e.key?.toLowerCase();
    if (!(k==='w'||k==='a'||k==='s'||k==='d')) return;
    e.preventDefault();
    if (k==='w') moveKeys.w = true;
    if (k==='a') moveKeys.a = true;
    if (k==='s') moveKeys.s = true;
    if (k==='d') moveKeys.d = true;
    // Give immediate small orbit step so short taps are visible
    try{
      const step = (typeof CAM_ORBIT_SPEED !== 'undefined' ? CAM_ORBIT_SPEED : 1.2) * 0.016;
      if (k==='a') controls.rotateLeft(-step);
      if (k==='d') controls.rotateLeft(+step);
      if (k==='w') controls.rotateUp(-step);
      if (k==='s') controls.rotateUp(+step);
    } catch(err){}
  }
  function handleWASDKeyUp(e){
    const k = e.key?.toLowerCase();
    if (k==='w') moveKeys.w = false;
    else if (k==='a') moveKeys.a = false;
    else if (k==='s') moveKeys.s = false;
    else if (k==='d') moveKeys.d = false;
  }
  function updateCameraWASD(dtSec){
    if (!camera || !controls) return;
    if (!(moveKeys.w || moveKeys.a || moveKeys.s || moveKeys.d)) return;
    const ang = CAM_ORBIT_SPEED * dtSec;
    // Compute camera vector relative to target
    const target = controls.target.clone();
    const rel = camera.position.clone().sub(target);
    const sph = new THREE.Spherical();
    sph.setFromVector3(rel);
    // A/D: azimuth (theta) left/right (swapped per user request)
    if (moveKeys.a) sph.theta -= ang;
    if (moveKeys.d) sph.theta += ang;
    // W/S: polar (phi) up/down
    if (moveKeys.w) sph.phi = Math.max(0.001, Math.min(Math.PI - 0.001, sph.phi - ang));
    if (moveKeys.s) sph.phi = Math.max(0.001, Math.min(Math.PI - 0.001, sph.phi + ang));
    // Keep radius constant
    const newRel = new THREE.Vector3().setFromSpherical(sph);
    camera.position.copy(target.clone().add(newRel));
    camera.lookAt(target);
    }
  // Joint angle limits (deg) per person per joint per axis
  let limitsA = {};
  let limitsB = {};
  // Imported preset snapshots keyed by pose id (e.g., 'backControl', 'sideControl')
  let importedPoses = {}; // { poseKey: { A:{joints,euler,rootPos}, B:{...}, torsoExtras? } }

  // ---------- Hierarchical skeleton (FK/CCD IK) ----------
  const IDX = {
    root: 0,
    hipL: 1, kneeL: 2, footL: 3,
    hipR: 4, kneeR: 5, footR: 6,
    spine: 7,
    shoulderL: 8, elbowL: 9, handL: 10,
    shoulderR: 11, elbowR: 12, handR: 13,
    neck: 14, head: 15
  };
  const TOP_ORDER = [
    IDX.root,
    IDX.hipL, IDX.kneeL, IDX.footL,
    IDX.hipR, IDX.kneeR, IDX.footR,
    IDX.spine,
    IDX.shoulderL, IDX.elbowL, IDX.handL,
    IDX.shoulderR, IDX.elbowR, IDX.handR,
    IDX.neck, IDX.head
  ];
  const PARENT = [];
  PARENT[IDX.root] = -1;
  PARENT[IDX.hipL] = IDX.root; PARENT[IDX.kneeL] = IDX.hipL; PARENT[IDX.footL] = IDX.kneeL;
  PARENT[IDX.hipR] = IDX.root; PARENT[IDX.kneeR] = IDX.hipR; PARENT[IDX.footR] = IDX.kneeR;
  PARENT[IDX.spine] = IDX.root;
  PARENT[IDX.shoulderL] = IDX.spine; PARENT[IDX.elbowL] = IDX.shoulderL; PARENT[IDX.handL] = IDX.elbowL;
  PARENT[IDX.shoulderR] = IDX.spine; PARENT[IDX.elbowR] = IDX.shoulderR; PARENT[IDX.handR] = IDX.elbowR;
  PARENT[IDX.neck] = IDX.spine; PARENT[IDX.head] = IDX.neck;

  const NAME_TO_IDX = {
    head: IDX.head, neck: IDX.neck,
    shoulderL: IDX.shoulderL, shoulderR: IDX.shoulderR,
    elbowL: IDX.elbowL, elbowR: IDX.elbowR,
    handL: IDX.handL, handR: IDX.handR,
    hipL: IDX.hipL, hipR: IDX.hipR,
    kneeL: IDX.kneeL, kneeR: IDX.kneeR,
    footL: IDX.footL, footR: IDX.footR
  };
  // Reverse map for convenience
  const IDX_TO_NAME = {};
  for (const k of Object.keys(NAME_TO_IDX)) IDX_TO_NAME[NAME_TO_IDX[k]] = k;

  function jointsToVecs(j){ const o={}; for(const k of Object.keys(j)) o[k]=new THREE.Vector3(...j[k]); return o; }
  function vecsToJoints(v){ const o={}; for(const k of Object.keys(v)) o[k]=[v[k].x,v[k].y,v[k].z]; return o; }
  function centerOfJ(j,a,b){ return jointsToVecs(j) && new THREE.Vector3().addVectors(new THREE.Vector3(...j[a]), new THREE.Vector3(...j[b])).multiplyScalar(0.5); }
  function centerFromVecs(j,a,b){ return new THREE.Vector3().addVectors(j[a], j[b]).multiplyScalar(0.5); }

  function buildBindFromNeutral(neutral){
    // neutral: joint-name -> [x,y,z]
    const j = jointsToVecs(neutral);
    const hipC = new THREE.Vector3().addVectors(j.hipL, j.hipR).multiplyScalar(0.5);
    const shoulderC = new THREE.Vector3().addVectors(j.shoulderL, j.shoulderR).multiplyScalar(0.5);

    const bind = {
      rootPos: hipC.clone(),
      rootRot: new THREE.Quaternion(),
      bindDirParent: Array(16).fill(null),
      restLength: Array(16).fill(0),
      angleRot: Array(16).fill(null).map(()=> new THREE.Quaternion()),
      worldPos: Array(16).fill(null).map(()=> new THREE.Vector3()),
      worldRot: Array(16).fill(null).map(()=> new THREE.Quaternion()),
      dims: { pelvisWidth: j.hipL.distanceTo(j.hipR) * 1.2, chestWidth: j.shoulderL.distanceTo(j.shoulderR) * 1.25, chestHeight: shoulderC.distanceTo(hipC) * 0.8, chestDepth: 0.32, torsoWidth: j.shoulderL.distanceTo(j.shoulderR) * 1.1, torsoHeight: shoulderC.distanceTo(hipC) * 1.05, torsoDepth: TORSO_DEPTH_FIXED }
    };

    // Helper to set child using parent->child direction and length
    function setBind(childIdx, parentPos, parentRot, childPos){
      const dirWorld = new THREE.Vector3().subVectors(childPos, parentPos);
      const len = dirWorld.length();
      const dirN = dirWorld.clone().normalize();
      const dirParent = dirN.clone().applyQuaternion(parentRot.clone().invert());
      bind.bindDirParent[childIdx] = dirParent;
      bind.restLength[childIdx] = len;
    }

    // Initialize with identity angleRot; derive bindDirParent/restLength from neutral
    // root
    bind.worldPos[IDX.root] = hipC.clone();
    bind.worldRot[IDX.root] = bind.rootRot.clone();

    // Sequence in topological order, computing parent rots/positions from neutral (angleRot=identity)
    const NEU = {};
    NEU[IDX.root] = hipC.clone();
    NEU[IDX.hipL] = j.hipL.clone(); NEU[IDX.kneeL] = j.kneeL.clone(); NEU[IDX.footL] = j.footL.clone();
    NEU[IDX.hipR] = j.hipR.clone(); NEU[IDX.kneeR] = j.kneeR.clone(); NEU[IDX.footR] = j.footR.clone();
    NEU[IDX.spine] = shoulderC.clone();
    NEU[IDX.shoulderL] = j.shoulderL.clone(); NEU[IDX.elbowL] = j.elbowL.clone(); NEU[IDX.handL] = j.handL.clone();
    NEU[IDX.shoulderR] = j.shoulderR.clone(); NEU[IDX.elbowR] = j.elbowR.clone(); NEU[IDX.handR] = j.handR.clone();
    NEU[IDX.neck] = j.neck.clone(); NEU[IDX.head] = j.head.clone();

    const worldRotTemp = Array(16).fill(null).map(()=> new THREE.Quaternion());
    worldRotTemp[IDX.root].copy(bind.rootRot);
    for (const i of TOP_ORDER) {
      if (i === IDX.root) continue;
      const p = PARENT[i];
      const parentPos = NEU[p];
      const parentRot = worldRotTemp[p];
      setBind(i, parentPos, parentRot, NEU[i]);
      worldRotTemp[i] = parentRot.clone(); // angleRot identity in neutral
    }
    return bind;
  }

  function computeFK(skel){
    // skel: {rootPos, rootRot, bindDirParent[], restLength[], angleRot[], worldPos[], worldRot[]}
    skel.worldPos[IDX.root].copy(skel.rootPos);
    skel.worldRot[IDX.root].copy(skel.rootRot);
    for (const i of TOP_ORDER) {
      if (i === IDX.root) continue;
      const p = PARENT[i];
      const parentRot = skel.worldRot[p];
      const dirParent = skel.bindDirParent[i].clone().applyQuaternion(skel.angleRot[i]);
      const dirWorld = dirParent.clone().applyQuaternion(parentRot);
      skel.worldPos[i].copy(skel.worldPos[p]).add(dirWorld.multiplyScalar(skel.restLength[i]));
      skel.worldRot[i].copy(parentRot).multiply(skel.angleRot[i]);
    }
  }

  function jointsFromSkeleton(skel){
    const j = {};
    j.head = [skel.worldPos[IDX.head].x, skel.worldPos[IDX.head].y, skel.worldPos[IDX.head].z];
    j.neck = [skel.worldPos[IDX.neck].x, skel.worldPos[IDX.neck].y, skel.worldPos[IDX.neck].z];
    j.shoulderL = [skel.worldPos[IDX.shoulderL].x, skel.worldPos[IDX.shoulderL].y, skel.worldPos[IDX.shoulderL].z];
    j.shoulderR = [skel.worldPos[IDX.shoulderR].x, skel.worldPos[IDX.shoulderR].y, skel.worldPos[IDX.shoulderR].z];
    j.elbowL = [skel.worldPos[IDX.elbowL].x, skel.worldPos[IDX.elbowL].y, skel.worldPos[IDX.elbowL].z];
    j.elbowR = [skel.worldPos[IDX.elbowR].x, skel.worldPos[IDX.elbowR].y, skel.worldPos[IDX.elbowR].z];
    j.handL = [skel.worldPos[IDX.handL].x, skel.worldPos[IDX.handL].y, skel.worldPos[IDX.handL].z];
    j.handR = [skel.worldPos[IDX.handR].x, skel.worldPos[IDX.handR].y, skel.worldPos[IDX.handR].z];
    j.hipL = [skel.worldPos[IDX.hipL].x, skel.worldPos[IDX.hipL].y, skel.worldPos[IDX.hipL].z];
    j.hipR = [skel.worldPos[IDX.hipR].x, skel.worldPos[IDX.hipR].y, skel.worldPos[IDX.hipR].z];
    j.kneeL = [skel.worldPos[IDX.kneeL].x, skel.worldPos[IDX.kneeL].y, skel.worldPos[IDX.kneeL].z];
    j.kneeR = [skel.worldPos[IDX.kneeR].x, skel.worldPos[IDX.kneeR].y, skel.worldPos[IDX.kneeR].z];
    j.footL = [skel.worldPos[IDX.footL].x, skel.worldPos[IDX.footL].y, skel.worldPos[IDX.footL].z];
    j.footR = [skel.worldPos[IDX.footR].x, skel.worldPos[IDX.footR].y, skel.worldPos[IDX.footR].z];
    return j;
  }

  function applyWorldPoseToSkeleton(skel, joints){
    // Set angles so directions match target pose, preserving rest lengths
    const j = jointsToVecs(joints);
    const hipC = new THREE.Vector3().addVectors(j.hipL, j.hipR).multiplyScalar(0.5);
    const shoulderC = new THREE.Vector3().addVectors(j.shoulderL, j.shoulderR).multiplyScalar(0.5);
    // root position and rotation
    skel.rootPos = hipC.clone();
    skel.rootRot = new THREE.Quaternion();
    // Temp world rot accumulation
    skel.worldRot[IDX.root].copy(skel.rootRot);
    skel.worldPos[IDX.root].copy(skel.rootPos);
    const TV = [];
    TV[IDX.root] = hipC.clone();
    TV[IDX.hipL] = j.hipL.clone(); TV[IDX.kneeL] = j.kneeL.clone(); TV[IDX.footL] = j.footL.clone();
    TV[IDX.hipR] = j.hipR.clone(); TV[IDX.kneeR] = j.kneeR.clone(); TV[IDX.footR] = j.footR.clone();
    TV[IDX.spine] = shoulderC.clone();
    TV[IDX.shoulderL] = j.shoulderL.clone(); TV[IDX.elbowL] = j.elbowL.clone(); TV[IDX.handL] = j.handL.clone();
    TV[IDX.shoulderR] = j.shoulderR.clone(); TV[IDX.elbowR] = j.elbowR.clone(); TV[IDX.handR] = j.handR.clone();
    TV[IDX.neck] = j.neck.clone(); TV[IDX.head] = j.head.clone();

    for (const i of TOP_ORDER) {
      if (i === IDX.root) continue;
      const p = PARENT[i];
      const parentRot = skel.worldRot[p];
      const targetDirWorld = new THREE.Vector3().subVectors(TV[i], TV[p]).normalize();
      const targetDirParent = targetDirWorld.clone().applyQuaternion(parentRot.clone().invert());
      const fromDir = skel.bindDirParent[i].clone();
      const q = new THREE.Quaternion().setFromUnitVectors(fromDir, targetDirParent);
      skel.angleRot[i] = q;
      // accumulate to compute child's world rot for next step
      skel.worldRot[i] = parentRot.clone().multiply(q);
      // position computed afterwards by computeFK
    }
    computeFK(skel);
  }

  function groundSkeleton(skel){
    computeFK(skel);
    let minY = Infinity;
    for (const i of TOP_ORDER) minY = Math.min(minY, skel.worldPos[i].y);
    const dy = (FLOOR_Y + 0.02) - minY;
    if (Math.abs(dy) > 1e-6) { skel.rootPos.y += dy; computeFK(skel); }
  }

  function clampTorsoDriftDuringDrag(person){
    if (!dragging || !activePerson || activePerson !== person) return;
    const anchor = person === 'A' ? dragTorsoAnchorA : dragTorsoAnchorB;
    const forwardStore = person === 'A' ? dragTorsoForwardA : dragTorsoForwardB;
    if (!anchor || !forwardStore) return;
    const skel = person === 'A' ? skeletonA : skeletonB;
    if (!skel) return;
    const up = new THREE.Vector3(0,1,0);
    const forward = forwardStore.clone().projectOnPlane(up);
    if (forward.lengthSq() < 1e-8) return;
    forward.normalize();
    const side = new THREE.Vector3().crossVectors(up, forward);
    if (side.lengthSq() < 1e-8) return;
    side.normalize();
    const delta = skel.rootPos.clone().sub(anchor);
    const horiz = new THREE.Vector3(delta.x, 0, delta.z);
    let fComp = horiz.dot(forward);
    let sideComp = horiz.dot(side);
    let clamped = false;
    if (fComp < -TORSO_BACK_LIMIT){ fComp = -TORSO_BACK_LIMIT; clamped = true; }
    if (fComp > TORSO_FORWARD_LIMIT){ fComp = TORSO_FORWARD_LIMIT; clamped = true; }
    if (sideComp > TORSO_SIDE_LIMIT){ sideComp = TORSO_SIDE_LIMIT; clamped = true; }
    if (sideComp < -TORSO_SIDE_LIMIT){ sideComp = -TORSO_SIDE_LIMIT; clamped = true; }
    if (!clamped) return;
    const newHoriz = forward.clone().multiplyScalar(fComp).add(side.clone().multiplyScalar(sideComp));
    const newRoot = anchor.clone().add(newHoriz);
    newRoot.y = skel.rootPos.y;
    skel.rootPos.copy(newRoot);
    groundSkeleton(skel);
  }

  function shouldRootStayFixedForJoint(idx){
    if (idx == null) return false;
    return !(
      idx === IDX.hipL ||
      idx === IDX.hipR ||
      idx === IDX.head ||
      idx === IDX.neck ||
      idx === IDX.spine ||
      idx === IDX.root ||
      idx === IDX.shoulderL ||
      idx === IDX.shoulderR
    );
  }

  function torsoFrameFromSkeleton(skel){
    if (!skel) return null;
    try{ computeFK(skel); }catch(e){}
    const hL = skel.worldPos?.[IDX.hipL];
    const hR = skel.worldPos?.[IDX.hipR];
    const sL = skel.worldPos?.[IDX.shoulderL];
    const sR = skel.worldPos?.[IDX.shoulderR];
    if (!hL || !hR || !sL || !sR) return null;
    const hipCenter = hL.clone().add(hR).multiplyScalar(0.5);
    const shoulderCenter = sL.clone().add(sR).multiplyScalar(0.5);
    let up = shoulderCenter.clone().sub(hipCenter);
    if (up.lengthSq() < 1e-6) up.set(0,1,0);
    up.normalize();
    let right = sR.clone().sub(sL);
    if (right.lengthSq() < 1e-6) right.set(1,0,0);
    right.normalize();
    let forward = new THREE.Vector3().crossVectors(right, up);
    if (forward.lengthSq() < 1e-6) forward.set(0,0,1);
    forward.normalize();
    right = new THREE.Vector3().crossVectors(up, forward).normalize();
    forward = new THREE.Vector3().crossVectors(right, up).normalize();
    return { origin: shoulderCenter, right, up, forward };
  }

  function headOffsetFromTorsoFrame(skel){
    const frame = torsoFrameFromSkeleton(skel);
    if (!frame) return null;
    const head = skel.worldPos?.[IDX.head];
    if (!head) return null;
    const v = head.clone().sub(frame.origin);
    return new THREE.Vector3(v.dot(frame.right), v.dot(frame.up), v.dot(frame.forward));
  }

  function headTargetFromTorsoOffset(skel, offset){
    const frame = torsoFrameFromSkeleton(skel);
    if (!frame || !offset) return null;
    return frame.origin.clone()
      .add(frame.right.clone().multiplyScalar(offset.x))
      .add(frame.up.clone().multiplyScalar(offset.y))
      .add(frame.forward.clone().multiplyScalar(offset.z));
  }

  function enforceRootAnchorDuringDrag(person){
    if (!dragging || !activePerson || activePerson !== person) return;
    if (!shouldRootStayFixedForJoint(activeJointIdx)) return;
    const anchor = person === 'A' ? dragRootAnchorA : dragRootAnchorB;
    if (!anchor) return;
    const skel = person === 'A' ? skeletonA : skeletonB;
    if (!skel) return;
    const root = skel.rootPos;
    if (!root) return;
    root.x = anchor.x;
    root.z = anchor.z;
    const spineAnchor = person === 'A' ? dragSpineAnchorA : dragSpineAnchorB;
    if (spineAnchor && skel.angleRot[IDX.spine]){
      skel.angleRot[IDX.spine].copy(spineAnchor);
    }
    computeFK(skel);
  }

  function enforceHeadAnchorDuringDrag(person){
    if (!dragging || !activePerson || activePerson !== person) return;
    if (activeJointIdx === IDX.head || activeJointIdx === IDX.neck) return;
    if (activeJointIdx === IDX.hipL || activeJointIdx === IDX.hipR) return;
    const anchor = person === 'A' ? dragHeadAnchorA : dragHeadAnchorB;
    const offset = person === 'A' ? dragHeadOffsetA : dragHeadOffsetB;
    if (!anchor && !offset) return;
    const skel = person === 'A' ? skeletonA : skeletonB;
    if (!skel) return;
    const target = offset ? headTargetFromTorsoOffset(skel, offset) : anchor.clone();
    if (!target) return;
    try { computeFK(skel); }catch(e){}
    try{
      const allowed = new Set([IDX.head, IDX.neck]);
      ccdIKLimited(skel, IDX.head, target, allowed, 3);
      if (person === 'A') jointsA = jointsFromSkeleton(skel); else jointsB = jointsFromSkeleton(skel);
    }catch(e){}
  }

  function reanchorShoulder(person, side){
    const store = person === 'A' ? shoulderAnchors.A : shoulderAnchors.B;
    const anchor = store?.[side];
    if (!anchor) return;
    const joints = person === 'A' ? jointsA : jointsB;
    if (!joints) return;
    const shoulderKey = side === 'L' ? 'shoulderL' : 'shoulderR';
    const elbowKey = side === 'L' ? 'elbowL' : 'elbowR';
    const handKey = side === 'L' ? 'handL' : 'handR';
    const shoulderArr = joints[shoulderKey];
    if (!shoulderArr) return;
    const curr = new THREE.Vector3(...shoulderArr);
    const delta = curr.clone().sub(anchor);
    if (delta.lengthSq() < 1e-10) return;
    const adjust = (key)=>{
      const arr = joints[key];
      if (!arr) return;
      const v = new THREE.Vector3(...arr).sub(delta);
      joints[key] = [v.x, v.y, v.z];
    };
    adjust(shoulderKey); adjust(elbowKey); adjust(handKey);
    if (person === 'A') jointsA = joints; else jointsB = joints;
    const skel = person === 'A' ? skeletonA : skeletonB;
    if (skel){
      try{
        applyJointsToSkeletonExact(skel, joints);
      }catch(e){}
    }
  }


  function getPathToRoot(idx){
    const path = [];
    let i = idx;
    while (i !== -1) { path.push(i); i = PARENT[i]; }
    return path.reverse();
  }

  // ---------- Soft Anatomical Limits (prevent unrealistic bending) ----------
  function _angleBetween(a,b){
    const d = a.clone().normalize().dot(b.clone().normalize());
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }
  function _applyLocalWorldRotation(skel, jointIdx, childIdx, qWorld, blend=1){
    const parentWorldRot = skel.worldRot[jointIdx];
    const qWorldBlended = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), qWorld, Math.max(0, Math.min(1, blend)));
    const qLocal = parentWorldRot.clone().invert().multiply(qWorldBlended).multiply(parentWorldRot);
    skel.angleRot[childIdx] = qLocal.clone().multiply(skel.angleRot[childIdx]);
  }
  // Hinge limit around the plane formed by parent->joint and joint->child
  function limitHinge(skel, parentIdx, jointIdx, childIdx, minDeg, maxDeg, blend=0.2){
    computeFK(skel);
    const p = skel.worldPos[parentIdx];
    const j = skel.worldPos[jointIdx];
    const c = skel.worldPos[childIdx];
    const v1 = p.clone().sub(j); // toward parent
    const v2 = c.clone().sub(j); // toward child
    if (v1.lengthSq()<1e-8 || v2.lengthSq()<1e-8) return false;
    const ang = _angleBetween(v1, v2);
    const minR = THREE.MathUtils.degToRad(minDeg);
    const maxR = THREE.MathUtils.degToRad(maxDeg);
    let delta = 0;
    if (ang < minR) delta = minR - ang; else if (ang > maxR) delta = maxR - ang;
    if (Math.abs(delta) < 1e-3) return false;
    const axis = v2.clone().cross(v1).normalize();
    if (axis.lengthSq()<1e-8) return false;
    const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, delta);
    _applyLocalWorldRotation(skel, jointIdx, childIdx, qWorld, blend);
    computeFK(skel);
    return true;
  }
  // Shoulder/Hip cone limits in torso (spine) frame: clamp pitch and roll
  function limitConeTorsoFrame(skel, jointIdx, childIdx, pitchMaxDeg, rollMaxDeg, blend=0.15){
    computeFK(skel);
    const spineQ = skel.worldRot[IDX.spine];
    const j = skel.worldPos[jointIdx];
    const c = skel.worldPos[childIdx];
    const v = c.clone().sub(j);
    if (v.lengthSq()<1e-8) return false;
    const inv = spineQ.clone().invert();
    const vLocal = v.clone().applyQuaternion(inv);
    let changed = false;
    // Pitch around X axis (YZ plane)
    const pitch = Math.atan2(vLocal.z, vLocal.y);
    const pMax = THREE.MathUtils.degToRad(pitchMaxDeg);
    let dp = 0; if (pitch > pMax) dp = pMax - pitch; else if (pitch < -pMax) dp = -pMax - pitch;
    if (Math.abs(dp) > 1e-3){
      const axisWorldX = new THREE.Vector3(1,0,0).applyQuaternion(spineQ);
      const qWorld = new THREE.Quaternion().setFromAxisAngle(axisWorldX, dp);
      _applyLocalWorldRotation(skel, jointIdx, childIdx, qWorld, blend);
      changed = true; computeFK(skel);
    }
    // Roll around Z axis (XY plane)
    const v2 = skel.worldPos[childIdx].clone().sub(j).applyQuaternion(inv);
    const roll = Math.atan2(v2.x, v2.y);
    const rMax = THREE.MathUtils.degToRad(rollMaxDeg);
    let dr = 0; if (roll > rMax) dr = rMax - roll; else if (roll < -rMax) dr = -rMax - roll;
    if (Math.abs(dr) > 1e-3){
      const axisWorldZ = new THREE.Vector3(0,0,1).applyQuaternion(spineQ);
      const qWorld = new THREE.Quaternion().setFromAxisAngle(axisWorldZ, dr);
      _applyLocalWorldRotation(skel, jointIdx, childIdx, qWorld, blend);
      changed = true; computeFK(skel);
    }
    return changed;
  }
  function enforceAnatomyLimits(skel){
    let changed = false;
    try{
      // Elbows and knees: allow near-full elbow extension, keep knee at 0-150 unless changed
      changed = limitHinge(skel, IDX.shoulderL, IDX.elbowL, IDX.handL, 0, ELBOW_MAX_DEG, 0.2) || changed;
      changed = limitHinge(skel, IDX.shoulderR, IDX.elbowR, IDX.handR, 0, ELBOW_MAX_DEG, 0.2) || changed;
      changed = limitHinge(skel, IDX.hipL, IDX.kneeL, IDX.footL, 0, 150, 0.2) || changed;
      changed = limitHinge(skel, IDX.hipR, IDX.kneeR, IDX.footR, 0, 150, 0.2) || changed;
      // Shoulders and hips: cone limits relative to torso
      changed = limitConeTorsoFrame(skel, IDX.shoulderL, IDX.elbowL, 120, 90, 0.15) || changed;
      changed = limitConeTorsoFrame(skel, IDX.shoulderR, IDX.elbowR, 120, 90, 0.15) || changed;
      changed = limitConeTorsoFrame(skel, IDX.hipL, IDX.kneeL, 120, 90, 0.15) || changed;
      changed = limitConeTorsoFrame(skel, IDX.hipR, IDX.kneeR, 120, 90, 0.15) || changed;
    }catch(e){}
    return changed;
  }

  function ccdIKToTarget(skel, endIdx, target, iterations=10, force=false){
    // Respect locks for regular IK, but allow override when forcing (for world locks)
    try{
      const person = (skel === skeletonA) ? 'A' : 'B';
      const key = Object.keys(NAME_TO_IDX).find(k=> NAME_TO_IDX[k]===endIdx);
      if (!force && key && isLocked(person, key)) return;
    }catch(e){}
    // CCD over the chain (root anchored)
    computeFK(skel);
    const path = getPathToRoot(endIdx); // [root,...,end]
    for (let it=0; it<iterations; it++){
      for (let k=path.length-2; k>=0; k--){
        const joint = path[k];
        const child = path[k+1];
        // skip rotation if this segment or joint is locked (unless forcing)
        try{
          const person = (skel === skeletonA) ? 'A' : 'B';
          const childKey = Object.keys(NAME_TO_IDX).find(n=> NAME_TO_IDX[n]===child);
          const jointKey = Object.keys(NAME_TO_IDX).find(n=> NAME_TO_IDX[n]===joint);
          if (!force && ((childKey && isLocked(person, childKey)) || (jointKey && isLocked(person, jointKey)))) continue;
        }catch(e){}
        const origin = skel.worldPos[joint].clone();
        const end = skel.worldPos[endIdx].clone();
        const vCur = end.clone().sub(origin);
        const vTar = target.clone(); vTar.sub(origin);
        if (vCur.lengthSq()<1e-10 || vTar.lengthSq()<1e-10) continue;
        const qWorld = new THREE.Quaternion().setFromUnitVectors(vCur.clone().normalize(), vTar.clone().normalize());
        // convert to parent (joint) space: angleRot belongs to child (branch from joint)
        const parentWorldRot = skel.worldRot[joint];
        const qLocal = parentWorldRot.clone().invert().multiply(qWorld).multiply(parentWorldRot);
        skel.angleRot[child] = qLocal.clone().multiply(skel.angleRot[child]);
        computeFK(skel);
      }
      // optional early exit
      if (skel.worldPos[endIdx].distanceTo(target) < 1e-3) break;
    }
    // floor clamp via root shift to keep contact if needed
    groundSkeleton(skel);
  }

  let poses = []; // saved frames
  let comment = "";
  let currentFrame = 0;
  let playing = false;
  let playbackMode = "auto";
  let intervalId;
  const PLAYBACK_MIN_MS = 100;
  const PLAYBACK_MAX_MS = 3000;
  let playbackIntervalMs = (PLAYBACK_MIN_MS + PLAYBACK_MAX_MS) / 2; // midpoint by default
  let playbackSpeedPct = 0; // 0 = left (fast), 100 = right (slow)
  let playbackTimer = null;
  // Saved playbacks (multiple sequences)
  let savedPlaybacks = [];
  let playbackFolders = [];
  let editingPlaybackIdx = -1;
  let editingPlaybackName = "";
  let editingPlaybackFolder = "";
  let newPlaybackName = "";
  let draggingPlaybackIdx = null;
  let playbackFolderView = null; // null = folder list; otherwise folder name
  let openPlaybackFolders = [];
  let playbacksMenuEl;
  let playbacksToggleEl;
  let playbackContextEl;
  let playbackContextMenu = { visible:false, x:0, y:0, folder:'' };
  let playbacksMenuVersion = 0;
  let presetsMenuEl;
  let presetsToggleEl;
  let accountMenuEl;
  let accountToggleEl;
  let showAccountAuth = false;
  let loginName = '';
  let loginEmail = '';
  let isLoggedIn = false;
  let authMessage = '';
  let authDetail = '';
  let authAttempted = false;
  let authBusy = false;
  let authUnsubscribe = null;
  // User-defined presets (persisted locally)
  let savedPresets = [];
  let editingPresetIdx = -1;
  let editingPresetName = "";
  let newPresetName = "";
  let presetOverrides = {}; // persistent overrides for built-in presets
  let savedPresetsSelectEl;
  // Dropdown menus visibility
  let showSavedPlaybacksMenu = false;
  let showSavedPresetsMenu = false;
  let showAccountMenu = false;
  let showAccountShortcuts = false;
  let showAccountSettings = false;
  let darkMode = false;
  let uiReady = false;
  let navOpen = false;
  const showLanding = false;
  let showFigures = true;
  let featuresRow;
  async function openFigures(){
    showFigures = true;
    navOpen = false;
    await tick();
    if (typeof document !== 'undefined'){
      const el = document.getElementById('figures');
      if (el){
        try{ el.scrollIntoView({ behavior:'smooth', block:'start' }); }
        catch(_){ el.scrollIntoView(); }
      }
    }
  }
  // Pinned controls (custom toolbar). Persisted to localStorage
  let pinnedControls = [];
  const SHOW_SAVE_PRESET_BUTTON = false;
  const AVAILABLE_CONTROLS = [
    { key: 'mirror_pose', label: 'Mirror Pose', action: () => { try{ mirrorPoseYZPlane(); }catch(_){} } },
    { key: 'torso_lock', label: 'Torso Lock (Q)', action: () => { try{ toggleTorsoFreeze(); }catch(_){} } },
    { key: 'movement_mode', label: 'Natural/Single-Joint Mode', action: () => { try{ toggleSingleJointMode(); }catch(_){} } },
    { key: 'four_view', label: 'Toggle 4-View', action: () => { fourViewMode = !fourViewMode; } },
    { key: 'control_settings', label: 'Control Settings', action: () => { showControlSettings = !showControlSettings; } }
  ];
  const CONTROL_MAP = new Map(AVAILABLE_CONTROLS.map(c=> [c.key, c]));

  // Smooth reveal-on-scroll action
  function reveal(node) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          node.classList.add("reveal-visible");
          observer.unobserve(node);
        }
      });
    }, { threshold: 0.12 });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  function scrollFeatures(dir){
    if (!featuresRow) return;
    const delta = (featuresRow.clientWidth || 0) * 0.6 * dir;
    featuresRow.scrollBy({ left: delta, behavior: "smooth" });
  }

  function isControlActive(key){
    switch(key){
      case 'torso_lock': return !!torsoFreeze;
      case 'movement_mode': return !!singleJointMode; // highlight when Single-Joint mode is active
      case 'four_view': return !!fourViewMode;
      case 'control_settings': return !!showControlSettings;
      default: return false;
    }
  }
  function loadPinnedControls(){
    try{
      const s = localStorage.getItem('pinnedControlsV1');
      if (s){
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) pinnedControls = arr.filter(k=> CONTROL_MAP.has(k));
      }
    }catch(_){ /* ignore */ }
  }
  function savePinnedControls(){
    try{ localStorage.setItem('pinnedControlsV1', JSON.stringify(pinnedControls)); }catch(_){ /* ignore */ }
  }
  function isPinned(key){ return Array.isArray(pinnedControls) && pinnedControls.includes(key); }
  function togglePinned(key){
    const arr = Array.isArray(pinnedControls) ? [...pinnedControls] : [];
    const filtered = arr.filter(k => k !== key);
    if (filtered.length === arr.length) filtered.push(key); // add if not present
    pinnedControls = filtered;
    savePinnedControls();
  }
  function applyDarkMode(){
    if (typeof document === 'undefined') return;
    const b = document.body;
    if (!b) return;
    if (darkMode) b.classList.add('dark-mode'); else b.classList.remove('dark-mode');
  }
  function applySceneTheme(){
    const bgLight = 0xf4f6f9;   // neutral light background to match UI
    const bgDark = 0x05070d;
    const groundLight = 0xe8edf3; // light neutral floor
    const groundDark = 0x203453;
    try{
      if (scene && renderer){
        if (darkMode){
          renderer.setClearColor(bgDark, 1);
          scene.background = new THREE.Color(bgDark);
        } else {
          renderer.setClearColor(0x000000, 0); // transparent to show CSS gradient
          scene.background = null;
        }
      }
    }catch(_){}
    try{
      if (groundMesh?.material?.color) groundMesh.material.color.setHex(darkMode ? groundDark : groundLight);
    }catch(_){}
    const jointColor = darkMode ? JOINT_BASE_COLOR_DARK : JOINT_BASE_COLOR_LIGHT;
    const allJoints = [...(jointMeshesA || []), ...(jointMeshesB || [])];
    for (const m of allJoints){
      try{
        if (m?.material?.color) m.material.color.setHex(jointColor);
        if (m?.userData) m.userData.defaultColor = jointColor;
      }catch(_){}
    }
  }
  function toggleDarkMode(){
    darkMode = !darkMode;
    applyDarkMode();
    applySceneTheme();
    try{ localStorage.setItem('darkMode', darkMode ? 'true' : 'false'); }catch(_){}
  }
  onMount(async ()=>{
    loadPinnedControls();
    await loadAuthState();
    try{
      const saved = localStorage.getItem('darkMode');
      if (saved === 'true') darkMode = true;
    }catch(_){}
    applyDarkMode();
    applySceneTheme();
    return ()=>{
      try{ authUnsubscribe?.(); }catch(_){}
      authUnsubscribe = null;
    };
  });
  let startPosition = "neutral";
  const BUILTIN_PRESETS = [
    { key: 'neutral', label: 'Neutral' },
    { key: 'openGuard', label: 'Open Guard' },
    { key: 'closedGuard', label: 'Closed Guard' },
    { key: 'halfGuard', label: 'Half Guard' },
    { key: 'kneeShield', label: 'Knee Shield' },
    { key: 'mount', label: 'Mount' },
    { key: 'sideControl', label: 'Side Control' },
    { key: 'backControl', label: 'Back Control' }
  ];

  // floor
  const FLOOR_Y = -0.55; // floor plane y
  // edge rotation threshold as fraction of canvas dimension
  const EDGE_THRESHOLD = 0.12;

  // joint keys and bone pairs
  const JOINT_KEYS = [
    "head","neck",
    "shoulderL","shoulderR",
    "elbowL","elbowR",
    "handL","handR",
    "hipL","hipR",
    "kneeL","kneeR",
    "footL","footR"
  ];

  const BONE_PAIRS = [
    ["head","neck"], ["neck","shoulderL"], ["neck","shoulderR"],
    ["shoulderL","shoulderR"],
    ["shoulderL","elbowL"], ["elbowL","handL"], ["shoulderR","elbowR"], ["elbowR","handR"],
    // no shoulder-to-hip diagonals; torso handled by chest/pelvis visuals
    ["hipL","hipR"],
    ["hipL","kneeL"], ["kneeL","footL"], ["hipR","kneeR"], ["kneeR","footR"]
  ];

  function getBoneRadius(a, b) {
    const arm = (a.includes('shoulder') && b.includes('elbow')) || (a.includes('elbow') && b.includes('hand'));
    const leg = (a.includes('hip') && b.includes('knee')) || (a.includes('knee') && b.includes('foot'));
    const core = (a === 'hipL' && b === 'hipR') || a === 'neck' || b === 'neck';
    if (leg) return 0.045;
    if (arm) return 0.035;
    if (core) return 0.04;
    return 0.04;
  }

  function getBoneRadii(a,b){
    // [topRadius, bottomRadius] for tapered limbs (rounded; no blocky shapes)
    const THIGH_SCALE = 1.2; // slightly thicker thighs
    if ((a.includes('shoulder') && b.includes('elbow'))) return [0.055, 0.04]; // biceps thicker near shoulder
    if ((a.includes('elbow') && b.includes('hand'))) return [0.04, 0.03]; // forearm thinner at wrist
    if ((a.includes('hip') && b.includes('knee'))) return [0.06 * THIGH_SCALE, 0.045 * THIGH_SCALE]; // thighs 1.2x
    if ((a.includes('knee') && b.includes('foot'))) return [0.045, 0.035]; // shin thinner at foot
    if ((a.includes('shoulder') && b.includes('shoulder'))) return [0.06, 0.06]; // shoulder bar
    if ((a.includes('hip') && b.includes('hip'))) return [0.055, 0.055]; // pelvis bar
    return [0.04, 0.04];
  }

  function isLimbBone(a, b){
    const arm = (a.includes('shoulder') && b.includes('elbow')) || (a.includes('elbow') && b.includes('hand'));
    const leg = (a.includes('hip') && b.includes('knee')) || (a.includes('knee') && b.includes('foot'));
    return arm || leg;
  }

  function makeBoneGeometry(a, b, length, rt, rb){
    const radialSegments = 26;
    const heightSegments = 6;
    if (isLimbBone(a, b) && THREE.CapsuleGeometry){
      const lengthTarget = Math.max(length, 0.001);
      let radius = (rt + rb) * 0.5;
      const maxRadius = Math.max(lengthTarget * 0.5 - 0.001, 0.001);
      if (radius > maxRadius) radius = maxRadius;
      const cylLen = Math.max(lengthTarget - 2 * radius, 0.001);
      const baseLength = cylLen + 2 * radius;
      return { geometry: new THREE.CapsuleGeometry(radius, cylLen, 12, radialSegments), baseLength };
    }
    return { geometry: new THREE.CylinderGeometry(rt, rb, 1, radialSegments, heightSegments), baseLength: null };
  }

  // ---------- Poses: absolute 3D coordinates for A (usually lying) and B (opponent) ----------
  // Values chosen so that lying ones are low near floor and standing ones are higher.
  function basePose(x,y,z) {
    return {
      head:[x, y + 1.7, z], neck:[x, y + 1.55, z],
      shoulderL:[x - 0.2, y + 1.5, z], shoulderR:[x + 0.2, y + 1.5, z],
      elbowL:[x - 0.4, y + 1.3, z], elbowR:[x + 0.4, y + 1.3, z],
      handL:[x - 0.45, y + 1.0, z], handR:[x + 0.45, y + 1.0, z],
      hipL:[x - 0.15, y + 1.0, z], hipR:[x + 0.15, y + 1.0, z],
      kneeL:[x - 0.15, y + 0.55, z], kneeR:[x + 0.15, y + 0.55, z],
      footL:[x - 0.15, y + 0.05, z], footR:[x + 0.15, y + 0.05, z]};}
  function lyingOnBack(x,y,z){
    // Oriented along +Z (horizontal). Keep all joints near floor in Y.
    const torsoZ = 0.5;     // shoulder-hip separation along Z
    const neckZ = torsoZ + 0.12;
    const headZ = torsoZ + 0.26;
    const yBase = y + 0.06; // small clearance off floor
    return {
      head:[x, yBase + 0.10, z + headZ], neck:[x, yBase + 0.08, z + neckZ],
      shoulderL:[x - 0.2, yBase + 0.06, z + torsoZ], shoulderR:[x + 0.2, yBase + 0.06, z + torsoZ],
      elbowL:[x - 0.28, yBase + 0.05, z + 0.32], elbowR:[x + 0.28, yBase + 0.05, z + 0.32],
      handL:[x - 0.35, yBase + 0.03, z + 0.20], handR:[x + 0.35, yBase + 0.03, z + 0.20],
      hipL:[x - 0.15, yBase + 0.04, z], hipR:[x + 0.15, yBase + 0.04, z],
      kneeL:[x - 0.15, yBase + 0.12, z + 0.22], kneeR:[x + 0.15, yBase + 0.12, z + 0.22],
      footL:[x - 0.15, yBase + 0.02, z + 0.40], footR:[x + 0.15, yBase + 0.02, z + 0.40]};}
  function lyingOnSide(x,y,z){
    // Side-lying along +Z; small Y offsets to keep near floor
    const torsoZ = 0.46;
    const yBase = y + 0.06;
    return {
      head:[x + 0.04, yBase + 0.10, z + 0.60], neck:[x + 0.04, yBase + 0.08, z + 0.52],
      shoulderL:[x - 0.18, yBase + 0.06, z + torsoZ], shoulderR:[x + 0.18, yBase + 0.06, z + (torsoZ - 0.04)],
      elbowL:[x - 0.22, yBase + 0.05, z + 0.34], elbowR:[x + 0.22, yBase + 0.05, z + 0.34],
      handL:[x - 0.26, yBase + 0.03, z + 0.20], handR:[x + 0.26, yBase + 0.03, z + 0.20],
      hipL:[x - 0.15, yBase + 0.04, z], hipR:[x + 0.15, yBase + 0.04, z],
      kneeL:[x - 0.15, yBase + 0.12, z + 0.18], kneeR:[x + 0.15, yBase + 0.12, z + 0.18],
      footL:[x - 0.15, yBase + 0.02, z + 0.36], footR:[x + 0.15, yBase + 0.02, z + 0.36]};}
  function kneelingOver(x,y,z){
    return {
      head:[x, y + 1.0, z], neck:[x, y + 0.85, z],
      shoulderL:[x - 0.2, y + 0.8, z], shoulderR:[x + 0.2, y + 0.8, z],
      elbowL:[x - 0.3, y + 0.5, z], elbowR:[x + 0.3, y + 0.5, z],
      handL:[x - 0.3, y + 0.25, z], handR:[x + 0.3, y + 0.25, z],
      hipL:[x - 0.15, y + 0.3, z], hipR:[x + 0.15, y + 0.3, z],
      kneeL:[x - 0.15, y, z], kneeR:[x + 0.15, y, z],
      footL:[x - 0.15, y - 0.25, z], footR:[x + 0.15, y - 0.25, z]};}
  function sittingOnTop(x,y,z){
    return {
      head:[x, y + 1.2, z], neck:[x, y + 1.05, z],
      shoulderL:[x - 0.2, y + 1.0, z], shoulderR:[x + 0.2, y + 1.0, z],
      elbowL:[x - 0.3, y + 0.7, z], elbowR:[x + 0.3, y + 0.7, z],
      handL:[x - 0.3, y + 0.45, z], handR:[x + 0.3, y + 0.45, z],
      hipL:[x - 0.15, y + 0.5, z], hipR:[x + 0.15, y + 0.5, z],
      kneeL:[x - 0.15, y + 0.2, z + 0.15], kneeR:[x + 0.15, y + 0.2, z + 0.15],
      footL:[x - 0.15, y - 0.05, z + 0.3], footR:[x + 0.15, y - 0.05, z + 0.3]};}

  function lyingClosedGuard(x,y,z){
    const p = lyingOnBack(x,y,z);
    p.kneeL = [x - 0.18, y + 0.1, z + 0.06];
    p.kneeR = [x + 0.18, y + 0.1, z + 0.06];
    p.footL = [x - 0.12, y - 0.1, z + 0.12];
    p.footR = [x + 0.12, y - 0.1, z + 0.12];
    return p;
  }

  // Higher-level BJJ pose builders
  const presetFromJson = (preset, fallbackA, fallbackB)=>{
    if (preset?.A?.joints && preset?.B?.joints){
      return {
        A: JSON.parse(JSON.stringify(preset.A.joints)),
        B: JSON.parse(JSON.stringify(preset.B.joints))
      };
    }
    return { A: fallbackA, B: fallbackB };
  };
  function poseNeutral(){
    const A = basePose(0,0,0);
    const B = basePose(0.7,0,0.7);
    return presetFromJson(poseNeutralPreset, A, B);
  }

  function poseOpenGuard(){
    const base = poseNeutral();
    return presetFromJson(poseOpenGuardPreset, base.A, base.B);
  }

  function poseClosedGuard(){
    const base = poseNeutral();
    return presetFromJson(poseClosedGuardPreset, base.A, base.B);
  }

  function poseKneeShield(){
    const base = poseNeutral();
    return presetFromJson(poseKneeShieldPreset, base.A, base.B);
  }

  function poseMount(){
    const base = poseNeutral();
    return presetFromJson(poseMountPreset, base.A, base.B);
  }

  function poseHalfGuard(){
    if (poseHalfGuardPreset?.A?.joints && poseHalfGuardPreset?.B?.joints){
      return {
        A: JSON.parse(JSON.stringify(poseHalfGuardPreset.A.joints)),
        B: JSON.parse(JSON.stringify(poseHalfGuardPreset.B.joints))
      };
    }
    // A on side with top knee shield-like, B in half-guard position offset
    const A = lyingOnSide(0,-0.03,0);
    // Top leg across with shin contact; bottom leg flatter
    A.kneeL = [A.kneeL[0]-0.05, A.kneeL[1]+0.30, A.kneeL[2]+0.18];
    A.footL = [A.footL[0]-0.02, A.footL[1]+0.22, A.footL[2]+0.28];
    A.kneeR = [A.kneeR[0]+0.02, A.kneeR[1]+0.08, A.kneeR[2]+0.12];
    A.footR = [A.footR[0]+0.02, A.footR[1]+0.02, A.footR[2]+0.22];
    // Orange uses exact posture from Mount (no changes)
    const mountPoseHG = poseMount();
    const B = JSON.parse(JSON.stringify(mountPoseHG.B));
    return { A, B };
  }

  function poseSideControl(){
    // Start from mount: rotate whole orange 90? toward yellow, then place kneeR between yellow hipR and footR
    const M = poseMount();
    const A = M.A; // Yellow unchanged
    const B = JSON.parse(JSON.stringify(M.B)); // Orange from mount

    // Rotate entire orange around hip center by +90? yaw (local Y)
    const hipC = [ (B.hipL[0]+B.hipR[0])*0.5, (B.hipL[1]+B.hipR[1])*0.5, (B.hipL[2]+B.hipR[2])*0.5 ];
    const ang = Math.PI / 2; const c = Math.cos(ang), s = Math.sin(ang);
    const keys = ['head','neck','shoulderL','shoulderR','elbowL','elbowR','handL','handR','hipL','hipR','kneeL','kneeR','footL','footR'];
    for (const k of keys){
      const x = B[k][0] - hipC[0];
      const y = B[k][1] - hipC[1];
      const z = B[k][2] - hipC[2];
      const xr = c*x - s*z;
      const zr = s*x + c*z;
      B[k] = [ hipC[0] + xr, hipC[1] + y, hipC[2] + zr ];
    }

    // Translate entire orange so right knee lies midway between yellow's right hip and right foot
    const target = [
      (A.hipR[0] + A.footR[0]) * 0.5,
      (A.hipR[1] + A.footR[1]) * 0.5,
      (A.hipR[2] + A.footR[2]) * 0.5
    ];
    const dx = target[0] - B.kneeR[0];
    const dy = target[1] - B.kneeR[1];
    const dz = target[2] - B.kneeR[2];
    for (const k of keys){ B[k] = [ B[k][0] + dx, B[k][1] + dy, B[k][2] + dz ]; }

    return { A, B };
  }

  function computeDefaultBackControl(){
    // A seated-reclined baseline; B behind with hooks and torso contact
    const groundY = FLOOR_Y + 0.02;
    const A = lyingOnBack(0,-0.02,0);
    const hipCA = [(A.hipL[0]+A.hipR[0])/2, groundY, (A.hipL[2]+A.hipR[2])/2];
    A.hipL[1] = groundY; A.hipR[1] = groundY;
    A.shoulderL = [A.shoulderL[0], groundY + 0.20, hipCA[2] + 0.26];
    A.shoulderR = [A.shoulderR[0], groundY + 0.20, hipCA[2] + 0.26];
    // B behind A with hooks (feet inside thighs)
    const B = basePose(-0.02,0,-0.30);
    B.hipL[1] = groundY + 0.18; B.hipR[1] = groundY + 0.18;
    B.shoulderL[2] += 0.40; B.shoulderR[2] += 0.40; B.neck[2] += 0.42; B.head[2] += 0.46;
    // Hooks
    B.kneeL = [hipCA[0]-0.75, groundY + 0.10, hipCA[2] + 0.12];
    B.kneeR = [hipCA[0]+0.75, groundY + 0.10, hipCA[2] + 0.12];
    B.footL = [hipCA[0]-0.60, groundY + 0.02, hipCA[2] + 0.26];
    B.footR = [hipCA[0]+0.60, groundY + 0.02, hipCA[2] + 0.26];
    // Hands across chest
    const AshC = [hipCA[0], groundY + 0.24, hipCA[2] + 0.30];
    B.handL = [AshC[0]-0.90, AshC[1], AshC[2]+0.02];
    B.handR = [AshC[0]+0.60, AshC[1], AshC[2]+0.02];
    return { A, B };
  }

  // ---------- Manual Back Control (editable in code) ----------
  // Toggle: when true, the Back Control pose uses the variables below.
  let useManualBackControl = false;

  // Convert joints {key:[x,y,z]} -> editable spec with rot fields.
  function jointsToEditableSpec(j){
    const mk = (arr)=>({ x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0, rotX: 0, rotY: 0, rotZ: 0 });
    return {
      head: mk(j.head), neck: mk(j.neck),
      shoulderL: mk(j.shoulderL), shoulderR: mk(j.shoulderR),
      elbowL: mk(j.elbowL), elbowR: mk(j.elbowR),
      handL: mk(j.handL), handR: mk(j.handR),
      hipL: mk(j.hipL), hipR: mk(j.hipR),
      kneeL: mk(j.kneeL), kneeR: mk(j.kneeR),
      footL: mk(j.footL), footR: mk(j.footR),
      // Torso control (optional orientation override)
      torso: { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 }
  };

  // Shift foot joints forward to toe tips based on current limb direction
  function adjustFeetToToesVecs(j){
    try{
      const floorY = FLOOR_Y + 0.02;
      const hipL = j.hipL.clone();
      const hipR = j.hipR.clone();
      const kneeL = j.kneeL.clone();
      const kneeR = j.kneeR.clone();
      const footL = j.footL.clone();
      const footR = j.footR.clone();
      // Fallback forward from torso for ambiguous cases
      const torsoFwd = new THREE.Vector3().subVectors(
        new THREE.Vector3().addVectors(j.shoulderL, j.shoulderR).multiplyScalar(0.5),
        new THREE.Vector3().addVectors(j.hipL, j.hipR).multiplyScalar(0.5)
      );
      const torsoFwdXZ = torsoFwd.clone(); torsoFwdXZ.y = 0; if (torsoFwdXZ.length()>1e-6) torsoFwdXZ.normalize();

      function toeFor(side){
        const knee = side==='L' ? kneeL : kneeR;
        const foot = side==='L' ? footL : footR;
        let dir = foot.clone().sub(knee);
        // Prefer horizontal component if available to avoid lengthening the shin much when vertical
        const dirXZ = dir.clone(); dirXZ.y = 0;
        if (dirXZ.length() > 1e-4) dir = dirXZ;
        else if (torsoFwdXZ.length() > 1e-6) dir = torsoFwdXZ.clone();
        else dir = new THREE.Vector3(0,0,1);
        dir.normalize();
        const p = foot.clone().addScaledVector(dir, TOE_EXTEND);
        p.y = Math.max(p.y, floorY);
        return p;
      }
      j.footL = toeFor('L');
      j.footR = toeFor('R');
    }catch(e){}
    return j;
  }
  }

  // Convert editable spec -> joints {key:[x,y,z]} (rotations are handled separately)
  function specToJoints(spec){
    const o = {};
    for (const k of JOINT_KEYS){
      const v = spec[k] ?? { x:0,y:0,z:0 };
      o[k] = [v.x||0, v.y||0, v.z||0];
    }
    return o;
  }

  // Initialize editable specs from the existing default Back Control
  let manualYellow = jointsToEditableSpec(computeDefaultBackControl().A);
  let manualOrange = jointsToEditableSpec(computeDefaultBackControl().B);

  // New Back Control pose: uses manual values when enabled
  function poseBackControl(){
    if (useManualBackControl) {
      return { A: specToJoints(manualYellow), B: specToJoints(manualOrange) };
    }
    return computeDefaultBackControl();
  }

  // Helper to apply extra manual torso Euler on top of computed torso orientation
  function applyManualTorsoRotationIfAny(torsoMesh){
    // Apply GUI torso rotations always
    let t = null;
    if (torsoMesh === torsoA) t = torsoGuiA; else if (torsoMesh === torsoB) t = torsoGuiB;
    if (t){
      const ex = (t.rotX||0), ey = (t.rotY||0), ez = (t.rotZ||0);
      if (Math.abs(ex)+Math.abs(ey)+Math.abs(ez) > 1e-9){
        const qExtra = new THREE.Quaternion().setFromEuler(new THREE.Euler(toRad(ex), toRad(ey), toRad(ez), 'XYZ'));
        torsoMesh.quaternion.multiply(qExtra);
      }
    }
    // Also apply manual back-control torso edits when enabled and active
    if (useManualBackControl && startPosition === 'backControl'){
      let spec = null;
      if (torsoMesh === torsoA) spec = manualYellow?.torso; else if (torsoMesh === torsoB) spec = manualOrange?.torso;
      if (spec){
        const ex = (spec.rotX||0), ey = (spec.rotY||0), ez = (spec.rotZ||0);
        if (Math.abs(ex)+Math.abs(ey)+Math.abs(ez) > 1e-9){
          const qExtra = new THREE.Quaternion().setFromEuler(new THREE.Euler(toRad(ex), toRad(ey), toRad(ez), 'XYZ'));
          torsoMesh.quaternion.multiply(qExtra);
        }
      }
    }
  }

  const POSES = {
    // Use external pose modules for core presets; keep existing ones as-needed
    neutral: { A: Poses.neutral(), B: Poses.neutralB() },
    openGuard: { A: Poses.openGuard(), B: Poses.openGuardB() },
    closedGuard: { A: Poses.closedGuard(), B: Poses.closedGuardB() },
    kneeShield: { A: Poses.kneeShield(), B: Poses.kneeShieldB() },
    sideControl: { A: Poses.sideControl(), B: Poses.sideControlB() },
    backControl: { A: Poses.backControl(), B: Poses.backControlB() },
    // Keep additional presets from existing builders
    halfGuard: poseHalfGuard(),
    mount: poseMount()
  };// ---------- Helpers ----------
  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
  function toRad(deg){ return deg * Math.PI / 180; }
  function pairKey(a,b){ return a < b ? `${a}|${b}` : `${b}|${a}`; }

  const isArmBone = (a,b)=>(
    (a==='shoulderL' && b==='elbowL') || (a==='elbowL' && b==='handL') ||
    (a==='shoulderR' && b==='elbowR') || (a==='elbowR' && b==='handR')
  );

  function computeDesiredLengths(joints){
    const m = new Map();
    for (const [a,b] of BONE_PAIRS) {
      const pa = new THREE.Vector3(...joints[a]);
      const pb = new THREE.Vector3(...joints[b]);
      let len = pa.distanceTo(pb);
      if (isArmBone(a,b)) len *= ARM_LENGTH_SCALE;
      m.set(pairKey(a,b), len);
    }
    return m;
  }

  function centerOf(joints, a, b){
    const pa = new THREE.Vector3(...joints[a]);
    const pb = new THREE.Vector3(...joints[b]);
    return new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
  }

  function computeTorsoLength(joints){
    const shoulderCenter = centerOf(joints, 'shoulderL', 'shoulderR');
    const hipCenter = centerOf(joints, 'hipL', 'hipR');
    return shoulderCenter.distanceTo(hipCenter);
  }

  function computeShoulderCenterToNeckLen(joints){
    const shoulderCenter = centerOf(joints, 'shoulderL', 'shoulderR');
    const neck = new THREE.Vector3(...joints.neck);
    return neck.distanceTo(shoulderCenter);
  }

  function computeWidth(joints, a, b){
    const pa = new THREE.Vector3(...joints[a]);
    const pb = new THREE.Vector3(...joints[b]);
    return pa.distanceTo(pb);
  }

  function captureBaselineFromMount(){
    // Build temporary skeletons using the current mount pose as the reference
    const mountPose = poseMount();
    const sA = buildBindFromNeutral(POSES.neutral.A);
    const sB = buildBindFromNeutral(POSES.neutral.B);
    applyWorldPoseToSkeleton(sA, mountPose.A);
    applyWorldPoseToSkeleton(sB, mountPose.B);
    groundSkeleton(sA); groundSkeleton(sB);
    const jA = jointsFromSkeleton(sA);
    const jB = jointsFromSkeleton(sB);
    baselineA = {
      lenMap: computeDesiredLengths(jA),
      torsoLen: computeTorsoLength(jA),
      neckCenterLen: computeShoulderCenterToNeckLen(jA),
      shoulderW: computeWidth(jA,'shoulderL','shoulderR'),
      hipW: computeWidth(jA,'hipL','hipR'),
      floorY: FLOOR_Y + 0.02
    };
    baselineB = {
      lenMap: computeDesiredLengths(jB),
      torsoLen: computeTorsoLength(jB),
      neckCenterLen: computeShoulderCenterToNeckLen(jB),
      shoulderW: computeWidth(jB,'shoulderL','shoulderR'),
      hipW: computeWidth(jB,'hipL','hipR'),
      floorY: FLOOR_Y + 0.02
    };
    baselineReady = true;
  }

  function clampWidthSymmetric(joints, leftKey, rightKey, target, tol=0.01){
    const L = new THREE.Vector3(...joints[leftKey]);
    const R = new THREE.Vector3(...joints[rightKey]);
    const center = new THREE.Vector3().addVectors(L,R).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(R,L);
    const cur = dir.length(); if (cur < 1e-6) return; dir.normalize();
    const min = target*(1-tol), max = target*(1+tol);
    const desired = clamp(cur, min, max);
    const half = desired*0.5;
    const newL = center.clone().addScaledVector(dir, -half);
    const newR = center.clone().addScaledVector(dir, half);
    joints[leftKey] = [newL.x,newL.y,newL.z];
    joints[rightKey] = [newR.x,newR.y,newR.z];
  }

  function normalizeToBaseline(person){
    if (!baselineReady) return;
    const skel = person==='A'? skeletonA : skeletonB;
    let joints = jointsFromSkeleton(skel);
    // Lengths: use baseline maps
    if (person==='A') desiredLengthsA = baselineA.lenMap; else desiredLengthsB = baselineB.lenMap;
    enforceExactNeutralLengths(person);
    joints = person==='A'? jointsA : jointsB; // updated by enforceExactNeutralLengths
    // Floor contacts: feet/knees to floor; hips snapped if within 0.01
    const floorY = (person==='A'?baselineA:baselineB).floorY;
    const hipLY = joints.hipL[1], hipRY = joints.hipR[1];
    joints.footL[1] = floorY; joints.footR[1] = floorY;
    joints.kneeL[1] = floorY; joints.kneeR[1] = floorY;
    if (Math.abs(hipLY-floorY) <= 0.01) joints.hipL[1] = floorY;
    if (Math.abs(hipRY-floorY) <= 0.01) joints.hipR[1] = floorY;
    // Widths within ?1%
    const base = person==='A'? baselineA : baselineB;
    clampWidthSymmetric(joints,'shoulderL','shoulderR', base.shoulderW, 0.01);
    clampWidthSymmetric(joints,'hipL','hipR', base.hipW, 0.01);
    // Torso length within ?1%
    const curLen = computeTorsoLength(joints);
    const minT = base.torsoLen*0.99, maxT = base.torsoLen*1.01;
    let targetLen = clamp(curLen, minT, maxT);
    enforceTorsoLength(joints, targetLen);
    // Re-apply to skeleton via world pose, preserving baseline lengths
    applyWorldPoseToSkeleton(skel, joints);
    groundSkeleton(skel);
  }

  function translateAllJoints(joints, delta){
    for (const key of Object.keys(joints)) {
      const [x,y,z] = joints[key];
      joints[key] = [x - delta.x, y - delta.y, z - delta.z];
    }
  }

  // keep torso (shoulder center distance to hip center) equal to neutral
  function enforceTorsoLength(joints, targetLen){
    const sL = new THREE.Vector3(...joints.shoulderL);
    const sR = new THREE.Vector3(...joints.shoulderR);
    const hL = new THREE.Vector3(...joints.hipL);
    const hR = new THREE.Vector3(...joints.hipR);
    const shoulderCenter = new THREE.Vector3().addVectors(sL, sR).multiplyScalar(0.5);
    const hipCenter = new THREE.Vector3().addVectors(hL, hR).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(shoulderCenter, hipCenter);
    const curLen = dir.length();
    if (curLen < 1e-6 || Math.abs(curLen - targetLen) < 1e-3) return;
    dir.normalize();
    const newShoulderCenter = hipCenter.clone().addScaledVector(dir, targetLen);
    const delta = new THREE.Vector3().subVectors(newShoulderCenter, shoulderCenter);
    // move the upper torso chain together to preserve relative proportions
    const apply = (v) => [v.x + delta.x, v.y + delta.y, v.z + delta.z];
    const _sL = new THREE.Vector3(...joints.shoulderL);
    const _sR = new THREE.Vector3(...joints.shoulderR);
    const _neck = new THREE.Vector3(...joints.neck);
    const _head = new THREE.Vector3(...joints.head);
    joints.shoulderL = apply(_sL);
    joints.shoulderR = apply(_sR);
    joints.neck      = apply(_neck);
    joints.head      = apply(_head);
  }
  function desiredBoneLength(person, a, b){
    try{
      const desired = person === 'A' ? desiredLengthsA : desiredLengthsB;
      const key = pairKey(a,b);
      const len = desired?.get?.(key);
      if (typeof len === 'number' && isFinite(len) && len > 0) return len;
    }catch(e){}
    try{
      const j = person === 'A' ? jointsA : jointsB;
      const va = new THREE.Vector3(...(j?.[a] || [0,0,0]));
      const vb = new THREE.Vector3(...(j?.[b] || [0,0,0]));
      return va.distanceTo(vb);
    }catch(e){}
    return 0;
  }

  function clampHeadLength(person){
    const joints = person === 'A' ? jointsA : jointsB;
    if (!joints || !joints.head || !joints.neck) return;
    try{
      const neck = new THREE.Vector3(...joints.neck);
      const head = new THREE.Vector3(...joints.head);
      const headLen = desiredBoneLength(person, 'head','neck');
      if (!(headLen > 0)) return;
      let dir = head.clone().sub(neck);
      if (dir.lengthSq() < 1e-8) dir.set(0,1,0);
      dir.normalize();
      const newHead = neck.clone().addScaledVector(dir, headLen);
      joints.head = [newHead.x, newHead.y, newHead.z];
    }catch(e){}
  }

  // Keep the neck at a fixed length from the shoulder center while allowing the head to move
  function enforceNeckLength(person){
    const joints = person === 'A' ? jointsA : jointsB;
    if (!joints || !joints.neck || !joints.head || !joints.shoulderL || !joints.shoulderR) return;
    try{
      const sL = new THREE.Vector3(...joints.shoulderL);
      const sR = new THREE.Vector3(...joints.shoulderR);
      const shoulderCenter = sL.clone().add(sR).multiplyScalar(0.5);
      const hipCenter = centerOf(joints, 'hipL', 'hipR');
      let torsoDir = shoulderCenter.clone().sub(hipCenter);
      if (torsoDir.lengthSq() < 1e-8) torsoDir.set(0,1,0); else torsoDir.normalize();
      let desiredLen = person === 'A' ? shoulderCenterToNeckLenA : shoulderCenterToNeckLenB;
      const neckVec = new THREE.Vector3(...joints.neck);
      let dir = neckVec.clone().sub(shoulderCenter);
      if (dir.lengthSq() < 1e-8) {
        dir = new THREE.Vector3(...joints.head).sub(shoulderCenter);
      }
      if (dir.lengthSq() < 1e-8) {
        dir.set(0, 1, 0);
      }
      dir.normalize();
      // Bias neck direction toward torso axis so arm IK doesn't yank the neck off the spine
      const dot = clamp(dir.dot(torsoDir), -1, 1);
      const torsoWeight = clamp(0.7 + 0.25 * (1 - Math.max(0, dot)), 0.7, 0.95);
      const dirWeight = 1 - torsoWeight;
      dir = torsoDir.clone().multiplyScalar(torsoWeight).add(dir.clone().multiplyScalar(dirWeight));
      if (dir.lengthSq() < 1e-10) dir.copy(torsoDir);
      dir.normalize();
      if (!(desiredLen > 0)) {
        desiredLen = neckVec.distanceTo(shoulderCenter);
      }
      if (!(desiredLen > 0)) {
        desiredLen = HEAD_RADIUS * 0.5;
      }
      const newNeck = shoulderCenter.clone().addScaledVector(dir, desiredLen);
      joints.neck = [newNeck.x, newNeck.y, newNeck.z];
      clampHeadLength(person);
    }catch(e){}
  }

  function stabilizeAndEnforce(person){
    const joints = person === 'A' ? jointsA : jointsB;
    const neutralTorso = person === 'A' ? neutralTorsoLenA : neutralTorsoLenB;
    // store root (hip center) before constraints to keep figure from drifting
    const hipBefore = centerOf(joints, 'hipL', 'hipR');
    // a few iterations to converge lengths
    for (let i=0;i<8;i++) {
      enforceConstraints(person, 'hipL');
      enforceTorsoLength(joints, neutralTorso);
    }
    // translate back so hip center stays where it was
    const hipAfter = centerOf(joints, 'hipL', 'hipR');
    const delta = new THREE.Vector3().subVectors(hipAfter, hipBefore);
    if (delta.lengthSq() > 1e-10) translateAllJoints(joints, delta);
  }

  function clampExtremeStretchIfNeeded(person, maxRatio = 1.25){
    const joints = person === 'A' ? jointsA : jointsB;
    const desired = person === 'A' ? desiredLengthsA : desiredLengthsB;
    if (!joints || !desired || desired.size === 0) return false;
    let stretched = false;
    for (const [a,b] of BONE_PAIRS){
      const L = desired.get(pairKey(a,b));
      if (!L || L <= 0) continue;
      const pa = new THREE.Vector3(...joints[a]);
      const pb = new THREE.Vector3(...joints[b]);
      if (pa.distanceTo(pb) > L * maxRatio){ stretched = true; break; }
    }
    const neutralTorso = person === 'A' ? neutralTorsoLenA : neutralTorsoLenB;
    if (!stretched && neutralTorso > 0){
      const torsoLen = computeTorsoLength(joints);
      if (torsoLen > neutralTorso * maxRatio) stretched = true;
    }
    if (!stretched) return false;
    stabilizeAndEnforce(person);
    return true;
  }

  // Enforce exact neutral bone lengths by reconstructing chains with current directions
  function enforceExactNeutralLengths(person){
    const joints = person === 'A' ? jointsA : jointsB;
    const desired = person === 'A' ? desiredLengthsA : desiredLengthsB;
    const torsoLen = person === 'A' ? neutralTorsoLenA : neutralTorsoLenB;

    const getL = (a,b)=> desired.get(pairKey(a,b)) ?? new THREE.Vector3(...joints[a]).distanceTo(new THREE.Vector3(...joints[b]));
    const safeDir = (from, to, fallback)=>{
      const v = new THREE.Vector3().subVectors(to, from);
      if (v.lengthSq() < 1e-8) return fallback.clone().normalize();
      return v.normalize();
    };

    // Anchor hipL; set hipR by pelvis width
    const hipL = new THREE.Vector3(...joints.hipL);
    const hipR = new THREE.Vector3(...joints.hipR);
    const pelvisDir = safeDir(hipL, hipR, new THREE.Vector3(1,0,0));
    const pelvisLen = getL('hipL','hipR');
    const newHipR = hipL.clone().addScaledVector(pelvisDir, pelvisLen);
    joints.hipR = [newHipR.x, newHipR.y, newHipR.z];
    // recompute centers
    const hipCenter = centerOf(joints, 'hipL','hipR');

    // Torso center direction from hips
    const curShoulderCenter = centerOf(joints, 'shoulderL','shoulderR');
    let torsoDir = safeDir(hipCenter, curShoulderCenter, new THREE.Vector3(0,1,0));
    const newShoulderCenter = hipCenter.clone().addScaledVector(torsoDir, torsoLen);

    // Shoulder width symmetric around center
    const curShoulderDir = safeDir(new THREE.Vector3(...joints.shoulderL), new THREE.Vector3(...joints.shoulderR), new THREE.Vector3(1,0,0));
    const halfShoulder = getL('shoulderL','shoulderR') * 0.5;
    const newShoulderL = newShoulderCenter.clone().addScaledVector(curShoulderDir.clone().multiplyScalar(-1), halfShoulder);
    const newShoulderR = newShoulderCenter.clone().addScaledVector(curShoulderDir, halfShoulder);
    joints.shoulderL = [newShoulderL.x, newShoulderL.y, newShoulderL.z];
    joints.shoulderR = [newShoulderR.x, newShoulderR.y, newShoulderR.z];

    // Neck and head along current directions
    const dNS = 0.5*(getL('neck','shoulderL') + getL('neck','shoulderR'));
    const neckDir = safeDir(newShoulderCenter, new THREE.Vector3(...joints.neck), torsoDir);
    const newNeck = newShoulderCenter.clone().addScaledVector(neckDir, dNS);
    joints.neck = [newNeck.x, newNeck.y, newNeck.z];
    const headDir = safeDir(newNeck, new THREE.Vector3(...joints.head), neckDir);
    const headLen = getL('head','neck');
    const newHead = newNeck.clone().addScaledVector(headDir, headLen);
    joints.head = [newHead.x, newHead.y, newHead.z];

    // Arms: L and R
    const placeArm = (side)=>{
      const S = side==='L' ? newShoulderL : newShoulderR;
      const shoulderKey = side==='L' ? 'shoulderL' : 'shoulderR';
      const elbowKey = side==='L' ? 'elbowL' : 'elbowR';
      const handKey = side==='L' ? 'handL' : 'handR';
      const elbowDir = safeDir(S, new THREE.Vector3(...joints[elbowKey]), new THREE.Vector3(1,0,0));
      const upperLen = getL(shoulderKey, elbowKey);
      const newElbow = S.clone().addScaledVector(elbowDir, upperLen);
      joints[elbowKey] = [newElbow.x, newElbow.y, newElbow.z];
      const foreDir = safeDir(newElbow, new THREE.Vector3(...joints[handKey]), elbowDir);
      const foreLen = getL(elbowKey, handKey);
      const newHand = newElbow.clone().addScaledVector(foreDir, foreLen);
      joints[handKey] = [newHand.x, newHand.y, newHand.z];
    };
    placeArm('L'); placeArm('R');

    // Legs: L and R
    const placeLeg = (side)=>{
      const H = side==='L' ? hipL : newHipR;
      const hipKey = side==='L' ? 'hipL' : 'hipR';
      const kneeKey = side==='L' ? 'kneeL' : 'kneeR';
      const footKey = side==='L' ? 'footL' : 'footR';
      const kneeDir = safeDir(H, new THREE.Vector3(...joints[kneeKey]), new THREE.Vector3(0,-1,0));
      const thighLen = getL(hipKey, kneeKey);
      const newKnee = H.clone().addScaledVector(kneeDir, thighLen);
      joints[kneeKey] = [newKnee.x, newKnee.y, newKnee.z];
      const shinDir = safeDir(newKnee, new THREE.Vector3(...joints[footKey]), kneeDir);
      const shinLen = getL(kneeKey, footKey);
      const newFoot = newKnee.clone().addScaledVector(shinDir, shinLen);
      joints[footKey] = [newFoot.x, newFoot.y, newFoot.z];
    };
    placeLeg('L'); placeLeg('R');

    // Hinge limits
    enforceElbowKneeHinges(joints, ELBOW_MAX_DEG, 'shoulderL','elbowL','handL');
    enforceElbowKneeHinges(joints, ELBOW_MAX_DEG, 'shoulderR','elbowR','handR');
    enforceElbowKneeHinges(joints, KNEE_MAX_DEG, 'hipL','kneeL','footL');
    enforceElbowKneeHinges(joints, KNEE_MAX_DEG, 'hipR','kneeR','footR');
  }

  // Shift all joints so the lowest joint rests on the floor plane
  function alignJointsToFloor(joints) {
    let minY = Infinity;
    for (const key of Object.keys(joints)) {
      const y = joints[key][1];
      if (y < minY) minY = y;
    }
    if (!isFinite(minY)) return;
    const dy = (FLOOR_Y + 0.02) - minY;
    if (Math.abs(dy) < 1e-6) return;
    for (const key of Object.keys(joints)) {
      const [x, y, z] = joints[key];
      joints[key] = [x, y + dy, z];
    }
  }

  function rotateAroundAxis(vec, axis, angle){
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    return vec.clone().applyQuaternion(q);
  }

  // Adjust endpoints to keep target length. If anchorKey provided, keep that joint fixed.
  function adjustPairLength(joints, a, b, targetLen, anchorKey){
    const pa = new THREE.Vector3(...joints[a]);
    const pb = new THREE.Vector3(...joints[b]);
    let v = new THREE.Vector3().subVectors(pb, pa);
    const curLen = v.length();
    if (curLen < 1e-6 || Math.abs(curLen - targetLen) < 1e-3) return;
    v.normalize();
    if (anchorKey === a) {
      const newPb = pa.clone().addScaledVector(v, targetLen);
      joints[b] = [newPb.x, newPb.y, newPb.z];
    } else if (anchorKey === b) {
      const newPa = pb.clone().addScaledVector(v, -targetLen);
      joints[a] = [newPa.x, newPa.y, newPa.z];
    } else {
      // move both towards meeting target length, around midpoint
      const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(pb, pa).normalize();
      const half = targetLen * 0.5;
      const newPa = mid.clone().addScaledVector(dir, -half);
      const newPb = mid.clone().addScaledVector(dir, half);
      joints[a] = [newPa.x, newPa.y, newPa.z];
      joints[b] = [newPb.x, newPb.y, newPb.z];
    }
  }

  function enforceElbowKneeHinges(joints, maxDeg, parent, middle, child, anchorKey){
    const p = new THREE.Vector3(...joints[parent]);
    const m = new THREE.Vector3(...joints[middle]);
    const c = new THREE.Vector3(...joints[child]);
    let u = new THREE.Vector3().subVectors(m, p);
    let v = new THREE.Vector3().subVectors(c, m);
    const Lu = u.length();
    const Lv = v.length();
    if (Lu < 1e-6 || Lv < 1e-6) return;
    u.normalize();
    v.normalize();
    const minusU = u.clone().multiplyScalar(-1);
    let dot = clamp(minusU.dot(v), -1, 1);
    const angle = Math.acos(dot);
    const maxRad = toRad(maxDeg);
    if (angle <= maxRad + 1e-3) return;
    let axis = new THREE.Vector3().crossVectors(minusU, v);
    if (axis.lengthSq() < 1e-6) axis = new THREE.Vector3(0,1,0);
    axis.normalize();
    const vTarget = rotateAroundAxis(minusU, axis, maxRad);
    // adjust child to respect hinge angle
    const newC = m.clone().addScaledVector(vTarget, Lv);
    joints[child] = [newC.x, newC.y, newC.z];
  }

  function enforceConstraints(person, anchorKey){
    const joints = person === 'A' ? jointsA : jointsB;
    const desired = person === 'A' ? desiredLengthsA : desiredLengthsB;
    // maintain bone lengths
    for (const [a,b] of BONE_PAIRS) {
      const key = pairKey(a,b);
      const L = desired.get(key);
      if (L) adjustPairLength(joints, a, b, L, anchorKey);
    }
    // hinge limits
    enforceElbowKneeHinges(joints, ELBOW_MAX_DEG, 'shoulderL','elbowL','handL', anchorKey);
    enforceElbowKneeHinges(joints, ELBOW_MAX_DEG, 'shoulderR','elbowR','handR', anchorKey);
    enforceElbowKneeHinges(joints, KNEE_MAX_DEG, 'hipL','kneeL','footL', anchorKey);
    enforceElbowKneeHinges(joints, KNEE_MAX_DEG, 'hipR','kneeR','footR', anchorKey);
  }

  // ---------- Initialize joint objects ----------
  function initJoints() {
    jointsA = JSON.parse(JSON.stringify(POSES[startPosition].A));
    jointsB = JSON.parse(JSON.stringify(POSES[startPosition].B));
    // Ensure both figures start at the floor
    alignJointsToFloor(jointsA);
    alignJointsToFloor(jointsB);
  }

  // ---------- Create dummy (simple crash-dummy) ----------
  function createDummy(joints, colorHex, person) {
    const group = new THREE.Group();
    const jointSpheres = [];
    const boneList = [];

    // per-sphere materials to allow individual highlighting
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55, metalness: 0.05 });

    const jointBaseColor = darkMode ? JOINT_BASE_COLOR_DARK : JOINT_BASE_COLOR_LIGHT;
    const makeJointMat = () => new THREE.MeshStandardMaterial({ color: jointBaseColor, roughness: 0.35, metalness: 0.02 });
    // joint spheres (head bigger; ONLY shoulders slightly larger)
    for (const key of JOINT_KEYS) {
      const radius = key === "head"
        ? HEAD_RADIUS
        : (key.startsWith("shoulder") ? JOINT_BASE_R * SHOULDER_JOINT_SCALE : JOINT_BASE_R);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), makeJointMat());
      sphere.position.set(...joints[key]);
      sphere.userData.key = key;
      sphere.userData.defaultColor = jointBaseColor;
      group.add(sphere);
      jointSpheres.push(sphere);
    }

    // bones (tapered, rounded limbs)
    for (const [a, b] of BONE_PAIRS) {
      const start = new THREE.Vector3(...joints[a]);
      const end = new THREE.Vector3(...joints[b]);
      const [rt, rb] = getBoneRadii(a, b);
      const length = start.distanceTo(end);
      const { geometry, baseLength } = makeBoneGeometry(a, b, length, rt, rb);
      const cyl = new THREE.Mesh(geometry, bodyMat);
      if (baseLength && baseLength > 1e-6) cyl.userData.baseLength = baseLength;
      alignCylinder(cyl, start, end);
      group.add(cyl);
      boneList.push({ mesh: cyl, a, b });
    }

    // torso anchor (invisible) and extras
    const torsoGeom = new THREE.BoxGeometry(0.5, 0.6, 0.28);
    const torso = new THREE.Mesh(torsoGeom, bodyMat);
    torso.visible = false; // hide rectangle torso from view
    group.add(torso);
    // Pelvis: slightly rounded/trapezoidal frustum (vertical cylinder scaled in X/Z)
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(PELVIS_BASE_TOP_R, PELVIS_BASE_BOTTOM_R, PELVIS_BASE_H, 28), bodyMat);
    group.add(pelvis);
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,1,18), bodyMat);
    group.add(spine);
    // Torso visual: tapered frustum (smooth) ? give chest its own material to allow recolor
    const chestMat = bodyMat.clone();
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_BASE_TOP_R, TORSO_BASE_BOTTOM_R, TORSO_BASE_H, 32), chestMat);
    group.add(chest);
    const shoulderBar = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,1,20), bodyMat);
    group.add(shoulderBar);
    // Simple rounded hands/feet (ellipsoids) without extra thumb/finger segments
    const handPickMat = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: true, depthWrite: false });
    const handLBox = new THREE.Mesh(new THREE.SphereGeometry(HAND_SPHERE_R, 18, 14), handPickMat.clone());
    const handRBox = new THREE.Mesh(new THREE.SphereGeometry(HAND_SPHERE_R, 18, 14), handPickMat.clone());
    // Invisible pick proxies for hands to make them easier to grab on narrow viewports.
    handLBox.userData.pickKey = 'handL';
    handRBox.userData.pickKey = 'handR';
    handLBox.userData.isPickProxy = true;
    handRBox.userData.isPickProxy = true;
    const footLBox = new THREE.Mesh(new THREE.SphereGeometry(FOOT_SPHERE_R, 20, 16), bodyMat);
    const footRBox = new THREE.Mesh(new THREE.SphereGeometry(FOOT_SPHERE_R, 20, 16), bodyMat);
    group.add(handLBox); group.add(handRBox); group.add(footLBox); group.add(footRBox);
    // Toe control joints (smaller spheres at toe tips; positioned later)
    const toeRadius = JOINT_BASE_R * TOE_JOINT_SCALE;
    const toeLJoint = new THREE.Mesh(new THREE.SphereGeometry(toeRadius, 16, 12), makeJointMat());
    const toeRJoint = new THREE.Mesh(new THREE.SphereGeometry(toeRadius, 16, 12), makeJointMat());
    toeLJoint.position.set(...joints.footL);
    toeRJoint.position.set(...joints.footR);
    toeLJoint.userData.key = 'toeL';
    toeRJoint.userData.key = 'toeR';
    toeLJoint.userData.defaultColor = jointBaseColor;
    toeRJoint.userData.defaultColor = jointBaseColor;
    toeLJoint.userData.isToeJoint = true; toeLJoint.userData.side = 'L';
    toeRJoint.userData.isToeJoint = true; toeRJoint.userData.side = 'R';
    group.add(toeLJoint); group.add(toeRJoint);
    jointSpheres.push(toeLJoint, toeRJoint);
    // extras will be positioned after scene initialization with figure-specific dimensions

    // Upper-body control handle: match the reload preset icon
    const handleGroup = new THREE.Group();
    handleGroup.userData.isUpperHandle = true;
    if (person) handleGroup.userData.person = person;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const iconTex = getReloadHandleTexture();
    const iconSize = 0.28;
    const iconGeom = new THREE.PlaneGeometry(iconSize, iconSize);
    const iconMat = ringMat.clone();
    if (iconTex) iconMat.map = iconTex;
    const iconMesh = new THREE.Mesh(iconGeom, iconMat);
    iconMesh.userData.handleRoot = handleGroup;
    handleGroup.add(iconMesh);
    // Invisible hit proxy to allow clicking inside the icon area
    try {
      const hitRadius = iconSize * 1.1;
      const hitGeom = new THREE.SphereGeometry(hitRadius, 16, 12);
      const hitMat = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: true, depthWrite: false, depthTest: false });
      const hitMesh = new THREE.Mesh(hitGeom, hitMat);
      hitMesh.userData.handleRoot = handleGroup;
      handleGroup.add(hitMesh);
    } catch(e) {}
    group.add(handleGroup);

    return { group, jointSpheres, boneList, torso, pelvis, spine, chest, shoulderBar, handLBox, handRBox, footLBox, footRBox, upperHandle: handleGroup, toeLJoint, toeRJoint};}

  // align cylinder from start to end (use quaternion from Y axis)
  function alignCylinder(mesh, start, end) {
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(mid);
    const v = new THREE.Vector3().subVectors(end, start);
    const length = v.length();
    if (length < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    mesh.quaternion.copy(q);
    const baseLength = mesh?.userData?.baseLength;
    const scaleY = (baseLength && baseLength > 1e-6) ? (length / baseLength) : length;
    mesh.scale.set(1, scaleY, 1);
  }

  // Update torso box from joints (shoulders & hips)
  function updateTorsoFromJoints(torsoMesh, joints, dims) {
    const sL = new THREE.Vector3(...joints.shoulderL);
    const sR = new THREE.Vector3(...joints.shoulderR);
    const hL = new THREE.Vector3(...joints.hipL);
    const hR = new THREE.Vector3(...joints.hipR);
    const shoulderCenter = new THREE.Vector3().addVectors(sL, sR).multiplyScalar(0.5);
    const hipCenter = new THREE.Vector3().addVectors(hL, hR).multiplyScalar(0.5);

    const mid = new THREE.Vector3().addVectors(shoulderCenter, hipCenter).multiplyScalar(0.5);
    // clamp torso movement from its initial center later
    torsoMesh.position.copy(mid);

    // constant torso dimensions (from neutral)
    const width = clamp(dims.torsoWidth, TORSO_WIDTH_MIN, TORSO_WIDTH_MAX);
    const height = clamp(dims.torsoHeight, TORSO_HEIGHT_MIN, TORSO_HEIGHT_MAX);
    const depth = dims.torsoDepth;
    torsoMesh.scale.set(width / 0.5, height / 0.6, depth / 0.28);

    // no torso caps/extra blocks

    // rotate torso to align with vector from hipCenter -> shoulderCenter (tilt)
    const forward = new THREE.Vector3().subVectors(shoulderCenter, hipCenter).normalize();
    if (forward.lengthSq() > 0.0001) {
      // compute quaternion that rotates (0,1,0) to forward vector direction in local Y axis
      const up = new THREE.Vector3(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, forward);
      // clamp rotation magnitude to make torso not flip crazy
      const angle = 2 * Math.acos(q.w);
      const clampedAngle = Math.min(angle, TORSO_ROT_LIMIT_RAD);
      if (angle > 1e-4) {
        const axis = new THREE.Vector3(q.x, q.y, q.z).normalize();
        torsoMesh.setRotationFromAxisAngle(axis, clampedAngle);
      }
    }
    // Apply any additional manual Euler rotation for the torso (when enabled)
    applyManualTorsoRotationIfAny(torsoMesh);
  }

  function enforceTorsoFreezeForSkeleton(skel, ref){
    if (!torsoFreeze || !skel || !ref) return false;
    let changed = false;
    // Keep torso center fixed
    if (skel.rootPos.distanceTo(ref.rootPos) > 1e-6){
      skel.rootPos.copy(ref.rootPos);
      changed = true;
    }
    // Disallow bending at the hip: lock spine local rotation
    if (!skel.angleRot[IDX.spine].equals(ref.spineLocal)){
      skel.angleRot[IDX.spine].copy(ref.spineLocal);
      changed = true;
    }
    // Lock shoulders and head/neck local rotations
    try{
      if (ref.shoulderL && !skel.angleRot[IDX.shoulderL].equals(ref.shoulderL)) { skel.angleRot[IDX.shoulderL].copy(ref.shoulderL); changed = true; }
      if (ref.shoulderR && !skel.angleRot[IDX.shoulderR].equals(ref.shoulderR)) { skel.angleRot[IDX.shoulderR].copy(ref.shoulderR); changed = true; }
      if (ref.neck && !skel.angleRot[IDX.neck].equals(ref.neck)) { skel.angleRot[IDX.neck].copy(ref.neck); changed = true; }
      if (ref.head && !skel.angleRot[IDX.head].equals(ref.head)) { skel.angleRot[IDX.head].copy(ref.head); changed = true; }
    }catch(e){}
    if (changed) computeFK(skel);
    return changed;
  }

  function enforceTorsoFreeze(){
    let changed = false;
    try { changed = enforceTorsoFreezeForSkeleton(skeletonA, torsoFreezeRefA) || changed; } catch(e){}
    try { changed = enforceTorsoFreezeForSkeleton(skeletonB, torsoFreezeRefB) || changed; } catch(e){}
    return changed;
  }

  function enforceDragRootFreeze(){
    if (!dragRootFreezeActive) return false;
    let changed = false;
    try{
      if (dragFreezeWhich === 'A'){
        if (skeletonA){
          if (dragRootA && skeletonA.rootPos.distanceTo(dragRootA) > 1e-6){ skeletonA.rootPos.copy(dragRootA); changed = true; }
          if (dragSpineRefA && !skeletonA.angleRot[IDX.spine].equals(dragSpineRefA)){ skeletonA.angleRot[IDX.spine].copy(dragSpineRefA); changed = true; }
        }
      } else if (dragFreezeWhich === 'B'){
        if (skeletonB){
          if (dragRootB && skeletonB.rootPos.distanceTo(dragRootB) > 1e-6){ skeletonB.rootPos.copy(dragRootB); changed = true; }
          if (dragSpineRefB && !skeletonB.angleRot[IDX.spine].equals(dragSpineRefB)){ skeletonB.angleRot[IDX.spine].copy(dragSpineRefB); changed = true; }
        }
      }
      if (changed){ try{ computeFK(skeletonA); }catch(e){} try{ computeFK(skeletonB); }catch(e){} }
    }catch(e){}
    return changed;
  }

  // Apply current colorblind scheme to figure body materials
  function applyColorblindScheme(){
    const scheme = COLORBLIND_SCHEMES[colorblindMode] || COLORBLIND_SCHEMES.normal;
    const applyToGroup = (group, which)=>{
      if (!group) return;
      const bodyColor = (which === 'A') ? scheme.A : scheme.B;
      group.traverse(obj=>{
        if (!obj.isMesh || !obj.material) return;
        // Skip joint spheres/toe joints which have a joint key
        if (obj.userData && obj.userData.key) return;
        try{
          if (Array.isArray(obj.material)){
            for (const m of obj.material){ if (m?.color) m.color.setHex(bodyColor); }
          } else if (obj.material.color){
            obj.material.color.setHex(bodyColor);
          }
        }catch(e){}
      });
    };
    applyToGroup(figureGroupA, 'A');
    applyToGroup(figureGroupB, 'B');
    updateTorsoColors();
  }

  function updateTorsoColors(){
    try{
      const scheme = COLORBLIND_SCHEMES[colorblindMode] || COLORBLIND_SCHEMES.normal;
      const lockCol = scheme.lock ?? TORSO_FREEZE_COLOR;
      const colA = torsoFreeze ? lockCol : scheme.A;
      const colB = torsoFreeze ? lockCol : scheme.B;
      if (chestA) chestA.material.color.setHex(colA);
      if (chestB) chestB.material.color.setHex(colB);
    }catch(e){}
  }

  function captureTorsoFreezeRefs(){
    try{
      if (skeletonA){
        computeFK(skeletonA);
        torsoFreezeRefA = {
          rootPos: skeletonA.rootPos.clone(),
          spineLocal: skeletonA.angleRot[IDX.spine].clone(),
          shoulderL: skeletonA.angleRot[IDX.shoulderL].clone(),
          shoulderR: skeletonA.angleRot[IDX.shoulderR].clone(),
          neck: skeletonA.angleRot[IDX.neck].clone(),
          head: skeletonA.angleRot[IDX.head].clone()
        };
      }
      if (skeletonB){
        computeFK(skeletonB);
        torsoFreezeRefB = {
          rootPos: skeletonB.rootPos.clone(),
          spineLocal: skeletonB.angleRot[IDX.spine].clone(),
          shoulderL: skeletonB.angleRot[IDX.shoulderL].clone(),
          shoulderR: skeletonB.angleRot[IDX.shoulderR].clone(),
          neck: skeletonB.angleRot[IDX.neck].clone(),
          head: skeletonB.angleRot[IDX.head].clone()
        };
      }
    }catch(e){}
  }

  function toggleTorsoFreeze(){
    torsoFreeze = !torsoFreeze;
    if (torsoFreeze){ captureTorsoFreezeRefs(); }
    updateTorsoColors();
    try{ if (enforceTorsoFreeze()) updateMeshesFromJoints(); }catch(e){}
  }

  function updateBodyExtras(parts, joints, dims){
    const { torso, pelvis, spine, chest, shoulderBar, handLBox, handRBox, footLBox, footRBox, upperHandle, toeLJoint, toeRJoint, person } = parts;
    // Update invisible torso anchor (for limits/clamping elsewhere)
    updateTorsoFromJoints(torso, joints, dims);

    // ---- Hips / Pelvis (rounded trapezoid)
    const hL = new THREE.Vector3(...joints.hipL);
    const hR = new THREE.Vector3(...joints.hipR);
    const hipCenter = new THREE.Vector3().addVectors(hL, hR).multiplyScalar(0.5);
    const hipSpan = hL.distanceTo(hR);
    const sL = new THREE.Vector3(...joints.shoulderL);
    const sR = new THREE.Vector3(...joints.shoulderR);
    const shoulderCenter = new THREE.Vector3().addVectors(sL, sR).multiplyScalar(0.5);
    const shoulderW = sL.distanceTo(sR);
    const targetPelvisW = Math.max(0.75 * shoulderW, hipSpan);
    const pelvisDepth = TORSO_DEPTH_FIXED * 0.9;
    const pelvisHeight = 0.18;
    pelvis.position.copy(hipCenter);
    const sxPelvis = (targetPelvisW) / (2 * PELVIS_BASE_TOP_R);
    const szPelvis = pelvisDepth / (2 * PELVIS_BASE_TOP_R);
    const syPelvis = pelvisHeight / PELVIS_BASE_H;
    pelvis.scale.set(sxPelvis, syPelvis, szPelvis);
    const hipDir = new THREE.Vector3().subVectors(hR, hL);
    pelvis.rotation.set(0, Math.atan2(hipDir.z, hipDir.x), 0);

    // ---- Spine connector
    alignCylinder(spine, hipCenter, shoulderCenter);

    // ---- Torso frustum (wider at shoulders, narrower at hips)
    const chestCenter = new THREE.Vector3().lerpVectors(hipCenter, shoulderCenter, 0.58);
    chest.position.copy(chestCenter);
    const shoulderMarkerR = JOINT_BASE_R * SHOULDER_JOINT_SCALE;
    const maxTopByMarkers = Math.max(0, shoulderW - 2 * shoulderMarkerR - 0.01);
    const ratioTB = TORSO_BASE_BOTTOM_R / TORSO_BASE_TOP_R;
    const targetTopNominal = 0.8 * shoulderW;
    const minTopByHips = (targetPelvisW * 1.03) / ratioTB;
    const torsoTopW = clamp(targetTopNominal, minTopByHips, maxTopByMarkers);
    const spanHS = shoulderCenter.distanceTo(hipCenter);
    const rawTorsoH = Math.min(HEAD_DIAM * 3.0, spanHS * 0.95);
    const torsoDepth = clamp(dims.chestDepth ?? TORSO_DEPTH_FIXED, 0.26, 1.0);
    const sxTorso = (torsoTopW) / (2 * TORSO_BASE_TOP_R);
    const szTorso = torsoDepth / (2 * TORSO_BASE_TOP_R);
    const syTorso = rawTorsoH / TORSO_BASE_H;
    chest.scale.set(sxTorso, syTorso, szTorso);
    // Build an orthonormal basis from hips->shoulders (up) and shoulder span (right) to carry yaw/pitch/roll
    let upTorso = new THREE.Vector3().subVectors(shoulderCenter, hipCenter);
    if (upTorso.lengthSq() < 1e-6) upTorso.set(0,1,0);
    upTorso.normalize();
    let rightTorso = new THREE.Vector3().subVectors(sR, sL);
    if (rightTorso.lengthSq() < 1e-6) rightTorso.set(1,0,0);
    rightTorso.normalize();
    let forwardTorso = new THREE.Vector3().crossVectors(rightTorso, upTorso);
    if (forwardTorso.lengthSq() < 1e-6) forwardTorso.set(0,0,1);
    forwardTorso.normalize();
    // Re-orthonormalize to avoid drift
    rightTorso = new THREE.Vector3().crossVectors(upTorso, forwardTorso).normalize();
    forwardTorso = new THREE.Vector3().crossVectors(rightTorso, upTorso).normalize();
    const torsoBasis = new THREE.Matrix4().makeBasis(rightTorso, upTorso, forwardTorso);
    chest.setRotationFromMatrix(torsoBasis);

    // ---- Shoulder bar (kept slim, aligns to shoulders)
    alignCylinder(shoulderBar, sL, sR);

    // ---- Upper-body control handle: floats above shoulder center along torso up
    if (upperHandle){
      const headPos = new THREE.Vector3(...joints.head);
      const pos = headPos.clone().add(new THREE.Vector3(0, HEAD_HANDLE_OFFSET, 0));
      upperHandle.position.copy(pos);
      try{ if (camera) upperHandle.lookAt(camera.position); }catch(e){}
    }

    // ---- Hands (simple ellipsoids aligned along forearm)
    const handL = new THREE.Vector3(...joints.handL);
    const elbowL = new THREE.Vector3(...joints.elbowL);
    const vHL = new THREE.Vector3().subVectors(handL, elbowL);
    if (vHL.length()>1e-6) {
      handLBox.position.copy(handL);
      handLBox.scale.set(HAND_W/(2*HAND_SPHERE_R), HAND_H/(2*HAND_SPHERE_R), HAND_L/(2*HAND_SPHERE_R));
      const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), vHL.clone().normalize());
      handLBox.quaternion.copy(q);
    }
    const handR = new THREE.Vector3(...joints.handR);
    const elbowR = new THREE.Vector3(...joints.elbowR);
    const vHR = new THREE.Vector3().subVectors(handR, elbowR);
    if (vHR.length()>1e-6) {
      handRBox.position.copy(handR);
      handRBox.scale.set(HAND_W/(2*HAND_SPHERE_R), HAND_H/(2*HAND_SPHERE_R), HAND_L/(2*HAND_SPHERE_R));
      const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), vHR.clone().normalize());
      handRBox.quaternion.copy(q);
    }

    // ---- Feet: rounded ellipsoids, flat on ground, compact, with toe controls
    const heelL = new THREE.Vector3(...joints.footL);
    const heelR = new THREE.Vector3(...joints.footR);
    const fwdXZ = new THREE.Vector3().subVectors(shoulderCenter, hipCenter); fwdXZ.y = 0;
    if (fwdXZ.lengthSq() < 1e-6) fwdXZ.set(0,0,1);
    fwdXZ.normalize();

    const store = (person === 'B' ? toeOffsets.B : toeOffsets.A);
    if (!store.L) store.L = new THREE.Vector3();
    if (!store.R) store.R = new THREE.Vector3();
    if (store.L.lengthSq() < 1e-6) store.L.copy(fwdXZ).multiplyScalar(FOOT_L);
    if (store.R.lengthSq() < 1e-6) store.R.copy(fwdXZ).multiplyScalar(FOOT_L);
    const clampToeOffset = (v)=>{
      const lenSq = v.lengthSq();
      if (lenSq < 1e-6) return;
      const d = Math.sqrt(lenSq);
      if (Math.abs(d - FOOT_L) < 1e-6) return;
      v.multiplyScalar(FOOT_L / d);
    };
    clampToeOffset(store.L);
    clampToeOffset(store.R);

    const toeLPos = heelL.clone().add(store.L);
    const toeRPos = heelR.clone().add(store.R);
    toeLPos.y = Math.max(toeLPos.y, FLOOR_Y + 0.02);
    toeRPos.y = Math.max(toeRPos.y, FLOOR_Y + 0.02);

    const baseScaleX = FOOT_W/(2*FOOT_SPHERE_R);
    const baseScaleY = FOOT_H/(2*FOOT_SPHERE_R);
    const lenL = Math.max(0.02, store.L.length());
    const lenR = Math.max(0.02, store.R.length());

    const centerL = heelL.clone().addScaledVector(store.L, 0.5);
    const centerR = heelR.clone().addScaledVector(store.R, 0.5);
    centerL.y = Math.max(centerL.y, FLOOR_Y + FOOT_H/2);
    centerR.y = Math.max(centerR.y, FLOOR_Y + FOOT_H/2);

    const dirL = (store.L.lengthSq() > 1e-6 ? store.L.clone() : fwdXZ.clone()).normalize();
    const dirR = (store.R.lengthSq() > 1e-6 ? store.R.clone() : fwdXZ.clone()).normalize();
    const baseForward = new THREE.Vector3(0,0,1);
    const qFootL = new THREE.Quaternion().setFromUnitVectors(baseForward, dirL);
    const qFootR = new THREE.Quaternion().setFromUnitVectors(baseForward, dirR);

    footLBox.position.copy(centerL);
    footLBox.scale.set(baseScaleX, baseScaleY, lenL/(2*FOOT_SPHERE_R));
    footLBox.setRotationFromQuaternion(qFootL);

    footRBox.position.copy(centerR);
    footRBox.scale.set(baseScaleX, baseScaleY, lenR/(2*FOOT_SPHERE_R));
    footRBox.setRotationFromQuaternion(qFootR);

    if (toeLJoint){ toeLJoint.position.copy(toeLPos); }
    if (toeRJoint){ toeRJoint.position.copy(toeRPos); }
  }

  // ---------- Mesh sync from joints ----------
  function updateMeshesFromJoints() {
    if (undoing || playbackApplying) {
      syncMeshesNoSolve();
      return;
    }
    // Handle-rotation uses world-space joints that can include twist; keep meshes
    // in sync without re-deriving joints from skeleton during the drag.
    if (upperDrag.active || lowerHandleDrag.active) {
      syncMeshesNoSolve();
      return;
    }
    // If in Single-Joint mode and dragging a joint (or using upper-body handle), skip auto-solvers
    const directJointDrag = !!(dragging && activeJointIdx != null && !shiftDragging && !ctrlDragging);
    const toeDragActive = !!(dragging && dragging.userData?.isToeJoint);
    const ctrlWholeMove = !!(dragging && ctrlDragging);
    const bypassSolvers =
      (singleJointMode && directJointDrag) ||
      (upperDrag.active === true) ||
      (lowerHandleDrag.active === true) ||
      (bridgeDrag.active === true) ||
      (armTranslateDrag.active === true) ||
      (elbowTranslateDrag.active === true) ||
      (handTranslateDrag.active === true) ||
      ctrlWholeMove ||
      toeDragActive;
    const solverTarget = (dragging && activePerson) ? activePerson : null;
    if (!bypassSolvers){
      // If preserving torso/head during Natural drag, re-apply yaw+roll before solvers take effect
      try{
        if (natLock.active && (!solverTarget || solverTarget === natLock.person)){
          const skel = natLock.person==='A'? skeletonA : skeletonB;
          if (skel){
            if (natLock.spineBefore) preserveYawOnlyLocal(skel, IDX.spine, natLock.spineBefore);
            if (!natLock.headDrag && natLock.headBefore) preserveYawOnlyLocal(skel, IDX.head, natLock.headBefore);
            computeFK(skel);
          }
        }
      }catch(e){}
      try { clampAllJointLimits(solverTarget); } catch(e) {}
      const applySelfA = !solverTarget || solverTarget === 'A';
      const applySelfB = !solverTarget || solverTarget === 'B';
      if (applySelfA){ try { resolveSelfCollisions('A'); } catch(e) {} }
      if (applySelfB){ try { resolveSelfCollisions('B'); } catch(e) {} }
      try { resolveInterFigureCollisions(solverTarget); } catch(e) {}
    }
    // Always keep figures grounded. When bypassing solvers (direct joint drag,
    // upper-body handle, or arm/elbow/hand translate drags), first sync skeletons
    // from current joints, then ground and refresh joints. For arm/elbow/hand
    // translate drags, skip skeleton updates for the actively dragged figure so
    // only the limb moves. Also, preserve head orientation unless it is being
    // explicitly dragged or rotated via upper-body handle.
    if (!toeDragActive){
      try{
        if (bypassSolvers){
          const skipA = (armTranslateDrag.active && armTranslateDrag.person === 'A') ||
                        (elbowTranslateDrag.active && elbowTranslateDrag.person === 'A') ||
                        (handTranslateDrag.active && handTranslateDrag.person === 'A');
          const skipB = (armTranslateDrag.active && armTranslateDrag.person === 'B') ||
                        (elbowTranslateDrag.active && elbowTranslateDrag.person === 'B') ||
                        (handTranslateDrag.active && handTranslateDrag.person === 'B');
          if (skeletonA && !skipA) {
            applyJointsToSkeletonExact(skeletonA, jointsA);
          }
          if (skeletonB && !skipB) {
            applyJointsToSkeletonExact(skeletonB, jointsB);
          }
        }
        // Enforce preferred head local rotation so head doesn't flare due to arm IK/collisions
        try{
          if (skeletonA && headPreferredA && !(headDragPerson === 'A') && !(upperDrag.active && upperDrag.person === 'A')){
            skeletonA.angleRot[IDX.head].copy(headPreferredA);
            computeFK(skeletonA);
          }
          if (skeletonB && headPreferredB && !(headDragPerson === 'B') && !(upperDrag.active && upperDrag.person === 'B')){
            skeletonB.angleRot[IDX.head].copy(headPreferredB);
            computeFK(skeletonB);
          }
        }catch(e){}
        const skipA2 = (armTranslateDrag.active && armTranslateDrag.person === 'A') ||
                       (elbowTranslateDrag.active && elbowTranslateDrag.person === 'A') ||
                       (handTranslateDrag.active && handTranslateDrag.person === 'A');
        const skipB2 = (armTranslateDrag.active && armTranslateDrag.person === 'B') ||
                       (elbowTranslateDrag.active && elbowTranslateDrag.person === 'B') ||
                       (handTranslateDrag.active && handTranslateDrag.person === 'B');
        const draggingPerson = solverTarget;
        const draggingHeadNeckA = dragging && draggingPerson === 'A' && (activeJointIdx === IDX.head || activeJointIdx === IDX.neck);
        const draggingHeadNeckB = dragging && draggingPerson === 'B' && (activeJointIdx === IDX.head || activeJointIdx === IDX.neck);
        const enforceA = !draggingHeadNeckA;
        const enforceB = !draggingHeadNeckB;
        if (skeletonA && !skipA2) {
          groundSkeleton(skeletonA);
          if (dragging && draggingPerson === 'A'){ clampTorsoDriftDuringDrag('A'); }
          enforceRootAnchorDuringDrag('A');
          enforceHeadAnchorDuringDrag('A');
          jointsA = jointsFromSkeleton(skeletonA);
          if (enforceA) enforceNeckLength('A');
        }
        if (skeletonB && !skipB2) {
          groundSkeleton(skeletonB);
          if (dragging && draggingPerson === 'B'){ clampTorsoDriftDuringDrag('B'); }
          enforceRootAnchorDuringDrag('B');
          enforceHeadAnchorDuringDrag('B');
          jointsB = jointsFromSkeleton(skeletonB);
          if (enforceB) enforceNeckLength('B');
        }
      }catch(e){}
    }
    // joints
    for (const m of jointMeshesA) { const p = jointsA[m.userData.key]; if (p) m.position.set(p[0],p[1],p[2]); }
    for (const m of jointMeshesB) { const p = jointsB[m.userData.key]; if (p) m.position.set(p[0],p[1],p[2]); }
    // bones
    boneMeshesA.forEach(b => { const s=new THREE.Vector3(...jointsA[b.a]); const e=new THREE.Vector3(...jointsA[b.b]); alignCylinder(b.mesh, s, e); });
    boneMeshesB.forEach(b => { const s=new THREE.Vector3(...jointsB[b.a]); const e=new THREE.Vector3(...jointsB[b.b]); alignCylinder(b.mesh, s, e); });
    // body parts
    updateTorsoFromJoints(torsoA, jointsA, skeletonA?.dims ?? {torsoWidth:0.5, torsoHeight:0.6, torsoDepth:0.28});
    updateBodyExtras({torso:torsoA, pelvis:pelvisA, spine:spineA, chest:chestA, shoulderBar:shoulderBarA, handLBox:handBoxesA.L, handRBox:handBoxesA.R, footLBox:footBoxesA.L, footRBox:footBoxesA.R, upperHandle: upperHandleA, toeLJoint: toeJointsA.L, toeRJoint: toeJointsA.R, person: 'A'}, jointsA, skeletonA?.dims ?? {pelvisWidth:0.4, chestWidth:0.6, chestHeight:0.6, chestDepth:0.32});
    updateTorsoFromJoints(torsoB, jointsB, skeletonB?.dims ?? {torsoWidth:0.5, torsoHeight:0.6, torsoDepth:0.28});
    updateBodyExtras({torso:torsoB, pelvis:pelvisB, spine:spineB, chest:chestB, shoulderBar:shoulderBarB, handLBox:handBoxesB.L, handRBox:handBoxesB.R, footLBox:footBoxesB.L, footRBox:footBoxesB.R, upperHandle: upperHandleB, toeLJoint: toeJointsB.L, toeRJoint: toeJointsB.R, person: 'B'}, jointsB, skeletonB?.dims ?? {pelvisWidth:0.4, chestWidth:0.6, chestHeight:0.6, chestDepth:0.32});

  }

  // Lightweight mesh sync that never runs solvers or touches skeleton
  function syncMeshesNoSolve(){
    // joints to meshes
    for (const m of jointMeshesA) { const p = jointsA[m.userData.key]; if (p) m.position.set(p[0],p[1],p[2]); }
    for (const m of jointMeshesB) { const p = jointsB[m.userData.key]; if (p) m.position.set(p[0],p[1],p[2]); }
    // bones
    boneMeshesA.forEach(b => { const s=new THREE.Vector3(...jointsA[b.a]); const e=new THREE.Vector3(...jointsA[b.b]); alignCylinder(b.mesh, s, e); });
    boneMeshesB.forEach(b => { const s=new THREE.Vector3(...jointsB[b.a]); const e=new THREE.Vector3(...jointsB[b.b]); alignCylinder(b.mesh, s, e); });
    // body parts
    updateTorsoFromJoints(torsoA, jointsA, skeletonA?.dims ?? {torsoWidth:0.5, torsoHeight:0.6, torsoDepth:0.28});
    updateBodyExtras({torso:torsoA, pelvis:pelvisA, spine:spineA, chest:chestA, shoulderBar:shoulderBarA, handLBox:handBoxesA.L, handRBox:handBoxesA.R, footLBox:footBoxesA.L, footRBox:footBoxesA.R, upperHandle: upperHandleA, toeLJoint: toeJointsA.L, toeRJoint: toeJointsA.R, person: 'A'}, jointsA, skeletonA?.dims ?? {pelvisWidth:0.4, chestWidth:0.6, chestHeight:0.6, chestDepth:0.32});
    updateTorsoFromJoints(torsoB, jointsB, skeletonB?.dims ?? {torsoWidth:0.5, torsoHeight:0.6, torsoDepth:0.28});
    updateBodyExtras({torso:torsoB, pelvis:pelvisB, spine:spineB, chest:chestB, shoulderBar:shoulderBarB, handLBox:handBoxesB.L, handRBox:handBoxesB.R, footLBox:footBoxesB.L, footRBox:footBoxesB.R, upperHandle: upperHandleB, toeLJoint: toeJointsB.L, toeRJoint: toeJointsB.R, person: 'B'}, jointsB, skeletonB?.dims ?? {pelvisWidth:0.4, chestWidth:0.6, chestHeight:0.6, chestDepth:0.32});
  }

  // Compute base radius for a given joint key
  function jointRadiusForKey(key){
    if (!key) return JOINT_BASE_R;
    if (key === 'head') return HEAD_RADIUS;
    if (key.startsWith('shoulder')) return JOINT_BASE_R * SHOULDER_JOINT_SCALE;
    if (key.startsWith('hand') || key.startsWith('foot')) return JOINT_BASE_R * 0.9;
    if (key.startsWith('toe')) return JOINT_BASE_R * TOE_JOINT_SCALE;
    if (key.startsWith('hip')) return JOINT_BASE_R * 1.1;
    return JOINT_BASE_R;
  }

  // Push a point out of torso spheres for self and the other figure; clamp to floor
  function applyJointConstraints(person, jointKey, point){
    const p = point.clone();
    p.y = Math.max(p.y, FLOOR_Y + 0.02);
    const rj = jointRadiusForKey(jointKey);
    // Build torso spheres for self and other using joints arrays
    const selfJ = person==='A' ? jointsA : jointsB;
    const otherJ = person==='A' ? jointsB : jointsA;
    const selfS = buildCollisionSpheres(selfJ).filter(s=> TORSO_SPHERE_TAGS.has(s.tag));
    const otherS = buildCollisionSpheres(otherJ).filter(s=> TORSO_SPHERE_TAGS.has(s.tag));
    const pushOut = (sv)=>{
      for (const t of sv){
        const v = p.clone().sub(t.c);
        const d = v.length();
        const rs = (rj||0) + (t.r||0);
        if (d < rs){
          const n = d > 1e-6 ? v.multiplyScalar(1/d) : new THREE.Vector3(0,1,0);
          p.copy(t.c.clone().add(n.multiplyScalar(rs + 0.005)));
        }
      }
    };
    try { pushOut(selfS); } catch(e){}
    // Allow hands to approach the other figure's torso without being pushed out
    if (!(jointKey && jointKey.startsWith('hand'))){
      try { pushOut(otherS); } catch(e){}
    }
    return p;
  }

  function jointVec(person, key){
    const j = (person==='A') ? jointsA : jointsB;
    const p = j?.[key];
    return p ? new THREE.Vector3(p[0],p[1],p[2]) : new THREE.Vector3();
  }

  function childKeyForJoint(idx){
    // Pick the single chain child if unambiguous (hand/foot/neck/elbow/knee)
    const candidates = [];
    for (const name of Object.keys(NAME_TO_IDX)){
      if (PARENT[NAME_TO_IDX[name]] === idx) candidates.push(name);
    }
    if (candidates.length === 1) return candidates[0];
    // Prefer specific known chains
    const idxToName = (i)=> Object.keys(NAME_TO_IDX).find(k=> NAME_TO_IDX[k]===i);
    const name = idxToName(idx);
    if (name?.startsWith('elbow')){
      return name.endsWith('L') ? 'handL' : 'handR';
    }
    if (name?.startsWith('knee')){
      return name.endsWith('L') ? 'footL' : 'footR';
    }
    if (name === 'shoulderL') return 'elbowL';
    if (name === 'shoulderR') return 'elbowR';
    if (name === 'hipL') return 'kneeL';
    if (name === 'hipR') return 'kneeR';
    if (name === 'neck') return 'head';
    return null;
  }

  // Project a vector onto plane orthogonal to n
  function projectPerp(v, n){
    const nn = n.clone().normalize();
    return v.clone().sub(nn.multiplyScalar(v.clone().dot(nn)));
  }

  // New: strict clamp where shoulders behave exactly like hips (fixed radius to center)
  function clampToDragLengthsStrict(person, jointKey, target){
    const isHip = (jointKey === 'hipL' || jointKey === 'hipR');
    const isShoulder = (jointKey === 'shoulderL' || jointKey === 'shoulderR');
    const neutralHipR = (function(){ try{ const base=(person==='A')?baselineA:baselineB; if (base?.hipW) return base.hipW*0.5; }catch(e){} try{ const j=(person==='A')?jointsA:jointsB; const hL=new THREE.Vector3(...j.hipL), hR=new THREE.Vector3(...j.hipR); return hL.distanceTo(hR)*0.5; }catch(e){} return 0; })();
    const neutralShR = (function(){ try{ const base=(person==='A')?baselineA:baselineB; if (base?.shoulderW) return base.shoulderW*0.5; }catch(e){} try{ const j=(person==='A')?jointsA:jointsB; const sL=new THREE.Vector3(...j.shoulderL), sR=new THREE.Vector3(...j.shoulderR); return sL.distanceTo(sR)*0.5; }catch(e){} return 0; })();
    // If not the active constrained joint, still clamp hip/shoulder to neutral sphere
    if (!dragLengthConstraint.active || dragLengthConstraint.person!==person || dragLengthConstraint.jointKey!==jointKey){
      if (isHip && neutralHipR>0){ const j=(person==='A')?jointsA:jointsB; const hL=new THREE.Vector3(...j.hipL), hR=new THREE.Vector3(...j.hipR); const C=hL.clone().add(hR).multiplyScalar(0.5); const v=target.clone().sub(C); if (v.lengthSq()<1e-10) return C.clone().add(new THREE.Vector3(neutralHipR,0,0)); return C.clone().add(v.normalize().multiplyScalar(neutralHipR)); }
      if (isShoulder && neutralShR>0){ const j=(person==='A')?jointsA:jointsB; const sL=new THREE.Vector3(...j.shoulderL), sR=new THREE.Vector3(...j.shoulderR); const C=sL.clone().add(sR).multiplyScalar(0.5); const v=target.clone().sub(C); if (v.lengthSq()<1e-10) return C.clone().add(new THREE.Vector3(neutralShR,0,0)); return C.clone().add(v.normalize().multiplyScalar(neutralShR)); }
      return target.clone();
    }
    const parentKey = dragLengthConstraint.parentKey; const childKey = dragLengthConstraint.childKey;
    let r1 = dragLengthConstraint.lParent||0; const r2 = dragLengthConstraint.lChild||0;
    if (isHip && neutralHipR>0) r1 = neutralHipR; if (isShoulder && neutralShR>0) r1 = neutralShR;
    const T = target.clone();
    const centerFor=(type)=>{ const j=(person==='A')?jointsA:jointsB; if (type==='hip'){ const hL=new THREE.Vector3(...j.hipL), hR=new THREE.Vector3(...j.hipR); return hL.clone().add(hR).multiplyScalar(0.5);} if (type==='shoulder'){ const sL=new THREE.Vector3(...j.shoulderL), sR=new THREE.Vector3(...j.shoulderR); return sL.clone().add(sR).multiplyScalar(0.5);} return null; };
    if ((parentKey||isHip||isShoulder) && !childKey){ const P = isHip?centerFor('hip'): isShoulder?centerFor('shoulder'): jointVec(person,parentKey); const v=T.clone().sub(P); if (v.lengthSq()<1e-10) return P.clone().add(new THREE.Vector3(r1,0,0)); return P.clone().add(v.normalize().multiplyScalar(r1)); }
    if ((parentKey||isHip||isShoulder) && childKey){ const P = isHip?centerFor('hip'): isShoulder?centerFor('shoulder'): jointVec(person,parentKey); const C=jointVec(person, childKey); const d=P.distanceTo(C); if (d<1e-8){ const v=T.clone().sub(P); if (v.lengthSq()<1e-10) return P.clone().add(new THREE.Vector3(r1,0,0)); return P.clone().add(v.normalize().multiplyScalar(r1)); } const ex=C.clone().sub(P).multiplyScalar(1/d); const a=(r1*r1 - r2*r2 + d*d)/(2*d); const center=P.clone().add(ex.clone().multiplyScalar(a)); const rr=r1*r1 - a*a; if (rr<=1e-8) return center; const h=Math.sqrt(Math.max(0,rr)); let ey=new THREE.Vector3(0,1,0); if (Math.abs(ey.dot(ex))>0.99) ey=new THREE.Vector3(1,0,0); ey=projectPerp(ey,ex).normalize(); const v=T.clone().sub(center); const vperp=v.clone().sub(ex.clone().multiplyScalar(v.dot(ex))); if (vperp.lengthSq()<1e-10) return center.clone().add(ey.clone().multiplyScalar(h)); return center.clone().add(vperp.normalize().multiplyScalar(h)); }
    if (!parentKey && childKey){ const C=jointVec(person,childKey); const v=T.clone().sub(C); if (v.lengthSq()<1e-10) return C.clone().add(new THREE.Vector3(r2,0,0)); return C.clone().add(v.normalize().multiplyScalar(r2)); }
    return T;
  }
  // Constrain target to preserved bone length(s) snapshot at drag start
function clampToDragLengths(person, jointKey, target){
    // Special handling for hips: keep distance to hip center at neutral length, allow rotation
    const isHip = (jointKey === 'hipL' || jointKey === 'hipR');
    const neutralHipR = (isHip ? (function(){
      try{
        const base = (person==='A') ? baselineA : baselineB;
        if (base?.hipW) return base.hipW * 0.5;
        const np = POSES?.neutral?.[person];
        if (np?.hipL && np?.hipR){
          const hL = new THREE.Vector3(...np.hipL);
          const hR = new THREE.Vector3(...np.hipR);
          return hL.distanceTo(hR) * 0.5;
}
      }catch(e){}
      try{
        const j = (person==='A') ? jointsA : jointsB;
        const hL = new THREE.Vector3(...j.hipL);
        const hR = new THREE.Vector3(...j.hipR);
        return hL.distanceTo(hR) * 0.5;
      }catch(e){}
      return 0;
    })() : 0);
    // Special handling for shoulders: keep lateral distance to shoulder center near neutral (? tolerance), allow shrug (Y/Z)
    const isShoulder = (jointKey === 'shoulderL' || jointKey === 'shoulderR');
    const neutralShR = (isShoulder ? (function(){
      try{
        const base = (person==='A') ? baselineA : baselineB;
        if (base?.shoulderW) return base.shoulderW * 0.5;
        const np = POSES?.neutral?.[person];
        if (np?.shoulderL && np?.shoulderR){
          const sL = new THREE.Vector3(...np.shoulderL);
          const sR = new THREE.Vector3(...np.shoulderR);
          return sL.distanceTo(sR) * 0.5;
        }
      }catch(e){}
      try{
        const j = (person==='A') ? jointsA : jointsB;
        const sL = new THREE.Vector3(...j.shoulderL);
        const sR = new THREE.Vector3(...j.shoulderR);
        return sL.distanceTo(sR) * 0.5;
      }catch(e){}
      return 0;
    })() : 0);

    // Shoulders: enforce neutral lateral width (no extension) and scale vertical shrug
    if (isShoulder && neutralShR > 0){
      try{
        const skel = (person==='A') ? skeletonA : skeletonB;
        const tf = torsoFrameFromSkel(skel);
        const j = (person==='A') ? jointsA : jointsB;
        const sL = new THREE.Vector3(...j.shoulderL);
        const sR = new THREE.Vector3(...j.shoulderR);
        const shC = sL.clone().add(sR).multiplyScalar(0.5);
        const side = (jointKey === 'shoulderR') ? 1 : -1;
        const v = target.clone().sub(shC);
        const dx = side * neutralShR; // fixed lateral component
        const dy0 = v.dot(tf.yUp);
        const dz = v.dot(tf.zForward);
        const dy = dy0 >= 0 ? dy0 * 0.4 : dy0 * 0.2; // 60% less up, 80% less down
        return shC.clone()
          .add(tf.xRight.clone().multiplyScalar(dx))
          .add(tf.yUp.clone().multiplyScalar(dy))
          .add(tf.zForward.clone().multiplyScalar(dz));
      } catch(e){}
    }

    if (!dragLengthConstraint.active || dragLengthConstraint.person!==person || dragLengthConstraint.jointKey!==jointKey){
      // If not the active constrained joint, still enforce hip neutral radius when dragging hips
      if (isHip && neutralHipR > 0){
        const j = (person==='A') ? jointsA : jointsB;
        const hL = new THREE.Vector3(...j.hipL);
        const hR = new THREE.Vector3(...j.hipR);
        const hipC = hL.clone().add(hR).multiplyScalar(0.5);
        const v = target.clone().sub(hipC);
        if (v.lengthSq() < 1e-10) return hipC.clone().add(new THREE.Vector3(neutralHipR,0,0));
        return hipC.clone().add(v.normalize().multiplyScalar(neutralHipR));
      }
      // Loose enforcement for shoulders: clamp only lateral component to ?tol band
      if (isShoulder && neutralShR > 0){
        const j = (person==='A') ? jointsA : jointsB;
        const sL = new THREE.Vector3(...j.shoulderL);
        const sR = new THREE.Vector3(...j.shoulderR);
        const shC = sL.clone().add(sR).multiplyScalar(0.5);
        let xRight = sR.clone().sub(sL);
        if (xRight.lengthSq() < 1e-10) xRight.set(1,0,0);
        xRight.normalize();
        const tol = OVERREACH_TOL_FRAC || 0.10;
        const rMin = neutralShR * (1 - tol);
        const rMax = neutralShR * (1 + tol);
        const side = (jointKey === 'shoulderR') ? 1 : -1;
        const v = target.clone().sub(shC);
        const dot = v.dot(xRight);
        const dotAbs = side * dot;
        const dotClamped = clamp(dotAbs, rMin, rMax) * side;
        const vPerp = v.clone().sub(xRight.clone().multiplyScalar(dot));
        return shC.clone().add(xRight.clone().multiplyScalar(dotClamped)).add(vPerp);
      }
      return target.clone();
    }
    const skel = (person==='A') ? skeletonA : skeletonB;
    const idx = NAME_TO_IDX[jointKey];
    const parentKey = dragLengthConstraint.parentKey;
    const childKey  = dragLengthConstraint.childKey;
    let r1 = dragLengthConstraint.lParent || 0;
    const r2 = dragLengthConstraint.lChild  || 0;
    // For hips, use neutral radius (ignore snapshot)
    if (isHip && neutralHipR > 0) r1 = neutralHipR;
    const T = target.clone();
    // If no parent (root), nothing to do
    if ((!parentKey && !isHip) && !childKey) return T;
    if ((parentKey || isHip || isShoulder) && !childKey){
      // Parent sphere only; for hips, parent is hip center at neutral radius
      if (isHip){
        const P = (function(){ const j = (person==='A')?jointsA:jointsB; const hL=new THREE.Vector3(...j.hipL); const hR=new THREE.Vector3(...j.hipR); return hL.clone().add(hR).multiplyScalar(0.5); })();
        const v = T.clone().sub(P);
        if (v.lengthSq() < 1e-10) return P.clone().add(new THREE.Vector3(r1,0,0));
        return P.clone().add(v.normalize().multiplyScalar(r1));
      }
      if (isShoulder && neutralShR > 0){
        // Shoulder band clamp: only lateral component is constrained to [rMin,rMax]
        const j = (person==='A') ? jointsA : jointsB;
        const sL = new THREE.Vector3(...j.shoulderL);
        const sR = new THREE.Vector3(...j.shoulderR);
        const shC = sL.clone().add(sR).multiplyScalar(0.5);
        let xRight = sR.clone().sub(sL); if (xRight.lengthSq()<1e-10) xRight.set(1,0,0); xRight.normalize();
        const tol = OVERREACH_TOL_FRAC || 0.10;
        const rMin = neutralShR * (1 - tol);
        const rMax = neutralShR * (1 + tol);
        const side = (jointKey === 'shoulderR') ? 1 : -1;
        const v = T.clone().sub(shC);
        const dot = v.dot(xRight);
        const dotAbs = side * dot;
        const dotClamped = clamp(dotAbs, rMin, rMax) * side;
        const vPerp = v.clone().sub(xRight.clone().multiplyScalar(dot));
        return shC.clone().add(xRight.clone().multiplyScalar(dotClamped)).add(vPerp);
      }
      // Fallback: parent sphere
      const P = jointVec(person, parentKey);
      const v = T.clone().sub(P);
      if (v.lengthSq() < 1e-10) return P.clone().add(new THREE.Vector3(r1,0,0));
      return P.clone().add(v.normalize().multiplyScalar(r1));
    }
    if ((parentKey || isHip || isShoulder) && childKey){
      // For shoulders: do NOT preserve shoulder->elbow length; only enforce lateral width band
      if (isShoulder && neutralShR > 0){
        const j = (person==='A') ? jointsA : jointsB;
        const sL = new THREE.Vector3(...j.shoulderL);
        const sR = new THREE.Vector3(...j.shoulderR);
        const shC = sL.clone().add(sR).multiplyScalar(0.5);
        let xRight = sR.clone().sub(sL); if (xRight.lengthSq()<1e-10) xRight.set(1,0,0); xRight.normalize();
        const tol = OVERREACH_TOL_FRAC || 0.10;
        const rMin = neutralShR * (1 - tol);
        const rMax = neutralShR * (1 + tol);
        const side = (jointKey === 'shoulderR') ? 1 : -1;
        const v0 = T.clone().sub(shC);
        const d0 = v0.dot(xRight);
        const d0abs = side * d0;
        const dClamp = clamp(d0abs, rMin, rMax) * side;
        const vPerp0 = v0.clone().sub(xRight.clone().multiplyScalar(d0));
        return shC.clone().add(xRight.clone().multiplyScalar(dClamp)).add(vPerp0);
      }
      const P = isHip ? (function(){ const j = (person==='A')?jointsA:jointsB; const hL=new THREE.Vector3(...j.hipL); const hR=new THREE.Vector3(...j.hipR); return hL.clone().add(hR).multiplyScalar(0.5); })() : jointVec(person, parentKey);
      const C = jointVec(person, childKey);
      const d = P.distanceTo(C);
      if (d < 1e-8){
        // degenerate; fallback to preserve parent only
        const v = T.clone().sub(P);
        if (v.lengthSq()<1e-10) return P.clone().add(new THREE.Vector3(r1,0,0));
        return P.clone().add(v.normalize().multiplyScalar(r1));
      }
      const ex = C.clone().sub(P).multiplyScalar(1/d);
      const a = (r1*r1 - r2*r2 + d*d) / (2*d);
      const center = P.clone().add(ex.clone().multiplyScalar(a));
      const rr = r1*r1 - a*a;
      if (rr <= 1e-8){
        // circle collapsed: use the single point on line of centers
        return center;
      }
      const h = Math.sqrt(Math.max(0, rr));
      // choose plane basis perpendicular to ex
      let ey = new THREE.Vector3(0,1,0);
      if (Math.abs(ey.dot(ex)) > 0.99) ey = new THREE.Vector3(1,0,0);
      ey = projectPerp(ey, ex).normalize();
      const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
      const v = T.clone().sub(center);
      const vperp = v.clone().sub(ex.clone().multiplyScalar(v.dot(ex)));
      if (vperp.lengthSq() < 1e-10){
        // pick ey direction
        return center.clone().add(ey.clone().multiplyScalar(h));
      }
      return center.clone().add(vperp.normalize().multiplyScalar(h));
    }
    // child only (shouldn't happen), treat like sphere around child
    if (!parentKey && childKey){
      const C = jointVec(person, childKey);
      const v = T.clone().sub(C);
      if (v.lengthSq() < 1e-10) return C.clone().add(new THREE.Vector3(r2,0,0));
      return C.clone().add(v.normalize().multiplyScalar(r2));
    }
    return T;
  }

  // Orient skeleton to current joints without changing bone rest lengths
  function applyJointsToSkeletonExact(skel, joints){
    if (!skel || !joints) return;
    const hipL = new THREE.Vector3(...joints.hipL);
    const hipR = new THREE.Vector3(...joints.hipR);
    const hipC = hipL.clone().add(hipR).multiplyScalar(0.5);
    skel.rootPos = hipC.clone();
    skel.rootRot = new THREE.Quaternion();
    applyWorldPoseToSkeleton(skel, joints);
  }

  function syncSkeletonFromJoints(person){
    const skel = (person==='A') ? skeletonA : skeletonB;
    const joints = (person==='A') ? jointsA : jointsB;
    try { applyJointsToSkeletonExact(skel, joints); } catch(e){}
  }

  // ---------- Joint Angle Limits (Directional) ----------
  function torsoFrameFromSkel(skel){
    computeFK(skel);
    const sL = skel.worldPos[IDX.shoulderL].clone();
    const sR = skel.worldPos[IDX.shoulderR].clone();
    const hL = skel.worldPos[IDX.hipL].clone();
    const hR = skel.worldPos[IDX.hipR].clone();
    const shoulderCenter = sL.clone().add(sR).multiplyScalar(0.5);
    const hipCenter = hL.clone().add(hR).multiplyScalar(0.5);
    let yUp = shoulderCenter.clone().sub(hipCenter);
    if (yUp.lengthSq() < 1e-8) yUp.set(0,1,0);
    yUp.normalize();
    let xRight = sR.clone().sub(sL);
    if (xRight.lengthSq() < 1e-8) xRight.set(1,0,0);
    xRight.normalize();
    let zForward = new THREE.Vector3().crossVectors(xRight, yUp);
    if (zForward.lengthSq() < 1e-8) zForward.set(0,0,1);
    zForward.normalize();
    return { xRight, yUp, zForward, shoulderCenter, hipCenter };
  }

  function torsoFrameFromJoints(joints){
    try{
      if (!joints?.shoulderL || !joints?.shoulderR || !joints?.hipL || !joints?.hipR) return null;
      const sL = new THREE.Vector3(...joints.shoulderL);
      const sR = new THREE.Vector3(...joints.shoulderR);
      const hL = new THREE.Vector3(...joints.hipL);
      const hR = new THREE.Vector3(...joints.hipR);
      const shoulderCenter = sL.clone().add(sR).multiplyScalar(0.5);
      const hipCenter = hL.clone().add(hR).multiplyScalar(0.5);
      let yUp = shoulderCenter.clone().sub(hipCenter);
      if (yUp.lengthSq() < 1e-8) yUp.set(0,1,0);
      yUp.normalize();
      let xRight = sR.clone().sub(sL);
      if (xRight.lengthSq() < 1e-8) xRight.set(1,0,0);
      xRight.normalize();
      let zForward = new THREE.Vector3().crossVectors(xRight, yUp);
      if (zForward.lengthSq() < 1e-8) zForward.set(0,0,1);
      zForward.normalize();
      return { xRight, yUp, zForward, shoulderCenter, hipCenter };
    }catch(e){
      return null;
    }
  }

  // Clamp shoulder extension behind the torso with a 10% tolerance past a breaking point
  function clampShoulderDirectionalLimits(person){
    const skel = person==='A' ? skeletonA : skeletonB;
    if (!skel) return;
    const { xRight, yUp, zForward } = torsoFrameFromSkel(skel);
    const backAxis = zForward.clone().multiplyScalar(-1); // pointing toward the back
    const maxBackRad = toRad(SHOULDER_EXTENSION_BREAK_DEG * (1 + OVERREACH_TOL_FRAC));
    const cosMaxBack = Math.cos(maxBackRad);

    const sides = [
      { shoulder: IDX.shoulderL, elbow: IDX.elbowL },
      { shoulder: IDX.shoulderR, elbow: IDX.elbowR },
    ];
    for (const s of sides){
      computeFK(skel);
      const sPos = skel.worldPos[s.shoulder].clone();
      const ePos = skel.worldPos[s.elbow].clone();
      let v = ePos.clone().sub(sPos);
      const L = Math.max(1e-6, skel.restLength[s.elbow] || v.length());
      if (v.lengthSq() < 1e-10) continue;
      v.normalize();
      let c = v.dot(backAxis); // cos(angle to back)
      if (c > cosMaxBack + 1e-4){
        // too far behind: project to cone around backAxis with half-angle = maxBackRad
        let w = v.clone().sub(backAxis.clone().multiplyScalar(c));
        if (w.lengthSq() < 1e-10){
          // pick any direction perpendicular to backAxis (prefer yUp first)
          w = yUp.clone().sub(backAxis.clone().multiplyScalar(yUp.dot(backAxis)));
          if (w.lengthSq() < 1e-10) w = xRight.clone();
        }
        const wDir = w.normalize();
        const vNew = wDir.clone().multiplyScalar(Math.sin(maxBackRad)).add(backAxis.clone().multiplyScalar(cosMaxBack));
        const targetElbow = sPos.clone().add(vNew.multiplyScalar(L));
        const allowed = new Set([s.elbow]);
        ccdIKLimited(skel, s.elbow, targetElbow, allowed, 3);
        groundSkeleton(skel);
        if (showConstraintHighlights) addDebugLine(sPos, targetElbow);
      }
    }
  }

  function clampAllJointLimits(targetPerson=null){
    const applyA = !targetPerson || targetPerson === 'A';
    const applyB = !targetPerson || targetPerson === 'B';
    if (applyA){
      try { clampShoulderDirectionalLimits('A'); } catch(e){}
    }
    if (applyB){
      try { clampShoulderDirectionalLimits('B'); } catch(e){}
    }
  }

  // ---------- Collision (A vs B) ----------
  function buildCollisionSpheres(joints){
    const sv = [];
    const V = (k)=> new THREE.Vector3(...joints[k]);
    // Basic joint spheres
    const add = (c, r, tag)=>{ if (isFinite(r) && r>0) sv.push({ c, r, tag }); };
    const sL = V('shoulderL'), sR = V('shoulderR');
    const hL = V('hipL'), hR = V('hipR');
    const shC = new THREE.Vector3().addVectors(sL, sR).multiplyScalar(0.5);
    const hipC = new THREE.Vector3().addVectors(hL, hR).multiplyScalar(0.5);
    const shoulderW = sL.distanceTo(sR);
    const hipW = hL.distanceTo(hR);
    // Torso/pelvis approximations
    add(shC.clone(), Math.max(0.1, shoulderW * 0.45), 'shoulderTorso');
    add(hipC.clone(), Math.max(0.1, hipW * 0.45), 'pelvis');
    // Mid torso sphere
    add(new THREE.Vector3().lerpVectors(hipC, shC, 0.5), Math.max(0.1, Math.min(shoulderW, hipW) * 0.40), 'midTorso');
    // Head
    add(V('head'), HEAD_RADIUS, 'head');
    // Shoulders, elbows, hands
    const jr = (k)=> k.startsWith('shoulder') ? JOINT_BASE_R * SHOULDER_JOINT_SCALE : JOINT_BASE_R;
    add(sL.clone(), jr('shoulderL'), 'shoulderL');
    add(sR.clone(), jr('shoulderR'), 'shoulderR');
    add(V('elbowL'), JOINT_BASE_R, 'elbowL');
    add(V('elbowR'), JOINT_BASE_R, 'elbowR');
    add(V('handL'), JOINT_BASE_R * 0.9, 'handL');
    add(V('handR'), JOINT_BASE_R * 0.9, 'handR');
    // Hips, knees, feet
    add(V('hipL'), JOINT_BASE_R * 1.1, 'hipL');
    add(V('hipR'), JOINT_BASE_R * 1.1, 'hipR');
    add(V('kneeL'), JOINT_BASE_R, 'kneeL');
    add(V('kneeR'), JOINT_BASE_R, 'kneeR');
    add(V('footL'), JOINT_BASE_R * 0.9, 'footL');
    add(V('footR'), JOINT_BASE_R * 0.9, 'footR');
    // Mid-limb spheres along arms and legs (capsule-lite)
    const mids = [
      ['shoulderL','elbowL'], ['elbowL','handL'], ['shoulderR','elbowR'], ['elbowR','handR'],
      ['hipL','kneeL'], ['kneeL','footL'], ['hipR','kneeR'], ['kneeR','footR']
    ];
    for (const [a,b] of mids){
      const pa = V(a), pb = V(b);
      const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
      const r = getBoneRadius(a,b) * 1.05; // slight padding
      add(mid, r, `${a}-${b}-mid`);
    }
    return sv;
  }

  // Helper: test if a tag corresponds to torso approximation spheres
  const TORSO_SPHERE_TAGS = new Set(['shoulderTorso','midTorso','pelvis']);

  function isHandChainTag(tag){
    if (!tag) return false;
    if (tag === 'handL' || tag === 'handR') return true;
    // match mid-spheres along the forearm like 'elbowL-handL-mid'
    return (tag.includes('elbowL') && tag.includes('handL')) || (tag.includes('elbowR') && tag.includes('handR'));
  }

  // Push a specific end-effector out of a sphere using IK
  function pushEffectorOutOfSphere(skel, effKey, effRadius, sphereCenter, sphereRadius){
    try{
      computeFK(skel);
      const idx = NAME_TO_IDX[effKey];
      const p = skel.worldPos[idx].clone();
      const v = new THREE.Vector3().subVectors(p, sphereCenter);
      const d = v.length();
      const rs = (effRadius || 0) + (sphereRadius || 0);
      if (!(d < (rs - 1e-4))) return false; // no penetration
      const n = d > 1e-6 ? v.multiplyScalar(1/d) : new THREE.Vector3(0,1,0);
      const target = sphereCenter.clone().add(n.multiplyScalar(rs + 0.005));
      if (effKey === 'handL' || effKey === 'handR' || effKey === 'footL' || effKey === 'footR'){
        const chain = chainForEndKey(effKey);
        if (!chain) return false;
        const allowed = new Set([chain.root, chain.mid]);
        ccdIKLimited(skel, chain.end, target, allowed, 4);
      } else {
        // elbows/knees/head use full-chain CCD
        ccdIKToTarget(skel, idx, target, 6);
      }
      groundSkeleton(skel);
      return true;
    } catch(e){ return false; }
  }

  // Self-collision: keep a figure's head and limb joints outside its own torso spheres
  function resolveSelfCollisions(person, iterations=2){
    const skel = person==='A' ? skeletonA : skeletonB;
    if (!skel) return;
    for (let it=0; it<iterations; it++){
      computeFK(skel);
      const j = jointsFromSkeleton(skel);
      const S = buildCollisionSpheres(j);
      const torsoS = S.filter(s=> TORSO_SPHERE_TAGS.has(s.tag));
      let changed = false;
      // Head vs torso
      const headS = S.find(s=> s.tag==='head');
      if (headS){
        for (const t of torsoS){
          const v = new THREE.Vector3().subVectors(headS.c, t.c);
          const d = v.length();
          const rs = headS.r + t.r;
          if (d < rs){
            const ok = pushEffectorOutOfSphere(skel, 'head', headS.r, t.c, t.r);
            if (ok) { changed = true; if (showConstraintHighlights) addDebugLine(headS.c, t.c); }
          }
        }
      }
      // Limbs (ends and hinge joints) vs torso and head
      const limbEnds = [
        { key:'handL', r: JOINT_BASE_R*0.9 },
        { key:'handR', r: JOINT_BASE_R*0.9 },
        { key:'footL', r: JOINT_BASE_R*0.9 },
        { key:'footR', r: JOINT_BASE_R*0.9 },
        { key:'elbowL', r: JOINT_BASE_R },
        { key:'elbowR', r: JOINT_BASE_R },
        { key:'kneeL', r: JOINT_BASE_R },
        { key:'kneeR', r: JOINT_BASE_R },
      ];
      const limbTargets = headS ? [...torsoS, headS] : torsoS;
      for (const eff of limbEnds){
        computeFK(skel);
        const idx = NAME_TO_IDX[eff.key];
        if (typeof idx !== 'number') continue;
        const p = skel.worldPos[idx].clone();
        for (const t of limbTargets){
          // While the user is actively dragging an arm joint on this figure,
          // avoid self-collision pushes between that arm and the torso, but still
          // allow collisions with the head so the arm cannot pass through it.
          if (dragging && activePerson === person && activeJointIdx != null){
            try{
              const activeKey = IDX_TO_NAME[activeJointIdx];
              if (activeKey){
                const isArmKey = (k)=> k === 'handL' || k === 'elbowL' || k === 'shoulderL' || k === 'handR' || k === 'elbowR' || k === 'shoulderR';
                const sameSide = (k1, k2)=> (k1.endsWith('L') && k2.endsWith('L')) || (k1.endsWith('R') && k2.endsWith('R'));
                const isActiveArm = isArmKey(eff.key) && isArmKey(activeKey) && sameSide(eff.key, activeKey);
                const isTorsoSphere = TORSO_SPHERE_TAGS.has(t.tag);
                if (isActiveArm && isTorsoSphere){
                  continue;
                }
              }
            } catch(e){}
          }
          const v = new THREE.Vector3().subVectors(p, t.c);
          const d = v.length();
          const rs = (eff.r||0) + t.r;
          if (d < rs){
            const ok = pushEffectorOutOfSphere(skel, eff.key, eff.r, t.c, t.r);
            if (ok) { changed = true; if (showConstraintHighlights) addDebugLine(p, t.c); }
          }
        }
      }
      if (!changed) break;
    }
  }

  function resolveInterFigureCollisions(targetPerson=null, iterations=2){
    if (!skeletonA || !skeletonB) return;
    const affectA = !targetPerson || targetPerson === 'A';
    const affectB = !targetPerson || targetPerson === 'B';
    // Work from current skeletons
    computeFK(skeletonA); computeFK(skeletonB);
    if (debugLinesGroup) debugLinesGroup.clear();
    for (let it=0; it<iterations; it++){
      const jA = jointsFromSkeleton(skeletonA);
      const jB = jointsFromSkeleton(skeletonB);
      const SA = buildCollisionSpheres(jA);
      const SB = buildCollisionSpheres(jB);
      let deltaA = new THREE.Vector3();
      let deltaB = new THREE.Vector3();
      let any = false;
      let maxPen = 0;
      for (const a of SA){
        for (const b of SB){
          // Allow hands to contact the other figure's torso: ignore those pairs
          if ((TORSO_SPHERE_TAGS.has(a.tag) && isHandChainTag(b.tag)) || (TORSO_SPHERE_TAGS.has(b.tag) && isHandChainTag(a.tag))){
            continue;
          }
          const v = new THREE.Vector3().subVectors(a.c, b.c);
          const dist = v.length();
          const rs = a.r + b.r;
          if (dist < rs && rs > 0){
            any = true;
            const n = dist > 1e-6 ? v.clone().multiplyScalar(1/dist) : new THREE.Vector3(0,1,0);
            const rawPen = rs - dist;
            const pen = Math.min(0.02, rawPen); // clamp small step
            if (rawPen > maxPen) maxPen = rawPen;
            const sep = n.clone().multiplyScalar(pen * 0.5);
            if (affectA) deltaA.add(sep);
            if (affectB) deltaB.add(sep.clone().multiplyScalar(-1));
            if (showConstraintHighlights) {
              addDebugLine(a.c, b.c);
            }
          }
        }
      }
      if (!any) break;
      // Avoid hip-drift while user is manipulating; require meaningful penetration
      const allowRootResolve = (!dragging || !targetPerson);
      if (!(allowRootResolve && maxPen > 0.006)) break;
      // Apply gentle root translations and re-ground
      if (affectA){
        skeletonA.rootPos.add(deltaA);
        groundSkeleton(skeletonA);
        deltaA.multiplyScalar(0.5);
      }
      if (affectB){
        skeletonB.rootPos.add(deltaB);
        groundSkeleton(skeletonB);
        deltaB.multiplyScalar(0.5);
      }
    }

    // Additional targeted correction: keep heads outside the other figure's torso spheres via IK
    try{
      computeFK(skeletonA); computeFK(skeletonB);
      const jA2 = jointsFromSkeleton(skeletonA);
      const jB2 = jointsFromSkeleton(skeletonB);
      const SA2 = buildCollisionSpheres(jA2);
      const SB2 = buildCollisionSpheres(jB2);
      const torsoA = SA2.filter(s=> TORSO_SPHERE_TAGS.has(s.tag));
      const torsoB = SB2.filter(s=> TORSO_SPHERE_TAGS.has(s.tag));
      const headA = SA2.find(s=> s.tag==='head');
      const headB = SB2.find(s=> s.tag==='head');
      // During targeted solves, only adjust the requested figure; otherwise adjust both
      if (targetPerson){
        if (targetPerson === 'A' && headA){ for (const t of torsoB){ pushEffectorOutOfSphere(skeletonA, 'head', headA.r, t.c, t.r); } }
        if (targetPerson === 'B' && headB){ for (const t of torsoA){ pushEffectorOutOfSphere(skeletonB, 'head', headB.r, t.c, t.r); } }
      } else {
        if (headA){ for (const t of torsoB){ pushEffectorOutOfSphere(skeletonA, 'head', headA.r, t.c, t.r); } }
        if (headB){ for (const t of torsoA){ pushEffectorOutOfSphere(skeletonB, 'head', headB.r, t.c, t.r); } }
      }
    } catch(e){}
  }

  function addDebugLine(p1, p2){
    if (!debugLinesGroup) return;
    const geom = new THREE.BufferGeometry().setFromPoints([p1.clone(), p2.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOR });
    const line = new THREE.Line(geom, mat);
    debugLinesGroup.add(line);
  }

  // ---------- Picking ----------
  
  // Raycast hips/torso body (pelvis/chest) to allow bridge-style dragging when clicking the structure
  function pickHipBody(event){
    const el = renderer?.domElement;
    if (!el) return null;
    const view = viewAtEvent(event);
    const cam = cameraForView(view) || camera;
    const ndc = ndcForEventInView(event, view);
    mouse.x = ndc.x; mouse.y = ndc.y;
    raycaster.setFromCamera(mouse, cam);
    const targets = [];
    if (pelvisA) targets.push(pelvisA);
    if (pelvisB) targets.push(pelvisB);
    if (chestA) targets.push(chestA);
    if (chestB) targets.push(chestB);
    if (!targets.length) return null;
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const obj = hits[0].object;
    let person = null;
    let part = null;
    if (obj === pelvisA) { person = 'A'; part = 'pelvis'; }
    else if (obj === pelvisB) { person = 'B'; part = 'pelvis'; }
    else if (obj === chestA) { person = 'A'; part = 'chest'; }
    else if (obj === chestB) { person = 'B'; part = 'chest'; }
    if (!person) return null;
    return { person, mesh: obj, part };
  }

  function pickJoint(event, opts = {}) {
    const el = renderer?.domElement;
    if (!el) return null;
    const allowFallback = opts.allowFallback !== false;
    const view = viewAtEvent(event);
    const cam = cameraForView(view) || camera;
    const ndc = ndcForEventInView(event, view);
    mouse.x = ndc.x; mouse.y = ndc.y;
    raycaster.setFromCamera(mouse, cam);
    const proxies = [];
    if (handBoxesA?.L) proxies.push(handBoxesA.L, handBoxesA.R);
    if (handBoxesB?.L) proxies.push(handBoxesB.L, handBoxesB.R);
    const hits = raycaster.intersectObjects([...jointMeshesA, ...jointMeshesB, ...proxies], false);
    if (!hits.length){
      if (!allowFallback) return null;
      // Fallback: screen-space proximity pick (helps grab small joints like hands)
      const vps = getViewports();
      const r = (!fourViewMode || !vps) ? { x:0, y:0, w: rect.width, h: rect.height } : (vps[view]?.dom || { x:0, y:0, w: rect.width, h: rect.height });
      const px = (event.clientX - rect.left) - r.x;
      const py = (event.clientY - rect.top) - r.y;
      const maxPx = 18;
      let best = null;
      let bestD2 = maxPx * maxPx;
      const all = [...jointMeshesA, ...jointMeshesB];
      for (const m of all){
        const wp = m.getWorldPosition(new THREE.Vector3());
        const ndc = wp.clone().project(cam);
        if (ndc.z < -1 || ndc.z > 1) continue;
        const sx = (ndc.x * 0.5 + 0.5) * r.w;
        const sy = (-ndc.y * 0.5 + 0.5) * r.h;
        const dx = sx - px;
        const dy = sy - py;
        const d2 = dx*dx + dy*dy;
        if (d2 < bestD2){ bestD2 = d2; best = m; }
      }
      return best ? { object: best } : null;
    }
    const hit = hits[0];
    const proxyKey = hit.object?.userData?.pickKey;
    if (proxyKey) {
      const person = hit.object.userData.person;
      const list = person === 'A' ? jointMeshesA : (person === 'B' ? jointMeshesB : null);
      let real = list ? list.find(m => m.userData.key === proxyKey) : null;
      if (!real) real = [...jointMeshesA, ...jointMeshesB].find(m => m.userData.key === proxyKey) || null;
      if (real) return { ...hit, object: real };
    }
    return hit;
  }

  // ---------- Scene creation ----------
  onMount(() => {
    initJoints();
    // skeletons from neutral and apply start pose
    skeletonA = buildBindFromNeutral(POSES.neutral.A);
    skeletonB = buildBindFromNeutral(POSES.neutral.B);
    applyWorldPoseToSkeleton(skeletonA, POSES[startPosition].A);
    applyWorldPoseToSkeleton(skeletonB, POSES[startPosition].B);
    groundSkeleton(skeletonA);
    groundSkeleton(skeletonB);
    try{
      computeFK(skeletonA);
      headPreferredA = skeletonA.angleRot[IDX.head]?.clone() || null;
    }catch(e){ headPreferredA = null; }
    try{
      computeFK(skeletonB);
      headPreferredB = skeletonB.angleRot[IDX.head]?.clone() || null;
    }catch(e){ headPreferredB = null; }
    jointsA = jointsFromSkeleton(skeletonA);
    jointsB = jointsFromSkeleton(skeletonB);

    // scene
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 1000);
    camera.position.set(2, 1.6, 3);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    try{
      if (renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
    }catch(e){}
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.2;
    // Disable mouse-based camera rotation; keep zoom and potential pan
    try{
      controls.enableRotate = false;
      controls.enablePan = false;
    }catch(e){}
    // Ortho cameras (for 4-view mode)
    camFront = new THREE.OrthographicCamera(-1,1,1,-1,0.01,1000);
    camSide  = new THREE.OrthographicCamera(-1,1,1,-1,0.01,1000);
    camTop   = new THREE.OrthographicCamera(-1,1,1,-1,0.01,1000);
    setOrthoFrustums();
    updateOrthoCameras();
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2.5, 5.5, 3.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb8c8ff, 0.25);
    rim.position.set(-3, 2.5, -4);
    scene.add(rim);

    // ground
    groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6,6),
      new THREE.MeshStandardMaterial({ color: darkMode ? 0x203453 : 0xe8edf3, roughness: 0.95, metalness: 0.0 })
    );
    groundMesh.rotation.x = -Math.PI/2;
    groundMesh.position.y = FLOOR_Y;
    scene.add(groundMesh);

    // dummies
    const scheme0 = COLORBLIND_SCHEMES[colorblindMode] || COLORBLIND_SCHEMES.normal;
    const dA = createDummy(jointsA, scheme0.A, 'A');
    const dB = createDummy(jointsB, scheme0.B, 'B');
    scene.add(dA.group); scene.add(dB.group);
    figureGroupA = dA.group; figureGroupB = dB.group;
    jointMeshesA = dA.jointSpheres; boneMeshesA = dA.boneList;
    torsoA = dA.torso; pelvisA = dA.pelvis; spineA = dA.spine; chestA = dA.chest; shoulderBarA = dA.shoulderBar;
    handBoxesA = { L: dA.handLBox, R: dA.handRBox }; footBoxesA = { L: dA.footLBox, R: dA.footRBox };
    toeJointsA = { L: dA.toeLJoint, R: dA.toeRJoint };
    jointMeshesB = dB.jointSpheres; boneMeshesB = dB.boneList;
    torsoB = dB.torso; pelvisB = dB.pelvis; spineB = dB.spine; chestB = dB.chest; shoulderBarB = dB.shoulderBar;
    handBoxesB = { L: dB.handLBox, R: dB.handRBox }; footBoxesB = { L: dB.footLBox, R: dB.footRBox };
    toeJointsB = { L: dB.toeLJoint, R: dB.toeRJoint };
    if (handBoxesA?.L){ handBoxesA.L.userData.person = 'A'; handBoxesA.R.userData.person = 'A'; }
    if (handBoxesB?.L){ handBoxesB.L.userData.person = 'B'; handBoxesB.R.userData.person = 'B'; }
    upperHandleA = dA.upperHandle; upperHandleB = dB.upperHandle;
    function setHandleVisual(h, color, emissive, scale=1){
      if (!h) return;
      h.scale.set(scale, scale, scale);
      h.traverse(m=>{
        if (m.isMesh && m.material){
          if (m.material.color) m.material.color.setHex(color);
          if (m.material.emissive) m.material.emissive.setHex(emissive);
        }
      });
    }
    const ROT_GREEN = 0x00b050, ROT_EMISS = 0x003a20;
    // Make the head handle icon smaller via scale
    if (upperHandleA){ setHandleVisual(upperHandleA, ROT_GREEN, ROT_EMISS, 0.75); upperHandleA.userData.defaultColor = ROT_GREEN; upperHandleA.userData.person='A'; }
    if (upperHandleB){ setHandleVisual(upperHandleB, ROT_GREEN, ROT_EMISS, 0.75); upperHandleB.userData.defaultColor = ROT_GREEN; upperHandleB.userData.person='B'; }

    // Ensure torso colors and body colors reflect current mode/lock state
    applyColorblindScheme();

    // Capture mount-based baseline and use its lengths as master reference
    captureBaselineFromMount();
    desiredLengthsA = baselineA?.lenMap ?? computeDesiredLengths(POSES.neutral.A);
    desiredLengthsB = baselineB?.lenMap ?? computeDesiredLengths(POSES.neutral.B);
    neutralTorsoLenA = baselineA?.torsoLen ?? computeTorsoLength(POSES.neutral.A);
    neutralTorsoLenB = baselineB?.torsoLen ?? computeTorsoLength(POSES.neutral.B);
    shoulderCenterToNeckLenA = baselineA?.neckCenterLen ?? computeShoulderCenterToNeckLen(POSES.neutral.A);
    shoulderCenterToNeckLenB = baselineB?.neckCenterLen ?? computeShoulderCenterToNeckLen(POSES.neutral.B);

    updateMeshesFromJoints();
    attachPointerEvents();
    window.addEventListener('resize', onResize);
    // Intercept wheel for ortho zoom when in 4-view
    renderer.domElement.addEventListener('wheel', wheelHandler, { passive: false });
    // Key listeners
    const kd = (e)=>{
      // Ignore single-key shortcuts while typing in inputs (allow Ctrl/Cmd combos)
      if (isTypingTarget(e.target) && !(e.ctrlKey||e.metaKey)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoLastFigureMove(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); try{ saveCurrentFrame(); }catch(_){} return; }
      if (e.key === 'Escape') { closeAllMenus(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nextFrame(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevFrame(); return; }
      if (e.key === 'Control') { armRotateSyncOnCtrlTap(e); return; }
      if (dragging && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); startDepthNudge(-1); return; }
      if (!dragging && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); togglePlayback(); return; }
      if (dragging && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF')) { e.preventDefault(); startDepthNudge(1); return; }
      if (e.key === 'Tab') { e.preventDefault(); tabToeRotate = true; return; }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); toggleUI(); return; }
      if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); toggleTorsoFreeze(); return; }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); toggleSingleJointMode(); return; }
      handleWASDKeyDown(e);
    };
    const ku = (e)=>{
      if (isTypingTarget(e.target) && !(e.ctrlKey||e.metaKey)) return;
      if (e.code === 'Space' || e.key === ' ' || e.key === 'f' || e.key === 'F' || e.code === 'KeyF') { stopDepthNudge(); }
      if (e.key === 'Tab') { tabToeRotate = false; return; }
      handleWASDKeyUp(e);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    const handleGlobalPointer = (e)=>{
      const t = e.target;
      if (showSavedPlaybacksMenu && !clickInside(t, playbacksMenuEl, playbacksToggleEl)) showSavedPlaybacksMenu = false;
      if (showSavedPresetsMenu && !clickInside(t, presetsMenuEl, presetsToggleEl)) showSavedPresetsMenu = false;
      if (showAccountMenu && !clickInside(t, accountMenuEl, accountToggleEl)) closeAllMenus();
      if ((showAccountAuth || showAccountSettings || showAccountShortcuts) && !clickInside(t, accountMenuEl, accountToggleEl)) closeAllSettingTabs();
      if (playbackContextMenu.visible && !clickInside(t, playbackContextEl, null)) closePlaybackContext();
    };
    window.addEventListener('pointerdown', handleGlobalPointer, true);
    // Pointer lock disabled to keep OS cursor visible while dragging
    onDestroy(()=>{ window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('pointerdown', handleGlobalPointer, true); });
    animate();

    // Build live GUI pose editor
    if (ENABLE_LIL_GUI){
      buildPoseGUI();
      applyUiVisibility();
    }
    // Initialize playback and custom presets (do not auto-create a frame; snapshot when user saves/plays)
    try{
      restoreSavedPlaybacks();
      restorePlaybackFolders();
      ensurePlaybackFoldersFromSaved();
      playbackGroups = groupPlaybacks(savedPlaybacks);
      restoreSavedPresets();
      restorePresetOverrides();
    }catch(e){}
    uiReady = true;
  });

  function cycleLockState(){
    const el = renderer?.domElement;
    if (lockState === 'normal'){
      lockState = 'select';
      try{ if (el) el.style.cursor = 'crosshair'; }catch(e){}
    } else if (lockState === 'select'){
      lockState = 'active';
      try{ if (el) el.style.cursor = 'default'; }catch(e){}
      setLockPreview(null);
    } else { // active -> normal (clear locks)
      lockState = 'normal';
      clearAllLocks();
      try{ if (el) el.style.cursor = 'default'; }catch(e){}
      setLockPreview(null);
    }
  }

  function onResize(){
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    setOrthoFrustums();
  }

  // Treat keybindings as inactive when user is typing into inputs
  const isTypingTarget = (el)=>{
    try{
      if (!el) return false;
      const tag = (el.tagName||'').toLowerCase();
      return tag==='input' || tag==='textarea' || tag==='select' || !!el.isContentEditable;
    }catch(_) { return false; }
  };

  
  function animate(){
    requestAnimationFrame(animate);
    controls.enabled = orbitEnabled;
    // delta time for smooth camera motion
    const nowMs = (typeof performance!=='undefined'? performance.now() : Date.now());
    const dtSec = Math.min(0.05, Math.max(0, (nowMs - lastAnimTimeMs) / 1000)); // clamp dt
    lastAnimTimeMs = nowMs;
    // WASD camera movement (when not dragging and not typing in UI)
    try{ updateCameraWASD(dtSec); } catch(e){}
    controls.update();
    // apply snap animations
    let snapped = updateSnaps();
    const wasdActive = (moveKeys.w || moveKeys.a || moveKeys.s || moveKeys.d);
    const ikChanged = false;
    // enforce torso freeze early (prevents torso translation/hip bending during drag/IK)
    const freezeChanged = enforceTorsoFreeze();
    // While dragging a joint, hold roots fixed to avoid creeping from collision correction elsewhere
    const dragRootChanged = enforceDragRootFreeze();
    // While dragging, update drag target against current camera so WASD works concurrently,
    // but freeze the joint while WASD keys are held. On release, re-anchor to avoid jump.
    if (dragging && wasdActive) {
      try { alignMouseToDraggedJoint(); } catch(e){}
    } else {
      try { if (lockCursorEl) lockCursorEl.style.display = 'none'; } catch(e){}
    }
    if (dragging && !wasdActive && lastWASDActive){
      try { reanchorDragOffset(); } catch(e){}
    }
    if (!(dragging && wasdActive)){
      // Keep scene/root from drifting while lower-body handle rotation is active
      if (!lowerHandleDrag.active){
        try { updateDraggingFromCamera(); } catch(e){}
      }
    }
    lastWASDActive = wasdActive;
    let changedLimits = false;
    let changedCollide = false;
    let changedLock = false;
    if (!(((singleJointMode && dragging && activeJointIdx != null)) || upperDrag.active || lowerHandleDrag.active || bridgeDrag.active || armTranslateDrag.active || elbowTranslateDrag.active || handTranslateDrag.active)){
      try { changedLimits = enforceRotationLimits(); } catch(e){}
      try { changedCollide = enforceTorsoCollisions(); } catch(e){}
      // Enforce world-locked joints last
      try { changedLock = enforceLockedJoints(); } catch(e){}
    }
    // enforce freeze again after other constraints so it wins
    const freezeChanged2 = enforceTorsoFreeze() || freezeChanged || dragRootChanged;
    if (snapped || ikChanged || changedLimits || changedCollide || changedLock || freezeChanged2) {
      try { updateMeshesFromJoints(); } catch(e){}
    }
    // update highlight visuals
    applyJointHighlights();
    // Update ortho camera placements and zoom
    updateOrthoCameras();
    try { updateCommentOverlay(); } catch(e){}
    const el = renderer.domElement;
    const w = el.clientWidth|0, h = el.clientHeight|0;
    if (!fourViewMode){
      renderer.setScissorTest(false);
      renderer.setViewport(0,0,w,h);
      renderer.setScissor(0,0,w,h);
      renderer.render(scene, camera);
    } else {
      const vps = getViewports();
      renderer.setScissorTest(true);
      // Perspective (top-left)
      { const r = vps.persp.gl; renderer.setViewport(r.x, r.y, r.w, r.h); renderer.setScissor(r.x, r.y, r.w, r.h); renderer.render(scene, camera); }
      // Front (top-right)
      { const r = vps.front.gl; renderer.setViewport(r.x, r.y, r.w, r.h); renderer.setScissor(r.x, r.y, r.w, r.h); renderer.render(scene, camFront); }
      // Side (bottom-left)
      { const r = vps.side.gl;  renderer.setViewport(r.x, r.y, r.w, r.h); renderer.setScissor(r.x, r.y, r.w, r.h); renderer.render(scene, camSide); }
      // Top (bottom-right)
      { const r = vps.top.gl;   renderer.setViewport(r.x, r.y, r.w, r.h); renderer.setScissor(r.x, r.y, r.w, r.h); renderer.render(scene, camTop); }
    }
  }
  function updateSnaps(){
    if (!activeSnaps.length) return false;
    const now = Date.now();
    let anyChanged = false;
    const remain = [];
    for (const s of activeSnaps){
      const t = Math.min(1, (now - s.t0) / (s.dur > 0 ? s.dur : 1));
      const skel = s.follower==='A' ? skeletonA : skeletonB;
      const newRoot = s.initialRoot.clone().add(s.delta.clone().multiplyScalar(t));
      skel.rootPos.copy(newRoot);
      groundSkeleton(skel);
      anyChanged = true;
      if (t < 1) remain.push(s);
    }
    activeSnaps = remain;
    return anyChanged;
  }
  // --- Comment overlay placement (right of figures, follows camera) ---
  function getActiveCommentText(){
    const typed = String(comment || '').trim();
    if (typed.length > 0) return typed;
    if (!showFrameComments) return '';
    try{
      const saved = poses && poses[currentFrame] && String(poses[currentFrame].comment || '').trim();
      if (saved && saved.length > 0) return saved;
    }catch(e){}
    return '';
  }

  function updateCommentOverlay(){
    try{
      commentText = getActiveCommentText();
      // Show comments whenever the current frame has text
      commentVisible = (commentText.length > 0);
      if (!commentVisible) return;
      const el = renderer?.domElement; if (!el) return;
      const rect = el.getBoundingClientRect();
      const vps = getViewports();
      const vp = (!fourViewMode || !vps) ? { x:0, y:0, w: rect.width, h: rect.height } : vps.persp.dom;
      const box = new THREE.Box3();
      if (figureGroupA) { figureGroupA.updateMatrixWorld(); box.expandByObject(figureGroupA); }
      if (figureGroupB) { figureGroupB.updateMatrixWorld(); box.expandByObject(figureGroupB); }
      if (box.isEmpty()) return;
      const cam = camera;
      const pts = [
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z)
      ];
      let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
      for (const p of pts){
        const ndc = p.clone().project(cam);
        const px = rect.left + vp.x + (ndc.x*0.5 + 0.5) * vp.w;
        const py = rect.top  + vp.y + (-ndc.y*0.5 + 0.5) * vp.h;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      const bbox = { left:minX, right:maxX, top:minY, bottom:maxY, midY:(minY+maxY)/2 };
      const boxW = (commentEl?.offsetWidth) ? commentEl.offsetWidth : 260;
      const boxH = (commentEl?.offsetHeight) ? commentEl.offsetHeight : 80;
      const M = 12;
      const winW = (typeof window!=='undefined') ? window.innerWidth : (rect.left + rect.width);
      const winH = (typeof window!=='undefined') ? window.innerHeight : (rect.top + rect.height);
      const bottomGap = (fourViewMode && toolbarEl && toolbarEl.offsetHeight) ? (toolbarEl.offsetHeight + 12) : 12;

      let left = bbox.right + M;
      let top  = Math.max(12, Math.min(bbox.midY - boxH/2, winH - bottomGap - boxH));
      if (left + boxW + 12 > winW){
        // try above
        let t = bbox.top - boxH - M;
        if (t >= 12){
          top = t; left = Math.min(winW - boxW - 12, Math.max(12, bbox.right - boxW));
        } else {
          // try below
          t = bbox.bottom + M;
          if (t + boxH <= winH - bottomGap){
            top = t; left = Math.min(winW - boxW - 12, Math.max(12, bbox.right - boxW));
          } else {
            // fallback: left side
            left = Math.max(12, bbox.left - boxW - M);
            top  = Math.max(12, Math.min(bbox.midY - boxH/2, winH - bottomGap - boxH));
          }
        }
      }
      commentPos.left = Math.round(left);
      commentPos.top  = Math.round(top);
    }catch(e){}
  }
  // Keep internal NDC cursor aligned to the dragged joint while camera orbits (WASD)
  function alignMouseToDraggedJoint(){
    if (!dragging) return;
    const cam = dragCamera || camera;
    if (!cam) return;
    const world = dragging.getWorldPosition(new THREE.Vector3());
    const ndc = world.project(cam);
    // Clamp to NDC bounds to avoid invalid values
    mouse.x = Math.max(-1, Math.min(1, ndc.x));
    mouse.y = Math.max(-1, Math.min(1, ndc.y));
  }
  // Adjust drag offset so releasing WASD does not cause a snap
  function reanchorDragOffset(){
    if (!dragging) return;
    const ds = activePerson==='A' ? dragState.A : dragState.B;
    const cam = ds.camera || dragCamera || camera;
    raycaster.setFromCamera(mouse, cam);
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ds.plane, p)){
      ds.offset.subVectors(dragging.getWorldPosition(new THREE.Vector3()), p);
    }
  }
  // Recompute drag intersection each frame so camera movement (WASD) works during drag
  function updateDraggingFromCamera(){
    if (!dragging) return;
    const el = renderer?.domElement; if (!el) return;
    const ds = activePerson==='A' ? dragState.A : dragState.B;
    const cam = ds.camera || dragCamera || camera;
    raycaster.setFromCamera(mouse, cam);
    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ds.plane, intersectPoint)){
      let target = intersectPoint.add(ds.offset.clone());
      target.y = Math.max(target.y, FLOOR_Y + 0.02);
      if (shiftDragging){
        if (torsoFreeze) { return; }
        const prev = dragging.position.clone();
        const delta = new THREE.Vector3().subVectors(target, prev);
        const allY = [...jointMeshesA, ...jointMeshesB].map(m=> m.position.y);
        const minY = Math.min(...allY);
        if (delta.y < 0){ const minAllowedDy = (FLOOR_Y + 0.02) - minY; if (delta.y < minAllowedDy) delta.y = minAllowedDy; }
        skeletonA.rootPos.add(delta); skeletonB.rootPos.add(delta);
        groundSkeleton(skeletonA); groundSkeleton(skeletonB);
        jointsA = jointsFromSkeleton(skeletonA); jointsB = jointsFromSkeleton(skeletonB);
        updateMeshesFromJoints();
      } else if (ctrlDragging){
        const prev = dragging.position.clone();
        const delta = new THREE.Vector3().subVectors(target, prev);
        const sel = selectedPerson === 'A' ? 'A' : 'B';
        const selMeshes = sel==='A' ? jointMeshesA : jointMeshesB;
        const minY = Math.min(...selMeshes.map(m=> m.position.y));
        if (delta.y < 0){ const minAllowedDy = (FLOOR_Y + 0.02) - minY; if (delta.y < minAllowedDy) delta.y = minAllowedDy; }
        if (sel==='A') { skeletonA.rootPos.add(delta); if (torsoFreeze && torsoFreezeRefA) torsoFreezeRefA.rootPos.add(delta); groundSkeleton(skeletonA); jointsA = jointsFromSkeleton(skeletonA); }
        else { skeletonB.rootPos.add(delta); if (torsoFreeze && torsoFreezeRefB) torsoFreezeRefB.rootPos.add(delta); groundSkeleton(skeletonB); jointsB = jointsFromSkeleton(skeletonB); }
        updateMeshesFromJoints();
      } else if (activeJointIdx != null) {
        applyJointDragTarget(target, ds);
      }
    }
  }
  // Map effector key to two-bone chain
  function chainForEndKey(key){
    switch(key){
      case 'handL': return { root: IDX.shoulderL, mid: IDX.elbowL, end: IDX.handL };
      case 'handR': return { root: IDX.shoulderR, mid: IDX.elbowR, end: IDX.handR };
      case 'footL': return { root: IDX.hipL, mid: IDX.kneeL, end: IDX.footL };
      case 'footR': return { root: IDX.hipR, mid: IDX.kneeR, end: IDX.footR };
      default: return null;
    }
  }

  function nearestEffectorKeyForPoint(skel, worldPoint){
    try{
      computeFK(skel);
      const options = ['handL','handR','footL','footR'];
      let bestK = null, bestD2 = Infinity;
      for (const k of options){
        const idx = NAME_TO_IDX[k];
        const wp = skel.worldPos[idx];
        const d2 = wp.distanceToSquared(worldPoint);
        if (d2 < bestD2){ bestD2 = d2; bestK = k; }
      }
      return bestK;
    } catch(e){ return null; }
  }

  function limitedChildrenForDrag(idx){
    switch (idx){
      case IDX.handL: return new Set([IDX.handL]); // keep shoulder fixed, only elbow+hand solve
      case IDX.handR: return new Set([IDX.handR]);
      case IDX.footL: return new Set([IDX.footL, IDX.kneeL, IDX.hipL]);
      case IDX.footR: return new Set([IDX.footR, IDX.kneeR, IDX.hipR]);
      default: return null;
    }
  }

  // CCD limited to two-bone limb (shoulder+elbow or hip+knee)
  function ccdIKLimited(skel, endIdx, target, allowedChildren, iterations=3){
    computeFK(skel);
    const path = getPathToRoot(endIdx);
    for (let it=0; it<iterations; it++){
      for (let k=path.length-2; k>=0; k--){
        const joint = path[k];
        const child = path[k+1];
        if (!allowedChildren.has(child)) continue;
        // Respect locks
        try{
          const person = (skel === skeletonA) ? 'A' : 'B';
          const childKey = Object.keys(NAME_TO_IDX).find(n=> NAME_TO_IDX[n]===child);
          const jointKey = Object.keys(NAME_TO_IDX).find(n=> NAME_TO_IDX[n]===joint);
          const endKey = Object.keys(NAME_TO_IDX).find(n=> NAME_TO_IDX[n]===endIdx);
          if ((endKey && isLocked(person, endKey)) || (childKey && isLocked(person, childKey)) || (jointKey && isLocked(person, jointKey))) continue;
        }catch(e){}
        const origin = skel.worldPos[joint].clone();
        const end = skel.worldPos[endIdx].clone();
        const vCur = end.clone().sub(origin);
        const vTar = target.clone().sub(origin);
        if (vCur.lengthSq()<1e-10 || vTar.lengthSq()<1e-10) continue;
        const qWorld = new THREE.Quaternion().setFromUnitVectors(vCur.clone().normalize(), vTar.clone().normalize());
        const parentWorldRot = skel.worldRot[joint];
        const qLocal = parentWorldRot.clone().invert().multiply(qWorld).multiply(parentWorldRot);
        skel.angleRot[child] = qLocal.clone().multiply(skel.angleRot[child]);
        computeFK(skel);
      }
      if (skel.worldPos[endIdx].distanceTo(target) < 1e-3) break;
    }
    groundSkeleton(skel);
  }

  function markHighlight(person, jointKey){
    if (!showConstraintHighlights) return;
    const until = Date.now() + HIGHLIGHT_MS;
    if (person==='A') highlightA[jointKey] = until; else highlightB[jointKey] = until;
  }

  function applyJointHighlights(){
    if (!showConstraintHighlights) {
      // reset to default
      for (const m of jointMeshesA){ m.material.color.setHex(m.userData.defaultColor); if (!m.userData.locked && m.material?.emissive) m.material.emissive.setHex(0x000000); }
      for (const m of jointMeshesB){ m.material.color.setHex(m.userData.defaultColor); if (!m.userData.locked && m.material?.emissive) m.material.emissive.setHex(0x000000); }
      if (debugLinesGroup) debugLinesGroup.clear();
      return;
    }
    const now = Date.now();
    for (const m of jointMeshesA){
      const k = m.userData.key;
      const active = (highlightA[k]||0) > now;
      if (active) m.material.color.setHex(HIGHLIGHT_COLOR); else m.material.color.setHex(m.userData.defaultColor);
      if (m.userData.locked && m.material?.emissive) m.material.emissive.setHex(0x661111);
    }
    for (const m of jointMeshesB){
      const k = m.userData.key;
      const active = (highlightB[k]||0) > now;
      if (active) m.material.color.setHex(HIGHLIGHT_COLOR); else m.material.color.setHex(m.userData.defaultColor);
      if (m.userData.locked && m.material?.emissive) m.material.emissive.setHex(0x661111);
    }
  }

  // ---------- Preset switching API ----------
  function setPosition(name){
    if (!name) return;
    const key = String(name)
      .replace(/\s+/g,'')
      .replace(/-/g,'')
      .replace(/_/g,'')
      .toLowerCase();
    const map = new Map([
      ['neutral','neutral'],
      ['openguard','openGuard'],
      ['closedguard','closedGuard'],
      ['kneeshield','kneeShield'],
      ['halfguard','halfGuard'],
      ['sidecontrol','sideControl'],
      ['backcontrol','backControl'],
      ['mount','mount']
    ]);
    const poseKey = map.get(key);
    if (!poseKey || !POSES[poseKey]) return;
    startPosition = poseKey;
    showFrameComments = false;
    comment = '';
    commentText = '';
    commentVisible = false;
    // Reset editing state and force reapply even if selecting the same preset twice
    editingPresetIdx = -1; editingPresetName = "";
    editingPlaybackIdx = -1; editingPlaybackName = "";
    // If this pose was imported from JSON, apply it directly
    if (importedPoses[poseKey]){
      applyImportedPose(poseKey);
      return;
    }
    if (poseKey === 'neutral') {
      // Reset local rotations to identity; place root at neutral hip center
      const resetSkel = (skel, neutralJoints)=>{
        const j = jointsToVecs(neutralJoints);
        const hipC = new THREE.Vector3().addVectors(j.hipL, j.hipR).multiplyScalar(0.5);
        skel.rootPos = hipC.clone();
        skel.rootRot = new THREE.Quaternion();
        for (const i of TOP_ORDER) { if (i === IDX.root) continue; skel.angleRot[i].identity(); }
        computeFK(skel);
      };
      resetSkel(skeletonA, POSES.neutral.A);
      resetSkel(skeletonB, POSES.neutral.B);
    } else {
      applyWorldPoseToSkeleton(skeletonA, POSES[startPosition].A);
      applyWorldPoseToSkeleton(skeletonB, POSES[startPosition].B);
    }
    groundSkeleton(skeletonA);
    groundSkeleton(skeletonB);
    updateMeshesFromJoints();
    // refresh GUI state to reflect new pose
    refreshGuiFromSkeletons();
  }

  function snapshotCurrentPoseForPreset(){
    return {
      A: cloneJoints(jointsA),
      B: cloneJoints(jointsB)
    };
  }

  function snapshotCurrentPoseForImport(){
    const vec = (v)=> v ? [v.x||0, v.y||0, v.z||0] : [0,0,0];
    const mk = (skel, joints)=>({
      joints: cloneJoints(joints),
      rootPos: skel ? [skel.rootPos.x, skel.rootPos.y, skel.rootPos.z] : [0,0,0]
    });
    return {
      A: mk(skeletonA, jointsA),
      B: mk(skeletonB, jointsB),
      torsoExtras: { A: { ...torsoGuiA }, B: { ...torsoGuiB } },
      toeOffsets: {
        A: { L: vec(toeOffsets.A?.L), R: vec(toeOffsets.A?.R) },
        B: { L: vec(toeOffsets.B?.L), R: vec(toeOffsets.B?.R) }
      }
    };
  }

  function updateCurrentPresetFromScene(){
    if (!startPosition) return;
    const poseKey = startPosition;
    const snapshot = snapshotCurrentPoseForImport();
    // Persist override so it survives reloads (and reuse it immediately for this session)
    presetOverrides[poseKey] = snapshot;
    applyPresetOverrideToPose(poseKey, snapshot);
    persistPresetOverrides();
    console.info(`Preset "${poseKey}" updated to current pose and saved.`);
  }

  // ---------- GUI Helpers ----------
  function toEulerDeg(q){
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return { x: e.x * 180/Math.PI, y: e.y * 180/Math.PI, z: e.z * 180/Math.PI };
  }
  function fromEulerDeg(x,y,z){
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(toRad(x||0), toRad(y||0), toRad(z||0), 'XYZ'));
  }

  function getSkel(person){ return person==='A' ? skeletonA : skeletonB; }

  function applyAfterChange(person){
    const skel = getSkel(person);
    groundSkeleton(skel);
    const joints = jointsFromSkeleton(skel);
    if (person==='A') jointsA = joints; else jointsB = joints;
    // Enforce and reapply to keep lengths/proportions stable
    stabilizeAndEnforce(person);
    const j2 = person==='A' ? jointsA : jointsB;
    applyWorldPoseToSkeleton(skel, j2);
    groundSkeleton(skel);
    updateMeshesFromJoints();
  }

  function updateJointPosition(person, key){
    const skel = getSkel(person);
    const idx = NAME_TO_IDX[key];
    if (idx == null) return;
    const src = person==='A'? guiPosA[key] : guiPosB[key];
    const target = new THREE.Vector3(src.x||0, Math.max(src.y||0, FLOOR_Y+0.02), src.z||0);
    ccdIKToTarget(skel, idx, target, 10);
    applyAfterChange(person);
  }

  function updateJointRotation(person, key){
    const skel = getSkel(person);
    const idx = NAME_TO_IDX[key];
    if (idx == null) return;
    const src = person==='A'? guiRotA[key] : guiRotB[key];
    const q = fromEulerDeg(src.x||0, src.y||0, src.z||0);
    skel.angleRot[idx] = q;
    applyAfterChange(person);
  }

  function refreshGuiFromSkeletons(){
    if (!gui) return;
    const refreshFor = (person)=>{
      const skel = getSkel(person);
      computeFK(skel);
      for (const k of JOINT_KEYS){
        const idx = NAME_TO_IDX[k];
        const p = skel.worldPos[idx];
        const r = toEulerDeg(skel.angleRot[idx]);
        const pos = person==='A'? guiPosA[k] : guiPosB[k];
        const rot = person==='A'? guiRotA[k] : guiRotB[k];
        pos.x = p.x; pos.y = p.y; pos.z = p.z;
        rot.x = r.x; rot.y = r.y; rot.z = r.z;
      }
    };
    refreshFor('A'); refreshFor('B');
    // update displays
    for (const c of guiControllers){ try { c.updateDisplay(); } catch(e){} }
  }

  function buildPoseGUI(){
    try { if (gui) { gui.destroy(); gui = null; } } catch(e){}
    gui = new GUI({ title: 'Pose Editor' });
    try { if (gui?.domElement && !gui.domElement.isConnected) document.body.appendChild(gui.domElement); } catch(e){}
    const root = gui;
    try { root.open(); } catch(e){}

    // Selection folder
    const selection = root.addFolder('Selection');
    const selectionState = { active: selectedPerson };
    selection.add(selectionState, 'active', { '?? Yellow':'A', '?? Orange':'B' }).name('Active Figure').onChange((v)=>{ selectedPerson = v; });
    try { selection.open(); } catch(e){}


    // Torso extra rotations (as their own folders under figures too)
    const torsoFolder = root.addFolder('Torso (Extra Rot)');
    torsoFolder.add(torsoGuiA, 'rotX', -180, 180, 1).name('Yellow Rotate X').onChange(()=>updateMeshesFromJoints());
    torsoFolder.add(torsoGuiA, 'rotY', -180, 180, 1).name('Yellow Rotate Y').onChange(()=>updateMeshesFromJoints());
    torsoFolder.add(torsoGuiA, 'rotZ', -180, 180, 1).name('Yellow Rotate Z').onChange(()=>updateMeshesFromJoints());
    torsoFolder.add(torsoGuiB, 'rotX', -180, 180, 1).name('Orange Rotate X').onChange(()=>updateMeshesFromJoints());
    torsoFolder.add(torsoGuiB, 'rotY', -180, 180, 1).name('Orange Rotate Y').onChange(()=>updateMeshesFromJoints());
    torsoFolder.add(torsoGuiB, 'rotZ', -180, 180, 1).name('Orange Rotate Z').onChange(()=>updateMeshesFromJoints());

    const makePerson = (person, label)=>{
      const f = root.addFolder(label);
      try { f.open(); } catch(e){}
      for (const k of JOINT_KEYS){
        if (person==='A'){
          guiPosA[k] = { x: 0, y: 0, z: 0 };
          guiRotA[k] = { x: 0, y: 0, z: 0 };
        } else {
          guiPosB[k] = { x: 0, y: 0, z: 0 };
          guiRotB[k] = { x: 0, y: 0, z: 0 };
        }
        const folder = f.addFolder(k === 'footL' ? 'ankleL' : k === 'footR' ? 'ankleR' : k);
        const pos = person==='A'? guiPosA[k] : guiPosB[k];
        const rot = person==='A'? guiRotA[k] : guiRotB[k];
        const pcx = folder.add(pos, 'x', -2, 2, 0.001).name('Pos X').onChange(()=>updateJointPosition(person, k));
        const pcy = folder.add(pos, 'y', -0.2, 2, 0.001).name('Pos Y').onChange(()=>updateJointPosition(person, k));
        const pcz = folder.add(pos, 'z', -2, 2, 0.001).name('Pos Z').onChange(()=>updateJointPosition(person, k));
        const rcx = folder.add(rot, 'x', -180, 180, 1).name('Rotate X').onChange(()=>updateJointRotation(person, k));
        const rcy = folder.add(rot, 'y', -180, 180, 1).name('Rotate Y').onChange(()=>updateJointRotation(person, k));
        const rcz = folder.add(rot, 'z', -180, 180, 1).name('Rotate Z').onChange(()=>updateJointRotation(person, k));
        guiControllers.push(pcx, pcy, pcz, rcx, rcy, rcz);
      }
      // Add torso extra rotation folder under each figure
      const torsoUnder = f.addFolder('torso');
      const tg = person==='A'? torsoGuiA : torsoGuiB;
      torsoUnder.add(tg, 'rotX', -180, 180, 1).name('Rotate X').onChange(()=>updateMeshesFromJoints());
      torsoUnder.add(tg, 'rotY', -180, 180, 1).name('Rotate Y').onChange(()=>updateMeshesFromJoints());
      torsoUnder.add(tg, 'rotZ', -180, 180, 1).name('Rotate Z').onChange(()=>updateMeshesFromJoints());
    };
    makePerson('A', '?? Yellow Figure');
    makePerson('B', '?? Orange Figure');

    // Import preset JSONs for specific poses
    const importFolder = root.addFolder('?? Import Presets');
    const importActions = {
      importBackControl: () => importPoseFor('backControl'),
      importSideControl: () => importPoseFor('sideControl')
    };
    importFolder.add(importActions, 'importBackControl').name('Import Back Control');
    importFolder.add(importActions, 'importSideControl').name('Import Side Control');

    // Buttons: Save / Load / Reset in dedicated folder at bottom
    const io = root.addFolder('?? File I/O');
    const actions = {
      savePose: () => savePoseToFile(),
      loadPose: () => triggerLoadPose(),
      resetPose: () => resetCurrentPose()
    };
    io.add(actions, 'savePose').name('?? Save Pose');
    io.add(actions, 'loadPose').name('?? Load Pose');
    io.add(actions, 'resetPose').name('?? Reset Pose');
    try { io.open(); } catch(e){}

    // Quick-access buttons at the top level (duplicated for visibility)
    root.add(actions, 'savePose').name('?? Save Pose');
    root.add(actions, 'loadPose').name('?? Load Pose');
    root.add(actions, 'resetPose').name('?? Reset Pose');

    refreshGuiFromSkeletons();
  }

  function resetCurrentPose(){
    const pose = POSES[startPosition];
    applyWorldPoseToSkeleton(skeletonA, pose.A);
    applyWorldPoseToSkeleton(skeletonB, pose.B);
    groundSkeleton(skeletonA);
    groundSkeleton(skeletonB);
    updateMeshesFromJoints();
    refreshGuiFromSkeletons();
  }

  function buildPoseSnapshot(){
    const build = (skel)=>{
      computeFK(skel);
      const joints = {};
      const euler = {};
      for (const k of JOINT_KEYS){
        const i = NAME_TO_IDX[k];
        const p = skel.worldPos[i];
        joints[k] = [p.x, p.y, p.z];
        const r = toEulerDeg(skel.angleRot[i]);
        euler[k] = [r.x, r.y, r.z];
      }
      return { joints, euler, rootPos: [skel.rootPos.x, skel.rootPos.y, skel.rootPos.z] };
    };
    const vecToArr = (v)=> v ? [v.x||0, v.y||0, v.z||0] : [0,0,0];
    return {
      preset: startPosition,
      A: build(skeletonA),
      B: build(skeletonB),
      torsoExtras: { A: torsoGuiA, B: torsoGuiB },
      toeOffsets: {
        A: { L: vecToArr(toeOffsets.A?.L), R: vecToArr(toeOffsets.A?.R) },
        B: { L: vecToArr(toeOffsets.B?.L), R: vecToArr(toeOffsets.B?.R) }
      }
    };
  }

  // ----- Playback helpers -----
  function saveCurrentFrame(){
    const data = buildPoseSnapshot();
    if (!poses || poses.length===0){
      poses = [{ data, comment: (comment||'') }];
      currentFrame = 0;
    } else {
      poses = [...poses, { data, comment: (comment||'') }];
      currentFrame = poses.length - 1;
    }
    comment = '';
  }
  function applyFrame(idx){
    if (!poses || poses.length===0) return;
    showFrameComments = true;
    const i = Math.max(0, Math.min(poses.length-1, idx|0));
    currentFrame = i;
    const snap = poses[i].data;
    playbackApplying = true;
    try{ applyLoadedPose(snap); }finally{ playbackApplying = false; }
  }
  function nextFrame(){ if (!poses.length) return; applyFrame((currentFrame+1)%poses.length); }
  function prevFrame(){ if (!poses.length) return; applyFrame((currentFrame-1+poses.length)%poses.length); }
  function restartPlaybackTimer(){
    if (!playing) return;
    try{ if (intervalId) clearInterval(intervalId); }catch(e){}
    intervalId = setInterval(()=>{
      try{ nextFrame(); }catch(e){}
    }, Math.max(100, playbackIntervalMs|0));
  }
  function startPlayback(){
    if (!poses || poses.length === 0) return;
    if (playing) return;
    playing = true;
    restartPlaybackTimer();
  }
  function stopPlayback(){ playing=false; try{ if (intervalId) clearInterval(intervalId); }catch(e){} intervalId = null; }
  function togglePlayback(){ if (playing) stopPlayback(); else startPlayback(); }
  function cancelPlayback(){ stopPlayback(); }
  function intervalToPct(ms){
    const clamped = Math.min(Math.max(ms, PLAYBACK_MIN_MS), PLAYBACK_MAX_MS);
    // 0 = slowest (left), 100 = fastest (right)
    const t = (PLAYBACK_MAX_MS - clamped) / (PLAYBACK_MAX_MS - PLAYBACK_MIN_MS);
    return Math.round(t * 100);
  }
  function setPlaybackSpeedPct(pct){
    const p = Math.max(0, Math.min(100, pct));
    playbackSpeedPct = p;
    const t = p / 100; // 0 slow, 1 fast
    playbackIntervalMs = PLAYBACK_MAX_MS - (PLAYBACK_MAX_MS - PLAYBACK_MIN_MS) * t;
    restartPlaybackTimer();
  }
  playbackSpeedPct = intervalToPct(playbackIntervalMs);
  function clearPlaybackQueue(){
    stopPlayback();
    poses = [];
    currentFrame = 0;
    comment = '';
    commentText = '';
    commentVisible = false;
  }
  const closeAllSettingTabs = ()=>{
    showAccountAuth = false;
    showAccountSettings = false;
    showAccountShortcuts = false;
  };
  const closeAllMenus = ()=>{
    showSavedPlaybacksMenu = false;
    showSavedPresetsMenu = false;
    showAccountMenu = false;
    closeAllSettingTabs();
  };
  function toggleAccountSetting(panel){
    const next = (panel === 'account') ? !showAccountAuth : (panel === 'settings') ? !showAccountSettings : (panel === 'shortcuts') ? !showAccountShortcuts : false;
    closeAllSettingTabs();
    if (next){
      if (panel === 'account') showAccountAuth = true;
      else if (panel === 'settings') showAccountSettings = true;
      else if (panel === 'shortcuts') showAccountShortcuts = true;
      showAccountMenu = true;
    }
  }
  const clickInside = (target, ...nodes)=> nodes.filter(Boolean).some(node => node.contains(target));

  function applyAuthSession(session){
    const user = session?.user ?? null;
    isLoggedIn = !!user;
    if (!user){
      loginName = '';
      loginEmail = '';
      return;
    }
    loginEmail = user.email || '';
    loginName =
      user.user_metadata?.display_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'User';
  }
  function formatAuthError(error){
    const message = error?.message || '';
    if (!message) return 'Unable to reach Supabase.';
    if (message.toLowerCase() === 'failed to fetch'){
      return 'Could not reach Supabase. Check your internet connection, firewall, or Supabase project URL.';
    }
    return message;
  }
  function formatAuthDetail(error){
    const message = error?.message || '';
    if (message.toLowerCase() === 'failed to fetch'){
      if (typeof navigator !== 'undefined' && navigator.onLine === false){
        return 'This browser appears to be offline.';
      }
      return 'If you are on a school or work network, requests to supabase.co may be blocked. Also confirm the project is active in Supabase.';
    }
    return '';
  }
  async function loadAuthState(){
    if (!isSupabaseConfigured) return;
    try{
      const supabase = requireSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      applyAuthSession(data?.session ?? null);
      const { data: authListener } = supabase.auth.onAuthStateChange((event, session)=>{
        applyAuthSession(session);
        if (event === 'SIGNED_IN') authMessage = 'Signed in.';
        else if (event === 'SIGNED_OUT') authMessage = 'Signed out.';
      });
      authUnsubscribe = authListener?.subscription?.unsubscribe
        ? () => authListener.subscription.unsubscribe()
        : null;
    }catch(error){
      authMessage = formatAuthError(error);
      authDetail = formatAuthDetail(error);
    }
  }
  async function handleAuthSubmit(){
    authAttempted = true;
    authMessage = '';
    authDetail = '';
    if (!isSupabaseConfigured){
      authMessage = 'Supabase is not configured yet. Add PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.';
      return;
    }
    if (!loginEmail.trim()){
      authMessage = 'Email required.';
      return;
    }
    authBusy = true;
    try{
      if (!loginName.trim()){
        loginName = loginEmail.split('@')[0] || 'User';
      }
      const supabase = requireSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: loginEmail.trim(),
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/fightlab3d/figures` : undefined,
          data: {
            name: loginName.trim(),
            display_name: loginName.trim()
          }
        }
      });
      if (error) throw error;
      authMessage = 'Check your email for the sign-in link.';
    }catch(error){
      authMessage = formatAuthError(error);
      authDetail = formatAuthDetail(error);
    }finally{
      authBusy = false;
    }
  }
  async function logout(){
    authAttempted = false;
    authMessage = '';
    authDetail = '';
    if (!isSupabaseConfigured){
      isLoggedIn = false;
      loginName = '';
      loginEmail = '';
      return;
    }
    authBusy = true;
    try{
      const supabase = requireSupabase();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      applyAuthSession(null);
      authMessage = 'Signed out.';
    }catch(error){
      authMessage = formatAuthError(error);
      authDetail = formatAuthDetail(error);
    }finally{
      authBusy = false;
    }
  }

  // ----- Save/Load playbacks (multiple sequences) -----
  function persistSavedPlaybacks(){
    try{ localStorage.setItem('savedPlaybacks', JSON.stringify(savedPlaybacks)); }catch(e){}
  }
  function restoreSavedPlaybacks(){
    try{
      const s = localStorage.getItem('savedPlaybacks');
      if (s){
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) savedPlaybacks = arr.map(pb=>{
          if (pb && typeof pb === 'object') return { ...pb, folder: folderKey(pb.folder) };
          return pb;
        });
      }
    }catch(e){}
  }
  function persistPlaybackFolders(){
    try{ localStorage.setItem('playbackFolders', JSON.stringify(playbackFolders)); }catch(e){}
  }
  function restorePlaybackFolders(){
    try{
      const s = localStorage.getItem('playbackFolders');
      if (s){
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) playbackFolders = arr.filter(f=> !!f && typeof f === 'string').map(folderKey).filter(Boolean);
      }
    }catch(e){}
  }
  function applyPresetOverrideToPose(poseKey, data, opts = {}){
    if (!poseKey || !data) return false;
    const { applyToScene = false } = opts;
    const clonePart = (part)=>{
      if (!part) return undefined;
      const joints = cloneJoints(part.joints || part);
      const rootPos = Array.isArray(part.rootPos) ? [...part.rootPos] : undefined;
      return { ...part, joints, ...(rootPos ? { rootPos } : {}) };
    };
    const cloned = { A: clonePart(data.A), B: clonePart(data.B) };
    if (data.torsoExtras){
      const extras = { ...data.torsoExtras };
      if (data.torsoExtras.A) extras.A = { ...data.torsoExtras.A };
      if (data.torsoExtras.B) extras.B = { ...data.torsoExtras.B };
      cloned.torsoExtras = extras;
    }
    if (data.toeOffsets){
      const vec = (arr)=> Array.isArray(arr) && arr.length>=3 ? [arr[0], arr[1], arr[2]] : undefined;
      cloned.toeOffsets = {
        A: { L: vec(data.toeOffsets.A?.L), R: vec(data.toeOffsets.A?.R) },
        B: { L: vec(data.toeOffsets.B?.L), R: vec(data.toeOffsets.B?.R) }
      };
    }
    importedPoses[poseKey] = cloned;
    if (!POSES[poseKey]) POSES[poseKey] = { A: {}, B: {} };
    if (cloned.A?.joints) POSES[poseKey].A = cloneJoints(cloned.A.joints);
    if (cloned.B?.joints) POSES[poseKey].B = cloneJoints(cloned.B.joints);
    if (applyToScene && poseKey === startPosition){
      try{ applyImportedPose(poseKey); return true; }catch(_) {}
    }
    return false;
  }
  // ----- Save/Load custom presets -----
  function persistSavedPresets(){
    try{ localStorage.setItem('savedPresets', JSON.stringify(savedPresets)); }catch(e){}
  }
  function restoreSavedPresets(){
    try{
      const s = localStorage.getItem('savedPresets');
      if (s){ const arr = JSON.parse(s); if (Array.isArray(arr)) savedPresets = arr; }
    }catch(e){}
  }
  function persistPresetOverrides(){
    try{ localStorage.setItem('presetOverridesV1', JSON.stringify(presetOverrides)); }catch(e){}
  }
  function restorePresetOverrides(){
    presetOverrides = {};
    importedPoses = {};
    try{
      const raw = localStorage.getItem('presetOverridesV1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const [poseKey, data] of Object.entries(parsed)){
        if (!poseKey || !data) continue;
        presetOverrides[poseKey] = data;
        applyPresetOverrideToPose(poseKey, data, { applyToScene: poseKey === startPosition });
      }
    }catch(e){
      console.error('Failed to restore preset overrides', e);
      presetOverrides = {};
      importedPoses = {};
    }
  }
  function saveCurrentPreset(){
    const nameRaw = (newPresetName||"").trim();
    const name = nameRaw || `Preset ${savedPresets.length+1}`;
    const data = buildPoseSnapshot();
    const idx = savedPresets.findIndex(p=> String(p?.name||"").toLowerCase() === name.toLowerCase());
    if (idx >= 0) {
      savedPresets = savedPresets.map((p,i)=> i===idx ? { name, data } : p);
    } else {
      savedPresets = [...savedPresets, { name, data }];
    }
    newPresetName = "";
    editingPresetIdx = -1; editingPresetName = "";
    persistSavedPresets();
  }
  function promptSaveCustomPreset(){
    const suggested = (newPresetName||"").trim() || `Preset ${savedPresets.length+1}`;
    try{
      const val = typeof prompt === 'function' ? prompt('Name this preset', suggested) : suggested;
      if (!val || !String(val).trim()) return;
      newPresetName = String(val).trim();
      saveCurrentPreset();
    }catch(e){}
  }
  function savePresetEdits(){
    if (editingPresetIdx < 0 || editingPresetIdx >= savedPresets.length) return;
    const name = (editingPresetName||"").trim() || savedPresets[editingPresetIdx].name || `Preset ${editingPresetIdx+1}`;
    const data = buildPoseSnapshot();
    savedPresets = savedPresets.map((p,i)=> i===editingPresetIdx ? { name, data } : p);
    persistSavedPresets();
  }
  function cancelPresetEdit(){
    editingPresetIdx = -1;
    editingPresetName = "";
  }
  function startPresetEdit(idx){
    if (idx<0 || idx>=savedPresets.length) return;
    editingPresetIdx = idx;
    editingPresetName = savedPresets[idx].name || `Preset ${idx+1}`;
    showFrameComments = false;
    comment = '';
    commentText = '';
    commentVisible = false;
    try{ applyLoadedPose(savedPresets[idx].data); }catch(e){}
  }
  function loadSavedPreset(idx){
    const i = idx|0; if (i<0 || i>=savedPresets.length) return;
    const pr = savedPresets[i];
    showFrameComments = false;
    comment = '';
    commentText = '';
    commentVisible = false;
    applyLoadedPose(pr.data);
  }
  function deleteSavedPreset(idx){
    const i = idx|0; if (i<0 || i>=savedPresets.length) return;
    savedPresets = [...savedPresets.slice(0,i), ...savedPresets.slice(i+1)];
    persistSavedPresets();
  }
  function deepCopyFrames(frames){ try{ return JSON.parse(JSON.stringify(frames||[])); }catch(e){ return []; } }
  function groupPlaybacks(list=[]){
    const map = new Map();
    // seed with known folders so empty folders appear
    playbackFolders.forEach(f=>{ const k = folderKey(f); if (k) map.set(k, []); });
    list.forEach((pb, i)=>{
      const folder = folderKey(pb.folder);
      if (!folder) return;
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder).push({ ...pb, _idx: i });
    });
    return Array.from(map.entries()).map(([folder, items])=>({ folder, items }));
  }
  let playbackGroups = groupPlaybacks(savedPlaybacks);
  $: topPlaybackGroups = Array.isArray(playbackGroups) ? playbackGroups.filter(g => !g.folder || g.folder.indexOf('/') === -1) : [];
  function syncOpenPlaybackFolders(){
    const all = playbackGroups.map(g=> g.folder);
    const set = new Set(openPlaybackFolders || []);
    all.forEach(f=> set.add(f));
    openPlaybackFolders = Array.from(set);
    if (playbackFolderView && !all.includes(playbackFolderView)) playbackFolderView = null;
  }
  function isPlaybackFolderOpen(f){ return openPlaybackFolders?.includes?.(f); }
  function togglePlaybackFolder(f){
    const arr = Array.isArray(openPlaybackFolders) ? [...openPlaybackFolders] : [];
    const idx = arr.indexOf(f);
    if (idx >= 0) arr.splice(idx,1); else arr.push(f);
    openPlaybackFolders = arr;
  }
  function ensurePlaybackFoldersFromSaved(){
    const set = new Set(playbackFolders.map(folderKey).filter(Boolean));
    savedPlaybacks.forEach(pb=>{
      const f = folderKey(pb.folder);
      if (f) set.add(f);
    });
    playbackFolders = Array.from(set).filter(Boolean);
    // keep folders open by default
    syncOpenPlaybackFolders();
  }
  function addPlaybackFolder(name, parent=null){
    const fullPath = combineFolderPath(parent, name);
    if (!fullPath) return;
    if (!playbackFolders.includes(fullPath)){
      playbackFolders = [...playbackFolders, fullPath];
      persistPlaybackFolders();
      playbackGroups = groupPlaybacks(savedPlaybacks);
    }
    // force reactive refresh for the current view so new folders appear immediately
    playbackFolders = [...playbackFolders];
    playbackGroups = [...playbackGroups];
    playbackFolderView = `${playbackFolderView}`;
    playbacksMenuVersion += 1;
    syncOpenPlaybackFolders();
  }
  function deletePlaybackFolder(name){
    const v = folderKey(name);
    if (!v) return;
    const isDescendant = (f)=> f === v || (f && f.startsWith(v + '/'));
    // Drop the folder and any nested subfolders
    playbackFolders = playbackFolders.filter(f=> !isDescendant(folderKey(f)));
    // Delete any playbacks inside the folder (or its subfolders)
    savedPlaybacks = savedPlaybacks.filter(pb => {
      const f = folderKey(pb.folder);
      return !isDescendant(f);
    });
    persistSavedPlaybacks();
    persistPlaybackFolders();
    playbackGroups = groupPlaybacks(savedPlaybacks);
    // force view refresh so the removal shows immediately
    playbackFolders = [...playbackFolders];
    playbackGroups = [...playbackGroups];
    playbackFolderView = `${playbackFolderView}`;
    playbacksMenuVersion += 1;
    syncOpenPlaybackFolders();
  }
  function openPlaybackContext(e, folderName=''){
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    playbackContextMenu = { visible:true, x: e?.clientX||0, y: e?.clientY||0, folder: folderKey(folderName) };
  }
  function closePlaybackContext(){
    playbackContextMenu = { visible:false, x:0, y:0, folder:'' };
  }
  function movePlaybackToFolder(idx, folderName){
    const i = idx|0; if (i<0 || i>=savedPlaybacks.length) return;
    const folder = folderKey(folderName);
    savedPlaybacks = savedPlaybacks.map((pb, j)=> j===i ? { ...pb, folder } : pb);
    persistSavedPlaybacks();
    if (folder && !playbackFolders.includes(folder)){
      playbackFolders = [...playbackFolders, folder];
      persistPlaybackFolders();
    }
    playbackGroups = groupPlaybacks(savedPlaybacks);
    // refresh view immediately and enter the target folder
    playbackFolders = [...playbackFolders];
    playbackGroups = [...playbackGroups];
    playbackFolderView = folder ?? '';
    playbacksMenuVersion += 1;
    syncOpenPlaybackFolders();
  }
  const folderKey = (name)=>{
    const parts = String(name||'').split('/').map(p=> p.trim()).filter(Boolean);
    return parts.join('/') || '';
  };
  function combineFolderPath(parent, name){
    const child = folderKey(name);
    if (!child) return '';
    const base = folderKey(parent);
    return base ? `${base}/${child}` : child;
  }
  function childFolders(parent){
    const base = folderKey(parent);
    const baseDepth = base ? base.split('/').length : 0;
    const children = playbackFolders
      .map(folderKey)
      .filter(Boolean)
      .filter(f=>{
        if (base){
          if (!f.startsWith(base + '/')) return false;
          const rest = f.slice(base.length + 1);
          return rest.length && rest.indexOf('/') === -1;
        }
        return f.indexOf('/') === -1;
      });
    return Array.from(new Set(children));
  }
  function playbacksInFolder(name){
    const key = folderKey(name);
    return savedPlaybacks.map((pb,i)=> ({ ...pb, _idx:i })).filter(pb => folderKey(pb.folder || '') === key);
  }
  function saveEditsToPlayback(){
    if (editingPlaybackIdx < 0 || editingPlaybackIdx >= savedPlaybacks.length) return;
    if (!poses || poses.length === 0) return;
    const idx = editingPlaybackIdx;
    const name = (editingPlaybackName||"").trim() || savedPlaybacks[idx].name || `Playback ${idx+1}`;
    const folder = folderKey(editingPlaybackFolder);
    // Update the currently visible frame with the live pose before saving
    if (poses[currentFrame]){
      poses[currentFrame] = { ...poses[currentFrame], data: buildPoseSnapshot() };
    }
    const frames = deepCopyFrames(poses);
    savedPlaybacks = savedPlaybacks.map((pb, i)=> i===idx ? { name, frames, folder } : pb);
    persistSavedPlaybacks();
    poses = frames;
    currentFrame = Math.min(currentFrame, Math.max(poses.length - 1, 0));
    try{ applyFrame(currentFrame); }catch(_) {}
    // refresh dropdown grouping
    playbackGroups = groupPlaybacks(savedPlaybacks);
  }
  function cancelPlaybackEdit(){
    editingPlaybackIdx = -1;
    editingPlaybackName = "";
    editingPlaybackFolder = "";
    showSavedPlaybacksMenu = false;
  }
  function startPlaybackEdit(idx){
    if (idx<0 || idx>=savedPlaybacks.length) return;
    editingPlaybackIdx = idx;
    editingPlaybackName = savedPlaybacks[idx].name || `Playback ${idx+1}`;
    editingPlaybackFolder = folderKey(savedPlaybacks[idx].folder) || "";
    try{
      const frames = deepCopyFrames(savedPlaybacks[idx].frames);
      poses = frames;
      currentFrame = 0;
      applyFrame(0);
    }catch(e){}
  }
  function saveCurrentPlayback(){
    if (!poses || poses.length === 0) return;
    if (poses[currentFrame]){
      poses[currentFrame] = { ...poses[currentFrame], data: buildPoseSnapshot() };
    }
    const name = (newPlaybackName||"").trim() || `Playback ${savedPlaybacks.length+1}`;
    const folder = folderKey(playbackFolderView);
    const frames = deepCopyFrames(poses);
    savedPlaybacks = [...savedPlaybacks, { name, frames, folder }];
    newPlaybackName = "";
    editingPlaybackIdx = -1; editingPlaybackName = "";
    persistSavedPlaybacks();
    if (folder && !playbackFolders.includes(folder)){
      playbackFolders = [...playbackFolders, folder];
      persistPlaybackFolders();
    }
    playbackGroups = groupPlaybacks(savedPlaybacks);
    playbackFolderView = folder || null;
    syncOpenPlaybackFolders();
  }
  function loadSavedPlayback(idx){
    const i = idx|0; if (i<0 || i>=savedPlaybacks.length) return;
    stopPlayback();
    const pb = savedPlaybacks[i];
    const frames = deepCopyFrames(pb.frames);
    poses = frames;
    currentFrame = 0;
    playbackFolderView = folderKey(pb.folder) || playbackFolderView;
    try{ applyFrame(0); }catch(e){}
  }
  function deleteSavedPlayback(idx){
    const i = idx|0; if (i<0 || i>=savedPlaybacks.length) return;
    savedPlaybacks = [...savedPlaybacks.slice(0,i), ...savedPlaybacks.slice(i+1)];
    persistSavedPlaybacks();
    playbackGroups = groupPlaybacks(savedPlaybacks);
    // refresh current view so the list updates immediately
    playbackGroups = [...playbackGroups];
    playbackFolderView = `${playbackFolderView}`;
    playbacksMenuVersion += 1;
  }

  function savePoseToFile(){
    const data = buildPoseSnapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pose-${startPosition}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function triggerLoadPose(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try{
          const data = JSON.parse(String(reader.result||'{}'));
          applyLoadedPose(data);
        } catch(e){ console.error('Invalid pose file', e); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function importPoseFor(poseKey){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try{
          const data = JSON.parse(String(reader.result||'{}'));
          importedPoses[poseKey] = data;
          if (startPosition === poseKey) applyImportedPose(poseKey);
        } catch(e){ console.error('Invalid pose file', e); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function applyImportedPose(poseKey){
    const data = importedPoses[poseKey];
    if (!data) return;
    const applyOne = (skel, part, which)=>{
      if (part?.joints){
        applyWorldPoseToSkeleton(skel, part.joints);
      }
      if (Array.isArray(part?.rootPos)){
        skel.rootPos.set(part.rootPos[0]||0, part.rootPos[1]||0, part.rootPos[2]||0);
      }
      if (!playbackApplying){ groundSkeleton(skel); }
      // Keep joints arrays in sync with snapshot; avoid solver drift when skipping grounding
      if (part?.joints){
        const cloned = cloneJoints(part.joints);
        if (which === 'A') jointsA = cloned; else jointsB = cloned;
      } else {
        const derived = jointsFromSkeleton(skel);
        if (which === 'A') jointsA = derived; else jointsB = derived;
      }
    };
    applyOne(skeletonA, data.A, 'A');
    applyOne(skeletonB, data.B, 'B');
    if (data.torsoExtras){
      if (data.torsoExtras.A) torsoGuiA = { ...torsoGuiA, ...data.torsoExtras.A };
      if (data.torsoExtras.B) torsoGuiB = { ...torsoGuiB, ...data.torsoExtras.B };
    }
    if (data.toeOffsets){
      const setToe = (store, src)=>{
        if (!src) return;
        if (Array.isArray(src.L) && src.L.length>=3) store.L.set(src.L[0], src.L[1], src.L[2]);
        if (Array.isArray(src.R) && src.R.length>=3) store.R.set(src.R[0], src.R[1], src.R[2]);
      };
      setToe(toeOffsets.A, data.toeOffsets.A);
      setToe(toeOffsets.B, data.toeOffsets.B);
    }
    updateMeshesFromJoints();
    refreshGuiFromSkeletons();
  }

  function applyLoadedPose(data){
    if (!data) return;
    const applyOne = (skel, part, which)=>{
      if (part?.joints){
        applyWorldPoseToSkeleton(skel, part.joints);
      }
      if (Array.isArray(part?.rootPos)){
        skel.rootPos.set(part.rootPos[0]||0, part.rootPos[1]||0, part.rootPos[2]||0);
      }
      if (!playbackApplying){ groundSkeleton(skel); }
      if (part?.joints){
        const cloned = cloneJoints(part.joints);
        if (which === 'A') jointsA = cloned; else jointsB = cloned;
      } else {
        const derived = jointsFromSkeleton(skel);
        if (which === 'A') jointsA = derived; else jointsB = derived;
      }
    };
    applyOne(skeletonA, data.A, 'A');
    applyOne(skeletonB, data.B, 'B');
    if (data.torsoExtras){
      if (data.torsoExtras.A) torsoGuiA = { ...torsoGuiA, ...data.torsoExtras.A };
      if (data.torsoExtras.B) torsoGuiB = { ...torsoGuiB, ...data.torsoExtras.B };
    }
    if (data.toeOffsets){
      const setToe = (store, src)=>{
        if (!src) return;
        if (Array.isArray(src.L) && src.L.length>=3) store.L.set(src.L[0], src.L[1], src.L[2]);
        if (Array.isArray(src.R) && src.R.length>=3) store.R.set(src.R[0], src.R[1], src.R[2]);
      };
      setToe(toeOffsets.A, data.toeOffsets.A);
      setToe(toeOffsets.B, data.toeOffsets.B);
    }
    updateMeshesFromJoints();
    refreshGuiFromSkeletons();
  }

  // ---------- Mirror Pose (YZ plane around each torso center) ----------
  function mirrorPoseYZPlane(){
    const mirrorOne = (skel)=>{
      computeFK(skel);
      const j = jointsFromSkeleton(skel);
      const hipCX = (j.hipL[0] + j.hipR[0]) / 2;
      const keys = [
        "head","neck",
        "shoulderL","shoulderR",
        "elbowL","elbowR",
        "handL","handR",
        "hipL","hipR",
        "kneeL","kneeR",
        "footL","footR"
      ];
      for (const k of keys){
        const p = j[k];
        j[k] = [ (2*hipCX - p[0]), p[1], p[2] ];
      }
      applyWorldPoseToSkeleton(skel, j);
      groundSkeleton(skel);
    };
    mirrorOne(skeletonA);
    mirrorOne(skeletonB);
    updateMeshesFromJoints();
    refreshGuiFromSkeletons();
  }

  // ---------- Pointer / Drag ----------

  function attachPointerEvents(){
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    // Capture pointerdown before OrbitControls so we can block camera motion on handle drags.
    el.addEventListener('pointerdown', pointerDownHandler, { capture: true });
    el.addEventListener('pointermove', pointerMoveHandler);
    el.addEventListener('pointerup', pointerUpHandler);
    el.addEventListener('pointercancel', pointerUpHandler);
    el.addEventListener('pointerleave', pointerUpHandler);
    el.addEventListener('contextmenu', (e)=> e.preventDefault());
  }

  function toggleSingleJointMode(){ singleJointMode = !singleJointMode; }

  function armRotateSyncOnCtrlTap(e){
    if (e?.repeat) return;
    const now = timeNowMs();
    if (now - lastCtrlTapMs <= CTRL_DOUBLE_TAP_MS){
      rotateSyncArmUntil = now + ROTATE_SYNC_ARM_MS;
    }
    lastCtrlTapMs = now;
  }

  function consumeRotateSyncArm(){
    const now = timeNowMs();
    const armed = rotateSyncArmUntil && rotateSyncArmUntil >= now;
    rotateSyncArmUntil = 0;
    return armed;
  }

  function pointerDownHandler(event){
    const el = renderer.domElement;
    const rect = el.getBoundingClientRect();
    const view = viewAtEvent(event);
    activePointerView = view;
    touchOrbitDrag.active = false;
    const cam = cameraForView(view) || camera;
    const isCtrlLike = !!(event.ctrlKey || event.metaKey);
    const ctrlShift = !!(event.shiftKey && isCtrlLike);
    const ctrlOnly = !!(!event.shiftKey && isCtrlLike);
    const isTouchOrbit = !!(((event.pointerType === 'touch' || event.pointerType === 'mouse' || !event.pointerType) && !isCtrlLike && !event.shiftKey && event.isPrimary !== false && (event.button === 0 || event.button == null)));
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    const nearEdge = nx < EDGE_THRESHOLD || nx > (1-EDGE_THRESHOLD) || ny < EDGE_THRESHOLD || ny > (1-EDGE_THRESHOLD);
    let edgeJointHit = null;
    let edgeHandlePerson = null;
    let edgeHipHit = null;
    if (nearEdge) {
      edgeJointHit = pickJoint(event, { allowFallback: false });
      if (!edgeJointHit) edgeHandlePerson = hoverUpperHandlePerson || pickUpperHandle(event);
      if (!edgeJointHit && !edgeHandlePerson) edgeHipHit = pickHipBody(event);
      if (!edgeJointHit && !edgeHandlePerson && !edgeHipHit) {
        orbitEnabled = true;
        controls.enabled = true;
        dragging = null;
        if (view === 'persp' && isTouchOrbit){
          touchOrbitDrag = { active: true, pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
          try{ touchOrbitRotateRestore = !!controls?.enableRotate; controls.enableRotate = true; }catch(e){}
          try{ event.preventDefault(); }catch(e){}
        } else {
          touchOrbitDrag.active = false;
        }
        return;
      }
    }
    if (isCtrlLike || event.shiftKey){
      try{
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }catch(e){}
    }
    ctrlDragging = isCtrlLike;
    shiftDragging = ctrlShift;
    // cache last mouse NDC so drag continues updating if camera moves (WASD)
    const ndc = ndcForEventInView(event, view);
    mouse.x = ndc.x; mouse.y = ndc.y;
    virtCursorX = event.clientX; virtCursorY = event.clientY;
    mouseLockedToJoint = false;
    // Prefer starting a handle drag before any other hit logic.
    if (!dragging){
      let preHandlePerson = hoverUpperHandlePerson || pickUpperHandle(event);
      if (!preHandlePerson && lastHandleHover.person){
        const now = timeNowMs();
        if ((now - lastHandleHover.time) <= 450){
          preHandlePerson = lastHandleHover.person;
        }
      }
      if (preHandlePerson && startUpperHandleDrag(event, preHandlePerson, view, cam, ctrlOnly, ctrlShift)) return;
    }
    // Prefer joint-dragging when Ctrl is held (move whole figure), but allow handle drags when the handle is hit
    let hit = edgeJointHit || pickJoint(event, { allowFallback: false });
    const hitBody = !hit ? (edgeHipHit || pickHipBody(event)) : null;
    if (!hit && !hitBody) {
      if (!isTouchOrbit || view !== 'persp') {
        hit = pickJoint(event, { allowFallback: true });
      }
    }
    // Block if already joint-dragging
    if (!dragging){
      let handlePerson = hoverUpperHandlePerson || ((edgeHandlePerson != null) ? edgeHandlePerson : pickUpperHandle(event));
      if (!handlePerson && lastHandleHover.person){
        const now = timeNowMs();
        if ((now - lastHandleHover.time) <= 450){
          handlePerson = lastHandleHover.person;
        }
      }
      // Start handle drag when the handle is hit, even if Ctrl is held
      if (handlePerson && startUpperHandleDrag(event, handlePerson, view, cam, ctrlOnly, ctrlShift)) return;
    }
    // Lock selection mode: clicking toggles lock state and exits without starting a drag
    if (lockState === 'select' && hit){ toggleLockForMesh(hit.object); return; }
    // Ortho pan start (right/middle button with no hit)
    if (!hit && fourViewMode && view !== 'persp' && (event.button === 1 || event.button === 2)){
      orthoPan.active = true; orthoPan.view = view; orthoPan.startX = event.clientX; orthoPan.startY = event.clientY;
      orthoPan.startCenter.copy(view==='front'? frontCenter : view==='side'? sideCenter : topCenter);
      controls.enabled = false; orbitEnabled = false;
      return;
    }
    if (hit){
      // Do not allow dragging locked joints
      const isA = jointMeshesA.includes(hit.object);
      const k = hit.object.userData.key;
      if ((isA && lockedA.has(k)) || (!isA && lockedB.has(k))) { return; }
      dragging = hit.object;
      activePerson = jointMeshesA.includes(dragging) ? 'A' : 'B';
      selectedPerson = activePerson;
      activeJointIdx = NAME_TO_IDX[dragging.userData.key] ?? null;
      // Track when user explicitly starts dragging the head/neck
      const isHeadOrNeck = (activeJointIdx === IDX.head || activeJointIdx === IDX.neck);
      headDragPerson = isHeadOrNeck ? activePerson : null;
      if (!ctrlDragging && !shiftDragging){
        if (activePerson === 'A'){
          try{ dragTorsoAnchorA = skeletonA?.rootPos?.clone() || null; }catch(e){ dragTorsoAnchorA = null; }
          try{
            const joints = jointsA;
            if (joints?.hipL && joints?.hipR && joints?.shoulderL && joints?.shoulderR){
              const hipC = new THREE.Vector3(...joints.hipL).add(new THREE.Vector3(...joints.hipR)).multiplyScalar(0.5);
              const shC = new THREE.Vector3(...joints.shoulderL).add(new THREE.Vector3(...joints.shoulderR)).multiplyScalar(0.5);
              const dir = shC.sub(hipC); dir.y = 0;
              if (dir.lengthSq() < 1e-8) dir.set(0,0,1);
              dragTorsoForwardA = dir.normalize();
            } else {
              dragTorsoForwardA = new THREE.Vector3(0,0,1);
            }
          }catch(e){ dragTorsoForwardA = new THREE.Vector3(0,0,1); }
        } else {
          try{ dragTorsoAnchorB = skeletonB?.rootPos?.clone() || null; }catch(e){ dragTorsoAnchorB = null; }
          try{
            const joints = jointsB;
            if (joints?.hipL && joints?.hipR && joints?.shoulderL && joints?.shoulderR){
              const hipC = new THREE.Vector3(...joints.hipL).add(new THREE.Vector3(...joints.hipR)).multiplyScalar(0.5);
              const shC = new THREE.Vector3(...joints.shoulderL).add(new THREE.Vector3(...joints.shoulderR)).multiplyScalar(0.5);
              const dir = shC.sub(hipC); dir.y = 0;
              if (dir.lengthSq() < 1e-8) dir.set(0,0,1);
              dragTorsoForwardB = dir.normalize();
            } else {
              dragTorsoForwardB = new THREE.Vector3(0,0,1);
            }
          }catch(e){ dragTorsoForwardB = new THREE.Vector3(0,0,1); }
        }
      }
      if (!ctrlDragging && !shiftDragging && activeJointIdx != null){
        const lockRoot = shouldRootStayFixedForJoint(activeJointIdx);
        if (activePerson === 'A'){
          dragRootAnchorA = lockRoot ? skeletonA?.rootPos?.clone() || null : null;
          dragSpineAnchorA = lockRoot ? skeletonA?.angleRot?.[IDX.spine]?.clone() || null : null;
        } else {
          dragRootAnchorB = lockRoot ? skeletonB?.rootPos?.clone() || null : null;
          dragSpineAnchorB = lockRoot ? skeletonB?.angleRot?.[IDX.spine]?.clone() || null : null;
        }
      } else {
        if (activePerson === 'A'){ dragRootAnchorA = null; dragSpineAnchorA = null; }
        else { dragRootAnchorB = null; dragSpineAnchorB = null; }
      }
      if (!ctrlDragging && !shiftDragging && activeJointIdx != null && activeJointIdx !== IDX.head && activeJointIdx !== IDX.neck){
        const useRelativeHead = !singleJointMode && (activeJointIdx === IDX.handL || activeJointIdx === IDX.handR);
        if (useRelativeHead){
          const skel = activePerson === 'A' ? skeletonA : skeletonB;
          const offset = headOffsetFromTorsoFrame(skel);
          if (activePerson === 'A') { dragHeadOffsetA = offset; dragHeadAnchorA = null; }
          else { dragHeadOffsetB = offset; dragHeadAnchorB = null; }
          if (!offset){
            const joints = activePerson === 'A' ? jointsA : jointsB;
            const headArr = joints?.head;
            if (headArr){
              const v = new THREE.Vector3(...headArr);
              if (activePerson === 'A') dragHeadAnchorA = v; else dragHeadAnchorB = v;
            }
          }
        } else {
          const joints = activePerson === 'A' ? jointsA : jointsB;
          const headArr = joints?.head;
          if (headArr){
            const v = new THREE.Vector3(...headArr);
            if (activePerson === 'A') dragHeadAnchorA = v; else dragHeadAnchorB = v;
          }
          if (activePerson === 'A') dragHeadOffsetA = null; else dragHeadOffsetB = null;
        }
      } else {
        if (activePerson === 'A') { dragHeadAnchorA = null; dragHeadOffsetA = null; }
        else { dragHeadAnchorB = null; dragHeadOffsetB = null; }
      }
      if (!singleJointMode && !ctrlDragging && !shiftDragging && (k === 'handL' || k === 'handR')){
        const side = k.endsWith('L') ? 'L' : 'R';
        const joints = activePerson === 'A' ? jointsA : jointsB;
        const shoulderKey = side === 'L' ? 'shoulderL' : 'shoulderR';
        const pos = joints?.[shoulderKey];
        if (pos){
          const store = activePerson === 'A' ? shoulderAnchors.A : shoulderAnchors.B;
          store[side] = new THREE.Vector3(...pos);
        }
      } else {
        const store = activePerson === 'A' ? shoulderAnchors.A : shoulderAnchors.B;
        store.L = null; store.R = null;
      }
      // Natural-mode torso/head preservation baseline
      try{
        if (!singleJointMode && activeJointIdx != null){
          natLock.active = true; natLock.person = activePerson; natLock.headDrag = (activeJointIdx===IDX.head || activeJointIdx===IDX.neck);
          const skelNL = activePerson==='A' ? skeletonA : skeletonB;
          natLock.spineBefore = skelNL?.angleRot?.[IDX.spine]?.clone() || null;
          natLock.headBefore  = skelNL?.angleRot?.[IDX.head]?.clone() || null;
        }
      }catch(e){}
      // While joint-dragging (not ctrl/shift), freeze the OTHER figure's root + spine to avoid unintended spin
      dragRootFreezeActive = !(ctrlDragging || shiftDragging);
      if (dragRootFreezeActive){
        if (activePerson==='A'){
          dragFreezeWhich = 'B';
          try{ dragRootB = skeletonB?.rootPos?.clone() || null; dragSpineRefB = skeletonB?.angleRot?.[IDX.spine]?.clone() || null; }catch(e){}
        } else {
          dragFreezeWhich = 'A';
          try{ dragRootA = skeletonA?.rootPos?.clone() || null; dragSpineRefA = skeletonA?.angleRot?.[IDX.spine]?.clone() || null; }catch(e){}
        }
      } else {
        dragFreezeWhich = 'none';
      }
      // Snapshot state once at drag start (for any drag type)
      if (!dragSnapshotTaken) { pushUndoSnapshot(); dragSnapshotTaken = true; }

      // In Natural mode, dragging a shoulder should move the entire arm rigidly (no IK)
      if (!singleJointMode && !shiftDragging && !ctrlDragging && (k === 'shoulderL' || k === 'shoulderR')) {
        armTranslateDrag.active = true;
        armTranslateDrag.person = activePerson;
        armTranslateDrag.side = k.endsWith('L') ? 'L' : 'R';
      } else {
        armTranslateDrag.active = false;
        armTranslateDrag.person = null;
        armTranslateDrag.side = null;
      }
      // In Natural mode, dragging an elbow should move only elbow+hand rigidly
      if (!singleJointMode && !shiftDragging && !ctrlDragging && (k === 'elbowL' || k === 'elbowR')) {
        elbowTranslateDrag.active = true;
        elbowTranslateDrag.person = activePerson;
        elbowTranslateDrag.side = k.endsWith('L') ? 'L' : 'R';
      } else {
        elbowTranslateDrag.active = false;
        elbowTranslateDrag.person = null;
        elbowTranslateDrag.side = null;
      }
      // In Natural mode, dragging a hand should move hand+elbow rigidly
      if (!singleJointMode && !shiftDragging && !ctrlDragging && (k === 'handL' || k === 'handR')) {
        handTranslateDrag.active = true;
        handTranslateDrag.person = activePerson;
        handTranslateDrag.side = k.endsWith('L') ? 'L' : 'R';
      } else {
        handTranslateDrag.active = false;
        handTranslateDrag.person = null;
        handTranslateDrag.side = null;
      }

      // Snapshot heel/toe relationship when dragging a foot, knee, or hip joint so toes can follow lower-leg rotation
      if (!shiftDragging && !ctrlDragging && (k === 'footL' || k === 'footR' || k === 'kneeL' || k === 'kneeR' || k === 'hipL' || k === 'hipR')) {
        try {
          const person = activePerson;
          const side = k.endsWith('L') ? 'L' : 'R';
          const joints = person === 'A' ? jointsA : jointsB;
          const kneeKey = side === 'L' ? 'kneeL' : 'kneeR';
          const footKey = side === 'L' ? 'footL' : 'footR';
          const heel = joints[footKey] ? new THREE.Vector3(...joints[footKey]) : null;
          const knee = joints[kneeKey] ? new THREE.Vector3(...joints[kneeKey]) : null;
          const store = person === 'B' ? toeOffsets.B : toeOffsets.A;
          const toeOff = store && store[side] ? store[side].clone() : new THREE.Vector3();
          if (heel && knee) {
            footDrag.active = true;
            footDrag.person = person;
            footDrag.side = side;
            footDrag.heelStart.copy(heel);
            footDrag.kneeStart.copy(knee);
            footDrag.toeOffsetStart.copy(toeOff);
          } else {
            footDrag.active = false;
          }
        } catch(e) {
          footDrag.active = false;
        }
      } else {
        footDrag.active = false;
      }

      // Toe rotation: hold Tab while clicking a toe joint to rotate instead of translate
      toeRotateDrag.active = false; toeRotateDrag.person = null; toeRotateDrag.side = null;
      toeRotateDrag.startOffset.set(0,0,0); toeRotateDrag.startToeWorld.set(0,0,0); toeRotateDrag.startX = 0; toeRotateDrag.startY = 0; toeRotateDrag.camera = null;
      if (tabToeRotate && dragging?.userData?.isToeJoint){
        const side = dragging.userData.side === 'L' ? 'L' : 'R';
        const store = activePerson === 'B' ? toeOffsets.B : toeOffsets.A;
        const joints = activePerson === 'A' ? jointsA : jointsB;
        const heelKey = side === 'L' ? 'footL' : 'footR';
        const heelArr = joints?.[heelKey];
        const heel = heelArr ? new THREE.Vector3(...heelArr) : null;
        const toeWorld = dragging.getWorldPosition(new THREE.Vector3());
        let base = store?.[side]?.clone();
        if ((!base || base.lengthSq() < 1e-8) && heel){
          const toePos = dragging.getWorldPosition(new THREE.Vector3());
          base = toePos.clone().sub(heel);
        }
        if (!base) base = new THREE.Vector3(TOE_EXTEND, 0, 0);
        if (!store[side]) store[side] = base.clone(); else store[side].copy(base);
        toeRotateDrag.active = true;
        toeRotateDrag.person = activePerson;
        toeRotateDrag.side = side;
        toeRotateDrag.startOffset.copy(base);
        toeRotateDrag.startX = event.clientX; toeRotateDrag.startY = event.clientY;
        toeRotateDrag.camera = cam;
        toeRotateDrag.startToeWorld.copy(toeWorld);
      }

      dragCamera = cam; dragView = view;
      const ds = activePerson==='A' ? dragState.A : dragState.B;
      ds.plane = new THREE.Plane();
      const worldPoint = dragging.getWorldPosition(new THREE.Vector3());
      const vDir = cam.getWorldDirection(new THREE.Vector3()).negate();
      ds.plane.setFromNormalAndCoplanarPoint(vDir, worldPoint);
      const intersectPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(ds.plane, intersectPoint);
      ds.offset = new THREE.Vector3().subVectors(worldPoint, intersectPoint);
      ds.camera = cam; ds.view = view;
      ds.lastTarget = null; ds.atLimit = false; ds.justScrolled = false;
      controls.enabled = false; orbitEnabled = false;

      // Snapshot length constraints for this joint
      try{
        const jKey = dragging.userData.key;
        const person = activePerson;
        const idx = activeJointIdx;
        const pIdx = PARENT[idx];
        const parentKey = pIdx>=0 ? Object.keys(NAME_TO_IDX).find(k=> NAME_TO_IDX[k]===pIdx) : null;
        const childKey = childKeyForJoint(idx);
        const vParent = parentKey ? jointVec(person, parentKey) : null;
        const vJoint  = jointVec(person, jKey);
        const vChild  = childKey ? jointVec(person, childKey) : null;
        dragLengthConstraint = {
          active: true,
          person,
          jointKey: jKey,
          parentKey,
          childKey,
          lParent: (vParent? vParent.distanceTo(vJoint) : 0),
          lChild: (vChild? vChild.distanceTo(vJoint) : 0)
        };
      } catch(e) { dragLengthConstraint = {active:false, person:null, jointKey:null, parentKey:null, childKey:null, lParent:0, lChild:0}; }
    } else {
      // If user clicks the pelvis/torso structure (not a joint)
      if (event.button === 0 && !shiftDragging && !ctrlDragging){
        const hitBody2 = hitBody || edgeHipHit || pickHipBody(event);
          if (hitBody2){
          const person = hitBody2.person;
          const joints = person === 'A' ? jointsA : jointsB;
          const hipL = new THREE.Vector3(...joints.hipL);
          const hipR = new THREE.Vector3(...joints.hipR);
          const hipCenter = hipL.clone().add(hipR).multiplyScalar(0.5);

          if (hitBody2.part === 'pelvis') {
            // Bridge-style hip drag (existing behavior)
            bridgeDrag.active = true;
            bridgeDrag.person = person;
            bridgeDrag.hipLStart.copy(hipL);
            bridgeDrag.hipRStart.copy(hipR);
            bridgeDrag.hipCenterStart.copy(hipCenter);
          } else {
            // Torso click: hinge upper body like a pendulum around fixed hips
            if (!dragSnapshotTaken) { pushUndoSnapshot(); dragSnapshotTaken = true; }
            upperDrag.active = true;
            upperDrag.person = person;
            upperDrag.startX = event.clientX;
            upperDrag.startY = event.clientY;
            upperDrag.lastX = event.clientX;
            upperDrag.lastY = event.clientY;
            upperDrag.view = view;
            upperDrag.camera = cam;
            upperDrag.accumQ.identity();
            upperDrag.baseRelOther.clear(); upperDrag.syncBoth = false; upperDrag.otherPerson = null; upperDrag.pivotOther.set(0,0,0);
            upperDrag.wholeBody = false; // only upper-body keys
            upperDrag.mode = 'pendulum';
            upperDrag.pivot = hipCenter.clone();
            upperDrag.baseRel.clear();
            const keys = upperBodyKeys();
            for (const k of keys){
              const p = joints[k]; if (!p) continue;
              upperDrag.baseRel.set(k, new THREE.Vector3(p[0]-upperDrag.pivot.x, p[1]-upperDrag.pivot.y, p[2]-upperDrag.pivot.z));
            }
            // Baseline torso direction from hips to shoulders at drag start
            try{
              const sL = joints.shoulderL ? new THREE.Vector3(...joints.shoulderL) : null;
              const sR = joints.shoulderR ? new THREE.Vector3(...joints.shoulderR) : null;
              if (sL && sR){
                const shoulderCenter = sL.clone().add(sR).multiplyScalar(0.5);
                upperDrag.baseDir.copy(shoulderCenter.clone().sub(upperDrag.pivot).normalize());
              } else {
                upperDrag.baseDir.set(0,1,0);
              }
            }catch(e){ upperDrag.baseDir.set(0,1,0); }
          }

          dragging = hitBody.mesh;
          activePerson = person;
          selectedPerson = person;
          activeJointIdx = null;
          // While hip/torso dragging, freeze the other figure's root + spine to avoid unintended spin
          dragRootFreezeActive = true;
          if (activePerson === 'A'){
            dragFreezeWhich = 'B';
            try{ dragRootB = skeletonB?.rootPos?.clone() || null; dragSpineRefB = skeletonB?.angleRot?.[IDX.spine]?.clone() || null; }catch(e){}
          } else {
            dragFreezeWhich = 'A';
            try{ dragRootA = skeletonA?.rootPos?.clone() || null; dragSpineRefA = skeletonA?.angleRot?.[IDX.spine]?.clone() || null; }catch(e){}
          }
          if (!dragSnapshotTaken) { pushUndoSnapshot(); dragSnapshotTaken = true; }

          dragCamera = cam; dragView = view;
          const ds = activePerson==='A' ? dragState.A : dragState.B;
          ds.plane = new THREE.Plane();
          const worldPoint = dragging.getWorldPosition(new THREE.Vector3());
          const vDir = cam.getWorldDirection(new THREE.Vector3()).negate();
          ds.plane.setFromNormalAndCoplanarPoint(vDir, worldPoint);
          const intersectPoint = new THREE.Vector3();
          raycaster.ray.intersectPlane(ds.plane, intersectPoint);
          ds.offset = new THREE.Vector3().subVectors(worldPoint, intersectPoint);
          ds.camera = cam; ds.view = view;
          ds.lastTarget = null; ds.atLimit = false; ds.justScrolled = false;
          controls.enabled = false; orbitEnabled = false;
          try{ const el2 = renderer?.domElement; if (el2) el2.style.cursor = 'grabbing'; }catch(e){}
          return;
        }
      }
      // In perspective view allow OrbitControls, otherwise disable
      controls.enabled = (view === 'persp');
      orbitEnabled = (view === 'persp');
      if (view === 'persp' && !dragging && isTouchOrbit){
        touchOrbitDrag = { active: true, pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
        try{ touchOrbitRotateRestore = !!controls?.enableRotate; controls.enableRotate = true; }catch(e){}
        try{ event.preventDefault(); }catch(e){}
      }
    }
  }

  function applyJointDragTarget(target, ds){
    if (activeJointIdx == null) return;
    // Prevent moving head/neck/shoulders when torso lock is active
    if (torsoFreeze) {
      const blocked = new Set([IDX.head, IDX.neck, IDX.shoulderL, IDX.shoulderR]);
      if (blocked.has(activeJointIdx)) return;
    }
    // Skip if target joint is locked
    const jointKey = Object.keys(NAME_TO_IDX).find(k => NAME_TO_IDX[k]===activeJointIdx);
    if (jointKey && isLocked(activePerson, jointKey)) return;
    const isHeadDrag = (activeJointIdx === IDX.head || activeJointIdx === IDX.neck);
    const isHipDrag = (activeJointIdx === IDX.hipL || activeJointIdx === IDX.hipR);
    const translateUpperBody = (person, delta)=>{
      if (!delta || delta.lengthSq() < 1e-12) return;
      const joints = person === 'A' ? jointsA : jointsB;
      if (!joints) return;
      const keys = ['shoulderL','shoulderR','elbowL','elbowR','handL','handR','neck','head'];
      for (const key of keys){
        if (isLocked && isLocked(person, key)) continue;
        const arr = joints[key];
        if (!arr) continue;
        const v = new THREE.Vector3(...arr).add(delta);
        joints[key] = [v.x, v.y, v.z];
      }
      if (person === 'A') jointsA = joints; else jointsB = joints;
    };
    const directMode = singleJointMode || isHeadDrag || isHipDrag;
    if (directMode){
      // Single-Joint (or explicit head/neck/hip drag): move only the selected joint
      const joints = activePerson === 'A' ? jointsA : jointsB;
      const prevHipL = (isHipDrag && joints?.hipL) ? new THREE.Vector3(...joints.hipL) : null;
      const prevHipR = (isHipDrag && joints?.hipR) ? new THREE.Vector3(...joints.hipR) : null;
      const prevHipC = (prevHipL && prevHipR) ? prevHipL.clone().add(prevHipR).multiplyScalar(0.5) : null;
      let tgt = clampToDragLengthsStrict(activePerson, jointKey, target.clone());
      tgt = applyJointConstraints(activePerson, jointKey, tgt);
      tgt = clampToDragLengthsStrict(activePerson, jointKey, tgt);
      // For head/neck drags, apply torso constraints last so the head
      // cannot end up inside the torso after length clamping.
      if (isHeadDrag){
        tgt = applyJointConstraints(activePerson, jointKey, tgt);
      }
      if (activePerson === 'A') { jointsA[jointKey] = [tgt.x, tgt.y, tgt.z]; }
      else { jointsB[jointKey] = [tgt.x, tgt.y, tgt.z]; }
      if (isHipDrag && !singleJointMode && prevHipC && prevHipL && prevHipR){
        const newHipL = (activeJointIdx === IDX.hipL) ? tgt : prevHipL;
        const newHipR = (activeJointIdx === IDX.hipR) ? tgt : prevHipR;
        const newHipC = newHipL.clone().add(newHipR).multiplyScalar(0.5);
        const delta = newHipC.sub(prevHipC);
        translateUpperBody(activePerson, delta);
      }
      if (isHeadDrag){
        clampHeadLength(activePerson);
      }
      if (ds){
        ds.lastTarget = tgt.clone();
        ds.justScrolled = false;
      }
      const clamped = clampExtremeStretchIfNeeded(activePerson);
      if (clamped) updateMeshesFromJoints();
      else syncMeshesNoSolve();
    } else {
      // Natural mode: prevent torso (spine) and head rotation via temporary locks inside IK and solvers
      const skel = activePerson === 'A' ? skeletonA : skeletonB;
      const tset = (activePerson==='A') ? tempLockedA : tempLockedB;
      tset.add('spine'); tset.add('neck'); tset.add('head');
      try {
        // Special case: Natural-mode hand/elbow/shoulder drags with fixed segment lengths
        if (!singleJointMode && !shiftDragging && !ctrlDragging && (activeJointIdx === IDX.handL || activeJointIdx === IDX.handR)) {
          const joints = activePerson === 'A' ? jointsA : jointsB;
          const handKey = (activeJointIdx === IDX.handL) ? 'handL' : 'handR';
          const elbowKey = (handKey === 'handL') ? 'elbowL' : 'elbowR';
          const shoulderKey = (handKey === 'handL') ? 'shoulderL' : 'shoulderR';
          const store = activePerson === 'A' ? shoulderAnchors.A : shoulderAnchors.B;
          const shoulderAnchor = store?.[handKey.endsWith('L') ? 'L' : 'R'] || (joints[shoulderKey] ? new THREE.Vector3(...joints[shoulderKey]) : null);
          const s = shoulderAnchor ? shoulderAnchor.clone() : null;
          if (s){
            joints[shoulderKey] = [s.x, s.y, s.z];
          }
          const h = new THREE.Vector3(...(joints[handKey] || [0,0,0]));
          const e = new THREE.Vector3(...(joints[elbowKey] || [0,0,0]));
          if (s) {
            const upperLen = e.distanceTo(s);
            const lowerLen = h.distanceTo(e);
            const totalLen = upperLen + lowerLen;
            if (upperLen > 1e-6 && lowerLen > 1e-6 && totalLen > 1e-6) {
              let tgt = target.clone();
              let dir = tgt.clone().sub(s);
              let dist = dir.length();
              if (dist < 1e-6) { dist = 1e-6; dir.set(0, 1, 0); }
              const maxReach = totalLen;
              const minReach = Math.max(0.001, Math.abs(upperLen - lowerLen));
              if (dist > maxReach) { dir.normalize(); tgt = s.clone().addScaledVector(dir, maxReach); dist = maxReach; }
              if (dist < minReach) { dir.normalize(); tgt = s.clone().addScaledVector(dir, minReach); dist = minReach; }
              dir.normalize();
              let planeNormal = new THREE.Vector3().crossVectors(dir, e.clone().sub(s));
              if (planeNormal.lengthSq() < 1e-8) planeNormal = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
              if (planeNormal.lengthSq() < 1e-8) planeNormal = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0));
              planeNormal.normalize();
              const perp = new THREE.Vector3().crossVectors(planeNormal, dir).normalize();
              const x = (upperLen*upperLen - lowerLen*lowerLen + dist*dist) / (2 * dist);
              const hLen = Math.sqrt(Math.max(0, upperLen*upperLen - x*x));
              const newE = s.clone().addScaledVector(dir, x).addScaledVector(perp, hLen);
              const newH = tgt;
              joints[elbowKey] = [newE.x, newE.y, newE.z];
              joints[handKey] = [newH.x, newH.y, newH.z];
              if (activePerson === 'A') { jointsA = joints; } else { jointsB = joints; }
              syncMeshesNoSolve();
              const side = handKey.endsWith('L') ? 'L' : 'R';
              reanchorShoulder(activePerson, side);
            }
          }
        } else if (elbowTranslateDrag.active && (activeJointIdx === IDX.elbowL || activeJointIdx === IDX.elbowR)) {
          const joints = activePerson === 'A' ? jointsA : jointsB;
          const elbowKey = (activeJointIdx === IDX.elbowL) ? 'elbowL' : 'elbowR';
          const handKey = (elbowKey === 'elbowL') ? 'handL' : 'handR';
          const e = new THREE.Vector3(...(joints[elbowKey] || [0,0,0]));
          const h = new THREE.Vector3(...(joints[handKey] || [0,0,0]));
          let tgt = clampToDragLengthsStrict(activePerson, elbowKey, target.clone());
          tgt = applyJointConstraints(activePerson, elbowKey, tgt);
          tgt = clampToDragLengthsStrict(activePerson, elbowKey, tgt);
          const delta = tgt.clone().sub(e);
          const newE = e.clone().add(delta);
          const newH = h.clone().add(delta);
          joints[elbowKey] = [newE.x, newE.y, newE.z];
          joints[handKey] = [newH.x, newH.y, newH.z];
          if (activePerson === 'A') { jointsA = joints; } else { jointsB = joints; }
          // Update meshes immediately; solvers are bypassed via elbowTranslateDrag flag
          syncMeshesNoSolve();
        } else if (armTranslateDrag.active && (activeJointIdx === IDX.shoulderL || activeJointIdx === IDX.shoulderR)) {
          const joints = activePerson === 'A' ? jointsA : jointsB;
          const shoulderKey = (activeJointIdx === IDX.shoulderL) ? 'shoulderL' : 'shoulderR';
          const elbowKey = (shoulderKey === 'shoulderL') ? 'elbowL' : 'elbowR';
          const handKey = (shoulderKey === 'shoulderL') ? 'handL' : 'handR';
          const s = new THREE.Vector3(...(joints[shoulderKey] || [0,0,0]));
          const e = new THREE.Vector3(...(joints[elbowKey] || [0,0,0]));
          const h = new THREE.Vector3(...(joints[handKey] || [0,0,0]));
          const delta = target.clone().sub(s);
          const newS = s.clone().add(delta);
          const newE = e.clone().add(delta);
          const newH = h.clone().add(delta);
          joints[shoulderKey] = [newS.x, newS.y, newS.z];
          joints[elbowKey] = [newE.x, newE.y, newE.z];
          joints[handKey] = [newH.x, newH.y, newH.z];
          if (activePerson === 'A') { jointsA = joints; } else { jointsB = joints; }
          // Update meshes immediately; solvers are bypassed via armTranslateDrag flag
          syncMeshesNoSolve();
        } else {
          const limitedChildren = (!singleJointMode && !shiftDragging && !ctrlDragging)
            ? limitedChildrenForDrag(activeJointIdx)
            : null;
          if (limitedChildren){
            ccdIKLimited(skel, activeJointIdx, target.clone(), limitedChildren, 4);
            if (activePerson === 'A') jointsA = jointsFromSkeleton(skel); else jointsB = jointsFromSkeleton(skel);
            if (activeJointIdx === IDX.handL || activeJointIdx === IDX.handR){
              const side = activeJointIdx === IDX.handL ? 'L' : 'R';
              reanchorShoulder(activePerson, side);
            }
          } else {
            ccdIKToTarget(skel, activeJointIdx, target.clone());
            if (activePerson === 'A') jointsA = jointsFromSkeleton(skel); else jointsB = jointsFromSkeleton(skel);
          }
        }

        // While dragging a foot, knee, or hip joint, rotate the toe offset so the toe keeps
        // the same angle relative to the lower leg as at drag start.
        try {
          if (footDrag.active && footDrag.person === activePerson &&
              (activeJointIdx === IDX.footL || activeJointIdx === IDX.footR ||
               activeJointIdx === IDX.kneeL || activeJointIdx === IDX.kneeR ||
               activeJointIdx === IDX.hipL  || activeJointIdx === IDX.hipR)) {
            const person = activePerson;
            const side = footDrag.side;
            const joints = person === 'A' ? jointsA : jointsB;
            const kneeKey = side === 'L' ? 'kneeL' : 'kneeR';
            const footKey = side === 'L' ? 'footL' : 'footR';
            const kneeArr = joints[kneeKey];
            const footArr = joints[footKey];
            if (kneeArr && footArr) {
              const knee = new THREE.Vector3(...kneeArr);
              const heel = new THREE.Vector3(...footArr);
              const vStart = footDrag.heelStart.clone().sub(footDrag.kneeStart);
              const vCur = heel.clone().sub(knee);
              if (vStart.lengthSq() > 1e-6 && vCur.lengthSq() > 1e-6) {
                vStart.normalize();
                vCur.normalize();
                const q = new THREE.Quaternion().setFromUnitVectors(vStart, vCur);
                const toe0 = footDrag.toeOffsetStart.clone();
                if (toe0.lengthSq() > 1e-6) {
                  const toeRot = toe0.applyQuaternion(q);
                  const store = person === 'B' ? toeOffsets.B : toeOffsets.A;
                  if (!store[side]) store[side] = new THREE.Vector3();
                  store[side].copy(toeRot);
                }
              }
            }
          }
        } catch(e) {}

        clampExtremeStretchIfNeeded(activePerson);
        updateMeshesFromJoints();
      } finally {
        tset.delete('spine'); tset.delete('neck'); tset.delete('head');
      }
    }
  }

  function pointerMoveHandler(event){
    const el = renderer.domElement;
    const rect = el.getBoundingClientRect();
    const view = viewAtEvent(event);
    ctrlDragging = !!(event.ctrlKey || event.metaKey);
    activePointerView = view;
    const ndc = ndcForEventInView(event, dragging ? dragView : view);
    mouse.x = ndc.x; mouse.y = ndc.y;
    // While in lock selection mode, show preview highlight and do not process drag
    if (lockState === 'select'){
      const hit = pickJoint(event, { allowFallback: false });
      setLockPreview(hit?.object || null);
      return;
    }
    if (orthoPan.active){
      if (!fourViewMode || (orthoPan.view === 'persp')) { orthoPan.active = false; return; }
      const dx = event.clientX - orthoPan.startX;
      const dy = event.clientY - orthoPan.startY;
      const vps = getViewports(); const r = vps[orthoPan.view].dom;
      const vw = Math.max(1, r.w), vh = Math.max(1, r.h);
      const scaleY = (ORTHO_BASE_SIZE*2) / vh; // world units per pixel at zoom=1
      const scaleX = scaleY * (vw / vh);
      const sx = dx * scaleX; const sy = dy * scaleY;
      const c = new THREE.Vector3();
      if (orthoPan.view === 'front') { c.set(orthoPan.startCenter.x - sx/frontZoom, orthoPan.startCenter.y + sy/frontZoom, orthoPan.startCenter.z); frontCenter.copy(c); }
      else if (orthoPan.view === 'side') { c.set(orthoPan.startCenter.x, orthoPan.startCenter.y + sy/sideZoom, orthoPan.startCenter.z + sx/sideZoom); sideCenter.copy(c); }
      else { c.set(orthoPan.startCenter.x + sx/topZoom, orthoPan.startCenter.y, orthoPan.startCenter.z - sy/topZoom); topCenter.copy(c); }
      return;
    }

    const isTouchOrbit = touchOrbitDrag.active && (event.pointerType === 'touch' || event.pointerType === 'mouse' || !event.pointerType) && event.pointerId === touchOrbitDrag.pointerId && !dragging && !upperDrag.active && !lowerHandleDrag.active && !ctrlDragging && !shiftDragging;
    if (isTouchOrbit){
      try{
        const dx = event.clientX - touchOrbitDrag.lastX;
        const dy = event.clientY - touchOrbitDrag.lastY;
        touchOrbitDrag.lastX = event.clientX;
        touchOrbitDrag.lastY = event.clientY;
        if (dx !== 0 || dy !== 0){
          event.preventDefault();
          if (controls){
            controls.enableRotate = true;
            controls.rotateLeft(-dx * 0.004);
            controls.rotateUp(-dy * 0.004);
            if (controls.update) controls.update();
          }
        }
      }catch(e){}
      return;
    }

    // Handle hover highlight for upper handles when not dragging
    if (!dragging && !upperDrag.active && !lowerHandleDrag.active){
      try{
        const viewH = viewAtEvent(event);
        const camH = cameraForView(viewH) || camera;
        const ndcH = ndcForEventInView(event, viewH);
        raycaster.setFromCamera(ndcH, camH);
        const objs = [upperHandleA, upperHandleB].filter(Boolean);
        const hits = raycaster.intersectObjects(objs, true);
        let hoverA = false, hoverB = false;
        if (hits && hits.length){
          let o = hits[0].object;
          while (o && !o.userData?.isUpperHandle) o = o.parent;
          if (o){ if (o===upperHandleA) hoverA=true; if (o===upperHandleB) hoverB=true; }
        }
        hoverUpperHandlePerson = hoverA ? 'A' : (hoverB ? 'B' : null);
        if (hoverUpperHandlePerson){
          lastHandleHover.person = hoverUpperHandlePerson;
          lastHandleHover.time = timeNowMs();
        }
        const setColor = (h, col)=>{ if (!h) return; h.traverse(m=>{ if (m.isMesh && m.material?.color) m.material.color.setHex(col); }); };
        setColor(upperHandleA, hoverA ? HANDLE_COLOR_HOVER : (upperHandleA?.userData?.defaultColor||HANDLE_COLOR_A));
        setColor(upperHandleB, hoverB ? HANDLE_COLOR_HOVER : (upperHandleB?.userData?.defaultColor||HANDLE_COLOR_B));
        // Cursor feedback
        try{ const el = renderer?.domElement; if (el) el.style.cursor = (hoverA || hoverB) ? 'move' : (lockState==='select' ? 'crosshair' : 'default'); }catch(e){}
      }catch(e){}
      return;
    }
    // Lower-body rotation drag (Ctrl + hip)
    if (lowerHandleDrag.active){
      try{
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }catch(e){}
      const person = lowerHandleDrag.person;
      const skel = (person==='A') ? skeletonA : skeletonB;
      const tf = torsoFrameFromSkel(skel);
      const dx = (event.clientX - lowerHandleDrag.lastX);
      lowerHandleDrag.lastX = event.clientX; lowerHandleDrag.lastY = event.clientY;
      // Yaw only: rotate lower body side-to-side around hip center
      const yaw = -dx * UPPER_HANDLE_ROT_SENS_YAW;
      const qYaw = new THREE.Quaternion().setFromAxisAngle(tf.yUp, yaw);
      lowerHandleDrag.accumQ.premultiply(qYaw);
      const joints = (person==='A') ? jointsA : jointsB;
      // Preserve upper-body joint positions so torso stays put while lower rotates
      const upperKeep = {};
      for (const key of upperBodyKeys()){
        const p = joints[key]; if (p) upperKeep[key] = [...p];
      }
      const keys = lowerBodyKeys();
      for (const k of keys){
        if (isLocked && isLocked(person, k)) continue;
        const rel0 = lowerHandleDrag.baseRel.get(k); if (!rel0) continue;
        const p = rel0.clone().applyQuaternion(lowerHandleDrag.accumQ).add(lowerHandleDrag.pivot);
        joints[k] = [p.x, p.y, p.z];
      }
      // Restore upper joints
      for (const [k,v] of Object.entries(upperKeep)){
        joints[k] = v;
      }
      // Rotate toe offsets with the feet so toe joints follow foot orientation
      try{
        const store = person === 'B' ? toeOffsets.B : toeOffsets.A;
        for (const side of ['L','R']){
          if (!store[side]) store[side] = new THREE.Vector3();
          store[side].applyQuaternion(qYaw);
        }
      }catch(e){}
      updateMeshesFromJoints();
      return;
    }
    // Upper-body or whole-body rotation drag (via upper handle or torso click)
    if (upperDrag.active){
      try{
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }catch(e){}
      const person = upperDrag.person || activePerson || selectedPerson;
      if (!person) return;
      const skel = (person==='A') ? skeletonA : skeletonB;
      const joints = (person==='A') ? jointsA : jointsB;
      let tf = null;
      try{ tf = torsoFrameFromSkel(skel); }catch(e){ tf = null; }
      if (!tf) tf = torsoFrameFromJoints(joints);
      if (!tf) return;
      let qDelta = null;

      if (upperDrag.mode === 'pendulum'){
        // Torso-click mode: move torso like a pendulum so hip center stays fixed
        const ds = person==='A' ? dragState.A : dragState.B;
        const camUse = ds?.camera || dragCamera || camera;
        if (ds && ds.plane && camUse){
          raycaster.setFromCamera(mouse, camUse);
          const p = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(ds.plane, p)){
            const target = p.add(ds.offset.clone());
            const to = target.clone().sub(upperDrag.pivot);
            const from = upperDrag.baseDir.clone();
            if (to.lengthSq() > 1e-6 && from.lengthSq() > 1e-6){
              const toN = to.normalize();
              const fromN = from.normalize();
              let q = new THREE.Quaternion().setFromUnitVectors(fromN, toN);
              // Clamp total bend to torso rotation limit
              const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w)));
              if (angle > TORSO_ROT_LIMIT_RAD){
                const axis = new THREE.Vector3(q.x, q.y, q.z);
                if (axis.lengthSq() > 1e-8){
                  axis.normalize();
                  q = new THREE.Quaternion().setFromAxisAngle(axis, TORSO_ROT_LIMIT_RAD);
                }
              }
              upperDrag.accumQ.copy(q);
              qDelta = null; // accumQ already set to absolute rotation
            }
          }
        }
      } else {
        // Handle mode: incremental yaw/pitch around torso frame
        const dx = (event.clientX - upperDrag.lastX);
        const dy = (event.clientY - upperDrag.lastY);
        upperDrag.lastX = event.clientX; upperDrag.lastY = event.clientY;
        const pitch = -dy * UPPER_HANDLE_ROT_SENS_PITCH;
        if (upperDrag.mode === 'tilt'){
          const roll = -dx * UPPER_HANDLE_ROT_SENS_YAW;
          const qRoll = new THREE.Quaternion().setFromAxisAngle(tf.zForward, roll);
          const qPitch = new THREE.Quaternion().setFromAxisAngle(tf.xRight, pitch);
          qDelta = qRoll.multiply(qPitch);
        } else {
          const yaw = -dx * UPPER_HANDLE_ROT_SENS_YAW;
          const qYaw = new THREE.Quaternion().setFromAxisAngle(tf.yUp, yaw);
          const qPitch = new THREE.Quaternion().setFromAxisAngle(tf.xRight, pitch);
          qDelta = qYaw.multiply(qPitch);
        }
      }

      if (qDelta){
        upperDrag.accumQ.premultiply(qDelta);
      }
      // Rotate all captured keys when wholeBody is true, otherwise only upper-body keys
      const keys = upperDrag.wholeBody ? Array.from(upperDrag.baseRel.keys()) : upperBodyKeys();
      for (const k of keys){
        if (isLocked && isLocked(person, k)) continue;
        const rel0 = upperDrag.baseRel.get(k); if (!rel0) continue;
        const p = rel0.clone().applyQuaternion(upperDrag.accumQ).add(upperDrag.pivot);
        joints[k] = [p.x, p.y, p.z];
      }
      if (upperDrag.syncBoth && upperDrag.otherPerson){
        const other = upperDrag.otherPerson;
        const otherJoints = other === 'A' ? jointsA : jointsB;
        const otherKeys = upperDrag.wholeBody ? Array.from(upperDrag.baseRelOther.keys()) : upperBodyKeys();
        for (const k of otherKeys){
          if (isLocked && isLocked(other, k)) continue;
          const relOther = upperDrag.baseRelOther.get(k); if (!relOther) continue;
          const pOther = relOther.clone().applyQuaternion(upperDrag.accumQ).add(upperDrag.pivotOther);
          otherJoints[k] = [pOther.x, pOther.y, pOther.z];
        }
      }
      // During handle drag, avoid solvers but still enforce floor grounding
      updateMeshesFromJoints();
      return;
    }
    if (!dragging) return;
    const wasdActive = (moveKeys.w || moveKeys.a || moveKeys.s || moveKeys.d);
    if (wasdActive) return;
    const ds = activePerson==='A' ? dragState.A : dragState.B;
    const cam = ds.camera || dragCamera || camera;
    raycaster.setFromCamera(mouse, cam);
    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ds.plane, intersectPoint)){
      const target = intersectPoint.add(ds.offset.clone());
      target.y = Math.max(target.y, FLOOR_Y + 0.02);
      if (shiftDragging){
        const prev = dragging.position.clone();
        const delta = new THREE.Vector3().subVectors(target, prev);
        const allY = [...jointMeshesA, ...jointMeshesB].map(m=> m.position.y);
        const minY = Math.min(...allY);
        if (delta.y < 0){ const minAllowedDy = (FLOOR_Y + 0.02) - minY; if (delta.y < minAllowedDy) delta.y = minAllowedDy; }
        skeletonA.rootPos.add(delta); skeletonB.rootPos.add(delta);
        groundSkeleton(skeletonA); groundSkeleton(skeletonB);
        jointsA = jointsFromSkeleton(skeletonA); jointsB = jointsFromSkeleton(skeletonB);
        updateMeshesFromJoints();
      } else if (toeRotateDrag.active) {
        const person = toeRotateDrag.person;
        const side = toeRotateDrag.side;
        const store = person === 'B' ? toeOffsets.B : toeOffsets.A;
        const joints = person === 'A' ? jointsA : jointsB;
        const heelKey = side === 'L' ? 'footL' : 'footR';
        const anchor = toeRotateDrag.startToeWorld?.clone() || dragging.getWorldPosition(new THREE.Vector3());
        const base = toeRotateDrag.startOffset;
        if (store && base && base.lengthSq() > 1e-8){
          const yaw = (event.clientX - toeRotateDrag.startX) * TOE_ROTATE_SENS;
          const pitch = (event.clientY - toeRotateDrag.startY) * TOE_ROTATE_SENS;
          const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);
          let right = new THREE.Vector3(1,0,0);
          const camUse = toeRotateDrag.camera || cam;
          try{
            const dir = camUse.getWorldDirection(new THREE.Vector3()).normalize();
            right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), dir).normalize();
            if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1,0,0);
          }catch(e){}
          const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -pitch);
          const rotated = base.clone().applyQuaternion(qYaw).applyQuaternion(qPitch);
          if (anchor && joints?.[heelKey]){
            let newHeel = anchor.clone().sub(rotated);
            if (newHeel.y < FLOOR_Y + 0.02) newHeel.y = FLOOR_Y + 0.02;
            const finalOffset = anchor.clone().sub(newHeel);
            if (!store[side]) store[side] = new THREE.Vector3();
            store[side].copy(finalOffset);
            joints[heelKey] = [newHeel.x, newHeel.y, newHeel.z];
            syncSkeletonFromJoints(person);
          } else {
            if (!store[side]) store[side] = new THREE.Vector3();
            store[side].copy(rotated);
          }
          updateMeshesFromJoints();
        }
      } else if (ctrlDragging){
        const prev = dragging.position.clone();
        const delta = new THREE.Vector3().subVectors(target, prev);
        const sel = selectedPerson === 'A' ? 'A' : 'B';
        const selMeshes = sel==='A' ? jointMeshesA : jointMeshesB;
        const minY = Math.min(...selMeshes.map(m=> m.position.y));
        if (delta.y < 0){ const minAllowedDy = (FLOOR_Y + 0.02) - minY; if (delta.y < minAllowedDy) delta.y = minAllowedDy; }
        if (sel==='A') { skeletonA.rootPos.add(delta); if (torsoFreeze && torsoFreezeRefA) torsoFreezeRefA.rootPos.add(delta); groundSkeleton(skeletonA); jointsA = jointsFromSkeleton(skeletonA); }
        else { skeletonB.rootPos.add(delta); if (torsoFreeze && torsoFreezeRefB) torsoFreezeRefB.rootPos.add(delta); groundSkeleton(skeletonB); jointsB = jointsFromSkeleton(skeletonB); }
        updateMeshesFromJoints();
      } else if (dragging && dragging.userData?.isToeJoint) {
        const person = activePerson;
        const side = dragging.userData.side === 'L' ? 'L' : 'R';
        const joints = person === 'A' ? jointsA : jointsB;
        const heelKey = side === 'L' ? 'footL' : 'footR';
        const heelArr = joints[heelKey];
        if (!heelArr) return;
        const heel = new THREE.Vector3(...heelArr);
        const targetClamped = target.clone();
        targetClamped.y = Math.max(targetClamped.y, FLOOR_Y + 0.02);
        const offset = targetClamped.clone().sub(heel);
        if (offset.lengthSq() < 1e-6) return;
        const store = person === 'B' ? toeOffsets.B : toeOffsets.A;
        if (!store[side]) store[side] = new THREE.Vector3();
        store[side].copy(offset);
        updateMeshesFromJoints();
      } else if (bridgeDrag.active && dragging && !shiftDragging && !ctrlDragging) {
        const person = bridgeDrag.person;
        const joints = person === 'A' ? jointsA : jointsB;
        const hipL0 = bridgeDrag.hipLStart;
        const hipR0 = bridgeDrag.hipRStart;
        const center0 = bridgeDrag.hipCenterStart;
        const targetCenter = target.clone();
        targetCenter.y = Math.max(targetCenter.y, FLOOR_Y + 0.02);
        // Prevent unstable behavior: clamp maximum hip center height so legs can still reach the floor.
        try {
          const hipLNow = new THREE.Vector3(...joints.hipL);
          const hipRNow = new THREE.Vector3(...joints.hipR);
          const kneeL = new THREE.Vector3(...joints.kneeL);
          const kneeR = new THREE.Vector3(...joints.kneeR);
          const footL = new THREE.Vector3(...joints.footL);
          const footR = new THREE.Vector3(...joints.footR);
          const footY = Math.min(footL.y, footR.y);
          const legLenL = hipLNow.distanceTo(kneeL) + kneeL.distanceTo(footL);
          const legLenR = hipRNow.distanceTo(kneeR) + kneeR.distanceTo(footR);
          const legLen = Math.max(1e-4, Math.min(legLenL, legLenR));
          const maxCenterY = footY + legLen * 0.98;
          if (targetCenter.y > maxCenterY) {
            // Once at the height limit, ignore further upward drag to avoid solver freak-outs.
            return;
          }
        } catch(e) {}
        const hipLNow = new THREE.Vector3(...joints.hipL);
        const hipRNow = new THREE.Vector3(...joints.hipR);
        const currentCenter = hipLNow.clone().add(hipRNow).multiplyScalar(0.5);
        const leftOffset = hipL0.clone().sub(center0);
        const rightOffset = hipR0.clone().sub(center0);
        const newHipL = targetCenter.clone().add(leftOffset);
        const newHipR = targetCenter.clone().add(rightOffset);
        joints.hipL = [newHipL.x, newHipL.y, newHipL.z];
        joints.hipR = [newHipR.x, newHipR.y, newHipR.z];
        const delta = targetCenter.clone().sub(currentCenter);
        if (delta.lengthSq() > 1e-12) {
          const keys = ['shoulderL','shoulderR','elbowL','elbowR','handL','handR','neck','head'];
          for (const key of keys){
            if (isLocked && isLocked(person, key)) continue;
            const arr = joints[key];
            if (!arr) continue;
            const v = new THREE.Vector3(...arr).add(delta);
            joints[key] = [v.x, v.y, v.z];
          }
        }
        syncSkeletonFromJoints(person);
        updateMeshesFromJoints();
      } else if (activeJointIdx != null) {
        applyJointDragTarget(target, ds);
      }
    }
  }

  function pointerUpHandler(event){
    try{ if (renderer?.domElement?.releasePointerCapture) renderer.domElement.releasePointerCapture(event.pointerId); }catch(e){}
    if (touchOrbitDrag.pointerId != null && event?.pointerId === touchOrbitDrag.pointerId){
      touchOrbitDrag = { active: false, pointerId: null, lastX: 0, lastY: 0 };
      try{ controls.enableRotate = touchOrbitRotateRestore; }catch(e){}
    }
    hoverUpperHandlePerson = null;
    dragTorsoAnchorA = null;
    dragTorsoAnchorB = null;
    dragTorsoForwardA = null;
    dragTorsoForwardB = null;
    dragRootAnchorA = null;
    dragRootAnchorB = null;
    dragSpineAnchorA = null;
    dragSpineAnchorB = null;
    dragHeadAnchorA = null;
    dragHeadAnchorB = null;
    dragHeadOffsetA = null;
    dragHeadOffsetB = null;
    shoulderAnchors.A.L = null; shoulderAnchors.A.R = null;
    shoulderAnchors.B.L = null; shoulderAnchors.B.R = null;
    try{ if (document.pointerLockElement) document.exitPointerLock(); }catch(e){}
    // Sync skeleton to current joints so later features (mirror, presets) see updated pose
    try {
      if (upperDrag.active){
        if (upperDrag.syncBoth){
          try{ syncSkeletonFromJoints('A'); }catch(e){}
          try{ syncSkeletonFromJoints('B'); }catch(e){}
        } else if (upperDrag.person === 'A') syncSkeletonFromJoints('A'); else if (upperDrag.person === 'B') syncSkeletonFromJoints('B');
      } else if (lowerHandleDrag.active){
        if (lowerHandleDrag.person === 'A') syncSkeletonFromJoints('A'); else if (lowerHandleDrag.person === 'B') syncSkeletonFromJoints('B');
      } else if (activeJointIdx != null){
        if (activePerson === 'A') syncSkeletonFromJoints('A'); else if (activePerson === 'B') syncSkeletonFromJoints('B');
      }
    } catch(e){}
    // If the user was dragging the head/neck, update the preferred local head rotation
    try{
      if (headDragPerson === 'A' && skeletonA){
        headPreferredA = skeletonA.angleRot[IDX.head]?.clone() || headPreferredA;
      } else if (headDragPerson === 'B' && skeletonB){
        headPreferredB = skeletonB.angleRot[IDX.head]?.clone() || headPreferredB;
      }
    }catch(e){}
    headDragPerson = null;
    dragging = null; dragCamera = null; dragView = 'persp'; activeJointIdx = null; shiftDragging = false; ctrlDragging = false; controls.enabled = orbitEnabled; orthoPan.active = false;
    try{ const el = renderer?.domElement; if (el) el.style.cursor = (lockState==='select' ? 'crosshair' : 'default'); }catch(e){}
    if (lockState === 'select') setLockPreview(null);
    dragState.A.plane = dragState.A.offset = dragState.A.camera = null; dragState.A.view = 'persp'; dragState.A.lastTarget = null; dragState.A.atLimit = false; dragState.A.justScrolled = false;
    dragState.B.plane = dragState.B.offset = dragState.B.camera = null; dragState.B.view = 'persp'; dragState.B.lastTarget = null; dragState.B.atLimit = false; dragState.B.justScrolled = false;
    dragSnapshotTaken = false;
    dragRootFreezeActive = false; dragFreezeWhich = 'none'; dragRootA = null; dragRootB = null; dragSpineRefA = null; dragSpineRefB = null;
    dragLengthConstraint = {active:false, person:null, jointKey:null, parentKey:null, childKey:null, lParent:0, lChild:0};
    bridgeDrag.active = false;
    armTranslateDrag.active = false; armTranslateDrag.person = null; armTranslateDrag.side = null;
    elbowTranslateDrag.active = false; elbowTranslateDrag.person = null; elbowTranslateDrag.side = null;
    handTranslateDrag.active = false; handTranslateDrag.person = null; handTranslateDrag.side = null;
    footDrag.active = false;
    toeRotateDrag.active = false; toeRotateDrag.person = null; toeRotateDrag.side = null; toeRotateDrag.startOffset.set(0,0,0); toeRotateDrag.startToeWorld.set(0,0,0); toeRotateDrag.startX = 0; toeRotateDrag.startY = 0; toeRotateDrag.camera = null;
    lowerHandleDrag.active = false; lowerHandleDrag.person = null; lowerHandleDrag.accumQ.identity(); lowerHandleDrag.baseRel.clear();
    upperDrag.active = false; upperDrag.person = null; upperDrag.wholeBody = false; upperDrag.mode = 'yawPitch'; upperDrag.baseDir.set(0,1,0);
    upperDrag.syncBoth = false; upperDrag.otherPerson = null; upperDrag.baseRelOther.clear(); upperDrag.pivotOther.set(0,0,0);
    natLock = { active:false, person:null, spineBefore:null, headBefore:null, headDrag:false };
    stopDepthNudge();
  }

  function wheelHandler(event){
    const dir = Math.sign(event.deltaY || 0);
    if (dir !== 0){
      if (applyDepthNudge(dir, event)) return;
    }
    // Ortho zoom in 4-view (when not joint-dragging)
    if (!fourViewMode) return; // let OrbitControls handle
    const view = viewAtEvent(event);
    if (view === 'persp') return; // allow OrbitControls
    // Zoom for orthographic views
    event.preventDefault();
    const delta = Math.sign(event.deltaY);
    const factor = (delta > 0) ? 1/1.1 : 1.1;
    if (view === 'front') { frontZoom = Math.max(0.1, Math.min(10, frontZoom * factor)); }
    else if (view === 'side') { sideZoom = Math.max(0.1, Math.min(10, sideZoom * factor)); }
    else { topZoom = Math.max(0.1, Math.min(10, topZoom * factor)); }
  }

  function applyDepthNudge(dir, event=null){
    if (!dragging || dir === 0 || !Number.isFinite(dir)) return false;
    // Ctrl-drag whole figure: move along camera view
    if (ctrlDragging && !shiftDragging){
      const person = activePerson || selectedPerson || 'A';
      const ds = person==='A' ? dragState.A : dragState.B;
      const camUse = ds?.camera || dragCamera || camera;
      if (camUse){
        if (event?.preventDefault) event.preventDefault();
        const viewDir = camUse.getWorldDirection(new THREE.Vector3()).normalize();
        const step = scrollSensitivity * 5;
        const delta = viewDir.multiplyScalar(-dir * step);
        const skel = person==='A' ? skeletonA : skeletonB;
        if (skel){
          skel.rootPos.add(delta);
          groundSkeleton(skel);
          if (person === 'A'){ jointsA = jointsFromSkeleton(skel); }
          else { jointsB = jointsFromSkeleton(skel); }
          if (ds?.plane){ ds.plane.constant -= step * dir; ds.justScrolled = true; }
          updateMeshesFromJoints();
          return true;
        }
      }
    }
    // While dragging (joint, toe, hips, or torso), move along camera depth
    if (!shiftDragging){
      const ds = activePerson==='A' ? dragState.A : dragState.B;
      if (ds?.plane){
        if (event?.preventDefault) event.preventDefault();
        const step = scrollSensitivity * dir;
        ds.plane.constant -= step;
        ds.justScrolled = true;
        // Upper-handle drag: adjust rotation
        if (upperDrag.active && activeJointIdx == null){
          const person = upperDrag.person;
          const skel = (person==='A') ? skeletonA : skeletonB;
          const tf = torsoFrameFromSkel(skel);
          let qDelta = null;
          if (upperDrag.mode === 'pendulum'){
            const camUse = ds?.camera || dragCamera || camera;
            if (ds && ds.plane && camUse){
              raycaster.setFromCamera(mouse, camUse);
              const p = new THREE.Vector3();
              if (raycaster.ray.intersectPlane(ds.plane, p)){
                const target = p.add(ds.offset.clone());
                const to = target.clone().sub(upperDrag.pivot);
                const from = upperDrag.baseDir.clone();
                if (to.lengthSq() > 1e-6 && from.lengthSq() > 1e-6){
                  const toN = to.normalize();
                  const fromN = from.normalize();
                  let q = new THREE.Quaternion().setFromUnitVectors(fromN, toN);
                  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w)));
                  if (angle > TORSO_ROT_LIMIT_RAD){
                    const axis = new THREE.Vector3(q.x, q.y, q.z);
                    if (axis.lengthSq() > 1e-8){
                      axis.normalize();
                      q = new THREE.Quaternion().setFromAxisAngle(axis, TORSO_ROT_LIMIT_RAD);
                    }
                  }
                  upperDrag.accumQ.copy(q);
                  qDelta = null;
                }
              }
            }
          } else {
            const pitch = -dir * UPPER_HANDLE_ROT_SENS_PITCH * 4;
            const qPitch = new THREE.Quaternion().setFromAxisAngle(tf.xRight, pitch);
            qDelta = qPitch;
          }
          if (qDelta){
            upperDrag.accumQ.premultiply(qDelta);
          }
          const joints = (person==='A') ? jointsA : jointsB;
          const keys = upperDrag.wholeBody ? Array.from(upperDrag.baseRel.keys()) : upperBodyKeys();
          for (const k of keys){
            if (isLocked && isLocked(person, k)) continue;
            const rel0 = upperDrag.baseRel.get(k); if (!rel0) continue;
            const p2 = rel0.clone().applyQuaternion(upperDrag.accumQ).add(upperDrag.pivot);
            joints[k] = [p2.x, p2.y, p2.z];
          }
          if (upperDrag.syncBoth && upperDrag.otherPerson){
            const other = upperDrag.otherPerson;
            const otherJoints = other === 'A' ? jointsA : jointsB;
            const otherKeys = upperDrag.wholeBody ? Array.from(upperDrag.baseRelOther.keys()) : upperBodyKeys();
            for (const k of otherKeys){
              if (isLocked && isLocked(other, k)) continue;
              const relOther = upperDrag.baseRelOther.get(k); if (!relOther) continue;
              const pOther = relOther.clone().applyQuaternion(upperDrag.accumQ).add(upperDrag.pivotOther);
              otherJoints[k] = [pOther.x, pOther.y, pOther.z];
            }
          }
          updateMeshesFromJoints();
          return true;
        }
        // Apply plane-based drag update to current joint position
        const camUse = ds.camera || dragCamera || camera;
        if (camUse){
          raycaster.setFromCamera(mouse, camUse);
          const hit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(ds.plane, hit)){
            const target = hit.add(ds.offset.clone());
            target.y = Math.max(target.y, FLOOR_Y + 0.02);
            if (activeJointIdx != null){
              applyJointDragTarget(target, ds);
              return true;
            }
            if (dragging && dragging.userData?.isToeJoint){
              const person = activePerson;
              const side = dragging.userData.side === 'L' ? 'L' : 'R';
              const joints = person === 'A' ? jointsA : jointsB;
              const heelKey = side === 'L' ? 'footL' : 'footR';
              const heelArr = joints[heelKey];
              if (!heelArr) return true;
              const heel = new THREE.Vector3(...heelArr);
              const targetClamped = target.clone();
              targetClamped.y = Math.max(targetClamped.y, FLOOR_Y + 0.02);
              const offset = targetClamped.clone().sub(heel);
              if (offset.lengthSq() < 1e-6) return true;
              const store = person === 'B' ? toeOffsets.B : toeOffsets.A;
              if (!store[side]) store[side] = new THREE.Vector3();
              store[side].copy(offset);
              updateMeshesFromJoints();
              return true;
            }
            const prev = dragging.position.clone();
            const delta = new THREE.Vector3().subVectors(target, prev);
            const allY = [...jointMeshesA, ...jointMeshesB].map(m=> m.position.y);
            const minY = Math.min(...allY);
            if (delta.y < 0){ const minAllowedDy = (FLOOR_Y + 0.02) - minY; if (delta.y < minAllowedDy) delta.y = minAllowedDy; }
            if (activePerson === 'A') { skeletonA.rootPos.add(delta); groundSkeleton(skeletonA); jointsA = jointsFromSkeleton(skeletonA); }
            else { skeletonB.rootPos.add(delta); groundSkeleton(skeletonB); jointsB = jointsFromSkeleton(skeletonB); }
            updateMeshesFromJoints();
            return true;
          }
        }
      }
    }
    return false;
  }

  // Allow keyboard nudges (space = away, F = toward) using the same depth logic as scroll
  function nudgeDepthFromKey(dir){
    startDepthNudge(dir);
  }

  const DEPTH_NUDGE_MS = 16;
  let depthNudgeDir = 0;
  let depthNudgeTimer = null;
  function startDepthNudge(dir){
    depthNudgeDir = dir;
    if (depthNudgeTimer) return;
    depthNudgeTimer = setInterval(()=>{ applyDepthNudge(depthNudgeDir, null); }, DEPTH_NUDGE_MS);
  }
  function stopDepthNudge(){
    depthNudgeDir = 0;
    if (depthNudgeTimer){ try{ clearInterval(depthNudgeTimer); }catch(_){} depthNudgeTimer = null; }
  }

  // Helper to find nearest joint sphere to a world point
  function nearestJointMesh(person, worldPoint){
    const list = person==='A' ? jointMeshesA : jointMeshesB;
    if (!list?.length) return null;
    let best = null; let bestD2 = Infinity;
    for (const m of list){
      const w = m.getWorldPosition(new THREE.Vector3());
      const d2 = w.distanceToSquared(worldPoint);
      if (d2 < bestD2){ bestD2 = d2; best = m; }
    }
    return best;
  }


  // Preserve yaw and roll from previous local rotation; allow pitch from current
  function preserveYawOnlyLocal(skel, idx, qBefore){
    try{
      const eBefore = new THREE.Euler().setFromQuaternion(qBefore, 'XYZ');
      const eAfter  = new THREE.Euler().setFromQuaternion(skel.angleRot[idx], 'XYZ');
      const qAdj = new THREE.Quaternion().setFromEuler(new THREE.Euler(eAfter.x, eBefore.y, eBefore.z, 'XYZ'));
      skel.angleRot[idx].copy(qAdj);
    }catch(e){}
  }

  // keep exports last if any
</script>

<svelte:head>
  <title>Fightlab 3D</title>
  <meta name="description" content="Move the figures and see changes in real time, like a video game. It makes you think through what comes first, a different and easier kind of visualization that still works alongside the rest." />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

  <div
    class="preload-cover"
    style={`opacity:${uiReady ? 0 : 1}; pointer-events:${uiReady ? 'none' : 'auto'};`}
    aria-hidden={uiReady}
  >
    <div class="preload-content">
      <div class="preload-spinner" aria-hidden="true"></div>
      <span>Fightlab 3D</span>
    </div>
  </div>


  <div class="scene-gradient" aria-hidden="true"></div>
  <div class="account-anchor">
    <button class="btn account-btn" bind:this={accountToggleEl} on:click={() => { const next = !showAccountMenu; showAccountMenu = next; showSavedPresetsMenu = false; showSavedPlaybacksMenu = false; if (!next) closeAllSettingTabs(); if (next) { closeAllSettingTabs(); } }} title="Menu / Login">
      <svg class="icon account-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span class="account-label">Menu</span>
    </button>
    {#if showAccountMenu}
      <div class="account-menu" bind:this={accountMenuEl}>
        <div class="menu-title">Account & Controls</div>
        <button
          type="button"
          class="shortcut-toggle account-subtoggle"
          on:click={()=> toggleAccountSetting('account')}
          aria-expanded={showAccountAuth}
          aria-controls="account-auth"
          title="Account access">
          <span class="shortcut-toggle__label" style="display:flex; align-items:center; gap:6px;">
            <svg class="icon shortcut-toggle__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 19a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Account
          </span>
          <svg class="icon shortcut-toggle__icon" viewBox="0 0 24 24" style={`transform: rotate(${showAccountAuth ? 180 : 0}deg);`} aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        {#if showAccountAuth}
        <div id="account-auth" class="menu-item panel-block" style="flex-direction:column; align-items:flex-start; gap:6px; padding:10px;">
          <label class="meta-label" for="account-name">Name</label>
          <input id="account-name" class="input" bind:value={loginName} placeholder="Your name" style="width:100%;" />
          <label class="meta-label" for="account-email">Email</label>
          <input id="account-email" class="input" type="email" bind:value={loginEmail} placeholder="you@example.com" style="width:100%;" />
          {#if !isSupabaseConfigured && authAttempted}
            <span class="meta-label">Add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` to enable login.</span>
          {:else if isLoggedIn}
            <span class="meta-label">Signed in as {loginEmail}</span>
          {:else if authAttempted}
            <span class="meta-label">We send a magic sign-in link to your email.</span>
          {/if}
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn--primary" on:click={handleAuthSubmit} disabled={authBusy || !isSupabaseConfigured}>
              {isLoggedIn ? 'Send new login link' : 'Login / Sign up'}
            </button>
            {#if isLoggedIn}
              <button class="btn" on:click={logout} disabled={authBusy}>Log out</button>
            {/if}
          </div>
          {#if authAttempted && authMessage}
            <span class="meta-label">{authMessage}</span>
          {/if}
          {#if authAttempted && authDetail}
            <span class="meta-label">{authDetail}</span>
          {/if}
        </div>
        {/if}
        <button
          type="button"
          class="shortcut-toggle account-subtoggle"
          on:click={()=> toggleAccountSetting('settings')}
          aria-expanded={showAccountSettings}
          aria-controls="account-settings"
          title="Settings">
          <span class="shortcut-toggle__label">Settings</span>
          <svg class="icon shortcut-toggle__icon" viewBox="0 0 24 24" style={`transform: rotate(${showAccountSettings ? 180 : 0}deg);`} aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        {#if showAccountSettings}
        <div id="account-settings" class="menu-item panel-block" style="flex-direction:column; align-items:flex-start; gap:10px; padding:10px;">
          <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
            <span class="name">Scroll sensitivity</span>
            <div style="display:flex; gap:8px; width:100%; align-items:center;">
              <input type="range" min="0.005" max="0.2" step="0.005" bind:value={scrollSensitivity} style="flex:1;" />
              <input type="number" step="0.005" min="0.005" max="0.5" bind:value={scrollSensitivity} style="width:72px; font-size:12px; padding:4px 6px;" />
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
            <span class="name">Colorblind mode</span>
            <select bind:value={colorblindMode} on:change={applyColorblindScheme} style="width:100%; font-size:12px; padding:6px; border-radius:6px;">
              <option value="normal">Normal</option>
              <option value="deuteranopia">Deuteranopia</option>
              <option value="protanopia">Protanopia</option>
              <option value="tritanopia">Tritanopia</option>
            </select>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
            <span class="name">Dark mode</span>
            <button class="btn" on:click={toggleDarkMode}>{darkMode ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
        {/if}
        <button
          type="button"
          class="shortcut-toggle"
          on:click={()=> toggleAccountSetting('shortcuts')}
          aria-expanded={showAccountShortcuts}
          aria-controls="account-shortcuts"
          title="Toggle shortcuts list">
          <span class="shortcut-toggle__label">Shortcuts</span>
          <svg class="icon shortcut-toggle__icon" viewBox="0 0 24 24" style={`transform: rotate(${showAccountShortcuts ? 180 : 0}deg);`} aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        {#if showAccountShortcuts}
        <div id="account-shortcuts" class="shortcut-list" style="background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.08);">
          <div class="shortcut-row"><span class="keys">Ctrl + Z</span><span class="desc">Undo last move</span></div>
          <div class="shortcut-row"><span class="keys">Ctrl + S</span><span class="desc">Save current frame</span></div>
          <div class="shortcut-row"><span class="keys">Q</span><span class="desc">Toggle torso lock</span></div>
          <div class="shortcut-row"><span class="keys">E</span><span class="desc">Toggle Natural / Single-Joint</span></div>
          <div class="shortcut-row"><span class="keys">Click head rotation handle</span><span class="desc">Rotate upper body only</span></div>
          <div class="shortcut-row"><span class="keys">Ctrl + click head rotation handle</span><span class="desc">Rotate lower body only</span></div>
          <div class="shortcut-row"><span class="keys">Ctrl + Shift + click head rotation handle</span><span class="desc">Rotate whole figure</span></div>
          <div class="shortcut-row"><span class="keys">Ctrl + drag joint</span><span class="desc">Move selected figure</span></div>
          <div class="shortcut-row"><span class="keys">Ctrl + Shift + drag joint</span><span class="desc">Move both figures together</span></div>
          <div class="shortcut-row"><span class="keys">Tab</span><span class="desc">Toe rotate mode (while dragging)</span></div>
          <div class="shortcut-row"><span class="keys">Space</span><span class="desc">Play/pause animation (idle) / Nudge joint closer (dragging)</span></div>
          <div class="shortcut-row"><span class="keys">F</span><span class="desc">Nudge joint farther (while dragging)</span></div>
        </div>
        {/if}
    </div>
    {/if}
  </div>
  <div class="preset-ui bottom" bind:this={toolbarEl}>
      <div class="toolbar-layout expanded-grid">
        <div class="toolbar-row">
          <div class="row-left">
            {#if !hidePresetControls}
              <div class="preset-select-wrap with-actions">
                <div class="preset-trigger-wrap">
                  <button
                    type="button"
                    class="preset-trigger"
                    aria-haspopup="true"
                    aria-expanded={showSavedPresetsMenu}
                    bind:this={presetsToggleEl}
                    on:click={()=>{ showSavedPresetsMenu = !showSavedPresetsMenu; showSavedPlaybacksMenu = false; }}
                    on:keydown={(e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); showSavedPresetsMenu = !showSavedPresetsMenu; showSavedPlaybacksMenu = false; } }}>
                    <span class="preset-trigger__label">
                      {#if BUILTIN_PRESETS.find(p=>p.key===startPosition)}
                        {BUILTIN_PRESETS.find(p=>p.key===startPosition).label}
                      {:else}
                        {startPosition}
                      {/if}
                    </span>
                    <svg class="icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="inline-action small preset-inline-action" title="Reload preset" on:click={() => setPosition(startPosition)}>
                    <svg class="icon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 4v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  </button>
                  {#if showSavedPresetsMenu}
                    <div class="menu-popup preset-menu" bind:this={presetsMenuEl} style="left:0; right:auto; bottom:calc(100% + 8px); top:auto; position:absolute;">
                      <div class="preset-menu-col">
                        <div class="menu-section-title">Built-in presets</div>
                        {#if BUILTIN_PRESETS.find(p=>p.key===startPosition)}
                          <div class="menu-item">
                            <button type="button" class="menu-row-btn" on:click={() => { updateCurrentPresetFromScene(); showSavedPresetsMenu=false; }}>
                              <span class="name">Save changes to current preset</span>
                            </button>
                          </div>
                          <div class="menu-item" style="cursor:default;">
                            <span class="name" style="white-space:normal; color:#555; font-size:12px;">Tip: Pose the figures, then save to update the preset in this browser.</span>
                          </div>
                        {/if}
                        {#each BUILTIN_PRESETS as preset (preset.key)}
                          <div class="menu-item">
                            <button type="button" class="menu-row-btn" on:click={() => { setPosition(preset.key); showSavedPresetsMenu=false; }}>
                              <span class="name">{preset.label}</span>
                            </button>
                          </div>
                        {/each}
                      </div>
                      <div class="preset-menu-col">
            <div class="menu-section-title preset-menu-title">
              <span>Custom presets</span>
              <button type="button" class="add-preset-action" on:click|stopPropagation={promptSaveCustomPreset} title="Add custom preset">
                <svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div class="menu-item" style="cursor:default; gap:6px; align-items:flex-start;">
              <span class="name" style="white-space:normal; color:#555; font-size:12px;">Tip: Click the + to save your current pose as a preset. It will appear below and stay saved in your browser.</span>
            </div>
                        {#if savedPresets.length}
                          {#each savedPresets as pr, i (pr?.name || i)}
                            <div class="menu-item">
                              <button type="button" class="menu-row-btn" on:click={() => { loadSavedPreset(i); showSavedPresetsMenu=false; }}>
                                <span class="name">{pr?.name || `Preset ${i + 1}`}</span>
                              </button>
                              <div style="display:flex; gap:4px;">
                                <button type="button" class="inline-action small edit-action" on:click|stopPropagation={() => startPresetEdit(i)} title="Edit preset">
                                  <svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5l4 4-10 10H6.5v-4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                                </button>
                                <button type="button" class="inline-action small danger-action" on:click|stopPropagation={() => deleteSavedPreset(i)} title="Delete">
                                  <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                                </button>
                              </div>
                            </div>
                          {/each}
                        {:else}
                          <div class="menu-item"><span class="name" style="opacity:.6;">No custom presets</span></div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
          <div class="row-center">
            <div class="controls-row controls-row--expanded">
              <button class="icon-btn" on:click={prevFrame} title="Previous frame">
                <svg class="icon" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="icon-btn icon-btn--primary" class:is-active={playing} on:click={togglePlayback} title="Play / Pause playback">
                {#if playing}
                  <svg class="icon" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/></svg>
                {:else}
                  <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7z" fill="currentColor"/></svg>
                {/if}
              </button>
              <button class="icon-btn" on:click={nextFrame} title="Next frame">
                <svg class="icon" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="icon-btn" on:click={clearPlaybackQueue} title="Clear playback queue">
                <svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <button class="icon-btn mobile-only-control mobile-undo-control" on:click={undoLastFigureMove} title="Undo (mobile)" aria-label="Undo">
                <span class="mobile-undo-symbol" aria-hidden="true">↩</span>
              </button>
            </div>
          </div>
          <div class="row-right">
            <div class="playback-dropdown">
            <div class="input-with-icon two-actions input-row playback-input-row">
                <input class="input toolbar-field toolbar-field--name" type="text" bind:value={newPlaybackName} placeholder="Name playback" />
                <button class="inline-action save-action" on:click={saveCurrentPlayback} title="Save playback">
                  <svg class="icon" viewBox="0 0 24 24"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 3v4h8" fill="none" stroke="currentColor" stroke-width="2"/><rect x="7" y="13" width="10" height="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <button class="inline-action" style="right:36px;" title="Select custom playbacks" bind:this={playbacksToggleEl} on:click={()=>{ showSavedPlaybacksMenu = !showSavedPlaybacksMenu; showSavedPresetsMenu=false; }}>
                  <svg class="icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              {#if showSavedPlaybacksMenu}
                {#key playbacksMenuVersion}
                <div
                  class="menu-popup"
                  role="menu"
                  aria-label="Playback folders"
                  tabindex="-1"
                  bind:this={playbacksMenuEl}
                  on:contextmenu|preventDefault={(e)=> openPlaybackContext(e, playbackFolderView || '')}>
                  {#if playbackFolderView === null}
                    <div class="menu-item" style="justify-content:flex-start; gap:6px; cursor:default;">
                      <button type="button" class="inline-action small edit-action" on:click|stopPropagation={() => {
                        const val = prompt('New folder name'); if (val && val.trim()) { addPlaybackFolder(val); playbackGroups = groupPlaybacks(savedPlaybacks); persistPlaybackFolders(); }
                      }} title="Add folder">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      </button>
                      <span class="name" style="flex:none; color:#555;">Folders</span>
                    </div>
                    {#if topPlaybackGroups.length || playbacksInFolder('').length}
                      {#each topPlaybackGroups as grp (grp.folder)}
                        <div class="menu-item folder-row menu-section-title" role="listitem">
                          <button
                            type="button"
                            class="menu-row-btn"
                            style="flex:1; text-align:left; display:flex; align-items:center; gap:6px;"
                            on:click={() => playbackFolderView = grp.folder}
                            on:contextmenu|preventDefault={(e)=> openPlaybackContext(e, grp.folder)}
                            on:keydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); playbackFolderView = grp.folder; }}}
                            on:dragover|preventDefault={() => {
                              if (draggingPlaybackIdx!=null) movePlaybackToFolder(draggingPlaybackIdx, grp.folder);
                            }}>
                            <svg class="icon folder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H3z" fill="currentColor"/><path d="M3 6h6l2 2h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                            <span class="name">{grp.folder}</span>
                          </button>
                          <button class="inline-action small danger-action" on:click|stopPropagation={() => deletePlaybackFolder(grp.folder)} title="Delete folder">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                          </button>
                        </div>
                      {/each}
                      {#if playbacksInFolder('').length}
                        {#each playbacksInFolder('') as pb (pb._idx)}
                          <div class="menu-item" role="listitem" draggable="true" on:dragstart={()=> draggingPlaybackIdx = pb._idx} on:dragend={()=> draggingPlaybackIdx = null}>
                            <button type="button" class="menu-row-btn" on:click={() => { loadSavedPlayback(pb._idx); showSavedPlaybacksMenu=false; }}>
                              <span class="name">{pb?.name || `Playback ${pb?._idx ?? ''}`} ({pb?.frames?.length||0})</span>
                            </button>
                            <div style="display:flex; gap:4px; align-items:center;">
                              <button type="button" class="inline-action small edit-action" on:click|stopPropagation={() => startPlaybackEdit(pb._idx)} title="Edit playback">
                                <svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5l4 4-10 10H6.5v-4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                              </button>
                              <button type="button" class="inline-action small danger-action" on:click|stopPropagation={() => deleteSavedPlayback(pb._idx)} title="Delete">
                                <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                              </button>
                            </div>
                          </div>
                        {/each}
                      {/if}
                    {:else}
                      <div class="menu-item"><span class="name" style="opacity:.6;">No playbacks</span></div>
                    {/if}
                  {:else}
                    <div class="menu-item back-breadcrumb">
                      <button
                        class="back-breadcrumb__btn"
                        on:click={()=> playbackFolderView = null}
                        on:dragover|preventDefault={() => {}}
                        on:drop|preventDefault={() => {
                          if (draggingPlaybackIdx != null) {
                            movePlaybackToFolder(draggingPlaybackIdx, '');
                            playbackFolderView = null;
                            draggingPlaybackIdx = null;
                          }
                        }}>
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Back to folders</span>
                      </button>
                      {#if playbackFolderView}
                        <div class="back-breadcrumb__path">
                          {#each playbackFolderView.split('/').filter(Boolean) as part, i}
                            {#if i > 0}
                              <svg class="icon breadcrumb-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            {/if}
                            <button
                              type="button"
                              class="breadcrumb-segment"
                              on:click={() => {
                                const parts = playbackFolderView.split('/').filter(Boolean);
                                playbackFolderView = parts.slice(0, i + 1).join('/');
                              }}
                            >{part}</button>
                          {/each}
                        </div>
                      {/if}
                      <button
                        type="button"
                        class="inline-action small edit-action"
                        on:click|stopPropagation={() => {
                          const val = prompt('New subfolder name');
                          if (val && val.trim()) { addPlaybackFolder(val, playbackFolderView); playbackGroups = groupPlaybacks(savedPlaybacks); persistPlaybackFolders(); }
                        }}
                        title="Add subfolder here">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      </button>
                    </div>
                    {#if childFolders(playbackFolderView).length}
                      {#each childFolders(playbackFolderView) as sub (sub)}
                        <div class="menu-item folder-row menu-section-title" role="listitem">
                          <button
                            type="button"
                            class="menu-row-btn"
                            style="flex:1; text-align:left; display:flex; align-items:center; gap:6px;"
                            on:click={() => playbackFolderView = sub}
                            on:dragover|preventDefault={() => { if (draggingPlaybackIdx!=null) movePlaybackToFolder(draggingPlaybackIdx, sub); }}>
                            <svg class="icon folder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H3z" fill="currentColor"/><path d="M3 6h6l2 2h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                            <span class="name">{sub}</span>
                          </button>
                          <button class="inline-action small danger-action" on:click|stopPropagation={() => deletePlaybackFolder(sub)} title="Delete folder">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                          </button>
                        </div>
                      {/each}
                    {/if}
                    {#if playbacksInFolder(playbackFolderView).length}
                      {#each playbacksInFolder(playbackFolderView) as pb (pb._idx)}
                        <div class="menu-item" role="listitem" draggable="true" on:dragstart={()=> draggingPlaybackIdx = pb._idx} on:dragend={()=> draggingPlaybackIdx = null}>
                          <button type="button" class="menu-row-btn" on:click={() => { loadSavedPlayback(pb._idx); showSavedPlaybacksMenu=false; }}>
                            <span class="name">{pb?.name || `Playback ${pb?._idx ?? ''}`} ({pb?.frames?.length||0})</span>
                          </button>
                          <div style="display:flex; gap:4px; align-items:center;">
                            <button type="button" class="inline-action small edit-action" on:click|stopPropagation={() => startPlaybackEdit(pb._idx)} title="Edit playback">
                              <svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5l4 4-10 10H6.5v-4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                            </button>
                            <button type="button" class="inline-action small danger-action" on:click|stopPropagation={() => deleteSavedPlayback(pb._idx)} title="Delete">
                              <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                            </button>
                          </div>
                        </div>
                      {/each}
                    {:else}
                      <div class="menu-item"><span class="name" style="opacity:.6;">No playbacks in this folder</span></div>
                    {/if}
                  {/if}
                </div>
                {/key}
              {/if}
            </div>
          </div>
        </div>

        <div class="toolbar-row">
          <div class="row-left">
            <div class="toolbar-actions wrap-tight">
              <button class="btn btn--toggle" class:is-active={!singleJointMode}
                on:click={toggleSingleJointMode}
                title="Toggle movement mode (E)">{singleJointMode ? 'Single Joint Mode' : 'Natural Mode'}</button>
              <button class="btn btn--fourview" on:click={()=> fourViewMode = !fourViewMode}>{fourViewMode ? 'Single View' : '4-View'}</button>
              <button class="btn" class:is-active={torsoFreeze} on:click={toggleTorsoFreeze} title="Torso Lock (Q)">Torso Lock</button>
              <button class="btn" on:click={mirrorPoseYZPlane}>Mirror Pose</button>
            </div>
          </div>
          <div class="row-center">
            <div class="controls-row info-row controls-row--expanded">
              <span class="counter">{poses.length? (currentFrame+1) : 0}/{poses.length}</span>
              <div class="speed-inline">
                <label for="playback-speed" class="speed-label">Speed</label>
                <div class="speed-track">
                  <div class="speed-markers">
                    <span>-</span>
                    <span>+</span>
                  </div>
                  <input class="slim" id="playback-speed" type="range" min="0" max="100" step="1" value={playbackSpeedPct} on:input={(e)=> setPlaybackSpeedPct(+e.currentTarget.value)} style="width:clamp(90px,16vw,130px);" />
                </div>
              </div>
            </div>
          </div>
          <div class="row-right playback-comment-row">
            <div class="input-with-icon input-row toolbar-field toolbar-field--name playback-input-row playback-comment">
              <input class="input" type="text" bind:value={comment} placeholder="Frame comment" />
              <button class="inline-action save-action" on:click={saveCurrentFrame} title="Save frame">
                <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

      {#if playbackContextMenu.visible}
        <div
          class="menu-popup"
          role="menu"
          aria-label="Playback folder context menu"
          tabindex="-1"
          bind:this={playbackContextEl}
          style="position:fixed; left:{playbackContextMenu.x}px; top:{playbackContextMenu.y}px; z-index:1300; min-width:180px;"
          on:click|stopPropagation={() => {}}
          on:keydown|stopPropagation={() => {}}
          on:contextmenu|preventDefault={() => {}}>
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            on:click={() => {
              const val = prompt('New folder name');
              if (val && val.trim()){
                addPlaybackFolder(val, playbackContextMenu.folder || null);
                playbackGroups = groupPlaybacks(savedPlaybacks);
                persistPlaybackFolders();
              }
              closePlaybackContext();
            }}
            on:keydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); e.currentTarget?.click(); } }}>
            <span class="name">Add folder here</span>
          </button>
          {#if playbackContextMenu.folder}
            <button
              type="button"
              class="menu-item"
              role="menuitem"
              on:click={() => {
                deletePlaybackFolder(playbackContextMenu.folder);
                closePlaybackContext();
              }}
              on:keydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); e.currentTarget?.click(); } }}>
              <span class="name">Delete "{playbackContextMenu.folder}"</span>
            </button>
          {/if}
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            on:click={closePlaybackContext}
            on:keydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); e.currentTarget?.click(); } }}>
            <span class="name" style="opacity:0.7;">Close</span>
          </button>
        </div>
      {/if}

    {#if editingPlaybackIdx >= 0}
      <div class="editing-bar collapse-hide">
        <span class="meta-label" style="font-size:12px; color:#444;">Editing playback {editingPlaybackIdx + 1}</span>
        <input class="input" type="text" bind:value={editingPlaybackName} placeholder="Playback name" style="width:clamp(140px,24vw,220px);" />
        <select class="input" bind:value={editingPlaybackFolder} style="width:clamp(140px,20vw,200px);">
          <option value="">No folder</option>
          {#each playbackFolders as f}
            <option value={f}>{f}</option>
          {/each}
        </select>
        <button class="btn btn--primary" on:click={saveEditsToPlayback}>Save edits</button>
        <button class="btn" on:click={cancelPlaybackEdit}>Cancel</button>
      </div>
    {/if}
    {#if editingPresetIdx >= 0}
    <div class="editing-bar collapse-hide">
      <span class="meta-label" style="font-size:12px; color:#444;">Editing preset {editingPresetIdx + 1}</span>
      <input class="input" type="text" bind:value={editingPresetName} placeholder="Preset name" style="width:clamp(140px,24vw,220px);" />
      <button class="btn btn--primary" on:click={savePresetEdits}>Save edits</button>
      <button class="btn" on:click={cancelPresetEdit}>Cancel</button>
    </div>
  {/if}
<div class="figures-wrapper" style={`display:${showFigures ? 'block' : 'none'}`}>
  <div id="figures"></div>
  <canvas bind:this={canvas} style="width:100vw; height:100vh; display:block; position:relative; z-index:1; background:transparent;"></canvas>

  {#if commentVisible && !showSavedPlaybacksMenu}
    <div class="comment-box" bind:this={commentEl} role="note" aria-live="polite" style="left: {commentPos.left}px; top: {commentPos.top}px;">
      {commentText}
    </div>
  {/if}

  {#if fourViewMode}
    <!-- Labels and separators overlay -->
    <div style="position:fixed; inset:0; pointer-events:none; z-index:5;">
      <!-- separator lines -->
      <div style="position:absolute; left:50%; top:0; bottom:0; width:1px; background:rgba(0,0,0,0.12);"></div>
      <div style="position:absolute; top:50%; left:0; right:0; height:1px; background:rgba(0,0,0,0.12);"></div>
      <!-- labels -->
      <div style="position:absolute; left:12px; top:12px; font: 12px/1.2 system-ui, sans-serif; background:rgba(0,0,0,0.55); color:#fff; padding:2px 6px; border-radius:4px;">Perspective</div>
      <div style="position:absolute; right:12px; top:12px; font: 12px/1.2 system-ui, sans-serif; background:rgba(0,0,0,0.55); color:#fff; padding:2px 6px; border-radius:4px;">Front</div>
      <div style="position:absolute; left:12px; bottom: calc(50% + 12px); font: 12px/1.2 system-ui, sans-serif; background:rgba(0,0,0,0.55); color:#fff; padding:2px 6px; border-radius:4px;">Side</div>
      <div style="position:absolute; right:12px; bottom: calc(50% + 12px); font: 12px/1.2 system-ui, sans-serif; background:rgba(0,0,0,0.55); color:#fff; padding:2px 6px; border-radius:4px;">Top</div>
    </div>
  {/if}

  <!-- Custom crosshair cursor shown while joint is lock-orbiting (WASD) -->
  <div bind:this={lockCursorEl} style="position:fixed; z-index:1001; width:14px; height:14px; margin:-7px 0 0 -7px; border:2px solid #1e90ff; border-radius:50%; pointer-events:none; display:none;"></div>
</div>

<div class="orientation-lock" role="alert" aria-live="polite">
  <div class="orientation-lock__card">
    <div class="orientation-lock__title">Rotate your device</div>
    <div class="orientation-lock__text">This app is available in landscape mode only.</div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: radial-gradient(circle at 50% 30%, #e0e7ff 0%, #f8fafc 60%, #ffffff 100%);
  }
  :global(.lil-gui) {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1000;
  }
  /* Responsive toolbar */
  .preset-ui { backdrop-filter: saturate(180%) blur(10px); box-sizing: border-box; }
  .preset-ui.bottom { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); right: auto; z-index: 10; background: linear-gradient(150deg, rgba(255,255,255,0.92), rgba(234,242,255,0.88)); border:1px solid rgba(212,228,255,0.9); border-radius:14px; padding:10px 22px; box-shadow:0 10px 28px rgba(15, 23, 42, 0.12); display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; width: clamp(280px, calc(100vw - 80px), 1680px); justify-content: center; }
  .toolbar-layout { width:100%; padding-inline: 4px; box-sizing: border-box; }
  .expanded-grid { display:grid; grid-template-columns: repeat(3, minmax(280px, 1fr)); grid-template-rows: repeat(2, auto); gap:4px 10px; align-items:start; justify-items:stretch; }
  .toolbar-row { display:contents; }
  .row-left, .row-center, .row-right { display:flex; align-items:center; justify-content:flex-start; gap:10px; flex-wrap:wrap; min-width:0; max-width:100%; }
  .row-center { justify-content:center; }
  .row-right { justify-content:flex-end; }
  .playback-comment-row { justify-content:flex-start; }
  .toolbar-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .toolbar-actions.wrap-tight { flex-wrap:nowrap; }
  .controls-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:center; }
  .controls-row--expanded { flex-wrap:nowrap; column-gap:10px; }
  .speed-inline { display:flex; align-items:center; gap:6px; flex-wrap:nowrap; }
  .speed-inline label { font-size:12px; color:#444; white-space:nowrap; }
  .speed-label { font-size:12px; color:#444; white-space:nowrap; }
  .speed-track { position:relative; display:flex; align-items:center; flex:1; }
  .speed-track input { width:100%; }
  .speed-markers { position:absolute; top:-4px; left:0; right:0; display:flex; justify-content:space-between; font-size:12px; color:#000; pointer-events:none; }
  .info-row { justify-content:center; }
  /* side layout removed */
  .btn { font: 13px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 6px 10px; border: 1px solid #d0d7de; border-radius: 8px; background: #fff; color: #111; cursor: pointer; transition: background .15s, border-color .15s, box-shadow .15s; }
  .btn:hover { background: #f7f8fa; border-color: #c4cbd3; }
  .btn:focus-visible { outline: 2px solid #0b5bd3; outline-offset: 2px; }
  .btn--primary { border-color: #3b82f6; color: #0b5bd3; background: #eef5ff; }
  .btn--primary:hover { background: #e5f0ff; }
  /* .btn--ghost removed (unused) */
  .btn--toggle.is-active { border-color: #16a34a; color: #166534; background: #ecfdf5; }
  .account-anchor { position: fixed; top: 12px; left: 12px; z-index: 12; }
  .account-btn { display:inline-flex; align-items:center; gap:6px; background: #ffffff; border:1px solid #d6dbe4; color: #0f172a; padding: 5px 10px; border-radius: 10px; font: 13px/1.2 system-ui, -apple-system, Segoe UI, sans-serif; transition: background .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  .account-btn:hover, .account-btn:focus-visible { background: #f8fafc; border-color: #c5ccda; color: #0f172a; box-shadow: 0 8px 18px rgba(0,0,0,0.10); }
  .account-label { font-weight: 600; letter-spacing: 0.01em; }
  .account-icon { width: 17px; height: 17px; color: currentColor; }
  .account-menu { position: absolute; top: calc(100% + 8px); left: 0; min-width: 210px; width: min(92vw, 360px); max-width: min(92vw, 360px); background: linear-gradient(150deg, rgba(255,255,255,0.95), rgba(234,242,255,0.9)); border: 1px solid #d8e3f5; border-radius: 14px; padding: 10px; box-shadow: 0 16px 40px rgba(15,23,42,0.18); color: #0f172a; z-index: 14; box-sizing: border-box; }
  .account-menu .menu-title { color: #0f172a; }
  .account-menu .menu-item { color: #0f172a; }
  .account-menu .menu-item .name { color: #0f172a; }
  .account-menu .menu-item:hover { background: rgba(15,23,42,0.04); }
  .account-menu .shortcut-row,
  .account-menu .shortcut-row .desc,
  .account-menu .shortcut-row .keys { color: #0f172a; }
  .account-menu .shortcut-list { border-color: rgba(15,23,42,0.08); background: rgba(255,255,255,0.6); }
  .panel-block { border:1px solid #d8e3f5; border-radius:10px; background: rgba(255,255,255,0.92); box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); }
  .input { font: 13px/1.2 system-ui, sans-serif; padding: 6px 8px; border:1px solid #d0d7de; border-radius:8px; }
  .input:focus-visible { outline: 2px solid #0b5bd3; outline-offset: 2px; }
  .icon { width: 18px; height: 18px; display: block; }
  .icon-btn { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:9999px; border:1px solid #d0d7de; background:#fff; color:#111; cursor:pointer; transition: background .15s, border-color .15s, box-shadow .15s; }
  .icon-btn:hover { background:#f7f8fa; border-color:#c4cbd3; }
  .icon-btn--primary { border-color:#3b82f6; background:#eef5ff; color:#0b5bd3; }
  .input-with-icon { position:relative; display:flex; align-items:center; z-index:0; width: 100%; box-sizing: border-box; min-width:0; overflow: hidden; }
  .input-with-icon .input { padding-right: 34px; width: 100%; box-sizing: border-box; }
  /* When the input has two inline action buttons (save + dropdown), add extra padding */
  .input-with-icon.two-actions .input { padding-right: 70px; }
  .playback-input-row { width: min(100%, 260px); max-width: min(100%, 260px); box-sizing: border-box; flex: 0 0 auto; }
  .playback-comment.playback-input-row { width: min(100%, 260px); max-width: min(100%, 260px); box-sizing: border-box; flex: 0 0 auto; }
  .toolbar-field { width: clamp(130px, 14vw, 170px); min-width: 0; max-width: 100%; }
  .toolbar-field--name { width: clamp(190px, 22vw, 260px); }
  .toolbar-frame { width: clamp(190px, 22vw, 260px); max-width: 100%; }
  .playback-comment { min-width: 0; }
  .playback-comment .input { width: 100%; min-width: 0; box-sizing: border-box; }
  .playback-comment { overflow: hidden; }
  .inline-action { position:absolute; right:6px; top:50%; transform: translateY(-50%); width:24px; height:24px; padding:0; border:0; background:transparent; cursor:pointer; color:#111; display:inline-flex; align-items:center; justify-content:center; }
  .inline-action.small { width:22px; height:22px; }
  .inline-action.small .icon { width:16px; height:16px; }
  .playback-comment .inline-action { right:8px; }
  .playback-comment .input { padding-right: 52px; box-sizing: border-box; }
  .playback-dropdown { width: min(100%, 100%); max-width: 100%; box-sizing: border-box; min-width: 0; }
  .toolbar-frame,
  .toolbar-field,
  .toolbar-field--name,
  .playback-comment { min-width: 0; max-width: 100%; box-sizing: border-box; }
  .preset-select-wrap { position:relative; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .preset-trigger-wrap { position:relative; display:inline-block; }
  .preset-trigger { display:inline-flex; align-items:center; justify-content:space-between; gap:8px; width:clamp(140px,18vw,190px); padding:6px 42px 6px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; cursor:pointer; font: 13px/1.2 system-ui, sans-serif; }
  .preset-inline-action { position:absolute; right:8px; top:50%; transform: translateY(-50%); color:#0f172a; }
  .preset-inline-action:hover { color:#0b5bd3; }
  .preset-trigger__label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .preset-trigger:focus-visible { outline:2px solid #0b5bd3; outline-offset:2px; }
  :global(.playback-footer) { display:grid; grid-template-columns: 1fr auto 1fr; gap:12px; align-items:start; width:100%; margin-top:8px; }
  :global(.pf-row) { display:contents; }
  :global(.pf-col) { display:flex; flex-direction:column; gap:8px; }
  :global(.pf-center) { align-items:center; justify-content:center; }
  :global(.pf-controls) { display:flex; align-items:center; gap:8px; justify-content:center; }
  :global(.pf-speed) { display:flex; align-items:center; gap:6px; justify-content:center; }
  :global(.pf-section) { display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
  :global(.pf-stack) { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
  :global(.pf-stack .playback-comment .input) { padding-right: 40px; width:100%; }
  /* Slim range input for playback speed */
  input[type="range"].slim { -webkit-appearance: none; appearance: none; height: 22px; background: transparent; }
  input[type="range"].slim:focus { outline: none; }
  input[type="range"].slim::-webkit-slider-runnable-track { height: 6px; background: #fff; border-radius: 9999px; border: 1px solid #000; box-shadow: inset 0 1px 0 rgba(0,0,0,0.08); }
  input[type="range"].slim::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; background: #3b82f6; border: 0; border-radius: 50%; margin-top: -4px; box-shadow: 0 2px 6px rgba(0,0,0,0.18); }
  input[type="range"].slim::-moz-range-track { height: 6px; background: #fff; border-radius: 9999px; border: 1px solid #000; box-shadow: inset 0 1px 0 rgba(0,0,0,0.08); }
  input[type="range"].slim::-moz-range-thumb { width: 14px; height: 14px; background: #3b82f6; border: 0; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.18); }
  .menu-popup { position:absolute; bottom: 110%; right:0; background:linear-gradient(135deg, #ffffff 0%, #f6f7fb 100%); border:1px solid #d0d7de; border-radius:12px; box-shadow:0 10px 28px rgba(0,0,0,0.14); padding:6px; min-width: 200px; max-height: 240px; max-width: min(100vw - 18px, 420px); width: min(420px, 100%); overflow:auto; z-index: 12; box-sizing: border-box; }
  .preset-menu { display:grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap:8px 12px; min-width: 420px; width: min(100vw - 18px, 760px); max-width: calc(100vw - 18px); }
  .preset-menu-col { display:flex; flex-direction:column; gap:4px; }
  .menu-item { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; cursor:pointer; border-radius:6px; }
  .menu-item:hover { background:#f7f8fa; }
  .menu-item .name { font: 13px/1.2 system-ui, sans-serif; color:#111; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .menu-section-title { font:12px/1.2 system-ui, sans-serif; font-weight:600; color:#444; padding:6px 8px 2px; text-transform:uppercase; letter-spacing:0.02em; display:flex; align-items:center; gap:6px; }
  .preset-menu-title { justify-content:space-between; }
  .add-preset-action { border:0; background:transparent; cursor:pointer; width:24px; height:24px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; color:#0f172a; }
  .add-preset-action:hover { background:#eef2ff; color:#0b5bd3; }
  .folder-icon { width:14px; height:14px; color:#f0b400; flex:none; }
  /* Ensure delete buttons inside dropdown rows are laid out per-row, not absolutely positioned */
  .menu-item .inline-action { position: static; right: auto; top: auto; transform: none; }
  .menu-row-btn { flex:1; text-align:left; border:0; background:transparent; padding:4px 6px; cursor:pointer; }
  .menu-row-btn:focus-visible { outline: 2px solid #0b5bd3; border-radius:6px; }
  .back-breadcrumb { gap:8px; align-items:center; background:#f7f9fc; border:1px solid #e2e8f0; border-radius:8px; padding:6px; }
  .back-breadcrumb__btn { display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; cursor:pointer; font-size:12px; }
  .back-breadcrumb__btn:hover { background:#eef2f7; }
  .back-breadcrumb__path { display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:6px; background:#eef2f7; color:#444; font-size:12px; flex-wrap:wrap; }
  .breadcrumb-segment { border:0; background:transparent; padding:2px 6px; border-radius:6px; cursor:pointer; color:#374151; }
  .breadcrumb-segment:hover { background:#e2e8f0; }
  .breadcrumb-sep { width:14px; height:14px; color:#6b7280; }
  .scene-gradient { position:fixed; inset:0; background: linear-gradient(315deg, rgba(105,165,255,0.38) 0%, rgba(228,235,246,0.82) 55%, #ffffff 100%); pointer-events:none; z-index:0; }
  :global(body.dark-mode) .scene-gradient { background: linear-gradient(315deg, rgba(34,56,120,0.65) 0%, rgba(8,12,22,0.95) 100%); }
  .preload-cover { position:fixed; inset:0; background:#f8fafc; display:flex; align-items:center; justify-content:center; z-index:2000; font:14px/1.2 system-ui, sans-serif; color:#0f172a; transition: opacity .2s ease; }
  .preload-content { display:flex; flex-direction:column; align-items:center; gap:10px; }
  .preload-spinner { width:40px; height:40px; border:3px solid rgba(15,23,42,0.15); border-top-color:#2563eb; border-radius:50%; animation: preload-spin 0.8s linear infinite; }
  @keyframes preload-spin { to { transform: rotate(360deg); } }
  :root { --bg-dark:#0b1325; --bg-light:#ffffff; --text:#0f172a; --muted:#475569; --radius:14px; --shadow:0 12px 32px rgba(15,23,42,0.16); }

  /* menu styles removed (unused) */
  .counter { font:12px/1.2 system-ui, sans-serif; color:#555; margin-left:8px; }
  .editing-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:4px 6px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; }
  .shortcut-list { display:grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:10px 14px; margin:6px 0 10px 0; padding:10px; border:1px solid #eee; border-radius:10px; background:#fafafa; max-height: 360px; overflow-y: auto; overflow-x: hidden; }
  .shortcut-row { display:grid; grid-template-columns: 50% 50%; align-items:start; gap:6px 12px; font:12px/1.3 system-ui, sans-serif; color:#333; }
  .shortcut-row .keys { font-weight:700; color:#0f172a; white-space:normal; width: 100%; word-break: break-word; }
  .shortcut-row .desc { color:#444; }
  .danger-action { border:1px solid transparent; border-radius:6px; transition: color .15s; }
  .danger-action:hover { color:#dc2626; background:transparent; }
  .edit-action { border:1px solid transparent; border-radius:6px; }
  .edit-action:hover { background:#f1f5f9; border-color:#cbd5e1; }
  .save-action { border-radius:6px; }
  .save-action:hover { background:#e5f0ff; border-color:#3b82f6; color:#0b5bd3; }
  .btn--primary:hover { background:#dbe8ff; border-color:#2f6fe0; }
  .mobile-only-control { display: none; }
  .mobile-undo-control { color:#1f2937; background: transparent; border-color: #cbd5e1; }
  .mobile-undo-control:hover { background: #f3f4f6; color:#1f2937; }
  .mobile-undo-symbol { font-size: 18px; line-height: 1; font-family: "Segoe UI Symbol", Arial, sans-serif; transform: translateX(-2px); }
  .input-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .shortcut-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid #d8e3f5;
    background: linear-gradient(135deg, #ffffff, #f3f6ff);
    color: #0f172a;
    cursor: pointer;
    transition: background .15s ease, border-color .15s ease, tran sform .12s ease;
  }
  .shortcut-toggle:hover { background: #eef2ff; border-color: #c7d7f5; }
  .shortcut-toggle:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
  .shortcut-toggle:active { transform: translateY(1px); }
  .shortcut-toggle__label { font: 12px/1.2 system-ui, sans-serif; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }
  .shortcut-toggle__icon { width: 16px; height: 16px; color: #0f172a; transition: transform .18s ease; }
  .account-subtoggle { padding:6px 8px; border-radius:9px; gap:8px; background: linear-gradient(145deg, #ffffff, #f3f6ff); border:1px solid #d8e3f5; }
  /* Dark mode overrides */
  :global(body.dark-mode) {
    background: radial-gradient(circle at 50% 30%, #0f172a 0%, #0b1220 60%, #050913 100%);
    color: #e5e7eb;
  }
  :global(body.dark-mode) .preset-ui.bottom {
    background: linear-gradient(150deg, rgba(15,23,42,0.94), rgba(9,12,23,0.9));
    border-color: rgba(59,73,102,0.8);
    box-shadow: 0 10px 28px rgba(0,0,0,0.5);
  }
  :global(body.dark-mode) .account-menu,
  :global(body.dark-mode) .menu-popup {
    background: linear-gradient(150deg, rgba(15,23,42,0.96), rgba(9,12,23,0.92));
    border-color: rgba(59,73,102,0.8);
    color: #e5e7eb;
  }
  :global(body.dark-mode) .account-btn {
    background: #0f172a;
    border-color: #334155;
    color: #e5e7eb;
    box-shadow: 0 8px 18px rgba(0,0,0,0.4);
  }
  :global(body.dark-mode) .account-btn:hover,
  :global(body.dark-mode) .account-btn:focus-visible {
    background: #111827;
    border-color: #475569;
    color: #e5e7eb;
  }
  :global(body.dark-mode) .account-icon,
  :global(body.dark-mode) .shortcut-toggle__icon,
  :global(body.dark-mode) .breadcrumb-sep {
    color: #e5e7eb;
  }
  :global(body.dark-mode) .account-menu .menu-title,
  :global(body.dark-mode) .menu-item,
  :global(body.dark-mode) .menu-item .name,
  :global(body.dark-mode) .menu-section-title { color: #e5e7eb; }
  :global(body.dark-mode) .menu-item:hover { background: rgba(255,255,255,0.04); }
  :global(body.dark-mode) .menu-row-btn { color:#e5e7eb; }
  :global(body.dark-mode) .menu-row-btn:hover { background: rgba(255,255,255,0.04); }
  :global(body.dark-mode) .preset-inline-action { color:#e5e7eb; }
  :global(body.dark-mode) .preset-inline-action:hover { color:#c7d2fe; }
  :global(body.dark-mode) .panel-block {
    background: linear-gradient(150deg, rgba(15,23,42,0.9), rgba(10,14,26,0.9));
    border-color: rgba(59,73,102,0.8);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  }
  :global(body.dark-mode) .speed-label,
  :global(body.dark-mode) .speed-inline label,
  :global(body.dark-mode) .speed-markers,
  :global(body.dark-mode) .counter { color:#e5e7eb; }
  :global(body.dark-mode) .meta-label { color:#e5e7eb; }
  :global(body.dark-mode) .btn {
    background: #0f172a;
    color: #e5e7eb;
    border-color: #334155;
  }
  :global(body.dark-mode) .btn:hover { background:#111827; border-color:#475569; }
  :global(body.dark-mode) .btn--primary { background:#1d4ed8; border-color:#2563eb; color:#e5e7eb; }
  :global(body.dark-mode) .btn--primary:hover { background:#1e40af; border-color:#1d4ed8; }
  :global(body.dark-mode) .input { background:#0b1220; color:#e5e7eb; border-color:#334155; }
  :global(body.dark-mode) .preset-trigger,
  :global(body.dark-mode) select,
  :global(body.dark-mode) option { background:#0b1220; color:#e5e7eb; border-color:#334155; }
  :global(body.dark-mode) .input { background:#0b1220; color:#e5e7eb; border-color:#334155; }
  :global(body.dark-mode) .input::placeholder { color: rgba(229,231,235,0.8); }
  :global(body.dark-mode) .playback-dropdown .input { color:#e5e7eb; }
  :global(body.dark-mode) .shortcut-list { background:#0f172a; border-color:#1f2937; }
  :global(body.dark-mode) .shortcut-row { color:#e5e7eb; }
  :global(body.dark-mode) .shortcut-row .keys { color:#cbd5f5; }
  :global(body.dark-mode) .shortcut-row .desc { color:#e5e7eb; }
  :global(body.dark-mode) .shortcut-toggle {
    background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
    border-color: rgba(255,255,255,0.08);
    color: #e5e7eb;
  }
  :global(body.dark-mode) .shortcut-toggle__icon { color:#cbd5f5; }

  /* Frame comment overlay */
  .comment-box {
    position: fixed;
    right: 12px;
    left: auto;
    min-width: 180px;
    max-width: min(64ch, calc(100vw - 24px));
    width: fit-content;
    background: rgba(255,255,255,0.96);
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.10);
    font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #111827;
    z-index: 15;
    word-break: break-word;
  }
  .orientation-lock {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 3000;
    background: radial-gradient(circle at 50% 30%, #e0e7ff 0%, #f8fafc 60%, #ffffff 100%);
    color: #0f172a;
    text-align: center;
  }
  .orientation-lock__card {
    background: rgba(255,255,255,0.96);
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 18px 20px;
    box-shadow: 0 12px 32px rgba(15,23,42,0.14);
    max-width: 320px;
  }
  .orientation-lock__title {
    font: 16px/1.2 system-ui, -apple-system, Segoe UI, sans-serif;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .orientation-lock__text {
    font: 13px/1.35 system-ui, -apple-system, Segoe UI, sans-serif;
    color: #475569;
  }


@media (max-width: 1280px){
  .controls-row--expanded { flex-wrap:wrap; }
  .preset-ui.bottom { max-width: calc(100vw - 16px); }
}
@media (max-width: 900px){
  .preset-ui { bottom: 10px; left: 10px; right: 10px; gap: 6px; padding: 6px 8px; }
  .preset-ui.bottom { left: 50%; right: auto; transform: translateX(-50%); width: calc(100vw - 20px); }
  .expanded-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; }
  .toolbar-frame,
  .toolbar-field,
  .toolbar-field--name,
  .playback-input-row { max-width: min(100%, 240px); width: min(100%, 240px); }
  .playback-dropdown,
  .row-right > .playback-dropdown,
  .row-right { width: min(100%, 240px); max-width: min(100%, 240px); }
  .playback-dropdown .input-with-icon.two-actions .input { padding-right: 64px; }
  .playback-dropdown .input-with-icon {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  .playback-dropdown .input-with-icon .input {
    width: 0;
    min-width: 0;
    flex: 1 1 auto;
    padding-right: 8px;
  }
  .playback-dropdown .input-with-icon .inline-action {
    position: static !important;
    top: auto;
    right: auto;
    transform: none;
    flex: 0 0 24px;
    margin-left: 0;
  }
  .playback-dropdown .input-with-icon .inline-action + .inline-action {
    margin-left: 2px;
  }
  .btn { padding: 5px 8px; font-size: 12px; }
  .input { font-size: 12px; }
}
  @media (max-width: 720px){
    .preset-ui.bottom { left: 50%; right: auto; transform: translateX(-50%); width: calc(100vw - 16px); overflow: hidden; }
    .preset-ui.bottom,
    .toolbar-layout,
    .toolbar-row { box-sizing: border-box; }
    .expanded-grid { grid-template-columns: 1fr; }
    .toolbar-row { display:flex; width:100%; flex-direction:column; gap:2px; align-items:stretch; padding-inline: 2px; box-sizing: border-box; }
    .row-left, .row-center, .row-right { width:100%; justify-content: stretch; gap:4px; max-width: 100%; padding-inline: 2px; }
    .row-left > *, .row-center > *, .row-right > * { width:100%; min-width: 0; max-width: 100%; }
    .row-right > .playback-input-row { width: min(100%, 260px) !important; max-width: min(100%, 260px) !important; flex: 0 0 auto; }
    .toolbar-actions { width:100%; }
    .toolbar-actions.wrap-tight { flex-wrap: wrap; }
    .controls-row { width:100%; justify-content: stretch; }
    .controls-row--expanded { flex-wrap: wrap; }
    .controls-row, .controls-row--expanded { width: 100%; }
    .btn { padding: 7px 10px; font-size: 13px; min-height: 36px; }
    .icon-btn { width: 40px; height: 40px; }
    .btn--fourview { display: none; }
    .playback-input-row { width: min(100%, 260px); max-width: min(100%, 260px); }
    .preset-select-wrap,
    .playback-dropdown,
    .toolbar-actions { width: calc(100% - 4px); max-width: calc(100% - 4px); }
    .toolbar-field,
    .toolbar-field--name,
    .toolbar-frame { max-width: min(100%, 260px); width: min(100%, 260px); }
    .playback-comment { overflow: hidden; }
    .playback-dropdown,
    .playback-comment { overflow: hidden; }
    .toolbar-actions .btn { flex: 1 1 auto; }
    .menu-popup { width: min(100vw - 16px, 420px); max-width: min(100vw - 16px, 420px); }
    :global(.preset-menu) { grid-template-columns: 1fr; min-width: 0; width: min(100vw - 16px, 760px); }
    :global(.playback-footer) { grid-template-columns: 1fr; }
    :global(.pf-controls) { flex-wrap: wrap; }
  }
  @media (pointer: coarse), (max-width: 768px){
    .mobile-only-control { display: inline-flex; }
  }
  @media (max-width: 900px) and (orientation: portrait){
    .orientation-lock { display: flex; }
    .figures-wrapper,
    .preset-ui,
    .account-anchor,
    .editing-bar { display: none !important; }
    :global(.menu-popup) { display: none !important; }
  }
  @media (max-width: 560px){
    .meta-label { display: none; }
    .preset-ui { gap: 6px; }
    .preset-ui.bottom { left: 50%; right: auto; transform: translateX(-50%); width: calc(100vw - 12px); padding: 6px; }
    .toolbar-actions .btn { width: 100%; justify-content: center; }
    .speed-track input { width: min(100%, 150px); }
    .preset-trigger { width: 100%; }
    .preset-select-wrap.with-actions { width: 100%; }
    .row-left, .row-center, .row-right { padding-inline: 3px; }
    .playback-input-row { width: min(100%, 260px) !important; max-width: min(100%, 260px) !important; overflow: hidden; }
    .row-right > .playback-input-row { width: min(100%, 260px) !important; max-width: min(100%, 260px) !important; }
    .playback-comment.playback-input-row { width: min(100%, 260px) !important; max-width: min(100%, 260px) !important; }
    .input-with-icon { overflow: hidden; }
    .toolbar-field,
    .toolbar-field--name,
    .toolbar-frame { width: min(100%, 260px); max-width: min(100%, 260px); }
    .input-with-icon.two-actions .input { padding-right: 82px; }
    .playback-dropdown .input-with-icon {
      width: 100%;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      overflow: hidden;
    }
    .playback-dropdown .input-with-icon .input {
      flex: 1 1 auto;
      min-width: 0;
      width: 0;
      padding-right: 8px;
    }
    .playback-dropdown .input-with-icon .inline-action {
      position: static !important;
      right: auto;
      top: auto;
      transform: none;
      margin-left: 0;
    }
    .playback-dropdown .input-with-icon .inline-action + .inline-action {
      margin-left: 2px;
    }
    .playback-comment { overflow: hidden; }
    .playback-dropdown .input-with-icon.two-actions .input { padding-right: 64px; }
    .toolbar-row { gap: 3px; }
    .input-with-icon .input { width: 100%; max-width: 100%; }
    .mobile-undo-control { width: 100%; border-radius: 12px; }
    .playback-comment .input { width: 100%; }
  }
</style>

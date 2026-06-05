<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';

	const characterUrl =
		'/fightlab3d/meshy/Meshy_AI_Low_Poly_Humanoid_Fig_biped/Meshy_AI_Low_Poly_Humanoid_Fig_biped_Character_output.glb';

	let stage;
	let status = 'Loading Meshy figure - joints-only build';

	let renderer;
	let scene;
	let camera;
	let model = null;
	let groundMesh = null;
	let frameId = null;
	let jointGroup = null;
	let jointHandles = [];
	let raycaster = new THREE.Raycaster();
	let pointer = new THREE.Vector2();
	let dragPlane = new THREE.Plane();
	let dragTarget = new THREE.Vector3();
	let draggingJoint = null;
	let jointDragOffset = new THREE.Vector3();
	let lastDragPointer = null;
	let draggingFigure = false;
	let figureDragOffset = new THREE.Vector3();
	let orbitingCamera = false;
	let orbitPointer = { x: 0, y: 0 };
	let orbitYaw = 0;
	let orbitPitch = 0.38;
	let orbitRadius = 3.6;
	let orbitTarget = new THREE.Vector3(0, 0.35, 0);
	let activePointerId = null;
	let bindPositions = new Map();
	let bindQuaternions = new Map();
	let lastClampDirections = new Map();
	let rotationFallbackAxes = new Map();

	const jointMaterial = new THREE.MeshStandardMaterial({
		color: 0x38bdf8,
		emissive: 0x082f49,
		depthTest: false,
		depthWrite: false,
		transparent: true,
		opacity: 0.58,
		roughness: 0.35,
		metalness: 0
	});
	const selectedJointMaterial = new THREE.MeshStandardMaterial({
		color: 0xfacc15,
		emissive: 0x5f4300,
		depthTest: false,
		roughness: 0.28,
		metalness: 0
	});
	const FLOOR_Y = -1.16;
	const MIN_ORBIT_PITCH = -1.25;
	const MAX_ORBIT_PITCH = 1.25;
	const MIN_ORBIT_RADIUS = 1.4;
	const MAX_ORBIT_RADIUS = 7;
	const DRAG_DEPTH_STEP = 0.045;
	const JOINT_TWIST_STEP = THREE.MathUtils.degToRad(15);

	function materialLooksWhite(material) {
		if (!material || material.map) return false;
		const color = material.color;
		if (!color) return false;
		return color.r > 0.82 && color.g > 0.82 && color.b > 0.82;
	}

	function coloredFallbackMaterial(child, rootBox) {
		const meshBox = new THREE.Box3().setFromObject(child);
		const center = meshBox.getCenter(new THREE.Vector3());
		const height = Math.max(rootBox.max.y - rootBox.min.y, 1);
		const y = (center.y - rootBox.min.y) / height;
		const name = `${child.name || ''} ${child.parent?.name || ''}`.toLowerCase();

		let color = 0x3b82f6;
		if (name.includes('head') || name.includes('hand') || name.includes('face') || y > 0.82) {
			color = 0xd8a17a;
		} else if (name.includes('leg') || name.includes('foot') || y < 0.38) {
			color = 0x1f2937;
		} else if (name.includes('arm') || y > 0.62) {
			color = 0x5b8def;
		}

		return new THREE.MeshStandardMaterial({
			color,
			roughness: 0.68,
			metalness: 0,
			envMapIntensity: 0.35
		});
	}

	function prepareModelForDisplay(object) {
		const rootBox = new THREE.Box3().setFromObject(object);

		object.traverse((child) => {
			if (!child.isMesh) return;
			if (child.geometry && !child.geometry.attributes.normal) {
				child.geometry.computeVertexNormals();
			}
			child.castShadow = true;
			child.receiveShadow = true;
			const materials = Array.isArray(child.material) ? child.material : [child.material];
			const shouldUseFallback = materials.every((material) => materialLooksWhite(material));
			if (shouldUseFallback) {
				child.material = coloredFallbackMaterial(child, rootBox);
				return;
			}
			child.material = Array.isArray(child.material)
				? child.material.map((material) => {
						const next = material.clone();
						next.roughness = Math.max(next.roughness ?? 0, 0.55);
						next.metalness = Math.min(next.metalness ?? 0, 0.05);
						return next;
					})
				: (() => {
						const next = child.material.clone();
						next.roughness = Math.max(next.roughness ?? 0, 0.55);
						next.metalness = Math.min(next.metalness ?? 0, 0.05);
						return next;
					})();
		});
	}

	function collectDraggableBones(object) {
		const bones = [];
		object.traverse((child) => {
			if (!child.isBone) return;
			const name = child.name.toLowerCase();
			if (name === 'hips') return;
			if (name === 'spine02' || name === 'leftshoulder' || name === 'rightshoulder') return;
			if (name.includes('twist') || name.includes('end') || name.includes('nub') || name.includes('toe')) return;
			bones.push(child);
		});
		return bones;
	}

	function fallbackJointPositions(object) {
		const box = new THREE.Box3().setFromObject(object);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const x = size.x;
		const y = size.y;
		const z = size.z;
		const yAt = (ratio) => box.min.y + y * ratio;
		const zFront = center.z + z * 0.03;

		return [
			['head', center.x, yAt(0.91), zFront],
			['neck', center.x, yAt(0.78), zFront],
			['chest', center.x, yAt(0.66), zFront],
			['spine', center.x, yAt(0.53), zFront],
			['hips', center.x, yAt(0.42), zFront],
			['leftShoulder', center.x - x * 0.27, yAt(0.72), zFront],
			['leftElbow', center.x - x * 0.43, yAt(0.57), zFront],
			['leftHand', center.x - x * 0.48, yAt(0.42), zFront],
			['rightShoulder', center.x + x * 0.27, yAt(0.72), zFront],
			['rightElbow', center.x + x * 0.43, yAt(0.57), zFront],
			['rightHand', center.x + x * 0.48, yAt(0.42), zFront],
			['leftHip', center.x - x * 0.14, yAt(0.40), zFront],
			['leftKnee', center.x - x * 0.14, yAt(0.22), zFront],
			['leftFoot', center.x - x * 0.14, yAt(0.04), center.z + z * 0.12],
			['rightHip', center.x + x * 0.14, yAt(0.40), zFront],
			['rightKnee', center.x + x * 0.14, yAt(0.22), zFront],
			['rightFoot', center.x + x * 0.14, yAt(0.04), center.z + z * 0.12]
		].map(([name, px, py, pz]) => ({
			name,
			position: new THREE.Vector3(px, py, pz)
		}));
	}

	function captureBindPose(object) {
		bindPositions = new Map();
		bindQuaternions = new Map();
		object.traverse((child) => {
			if (!child.isBone) return;
			bindPositions.set(child, child.position.clone());
			bindQuaternions.set(child, child.quaternion.clone());
		});
	}

	function restoreBindBoneOffsets() {
		for (const [bone, position] of bindPositions) {
			bone.position.copy(position);
		}
		model?.updateMatrixWorld(true);
	}

	function isSpineLike(bone) {
		const name = bone?.name?.toLowerCase?.() || '';
		return name.includes('spine') || name.includes('neck') || name.includes('head');
	}

	function rotationLimitForBone(bone) {
		const name = bone?.name?.toLowerCase?.() || '';
		if (name === 'spine02') return THREE.MathUtils.degToRad(70);
		if (name === 'spine01') return THREE.MathUtils.degToRad(78);
		if (name === 'spine') return THREE.MathUtils.degToRad(86);
		if (name.includes('neck')) return THREE.MathUtils.degToRad(82);
		if (name.includes('head')) return THREE.MathUtils.degToRad(84);
		return Infinity;
	}

	function clampBoneRotation(bone) {
		const limit = rotationLimitForBone(bone);
		if (!Number.isFinite(limit)) return;
		const bind = bindQuaternions.get(bone);
		if (!bind) return;
		const current = bone.quaternion.clone();
		const relative = bind.clone().invert().multiply(current);
		if (relative.w < 0) {
			relative.x *= -1;
			relative.y *= -1;
			relative.z *= -1;
			relative.w *= -1;
		}
		const angle = 2 * Math.acos(THREE.MathUtils.clamp(relative.w, -1, 1));
		if (angle <= limit || angle < 1e-5) return;
		relative.slerpQuaternions(new THREE.Quaternion(), relative.normalize(), limit / angle);
		bone.quaternion.copy(bind).multiply(relative);
	}

	function ikChainForBone(bone) {
		const targetName = bone?.name?.toLowerCase?.() || '';
		const side = targetName.includes('left') ? 'left' : targetName.includes('right') ? 'right' : '';
		const chain = [];
		let cursor = bone?.parent;

		while (cursor?.isBone) {
			const name = cursor.name.toLowerCase();
			if (name === 'hips') break;
			chain.push(cursor);

			if (side && name === `${side}shoulder`) break;
			if (side && name === `${side}upleg`) break;
			if (!side && name.includes('spine')) {
				const spineCount = chain.filter((item) => item.name.toLowerCase().includes('spine')).length;
				if (spineCount >= 3) break;
			}

			cursor = cursor.parent;
		}

		return chain;
	}

	function clampTargetToReach(bone, chain, targetWorld) {
		if (!chain.length) return targetWorld.clone();
		const root = chain[chain.length - 1];
		const rootPos = new THREE.Vector3();
		const current = new THREE.Vector3();
		const parent = new THREE.Vector3();
		root.getWorldPosition(rootPos);

		let maxReach = 0;
		let largestSegment = 0;
		let cursor = bone;
		while (cursor?.isBone && cursor !== root) {
			cursor.getWorldPosition(current);
			cursor.parent?.getWorldPosition(parent);
			const segmentLength = current.distanceTo(parent);
			maxReach += segmentLength;
			largestSegment = Math.max(largestSegment, segmentLength);
			cursor = cursor.parent;
		}

		if (maxReach <= 1e-6) return targetWorld.clone();
		const fromRoot = targetWorld.clone().sub(rootPos);
		const distance = fromRoot.length();
		const minReach = Math.max(largestSegment - (maxReach - largestSegment), maxReach * 0.08);
		const previousDirection = lastClampDirections.get(bone)?.clone();

		function smoothReachDirection(direction, maxStepRadians) {
			let next = direction.clone();
			if (next.lengthSq() < 1e-8) {
				next = previousDirection?.clone() || new THREE.Vector3(0.2, 0.15, 0.05);
			}
			next.normalize();

			if (!previousDirection || previousDirection.lengthSq() < 1e-8) {
				lastClampDirections.set(bone, next.clone());
				return next;
			}

			const previous = previousDirection.normalize();
			const dot = THREE.MathUtils.clamp(previous.dot(next), -1, 1);
			const angle = Math.acos(dot);
			if (angle <= maxStepRadians || angle < 1e-5) {
				lastClampDirections.set(bone, next.clone());
				return next;
			}

			let axis = new THREE.Vector3().crossVectors(previous, next);
			if (axis.lengthSq() < 1e-8) axis = perpendicularAxis(previous);
			axis.normalize();
			const limited = previous.clone().applyAxisAngle(axis, maxStepRadians).normalize();
			lastClampDirections.set(bone, limited.clone());
			return limited;
		}

		if (distance < minReach) {
			const direction = smoothReachDirection(fromRoot, THREE.MathUtils.degToRad(10));
			return rootPos.clone().add(direction.multiplyScalar(minReach));
		}

		if (distance > maxReach) {
			const direction = smoothReachDirection(fromRoot, THREE.MathUtils.degToRad(16));
			return rootPos.clone().add(direction.multiplyScalar(maxReach));
		}

		if (distance > 1e-8) {
			smoothReachDirection(fromRoot, THREE.MathUtils.degToRad(24));
		}
		if (distance <= maxReach) return targetWorld.clone();
		return targetWorld.clone();
	}

	function applyWorldRotationDelta(bone, deltaWorld) {
		const parentWorld = new THREE.Quaternion();
		bone.parent?.getWorldQuaternion(parentWorld);
		const deltaLocal = parentWorld.clone().invert().multiply(deltaWorld).multiply(parentWorld);
		bone.quaternion.premultiply(deltaLocal);
		clampBoneRotation(bone);
		bone.updateMatrixWorld(true);
	}

	function firstUsableChildBone(bone) {
		return bone.children.find((child) => {
			if (!child.isBone) return false;
			const name = child.name.toLowerCase();
			return !name.includes('twist') && !name.includes('end') && !name.includes('nub');
		});
	}

	function twistAxisForBone(bone) {
		const origin = new THREE.Vector3();
		const other = new THREE.Vector3();
		bone.getWorldPosition(origin);

		const child = firstUsableChildBone(bone);
		if (child) {
			child.getWorldPosition(other);
			const axisToChild = other.sub(origin);
			if (axisToChild.lengthSq() > 1e-8) return axisToChild.normalize();
		}

		if (bone.parent?.isBone) {
			bone.parent.getWorldPosition(other);
			const axisFromParent = origin.clone().sub(other);
			if (axisFromParent.lengthSq() > 1e-8) return axisFromParent.normalize();
		}

		return camera.getWorldDirection(new THREE.Vector3()).normalize();
	}

	function twistJointClockwise(handle) {
		const bone = handle?.userData?.bone;
		if (!bone) {
			status = 'This marker has no rig bone to rotate';
			return;
		}

		const axis = twistAxisForBone(bone);
		const cameraDirection = camera.getWorldDirection(new THREE.Vector3()).normalize();
		const sign = axis.dot(cameraDirection) >= 0 ? -1 : 1;
		const deltaWorld = new THREE.Quaternion().setFromAxisAngle(axis, sign * JOINT_TWIST_STEP);
		applyWorldRotationDelta(bone, deltaWorld);
		restoreBindBoneOffsets();
		updateJointHandles();
		status = `Rotated ${bone.name || 'joint'} clockwise`;
	}

	function perpendicularAxis(vector) {
		const absX = Math.abs(vector.x);
		const absY = Math.abs(vector.y);
		const helper = absX < absY ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
		const axis = new THREE.Vector3().crossVectors(vector, helper);
		if (axis.lengthSq() < 1e-8) axis.crossVectors(vector, new THREE.Vector3(0, 0, 1));
		return axis.normalize();
	}

	function stableDeltaFromUnitVectors(from, to, joint) {
		const dot = THREE.MathUtils.clamp(from.dot(to), -1, 1);
		if (dot < -0.9995) {
			let axis = rotationFallbackAxes.get(joint)?.clone();
			if (!axis || axis.lengthSq() < 1e-8) axis = perpendicularAxis(from);
			axis.addScaledVector(from, -axis.dot(from));
			if (axis.lengthSq() < 1e-8) axis = perpendicularAxis(from);
			axis.normalize();
			rotationFallbackAxes.set(joint, axis.clone());
			return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
		}

		const axis = new THREE.Vector3().crossVectors(from, to);
		if (axis.lengthSq() > 1e-8) rotationFallbackAxes.set(joint, axis.normalize().clone());
		return new THREE.Quaternion().setFromUnitVectors(from, to);
	}

	function solveBoneToTarget(bone, targetWorld) {
		restoreBindBoneOffsets();
		const chain = ikChainForBone(bone);
		if (!chain.length) return false;
		const reachableTarget = clampTargetToReach(bone, chain, targetWorld);

		const endPos = new THREE.Vector3();
		const jointPos = new THREE.Vector3();
		const toEnd = new THREE.Vector3();
		const toTarget = new THREE.Vector3();
		const deltaWorld = new THREE.Quaternion();

		for (let iteration = 0; iteration < 24; iteration += 1) {
			bone.getWorldPosition(endPos);
			if (endPos.distanceTo(reachableTarget) < 0.012) break;

			for (const joint of chain) {
				joint.getWorldPosition(jointPos);
				bone.getWorldPosition(endPos);
				toEnd.subVectors(endPos, jointPos);
				toTarget.subVectors(reachableTarget, jointPos);
				if (toEnd.lengthSq() < 1e-8 || toTarget.lengthSq() < 1e-8) continue;

				toEnd.normalize();
				toTarget.normalize();
				deltaWorld.copy(stableDeltaFromUnitVectors(toEnd, toTarget, joint));

				const angle = 2 * Math.acos(THREE.MathUtils.clamp(deltaWorld.w, -1, 1));
				const stepLimit = isSpineLike(joint) ? 0.22 : 0.26;
				if (angle > stepLimit && angle > 1e-5) {
					deltaWorld.slerpQuaternions(new THREE.Quaternion(), deltaWorld.normalize(), stepLimit / angle);
				}

				applyWorldRotationDelta(joint, deltaWorld);
			}
		}

		restoreBindBoneOffsets();
		return true;
	}

	function createJointHandles(object) {
		if (jointGroup) scene.remove(jointGroup);
		jointGroup = new THREE.Group();
		jointHandles = [];

		const geometry = new THREE.SphereGeometry(0.045, 20, 14);
		const bones = collectDraggableBones(object);

		if (bones.length) {
			for (const bone of bones) {
				const handle = new THREE.Mesh(geometry, jointMaterial.clone());
				handle.userData.bone = bone;
				handle.userData.baseMaterial = handle.material;
				handle.renderOrder = 10;
				jointGroup.add(handle);
				jointHandles.push(handle);
			}

			scene.add(jointGroup);
			updateJointHandles();
			status = `Small visible joints mode - ${bones.length} draggable joints`;
			return;
		}

		for (const joint of fallbackJointPositions(object)) {
			const handle = new THREE.Mesh(geometry, jointMaterial.clone());
			handle.position.copy(joint.position);
			handle.userData.guideJoint = true;
			handle.userData.name = joint.name;
			handle.userData.baseMaterial = handle.material;
			handle.renderOrder = 10;
			jointGroup.add(handle);
			jointHandles.push(handle);
		}
		scene.add(jointGroup);
		status = `Visual guide joints only - this GLB has no skeleton (${jointHandles.length} markers)`;
	}

	function updateJointHandles() {
		for (const handle of jointHandles) {
			const bone = handle.userData.bone;
			if (!bone) continue;
			bone.getWorldPosition(handle.position);
		}
	}

	function figureMeshes() {
		const meshes = [];
		model?.traverse((child) => {
			if (child.isMesh) meshes.push(child);
		});
		return meshes;
	}

	function setPointerFromEvent(event) {
		const rect = renderer.domElement.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
	}

	function updateCameraOrbit() {
		const cosPitch = Math.cos(orbitPitch);
		camera.position.set(
			orbitTarget.x + Math.sin(orbitYaw) * cosPitch * orbitRadius,
			orbitTarget.y + Math.sin(orbitPitch) * orbitRadius,
			orbitTarget.z + Math.cos(orbitYaw) * cosPitch * orbitRadius
		);
		camera.lookAt(orbitTarget);
	}

	function rememberDragPointer(event) {
		lastDragPointer = {
			clientX: event.clientX,
			clientY: event.clientY,
			pointerId: event.pointerId,
			preventDefault: () => {}
		};
	}

	function pickJoint(event) {
		if (!jointHandles.length) return null;
		setPointerFromEvent(event);
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(jointHandles, false);
		return hits[0]?.object || null;
	}

	function pickFigure(event) {
		if (!model) return null;
		setPointerFromEvent(event);
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(figureMeshes(), true);
		return hits[0] || null;
	}

	function startJointDrag(event, handle) {
		if (handle.userData.guideJoint) {
			status = `${handle.userData.name} marker - this model is not rigged, so the marker cannot move the mesh`;
			return;
		}
		draggingJoint = handle;
		handle.material = selectedJointMaterial;
		const world = handle.position.clone();
		const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
		dragPlane.setFromNormalAndCoplanarPoint(normal, world);
		setPointerFromEvent(event);
		raycaster.setFromCamera(pointer, camera);
		if (raycaster.ray.intersectPlane(dragPlane, dragTarget)) {
			jointDragOffset.copy(world).sub(dragTarget);
		} else {
			jointDragOffset.set(0, 0, 0);
		}
		rememberDragPointer(event);
		try {
			renderer.domElement.setPointerCapture(event.pointerId);
		} catch (_) {}
		activePointerId = event.pointerId;
		const bone = handle.userData.bone;
		if (bone) {
			const chain = ikChainForBone(bone);
			if (chain.length) {
				const rootPos = new THREE.Vector3();
				const bonePos = new THREE.Vector3();
				chain[chain.length - 1].getWorldPosition(rootPos);
				bone.getWorldPosition(bonePos);
				const direction = bonePos.sub(rootPos);
				if (direction.lengthSq() > 1e-8) lastClampDirections.set(bone, direction.normalize());
			}
		}
		renderer.domElement.style.cursor = 'grabbing';
		status = `Dragging ${handle.userData.bone?.name || 'joint'}`;
	}

	function startFigureDrag(event, hit) {
		if (!model || !hit) return;
		draggingFigure = true;
		const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
		dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
		figureDragOffset.copy(model.position).sub(hit.point);
		rememberDragPointer(event);
		try {
			renderer.domElement.setPointerCapture(event.pointerId);
		} catch (_) {}
		activePointerId = event.pointerId;
		renderer.domElement.style.cursor = 'grabbing';
		status = 'Moving whole figure in 3D space';
	}

	function startCameraOrbit(event) {
		orbitingCamera = true;
		orbitPointer = { x: event.clientX, y: event.clientY };
		try {
			renderer.domElement.setPointerCapture(event.pointerId);
		} catch (_) {}
		activePointerId = event.pointerId;
		renderer.domElement.style.cursor = 'grabbing';
		status = 'Rotating camera around figure';
	}

	function moveDraggedJoint(event) {
		if (!draggingJoint) return;
		event.preventDefault();
		rememberDragPointer(event);
		const bone = draggingJoint.userData.bone;
		if (!bone?.parent) return;
		setPointerFromEvent(event);
		raycaster.setFromCamera(pointer, camera);
		if (!raycaster.ray.intersectPlane(dragPlane, dragTarget)) return;
		const currentJointPosition = new THREE.Vector3();
		bone.getWorldPosition(currentJointPosition);
		const requestedTarget = dragTarget.clone().add(jointDragOffset);
		solveBoneToTarget(bone, requestedTarget);
		const actualJointPosition = new THREE.Vector3();
		bone.getWorldPosition(actualJointPosition);
		jointDragOffset.copy(actualJointPosition).sub(dragTarget);
		updateJointHandles();
	}

	function moveDraggedFigure(event) {
		if (!draggingFigure || !model) return;
		event.preventDefault();
		rememberDragPointer(event);
		setPointerFromEvent(event);
		raycaster.setFromCamera(pointer, camera);
		if (!raycaster.ray.intersectPlane(dragPlane, dragTarget)) return;
		model.position.copy(dragTarget).add(figureDragOffset);
		model.updateMatrixWorld(true);
		updateJointHandles();
	}

	function moveCameraOrbit(event) {
		if (!orbitingCamera) return;
		event.preventDefault();
		const dx = event.clientX - orbitPointer.x;
		const dy = event.clientY - orbitPointer.y;
		orbitPointer = { x: event.clientX, y: event.clientY };
		orbitYaw -= dx * 0.006;
		orbitPitch = THREE.MathUtils.clamp(orbitPitch - dy * 0.005, MIN_ORBIT_PITCH, MAX_ORBIT_PITCH);
		updateCameraOrbit();
	}

	function stopJointDrag(event) {
		if (!draggingJoint) return;
		draggingJoint.material = draggingJoint.userData.baseMaterial;
		draggingJoint = null;
		try {
			if (renderer?.domElement?.hasPointerCapture(event.pointerId)) {
				renderer.domElement.releasePointerCapture(event.pointerId);
			}
		} catch (_) {}
		renderer.domElement.style.cursor = 'grab';
		activePointerId = null;
		lastDragPointer = null;
		status = `Small visible joints mode - ${jointHandles.length} draggable joints`;
	}

	function stopFigureDrag(event) {
		if (!draggingFigure) return;
		draggingFigure = false;
		try {
			if (renderer?.domElement?.hasPointerCapture(event.pointerId)) {
				renderer.domElement.releasePointerCapture(event.pointerId);
			}
		} catch (_) {}
		renderer.domElement.style.cursor = 'grab';
		activePointerId = null;
		lastDragPointer = null;
		status = `Small visible joints mode - ${jointHandles.length} draggable joints`;
	}

	function stopCameraOrbit(event) {
		if (!orbitingCamera) return;
		orbitingCamera = false;
		try {
			if (renderer?.domElement?.hasPointerCapture(event.pointerId)) {
				renderer.domElement.releasePointerCapture(event.pointerId);
			}
		} catch (_) {}
		renderer.domElement.style.cursor = 'grab';
		activePointerId = null;
		lastDragPointer = null;
		status = `Small visible joints mode - ${jointHandles.length} draggable joints`;
	}

	function fitModelToView(object) {
		const box = new THREE.Box3().setFromObject(object);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const maxSize = Math.max(size.x, size.y, size.z) || 1;
		const scale = 2.25 / maxSize;

		object.position.sub(center);
		object.scale.setScalar(scale);

		const scaledBox = new THREE.Box3().setFromObject(object);
		const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
		object.position.sub(scaledCenter);
	}

	function addLights() {
		scene.add(new THREE.AmbientLight(0xffffff, 0.45));
		scene.add(new THREE.HemisphereLight(0xffffff, 0xd9e2ef, 0.65));

		const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
		keyLight.position.set(2.5, 5.5, 3.5);
		keyLight.castShadow = true;
		keyLight.shadow.mapSize.set(2048, 2048);
		keyLight.shadow.camera.near = 0.1;
		keyLight.shadow.camera.far = 12;
		keyLight.shadow.camera.left = -3;
		keyLight.shadow.camera.right = 3;
		keyLight.shadow.camera.top = 3;
		keyLight.shadow.camera.bottom = -3;
		scene.add(keyLight);

		const rimLight = new THREE.DirectionalLight(0xb8c8ff, 0.25);
		rimLight.position.set(-3, 2.5, -4);
		scene.add(rimLight);
	}

	function addOriginalFigureEnvironment() {
		groundMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(6, 6),
			new THREE.MeshStandardMaterial({
				color: 0xe8edf3,
				roughness: 0.95,
				metalness: 0
			})
		);
		groundMesh.rotation.x = -Math.PI / 2;
		groundMesh.position.y = FLOOR_Y;
		groundMesh.receiveShadow = true;
		scene.add(groundMesh);
	}

	function resize() {
		if (!stage || !renderer || !camera) return;
		const width = stage.clientWidth;
		const height = stage.clientHeight;
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	function onPointerDown(event) {
		event.preventDefault();
		const joint = pickJoint(event);
		if (event.button === 2) {
			if (joint) twistJointClockwise(joint);
			return;
		}
		if (joint) {
			startJointDrag(event, joint);
			return;
		}
		const figureHit = pickFigure(event);
		if (figureHit) {
			startFigureDrag(event, figureHit);
			return;
		}
		startCameraOrbit(event);
	}

	function onPointerMove(event) {
		if (activePointerId != null && event.pointerId != null && event.pointerId !== activePointerId) return;
		if (draggingJoint) {
			moveDraggedJoint(event);
			return;
		}
		if (draggingFigure) {
			moveDraggedFigure(event);
			return;
		}
		if (orbitingCamera) {
			moveCameraOrbit(event);
			return;
		}
	}

	function onPointerUp(event) {
		if (activePointerId != null && event.pointerId != null && event.pointerId !== activePointerId) return;
		if (draggingJoint) {
			stopJointDrag(event);
			return;
		}
		if (draggingFigure) {
			stopFigureDrag(event);
			return;
		}
		if (orbitingCamera) {
			stopCameraOrbit(event);
			return;
		}
		if (renderer?.domElement?.hasPointerCapture(event.pointerId)) {
			renderer.domElement.releasePointerCapture(event.pointerId);
		}
	}

	function onPointerCancel(event) {
		onPointerUp(event);
	}

	function onContextMenu(event) {
		event.preventDefault();
	}

	function onWheel(event) {
		event.preventDefault();
		if (draggingJoint || draggingFigure) {
			const direction = Math.sign(event.deltaY);
			if (direction !== 0) {
				dragPlane.constant -= DRAG_DEPTH_STEP * direction;
				const replayEvent = {
					clientX: lastDragPointer?.clientX ?? event.clientX,
					clientY: lastDragPointer?.clientY ?? event.clientY,
					pointerId: activePointerId,
					preventDefault: () => {}
				};
				if (draggingJoint) moveDraggedJoint(replayEvent);
				if (draggingFigure) moveDraggedFigure(replayEvent);
			}
			return;
		}
		const zoomScale = Math.exp(event.deltaY * 0.001);
		orbitRadius = THREE.MathUtils.clamp(orbitRadius * zoomScale, MIN_ORBIT_RADIUS, MAX_ORBIT_RADIUS);
		updateCameraOrbit();
	}

	function onKeyDown(event) {
		if (!draggingJoint && !draggingFigure) return;
		if (event.code !== 'Space' && event.key?.toLowerCase?.() !== 'f') return;
		event.preventDefault();
		const direction = event.code === 'Space' ? -1 : 1;
		dragPlane.constant -= DRAG_DEPTH_STEP * direction;
		const replayEvent = {
			clientX: lastDragPointer?.clientX ?? 0,
			clientY: lastDragPointer?.clientY ?? 0,
			pointerId: activePointerId,
			preventDefault: () => {}
		};
		if (draggingJoint) moveDraggedJoint(replayEvent);
		if (draggingFigure) moveDraggedFigure(replayEvent);
	}

	function disposeObject(object) {
		object.traverse((child) => {
			if (child.geometry) child.geometry.dispose();
			if (child.material) {
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				for (const material of materials) material.dispose();
			}
		});
		for (const handle of jointHandles) {
			handle.geometry?.dispose();
			handle.material?.dispose();
		}
		jointHandles = [];
	}

	onMount(() => {
		try {
			navigator.serviceWorker?.getRegistrations?.().then((registrations) => {
				for (const registration of registrations) registration.unregister();
			});
			caches?.keys?.().then((keys) => {
				for (const key of keys) caches.delete(key);
			});
		} catch (_) {}

		scene = new THREE.Scene();
		scene.background = null;

		camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
		updateCameraOrbit();

		renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(0x000000, 0);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 0.9;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		stage.appendChild(renderer.domElement);

		addLights();
		addOriginalFigureEnvironment();

		let disposed = false;
		import('three/examples/jsm/loaders/GLTFLoader.js')
			.then(({ GLTFLoader }) => {
				if (disposed) return;
				const loader = new GLTFLoader();
				loader.load(
					characterUrl,
					(gltf) => {
						if (disposed) return;
						model = gltf.scene;
						prepareModelForDisplay(model);
						fitModelToView(model);
						captureBindPose(model);
						scene.add(model);
						createJointHandles(model);
					},
					undefined,
					(error) => {
						console.error(error);
						status = 'Could not load Meshy figure';
					}
				);
			})
			.catch((error) => {
				console.error(error);
				status = 'Could not load GLTF loader';
			});

		resize();

		const canvas = renderer.domElement;
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('contextmenu', onContextMenu);
		canvas.addEventListener('wheel', onWheel, { passive: false });
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerCancel);
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('resize', resize);

		const render = () => {
			frameId = requestAnimationFrame(render);
			updateJointHandles();
			renderer.render(scene, camera);
		};
		render();

		return () => {
			disposed = true;
			cancelAnimationFrame(frameId);
			window.removeEventListener('resize', resize);
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('contextmenu', onContextMenu);
			canvas.removeEventListener('wheel', onWheel);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerCancel);
			window.removeEventListener('keydown', onKeyDown);
			if (model) disposeObject(model);
			renderer.dispose();
			stage?.removeChild(canvas);
		};
	});
</script>

<svelte:head>
	<title>FightLab 3D Rig Test</title>
</svelte:head>

<main class="rig-test">
	<div class="toolbar">
		<a class="back-link" href="/fightlab3d/figures">Figures</a>
		<div class="title-group">
			<h1>Meshy Figure Test</h1>
			<p>{status}</p>
		</div>
	</div>

	<div class="viewport" bind:this={stage}></div>
</main>

<style>
	:global(body) {
		margin: 0;
		background: radial-gradient(circle at 50% 30%, #e0e7ff 0%, #f8fafc 60%, #ffffff 100%);
	}

	.rig-test {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: #0f172a;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}

	.rig-test::before {
		content: "";
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background: linear-gradient(
			315deg,
			rgba(105, 165, 255, 0.38) 0%,
			rgba(228, 235, 246, 0.82) 55%,
			#ffffff 100%
		);
	}

	.viewport {
		position: relative;
		z-index: 1;
		width: 100vw;
		height: 100vh;
		touch-action: none;
	}

	.viewport :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
	}

	.viewport :global(canvas:active) {
		cursor: grabbing;
	}

	.toolbar {
		position: absolute;
		z-index: 3;
		top: 18px;
		left: 18px;
		display: flex;
		align-items: center;
		gap: 14px;
		pointer-events: none;
	}

	.back-link,
	.title-group {
		border: 1px solid rgba(212, 228, 255, 0.9);
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.86);
		backdrop-filter: blur(12px);
		box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
		pointer-events: auto;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		height: 36px;
		padding: 0 13px;
		color: #0f172a;
		font-size: 13px;
		text-decoration: none;
	}

	.back-link:hover {
		border-color: rgba(147, 197, 253, 0.95);
		background: rgba(248, 250, 252, 0.94);
	}

	.title-group {
		min-width: 0;
		padding: 7px 12px;
	}

	h1,
	p {
		margin: 0;
		letter-spacing: 0;
	}

	h1 {
		font-size: 14px;
		font-weight: 700;
		line-height: 1.1;
	}

	p {
		margin-top: 3px;
		color: #475569;
		font-size: 12px;
		line-height: 1.2;
	}

	@media (max-width: 620px) {
		.toolbar {
			top: 12px;
			left: 12px;
			right: 12px;
			align-items: flex-start;
			flex-wrap: wrap;
		}
	}
</style>

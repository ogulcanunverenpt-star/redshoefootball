import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

const gltfLoader = new GLTFLoader();
let cachedGltf: { scene: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

export class Player extends THREE.Group {
  team: number;
  username: string;
  nameTagElement: HTMLDivElement;

  mixer: THREE.AnimationMixer | null = null;
  actions: { [key: string]: THREE.AnimationAction } = {};
  currentAction: THREE.AnimationAction | null = null;

  head: THREE.Object3D;
  body: THREE.Object3D;
  leftLeg: THREE.Object3D | null = null;
  rightLeg: THREE.Object3D | null = null;

  isKicking = false;
  kickTimer = 0;

  constructor(team: number, username: string = "Player") {
    super();
    this.team = team;
    this.username = username;

    // Create 3D HTML Name Tag element above player head
    this.nameTagElement = document.createElement("div");
    this.nameTagElement.className = "player-nametag";
    this.nameTagElement.textContent = username;
    this.nameTagElement.style.cssText = `
      position: absolute;
      transform: translate(-50%, -100%);
      color: #ffffff;
      background: rgba(0, 0, 0, 0.7);
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-family: 'Inter', sans-serif;
      font-weight: bold;
      pointer-events: none;
      white-space: nowrap;
      transition: color 0.15s, border-color 0.15s, box-shadow 0.15s;
      z-index: 1500;
      border: 2px solid transparent;
    `;
    document.body.appendChild(this.nameTagElement);

    // Create procedural fallback character
    const fallbackGroup = this.createProceduralRiggedPlayer(team);
    this.head = fallbackGroup.getObjectByName("head") || fallbackGroup;
    this.body = fallbackGroup.getObjectByName("body") || fallbackGroup;
    this.add(fallbackGroup);

    // Load single gdbot.glb model for all players
    const loadGDbotModel = (gltfData: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => {
      this.remove(fallbackGroup);

      // Clone skeleton & scene so each player moves independently
      const clonedScene = SkeletonUtils.clone(gltfData.scene) as THREE.Group;
      clonedScene.scale.set(0.85, 0.85, 0.85);
      clonedScene.position.y = 0;

      // Tint materials based on Team Color (Team 0: Red, Team 1: Blue)
      const teamColor = team === 0 ? 0xff1122 : 0x0055ff;
      clonedScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          if (mesh.material) {
            mesh.material = (mesh.material as THREE.Material).clone();
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat.color) {
              mat.color.setHex(teamColor);
            }
          }
        }
      });

      this.add(clonedScene);

      // Setup Animation Mixer & Actions from gdbot.glb clips ('Idle', 'run', 'jump', 'simple_punch')
      if (gltfData.animations && gltfData.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(clonedScene);

        gltfData.animations.forEach((clip) => {
          if (this.mixer) {
            const name = clip.name.toLowerCase();
            this.actions[name] = this.mixer.clipAction(clip);
          }
        });

        // Set default idle
        const idleAction = this.actions["idle"] || Object.values(this.actions)[0];
        if (idleAction) {
          idleAction.play();
          this.currentAction = idleAction;
        }
      }
    };

    if (cachedGltf) {
      loadGDbotModel(cachedGltf);
    } else {
      const gdbotUrl = window.location.origin + "/gdbot.glb";
      gltfLoader.load(
        gdbotUrl,
        (gltf) => {
          console.log("gdbot.glb 3D model loaded successfully from:", gdbotUrl);
          cachedGltf = { scene: gltf.scene, animations: gltf.animations };
          loadGDbotModel(cachedGltf);
        },
        undefined,
        (err) => {
          console.warn("gdbot.glb load fallback, trying relative path gdbot.glb:", err);
          gltfLoader.load("gdbot.glb", (gltf) => {
            cachedGltf = { scene: gltf.scene, animations: gltf.animations };
            loadGDbotModel(cachedGltf);
          });
        }
      );
    }
  }

  setSpeaking(isSpeaking: boolean) {
    if (this.nameTagElement) {
      this.nameTagElement.style.color = isSpeaking ? "#00ff9b" : "#ffffff";
      this.nameTagElement.style.borderColor = isSpeaking ? "#00ff9b" : "transparent";
      this.nameTagElement.style.borderWidth = isSpeaking ? "2px" : "0px";
      this.nameTagElement.style.borderStyle = "solid";
      if (isSpeaking) {
        this.nameTagElement.style.boxShadow = "0 0 15px #00ff9b";
        this.nameTagElement.innerHTML = `🎤 ${escapeHtml(this.username)}`;
      } else {
        this.nameTagElement.style.boxShadow = "none";
        this.nameTagElement.innerHTML = escapeHtml(this.username);
      }
    }
  }

  updateNameTagPosition(camera: THREE.PerspectiveCamera) {
    if (!this.nameTagElement) return;
    const tempVector = new THREE.Vector3();
    this.getWorldPosition(tempVector);
    tempVector.y += 2.3; // Above head

    tempVector.project(camera);

    const x = (tempVector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(tempVector.y * 0.5) + 0.5) * window.innerHeight;

    if (tempVector.z < 1) {
      this.nameTagElement.style.display = "block";
      this.nameTagElement.style.left = `${x}px`;
      this.nameTagElement.style.top = `${y}px`;
    } else {
      this.nameTagElement.style.display = "none";
    }
  }

  dispose() {
    if (this.nameTagElement && this.nameTagElement.parentNode) {
      this.nameTagElement.parentNode.removeChild(this.nameTagElement);
    }
  }

  createProceduralRiggedPlayer(team: number): THREE.Group {
    const group = new THREE.Group();
    const teamColor = team === 0 ? 0xff0022 : 0x0044ff;
    const mat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: team === 0 ? 0x220000 : 0x000033, roughness: 0.6 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd2a17f, roughness: 0.8 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });

    const headGeo = new THREE.BoxGeometry(0.42, 0.45, 0.42);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.name = "head";
    head.position.y = 1.65;
    group.add(head);

    const bodyGeo = new THREE.BoxGeometry(0.85, 0.8, 0.45);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.name = "body";
    body.position.y = 1.0;
    group.add(body);

    const shortsGeo = new THREE.BoxGeometry(0.85, 0.35, 0.46);
    const shorts = new THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.55;
    group.add(shorts);

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.25, 0.5, 0);
    const leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.65, 0.24), skinMat);
    leftLegMesh.position.y = -0.32;
    leftLegGroup.add(leftLegMesh);

    const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.15, 0.38), bootMat);
    leftBoot.position.set(0, -0.6, 0.08);
    leftLegGroup.add(leftBoot);

    group.add(leftLegGroup);
    this.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.25, 0.5, 0);
    const rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.65, 0.24), skinMat);
    rightLegMesh.position.y = -0.32;
    rightLegGroup.add(rightLegMesh);

    const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.15, 0.38), bootMat);
    rightBoot.position.set(0, -0.6, 0.08);
    rightLegGroup.add(rightBoot);

    group.add(rightLegGroup);
    this.rightLeg = rightLegGroup;

    return group;
  }

  playKickAnimation() {
    this.isKicking = true;
    this.kickTimer = 0;

    const kickAction = this.actions["simple_punch"] || this.actions["kick"] || this.actions["shoot"];
    if (kickAction && this.mixer) {
      if (this.currentAction) this.currentAction.stop();
      kickAction.reset().setLoop(THREE.LoopOnce, 1).play();
      this.currentAction = kickAction;
    }
  }

  playPassAnimation() {
    this.playKickAnimation();
  }

  switchAction(newAction: THREE.AnimationAction | null) {
    if (!newAction || this.currentAction === newAction) return;
    if (this.currentAction) this.currentAction.fadeOut(0.15);
    newAction.reset().fadeIn(0.15).play();
    this.currentAction = newAction;
  }

  updateAnimation(delta: number, isMoving: boolean) {
    if (this.mixer) {
      this.mixer.update(delta);

      if (!this.isKicking) {
        const runAction = this.actions["run"] || this.actions["walk"];
        const idleAction = this.actions["idle"];

        if (isMoving && runAction) {
          this.switchAction(runAction);
        } else if (!isMoving && idleAction) {
          this.switchAction(idleAction);
        }
      }
    }

    if (this.isKicking) {
      this.kickTimer += delta * 14;
      const kickPhase = Math.sin(this.kickTimer);
      const kickAngle = kickPhase > 0 ? -kickPhase * 1.5 : kickPhase * 0.5;
      if (this.rightLeg) {
        this.rightLeg.rotation.x = kickAngle;
      }

      if (this.kickTimer >= Math.PI) {
        this.isKicking = false;
        if (this.rightLeg) this.rightLeg.rotation.x = 0;
      }
    } else if (isMoving && this.leftLeg && this.rightLeg) {
      const runCycle = Math.sin(Date.now() * 0.01) * 0.6;
      this.leftLeg.rotation.x = runCycle;
      this.rightLeg.rotation.x = -runCycle;
    } else if (this.leftLeg && this.rightLeg) {
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
    }
  }
}

function escapeHtml(str: string) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

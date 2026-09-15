import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls";
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { Ball } from "./ball";
import { Quaternion } from "./main";
import { CustomMap } from "./map";
import { Player } from "./player";

export type Position = { x: number; y: number; z: number };

export type Players = {
  [key: string]: { position: Position; looking: Quaternion; team: number };
};

export class Game {
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  cssRenderer: CSS3DRenderer | null = null;
  cssObject: CSS3DObject | null = null;

  camera: THREE.PerspectiveCamera;
  controls: PointerLockControls;
  ball = new Ball();
  trajectoryLine: THREE.Line | null = null;

  id: string;
  players: Players;
  map: CustomMap;
  playerObjects: { [key: string]: Player } = {};

  constructor(
    id: string,
    players: Players,
    setRotation: (rotation: Quaternion) => void
  ) {
    this.id = id;
    this.players = players;

    Object.entries(players).forEach(([id, { position, team }]) => {
      this.playerJoined(id, position, team);
    });

    this.map = new CustomMap({ x: 0, y: 0, z: 0 });

    this.camera = new THREE.PerspectiveCamera(
      90,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    this.controls = new PointerLockControls(this.camera, document.body);

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Setup CSS3DRenderer Billboard for mynet.com iframe
    this.setupCSS3DBillboard();

    this.controls.addEventListener("change", () => {
      setRotation({
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z,
        w: this.camera.quaternion.w,
      });
    });

    const loader = new THREE.TextureLoader();
    loader.load("sky_image.jpeg", (texture) => {
      const rt = new THREE.WebGLCubeRenderTarget(texture.image.height);
      rt.fromEquirectangularTexture(this.renderer, texture);
      this.scene.background = rt.texture;
    });

    this.scene.add(this.map);
    this.ball.position.set(0, 2, 0);
    this.scene.add(this.ball);

    // Create 3D Trajectory Line above ball for power charging
    this.createTrajectoryLine();

    this.animate();
  }

  setupCSS3DBillboard() {
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight);
    this.cssRenderer.domElement.style.position = "absolute";
    this.cssRenderer.domElement.style.top = "0";
    this.cssRenderer.domElement.style.left = "0";
    this.cssRenderer.domElement.style.pointerEvents.toString();
    document.body.appendChild(this.cssRenderer.domElement);

    // 4 Billboards surrounding the field (talk-to-me & mynet)
    const billboardConfigs = [
      { x: 0, y: 6, z: -23, ry: 0, url: "http://siir.me/kayip-cocuk" },          // Back (Arkası) -> talk-to-me app
      { x: 0, y: 6, z: 23, ry: Math.PI, url: "https://packetstorm.news/files/author/14973" },  // Front (Önü)
      { x: 17, y: 6, z: 0, ry: -Math.PI / 2, url: "http://127.0.0.1:3004" },// Right (Sağı) -> talk-to-me app
      { x: -17, y: 6, z: 0, ry: Math.PI / 2, url: "https://patrontv56.cfd/ch.html?id=patron" } // Left (Solu)
    ];

    billboardConfigs.forEach((config) => {
      const iframe = document.createElement("iframe");
      iframe.src = config.url;
      iframe.style.width = "900px";
      iframe.style.height = "500px";
      iframe.style.border = "4px solid #00ff9b";
      iframe.style.borderRadius = "12px";
      iframe.style.backgroundColor = "#0b0f19";

      const cssObj = new CSS3DObject(iframe);
      cssObj.position.set(config.x, config.y, config.z);
      cssObj.rotation.y = config.ry;
      cssObj.scale.set(0.016, 0.016, 0.016);
      this.scene.add(cssObj);
    });
  }

  createTrajectoryLine() {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) points.push(new THREE.Vector3(0, 0, 0));

    const curveGeo = new THREE.BufferGeometry().setFromPoints(points);
    const curveMat = new THREE.LineDashedMaterial({
      color: 0xffff00,
      linewidth: 3,
      scale: 1,
      dashSize: 0.4,
      gapSize: 0.2,
    });

    this.trajectoryLine = new THREE.Line(curveGeo, curveMat);
    this.trajectoryLine.visible = false;
    this.scene.add(this.trajectoryLine);
  }

  updateTrajectoryLine(
    actionType: string,
    power: number,
    _curveX: number,
    _curveY: number
  ) {
    if (!this.trajectoryLine || power <= 0) {
      if (this.trajectoryLine) this.trajectoryLine.visible = false;
      return;
    }

    const normPower = power / 100;
    const points = this.trajectoryLine.geometry.attributes.position.array as Float32Array;
    const numPoints = 20;

    let speed = 10 + normPower * 18;
    let upSpeed = 2 + normPower * 4;

    if (actionType === "cross") {
      speed = 10 + normPower * 12;
      upSpeed = 6 + normPower * 8;
    } else if (actionType === "tap") {
      speed = 5 + normPower * 6;
      upSpeed = 1.0;
    } else if (actionType === "through_pass") {
      speed = 8 + normPower * 12;
      upSpeed = 0.5;
    }

    // Direction vector facing exact First Person camera look direction
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();

    let vx = direction.x * speed;
    let vy = upSpeed;
    let vz = direction.z * speed;
    let px = this.ball.position.x;
    let py = this.ball.position.y + 0.35;
    let pz = this.ball.position.z;

    const dt = 0.08;
    const gravity = -10;

    for (let i = 0; i < numPoints; i++) {
      points[i * 3] = px;
      points[i * 3 + 1] = Math.max(py, 0.1);
      points[i * 3 + 2] = pz;

      vy += gravity * dt;
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
    }

    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
    this.trajectoryLine.computeLineDistances();
    this.trajectoryLine.visible = true;
  }

  hideTrajectoryLine() {
    if (this.trajectoryLine) this.trajectoryLine.visible = false;
  }

  playerJoined = (id: string, { x, y, z }: Position, team: number, username: string = "Player") => {
    if (id !== this.id) {
      const player = new Player(team, username);
      player.position.set(x, y, z);
      this.scene.add(player);
      this.playerObjects[id] = player;
    }
  };

  playerLeft = (id: string) => {
    if (this.playerObjects[id]) {
      this.playerObjects[id].dispose();
      this.scene.remove(this.playerObjects[id]);
      delete this.playerObjects[id];
    }
  };

  setPlayerSpeaking = (id: string, isSpeaking: boolean) => {
    if (this.playerObjects[id]) {
      this.playerObjects[id].setSpeaking(isSpeaking);
    }
  };

  playAction = (id: string, actionType: string) => {
    if (this.playerObjects[id]) {
      if (actionType === "boot" || actionType === "cross") {
        this.playerObjects[id].playKickAnimation();
      } else if (actionType === "tap" || actionType === "through_pass") {
        this.playerObjects[id].playPassAnimation();
      }
    }
  };

  tick = (
    players: Players,
    ball: {
      position: Position;
      attached: null | { id: string; offset: Position };
    }
  ) => {
    const delta = 0.016;

    Object.entries(players).forEach(([id, data]: [string, any]) => {
      const { position, looking, username } = data;
      const q = new THREE.Quaternion(looking.x, looking.y, looking.z, looking.w);

      if (id === this.id) {
        this.camera.position.set(position.x, position.y + 1.8, position.z);
        this.camera.quaternion.copy(q);
      } else {
        if (!this.playerObjects[id]) {
          this.playerJoined(id, position, 0, username || "Player");
        }
        const prevPos = this.playerObjects[id].position.clone();
        this.playerObjects[id].position.set(position.x, position.y, position.z);

        const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
        this.playerObjects[id].rotation.y = euler.y + Math.PI;

        const distMoved = prevPos.distanceTo(this.playerObjects[id].position);
        const isMoving = distMoved > 0.01;
        this.playerObjects[id].updateAnimation(delta, isMoving);
      }
    });

    // Update name tags above player heads
    Object.values(this.playerObjects).forEach((player) => {
      player.updateNameTagPosition(this.camera);
    });

    this.ball.position.set(ball.position.x, ball.position.y, ball.position.z);
  };

  animate = () => {
    requestAnimationFrame(this.animate);

    this.map.animate(this.players[this.id] ? this.players[this.id].position : { x: 0, y: 0, z: 0 });

    this.renderer.render(this.scene, this.camera);
    if (this.cssRenderer) {
      this.cssRenderer.render(this.scene, this.camera);
    }
  };
}

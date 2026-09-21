import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Crowd } from "./crowd";
import { Position } from "./game";
import { Goal } from "./goal";
import { Grass } from "./grass";

const gltfLoader = new GLTFLoader();

export class CustomMap extends THREE.Scene {
  grasses: Grass[] = [];

  constructor(position: Position) {
    super();

    // Balanced Lighting
    const light1 = new THREE.DirectionalLight(0xffffff, 1.8);
    light1.position.set(20, 40, 20);
    this.add(light1);

    const light2 = new THREE.AmbientLight(0xffffff, 0.8);
    this.add(light2);

    // Load Low-Poly Stadium GLB
    const stadiumPaths = ["/stadium.glb", "/mini_stadium.glb", "stadium.glb", "mini_stadium.glb"];
    const loadStadium = (index: number) => {
      if (index >= stadiumPaths.length) return;
      const path = stadiumPaths[index];
      gltfLoader.load(
        path,
        (gltf) => {
          const stadium = gltf.scene;
          stadium.scale.set(3, 3, 3);
          stadium.position.set(0, -1.8, 0);

          stadium.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.receiveShadow = true;
              mesh.castShadow = true;

              if (mesh.material) {
                const mat = mesh.material as THREE.MeshStandardMaterial;
                if (mat.color && mat.color.r > 0.98 && mat.color.g > 0.98 && mat.color.b > 0.98) {
                  mat.color.setHex(0x3a4f66);
                }
                mat.roughness = 0.7;
                mat.metalness = 0.2;
              }
            }
          });

          this.add(stadium);
          console.log(`Loaded ${path} successfully at position Y = -1.8`);
        },
        undefined,
        () => {
          loadStadium(index + 1);
        }
      );
    };

    loadStadium(0);

    const planeGeometry = new THREE.PlaneGeometry(40, 50);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x2e7d32,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    const rotation = new THREE.Vector3(-Math.PI / 2, 0, 0);
    plane.rotation.setFromVector3(rotation);
    this.add(plane);

    const sideAGeometry = new THREE.PlaneGeometry(11.25, 2.5);
    const redMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      side: THREE.DoubleSide,
    });
    const blueMaterial = new THREE.MeshBasicMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide,
    });
    const side1a = new THREE.Mesh(sideAGeometry, redMaterial);
    const side2a = new THREE.Mesh(sideAGeometry, blueMaterial);
    side1a.position.z = 20;
    side1a.position.x = -9.375;
    side2a.position.z = -20;
    side2a.position.x = 9.375;
    this.add(side1a);
    this.add(side2a);
    const side1b = new THREE.Mesh(sideAGeometry, redMaterial);
    const side2b = new THREE.Mesh(sideAGeometry, blueMaterial);
    side1b.position.z = 20;
    side1b.position.x = 9.375;
    side2b.position.z = -20;
    side2b.position.x = -9.375;
    this.add(side1b);
    this.add(side2b);

    const sideBGeometry = new THREE.PlaneGeometry(40, 2.5);
    const sideBMaterial = new THREE.MeshBasicMaterial({
      color: 0x606060,
      side: THREE.DoubleSide,
    });
    const sideBRotation = new THREE.Vector3(0, Math.PI / 2, 0);
    const side3 = new THREE.Mesh(sideBGeometry, sideBMaterial);
    const side4 = new THREE.Mesh(sideBGeometry, sideBMaterial);
    side3.rotation.setFromVector3(sideBRotation);
    side3.position.x = 15;
    side4.rotation.setFromVector3(sideBRotation);
    side4.position.x = -15;
    this.add(side3);
    this.add(side4);
    const side5 = new THREE.Mesh(sideBGeometry, redMaterial);
    const side6 = new THREE.Mesh(sideBGeometry, blueMaterial);
    side5.rotation.setFromVector3(sideBRotation);
    side5.position.x = 15;
    side6.rotation.setFromVector3(sideBRotation);
    side6.position.x = -15;
    this.add(side5);
    this.add(side6);

    const goal1 = new Goal();
    goal1.position.z = 20;
    const goal1Rotation = new THREE.Vector3(0, Math.PI, 0);
    goal1.rotation.setFromVector3(goal1Rotation);
    this.add(goal1);

    const goal2 = new Goal();
    goal2.position.z = -20;
    this.add(goal2);

    var loader = new THREE.TextureLoader();
    loader.load("PITCH.png", (texture) => {
      var geometry = new THREE.PlaneGeometry(30, 40);

      var material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        map: texture,
        transparent: true,
      });
      var lines = new THREE.Mesh(geometry, material);
      lines.rotation.setFromVector3(rotation);
      lines.position.y = 0.05;
      this.add(lines);
    });

    this.add(new Crowd());

    // GRASS
    const X_SEGMENTS = 20;
    const Z_SEGMENTS = 20;

    const xWidth = 30 / X_SEGMENTS;
    const zWidth = 40 / Z_SEGMENTS;

    const clock = new THREE.Clock();

    for (let x = -15 + xWidth / 2; x <= 15 - xWidth / 2; x += xWidth) {
      for (let z = -22 + zWidth / 2; z <= 22 - zWidth / 2; z += zWidth) {
        const distance = Math.hypot(position.x - x, position.z - z);
        const density = 10000 / (Math.pow(distance, 2) + 10) + 5;
        const grass = new Grass(xWidth, zWidth, density, clock);
        grass.position.x = x;
        grass.position.z = z;
        this.grasses.push(grass);
        this.add(grass);
      }
    }
  }

  animate = (position: Position) => {
    this.grasses.forEach((grass) => {
      grass.animate(position);
    });
  };
}

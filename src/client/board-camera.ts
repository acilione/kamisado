import { PerspectiveCamera, Vector3 } from 'three';

/** Fit the physical board and tallest towers into the initial view, with a small margin. */
export function frameBoardCamera(camera: PerspectiveCamera): void {
    const direction = new Vector3(0, 13, 8).normalize();
    const target = new Vector3(0, 0.2, 0);
    const vertical = Math.tan(camera.fov * Math.PI / 360) * 0.94;
    const horizontal = vertical * camera.aspect;
    let distance = 10;
    for (const x of [-4.5, 4.5]) for (const z of [-4.5, 4.5]) for (const y of [-0.15, 1.25]) {
        const elevation = y - target.y;
        const depth = elevation * direction.y + z * direction.z;
        const screenY = elevation * direction.z - z * direction.y;
        distance = Math.max(distance, depth + Math.abs(x) / horizontal, depth + Math.abs(screenY) / vertical);
    }
    camera.position.copy(direction).multiplyScalar(distance).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
}

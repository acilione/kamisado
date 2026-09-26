import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js' with { 'resolution-mode': 'import' };
import { BOARD_COLORS } from '../shared/constants.js';
import type { GameState, Piece, PieceColor, PlayerColor } from '../shared/types.js';
import { REALISTIC_COLORS, COLOR_CHARACTERS, COLOR_CHARACTER_PATHS, CHARACTER_VIEWBOX } from './realistic-art.js';

export interface RealisticBoardOptions {
    state: GameState;
    viewAsBlack: boolean;
    symbolMode: boolean;
    selected: { r: number; c: number } | null;
    canInteract: boolean;
    playerColor: PlayerColor | null;
}

type Cell = { r: number; c: number };

/** An on-demand WebGL view of the same authoritative board used by the 2D UI. */
export class RealisticBoard3D {
    private readonly scene = new THREE.Scene();
    private readonly board = new THREE.Group();
    private readonly pieces = new THREE.Group();
    private readonly markers = new THREE.Group();
    private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    private readonly renderer: THREE.WebGLRenderer;
    private observer: ResizeObserver | null = null;
    private controls: OrbitControls | null = null;
    private readonly tiles: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[][] = [];
    private readonly textures = new Map<string, THREE.CanvasTexture>();
    private readonly materials = new Map<string, THREE.Material>();
    private readonly geometries = new Map<string, THREE.BufferGeometry>();
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly activePointers = new Set<number>();
    private pointerStart: { id: number; x: number; y: number } | null = null;
    private dragged = false;
    private hovered: Cell | null = null;
    private keyboardCell: Cell = { r: 7, c: 0 };
    private options: RealisticBoardOptions | null = null;
    private boardSignature = '';
    private frame = 0;
    private disposed = false;
    private failed = false;
    private readonly hoverOutline: THREE.LineLoop;

    constructor(
        private readonly container: HTMLElement,
        private readonly onCellClick: (r: number, c: number) => void,
        private readonly onFailure: () => void,
    ) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        try {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 0.85;
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            const canvas = this.renderer.domElement;
            canvas.className = 'realistic-board-canvas';
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.touchAction = 'none';
            canvas.tabIndex = 0;
            canvas.setAttribute('role', 'application');
            canvas.setAttribute('aria-label', '3D Kamisado board. Drag to rotate, scroll to zoom. Use arrow keys to choose a square and Enter to select or move.');
            canvas.addEventListener('pointerdown', this.pointerDown);
            canvas.addEventListener('pointermove', this.pointerMove);
            canvas.addEventListener('pointerup', this.pointerUp);
            canvas.addEventListener('pointercancel', this.pointerCancel);
            canvas.addEventListener('pointerleave', this.pointerLeave);
            canvas.addEventListener('keydown', this.keyDown);
            canvas.addEventListener('blur', this.blur);
            canvas.addEventListener('webglcontextlost', this.contextLost);
            this.container.appendChild(canvas);
            this.scene.add(this.board);
            this.board.add(this.pieces, this.markers);
            this.buildEnvironment();
            this.buildBoard();
            this.hoverOutline = this.makeOutline('#fff4d5', 0.7);
            this.hoverOutline.visible = false;
            this.board.add(this.hoverOutline);
            this.resetCamera();
            this.observer = new ResizeObserver(this.resize);
            this.observer.observe(container);
            this.resize();
            // The application emits CommonJS for Node, while esbuild bundles this ESM addon for the browser.
            void import('three/addons/controls/OrbitControls.js').then(({ OrbitControls }) => {
                if (this.disposed || this.failed) return;
                this.controls = new OrbitControls(this.camera, canvas);
                this.controls.target.set(0, 0.2, 0);
                this.controls.enablePan = false;
                this.controls.enableDamping = false;
                this.controls.minDistance = 10;
                this.controls.maxDistance = 24;
                this.controls.minPolarAngle = 0.08;
                this.controls.maxPolarAngle = Math.PI * 0.36;
                this.controls.rotateSpeed = 0.55;
                this.controls.zoomSpeed = 0.8;
                this.controls.addEventListener('change', this.requestRender);
                this.controls.update();
                this.requestRender();
            }).catch(this.fail);
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    update(options: RealisticBoardOptions): void {
        if (this.disposed || this.failed) return;
        const orientationChanged = this.options?.viewAsBlack !== options.viewAsBlack;
        this.options = options;
        this.board.rotation.y = options.viewAsBlack ? Math.PI : 0;
        if (orientationChanged) {
            this.keyboardCell = { r: options.viewAsBlack ? 0 : 7, c: options.viewAsBlack ? 7 : 0 };
            this.hovered = null;
            this.hoverOutline.visible = false;
        }
        const signature = JSON.stringify([
            options.state.board, options.state.turn, options.state.requiredColor,
            options.symbolMode, options.selected, options.canInteract, options.playerColor,
        ]);
        if (signature !== this.boardSignature) {
            this.boardSignature = signature;
            this.pieces.clear();
            this.markers.clear();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const piece = options.state.board[r][c];
                    this.tiles[r][c].material.map = this.tileTexture(BOARD_COLORS[r][c], options.symbolMode);
                    this.tiles[r][c].material.needsUpdate = true;
                    if (piece) {
                        const tower = this.makeTower(piece);
                        tower.position.set(c - 3.5, 0.25, r - 3.5);
                        tower.userData.cell = { r, c };
                        this.pieces.add(tower);
                        if (options.canInteract && piece.player === options.playerColor &&
                            (!options.state.requiredColor || piece.color === options.state.requiredColor)) {
                            const ring = new THREE.Mesh(
                                this.geometry('playable-ring', () => new THREE.TorusGeometry(0.398, 0.012, 6, 48)),
                                this.basicMaterial('playable-ring', '#f7e5ac'),
                            );
                            ring.rotation.x = -Math.PI / 2;
                            ring.position.set(c - 3.5, 0.249, r - 3.5);
                            this.markers.add(ring);
                        }
                    }
                }
            }
            if (options.selected) {
                const marker = this.makeOutline('#ffe6a0', 1);
                marker.position.set(options.selected.c - 3.5, 0.251, options.selected.r - 3.5);
                this.markers.add(marker);
            }
        }
        this.renderer.domElement.style.cursor = options.canInteract ? 'pointer' : 'grab';
        this.resize();
    }

    resetCamera(): void {
        this.camera.position.set(0, 10.8, 11.8);
        this.camera.lookAt(0, 0.2, 0);
        this.controls?.target.set(0, 0.2, 0);
        this.controls?.update();
        this.requestRender();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.observer?.disconnect();
        this.controls?.removeEventListener('change', this.requestRender);
        this.controls?.dispose();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this.pointerDown);
        canvas.removeEventListener('pointermove', this.pointerMove);
        canvas.removeEventListener('pointerup', this.pointerUp);
        canvas.removeEventListener('pointercancel', this.pointerCancel);
        canvas.removeEventListener('pointerleave', this.pointerLeave);
        canvas.removeEventListener('keydown', this.keyDown);
        canvas.removeEventListener('blur', this.blur);
        canvas.removeEventListener('webglcontextlost', this.contextLost);
        this.scene.traverse(object => {
            if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) object.shadow.dispose();
        });
        this.geometries.forEach(geometry => geometry.dispose());
        this.materials.forEach(material => material.dispose());
        this.textures.forEach(texture => texture.dispose());
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        canvas.remove();
    }

    private geometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
        if (!this.geometries.has(key)) this.geometries.set(key, create());
        return this.geometries.get(key) as T;
    }

    private material(key: string, options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
        if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial(options));
        return this.materials.get(key) as THREE.MeshStandardMaterial;
    }

    private basicMaterial(key: string, color: string): THREE.MeshBasicMaterial {
        if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshBasicMaterial({ color }));
        return this.materials.get(key) as THREE.MeshBasicMaterial;
    }

    private texture(key: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
        const cached = this.textures.get(key);
        if (cached) return cached;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas textures are unavailable');
        paint(ctx);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.textures.set(key, texture);
        return texture;
    }

    private buildEnvironment(): void {
        this.scene.add(new THREE.HemisphereLight('#f1e9dd', '#554839', 1.3));
        const key = new THREE.DirectionalLight('#fff4de', 2);
        key.position.set(-5, 11, 6);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 30 });
        key.shadow.normalBias = 0.025;
        key.shadow.bias = -0.0001;
        this.scene.add(key);
        const fill = new THREE.DirectionalLight('#dce8f9', 0.5);
        fill.position.set(5, 6, -4);
        this.scene.add(fill);
        const wood = this.texture('wood', 512, 512, ctx => {
            ctx.fillStyle = '#3d2c23';
            ctx.fillRect(0, 0, 512, 512);
            for (let y = 0; y < 512; y++) {
                const shade = Math.sin(y * 0.29) * Math.sin(y * 0.013) * 0.025 + 0.035;
                ctx.strokeStyle = `rgba(25, 12, 6, ${shade})`;
                ctx.beginPath();
                for (let x = 0; x <= 512; x += 8) {
                    const offset = Math.sin(x * 0.012 + y * 0.04) * 3 + Math.sin(x * 0.027) * 1.8;
                    if (x === 0) ctx.moveTo(x, y + offset); else ctx.lineTo(x, y + offset);
                }
                ctx.stroke();
            }
        });
        wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
        wood.repeat.set(5, 5);
        const table = new THREE.Mesh(
            this.geometry('table', () => new THREE.PlaneGeometry(100, 100)),
            this.material('table', { map: wood, roughness: 0.94 }),
        );
        table.rotation.x = -Math.PI / 2;
        table.position.y = -0.13;
        table.receiveShadow = true;
        this.scene.add(table);
        this.scene.fog = new THREE.Fog('#3d2c23', 24, 65);
    }

    private buildBoard(): void {
        const base = new THREE.Mesh(
            this.geometry('board-base', () => new THREE.BoxGeometry(8.92, 0.28, 8.92)),
            this.material('board-base', { color: '#24201d', roughness: 0.58 }),
        );
        base.position.y = 0.055;
        base.castShadow = true;
        base.receiveShadow = true;
        this.board.add(base);
        const trim = new THREE.Mesh(
            this.geometry('board-trim', () => new THREE.BoxGeometry(8.97, 0.035, 8.97)),
            this.material('board-trim', { color: '#3c3124', metalness: 0.12, roughness: 0.6 }),
        );
        trim.position.y = -0.047;
        this.board.add(trim);
        const frameTexture = this.texture('frame-pattern', 2048, 96, ctx => {
            ctx.fillStyle = '#191a18';
            ctx.fillRect(0, 0, 2048, 96);
            ctx.strokeStyle = '#a99c7d';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 7); ctx.lineTo(2048, 7);
            ctx.moveTo(0, 89); ctx.lineTo(2048, 89);
            ctx.stroke();
            for (let i = 0; i < 16; i++) {
                if (i >= 6 && i <= 9) continue;
                const x = i * 128;
                ctx.strokeStyle = '#b1a58b';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(x + 12, 47);
                ctx.bezierCurveTo(x + 4, 16, x + 80, 13, x + 111, 46);
                ctx.bezierCurveTo(x + 141, 79, x + 63, 79, x + 32, 49);
                ctx.bezierCurveTo(x + 7, 25, x + 81, 29, x + 106, 51);
                ctx.stroke();
            }
            ctx.fillStyle = '#d8cbb3';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'italic 58px Georgia, serif';
            ctx.fillText('Kamisado', 1024, 48);
        });
        const edgeMaterial = this.material('frame-pattern', { map: frameTexture, roughness: 0.6 });
        for (let side = 0; side < 4; side++) {
            const strip = new THREE.Mesh(this.geometry('frame-strip', () => new THREE.PlaneGeometry(8.88, 0.43)), edgeMaterial);
            strip.rotation.x = -Math.PI / 2;
            strip.rotation.z = side * Math.PI / 2;
            strip.position.set(Math.sin(side * Math.PI / 2) * 4.23, 0.199, Math.cos(side * Math.PI / 2) * 4.23);
            strip.receiveShadow = true;
            this.board.add(strip);
        }
        const tileGeometry = this.geometry('tile', () => new THREE.BoxGeometry(0.995, 0.04, 0.995));
        for (let r = 0; r < 8; r++) {
            const row: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
            for (let c = 0; c < 8; c++) {
                const material = this.material(`tile-${r}-${c}`, { map: this.tileTexture(BOARD_COLORS[r][c], false), roughness: 0.51 });
                const tile = new THREE.Mesh(tileGeometry, material);
                tile.position.set(c - 3.5, 0.219, r - 3.5);
                tile.receiveShadow = true;
                tile.userData.cell = { r, c };
                row.push(tile);
                this.board.add(tile);
            }
            this.tiles.push(row);
        }
        const seam = new THREE.Mesh(
            this.geometry('fold-seam', () => new THREE.BoxGeometry(0.012, 0.002, 8)),
            this.material('fold-seam', { color: '#25201b', transparent: true, opacity: 0.5 }),
        );
        seam.position.y = 0.241;
        this.board.add(seam);
    }

    private tileTexture(color: PieceColor, symbolMode: boolean): THREE.CanvasTexture {
        const key = symbolMode ? `tile-character-${color}` : `tile-color-${color}`;
        return this.texture(key, 256, 256, ctx => {
            ctx.fillStyle = REALISTIC_COLORS[color];
            ctx.fillRect(0, 0, 256, 256);
            const sheen = ctx.createLinearGradient(0, 0, 256, 256);
            sheen.addColorStop(0, 'rgba(255,255,255,0.1)');
            sheen.addColorStop(1, 'rgba(0,0,0,0.08)');
            ctx.fillStyle = sheen;
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 2;
            ctx.strokeRect(3, 3, 250, 250);
            ctx.strokeStyle = 'rgba(0,0,0,0.14)';
            ctx.lineWidth = 1;
            ctx.strokeRect(1, 1, 254, 254);
            if (symbolMode) {
                this.paintMark(ctx, color, 8, 8, 74, '#eadfc2');
                ctx.save();
                ctx.translate(256, 256);
                ctx.rotate(Math.PI);
                this.paintMark(ctx, color, 8, 8, 74, '#eadfc2');
                ctx.restore();
            }
        });
    }

    private paintMark(ctx: CanvasRenderingContext2D, color: PieceColor, x: number, y: number, size: number, ink: string): void {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(size / CHARACTER_VIEWBOX, size / CHARACTER_VIEWBOX);
        ctx.fillStyle = ink;
        ctx.fill(new Path2D(COLOR_CHARACTER_PATHS[color]));
        ctx.restore();
    }

    private makeTower(piece: Piece): THREE.Group {
        const group = new THREE.Group();
        const ivory = piece.player === 'white';
        const masonry = this.texture(`masonry-${piece.player}`, 256, 64, ctx => {
            ctx.fillStyle = ivory ? '#e7e1d4' : '#272825';
            ctx.fillRect(0, 0, 256, 64);
            ctx.strokeStyle = ivory ? '#9c988e' : '#10110f';
            ctx.lineWidth = 1.6;
            for (let x = 0; x < 256; x += 32) {
                ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, 62); ctx.stroke();
            }
            ctx.strokeStyle = ivory ? '#faf6ea' : '#51534c';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(256, 5); ctx.stroke();
            ctx.fillStyle = ivory ? 'rgba(90,84,72,0.11)' : 'rgba(205,201,180,0.08)';
            for (let i = 0; i < 120; i++) {
                ctx.fillRect((i * 71) % 256, (i * 29) % 64, 1, 1);
            }
        });
        const stone = this.material(`stone-${piece.player}`, { map: masonry, roughness: ivory ? 0.76 : 0.49 });
        const lip = this.material(`stone-lip-${piece.player}`, { color: ivory ? '#e5dfd0' : '#32332e', roughness: 0.58 });
        for (let level = 0; level < 4; level++) {
            const radius = 0.375 - level * 0.027;
            const tier = new THREE.Mesh(
                this.geometry(`tower-tier-${level}`, () => new THREE.CylinderGeometry(radius - 0.023, radius, 0.115, 8, 1, false, Math.PI / 8)),
                stone,
            );
            tier.position.y = level * 0.111 + 0.0575;
            tier.castShadow = true;
            tier.receiveShadow = true;
            group.add(tier);
            const rim = new THREE.Mesh(
                this.geometry(`tower-lip-${level}`, () => new THREE.CylinderGeometry(radius + 0.002, radius + 0.002, 0.017, 8, 1, false, Math.PI / 8)),
                lip,
            );
            rim.position.y = level * 0.111 + 0.014;
            rim.castShadow = true;
            group.add(rim);
        }
        const topRing = new THREE.Mesh(
            this.geometry('tower-crown-ring', () => new THREE.CylinderGeometry(0.278, 0.291, 0.043, 8, 1, false, Math.PI / 8)), lip,
        );
        topRing.position.y = 0.454;
        topRing.castShadow = true;
        group.add(topRing);
        for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4;
            const battlement = new THREE.Mesh(this.geometry('battlement', () => new THREE.BoxGeometry(0.076, 0.102, 0.074)), stone);
            battlement.position.set(Math.sin(angle) * 0.256, 0.506, Math.cos(angle) * 0.256);
            battlement.rotation.y = angle;
            battlement.castShadow = true;
            group.add(battlement);
        }
        const labelTexture = this.texture(`tower-label-${piece.player}-${piece.color}-${piece.sumo}`, 256, 256, ctx => {
            ctx.fillStyle = ivory ? '#ece6d7' : '#1e211f';
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = ivory ? '#b4aa93' : '#52544b';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.stroke();
            const printedInk = ivory ? new THREE.Color(REALISTIC_COLORS[piece.color]).multiplyScalar(0.62).getStyle() : REALISTIC_COLORS[piece.color];
            this.paintMark(ctx, piece.color, 45, piece.sumo ? 27 : 45, 166, printedInk);
            if (piece.sumo > 0) {
                ctx.fillStyle = ivory ? '#443b29' : '#eedcbc';
                ctx.font = 'bold 38px Georgia, serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(piece.sumo), 128, 217);
            }
        });
        const label = new THREE.Mesh(
            this.geometry('tower-label', () => new THREE.CircleGeometry(0.239, 48)),
            this.material(`tower-label-${piece.player}-${piece.color}-${piece.sumo}`, { map: labelTexture, roughness: 0.78 }),
        );
        label.rotation.x = -Math.PI / 2;
        label.rotation.z = ivory ? 0 : Math.PI;
        label.position.y = 0.477;
        group.add(label);
        if (piece.sumo > 0) {
            const sumoRing = new THREE.Mesh(
                this.geometry('sumo-ring', () => new THREE.TorusGeometry(0.331, 0.018, 6, 8)),
                this.material('sumo-metal', { color: '#b8a36b', roughness: 0.37, metalness: 0.65 }),
            );
            sumoRing.rotation.x = -Math.PI / 2;
            sumoRing.rotation.z = Math.PI / 8;
            sumoRing.position.y = 0.23;
            group.add(sumoRing);
        }
        return group;
    }

    private makeOutline(color: string, opacity: number): THREE.LineLoop {
        const geometry = this.geometry('square-outline', () => new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.463, 0, -0.463), new THREE.Vector3(0.463, 0, -0.463),
            new THREE.Vector3(0.463, 0, 0.463), new THREE.Vector3(-0.463, 0, 0.463),
        ]));
        const key = `outline-${color}-${opacity}`;
        if (!this.materials.has(key)) this.materials.set(key, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
        const outline = new THREE.LineLoop(geometry, this.materials.get(key) as THREE.LineBasicMaterial);
        outline.renderOrder = 2;
        return outline;
    }

    private readonly resize = (): void => {
        if (this.disposed || this.failed) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width < 1 || height < 1) return;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        // Keep the horizontal framing when the host is taller than it is wide.
        this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(38 / 2)) / Math.min(1, this.camera.aspect)));
        this.camera.updateProjectionMatrix();
        this.requestRender();
    };

    private readonly requestRender = (): void => {
        if (this.disposed || this.failed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            if (!this.disposed && !this.failed) this.renderer.render(this.scene, this.camera);
        });
    };

    private cellAt(event: PointerEvent): Cell | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        this.scene.updateMatrixWorld(true);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersections = this.raycaster.intersectObjects([...this.tiles.flat(), this.pieces], true);
        for (const hit of intersections) {
            let object: THREE.Object3D | null = hit.object;
            while (object && object !== this.board) {
                const cell = object.userData.cell as Cell | undefined;
                if (cell) return cell;
                object = object.parent;
            }
        }
        return null;
    }

    private showHover(cell: Cell | null): void {
        this.hovered = cell;
        this.hoverOutline.visible = cell !== null;
        if (cell) this.hoverOutline.position.set(cell.c - 3.5, 0.253, cell.r - 3.5);
        this.requestRender();
    }

    private readonly pointerDown = (event: PointerEvent): void => {
        this.activePointers.add(event.pointerId);
        if (this.activePointers.size !== 1) {
            this.dragged = true;
            return;
        }
        this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
        this.dragged = event.button !== 0;
    };

    private readonly pointerMove = (event: PointerEvent): void => {
        if (this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 6) this.dragged = true;
        if (this.activePointers.size > 0 && this.dragged) {
            if (this.hovered) this.showHover(null);
            this.renderer.domElement.style.cursor = 'grabbing';
            return;
        }
        const cell = this.cellAt(event);
        if (cell?.r !== this.hovered?.r || cell?.c !== this.hovered?.c) this.showHover(cell);
        this.renderer.domElement.style.cursor = cell && this.options?.canInteract ? 'pointer' : 'grab';
    };

    private readonly pointerUp = (event: PointerEvent): void => {
        const click = this.pointerStart?.id === event.pointerId && !this.dragged && this.activePointers.size === 1;
        this.activePointers.delete(event.pointerId);
        if (this.activePointers.size === 0) this.pointerStart = null;
        if (click && this.options?.canInteract) {
            const cell = this.cellAt(event);
            if (cell) {
                this.keyboardCell = cell;
                this.onCellClick(cell.r, cell.c);
            }
        }
        this.renderer.domElement.style.cursor = this.options?.canInteract ? 'pointer' : 'grab';
    };

    private readonly pointerCancel = (event: PointerEvent): void => {
        this.activePointers.delete(event.pointerId);
        this.pointerStart = null;
        this.dragged = true;
    };

    private readonly pointerLeave = (): void => { this.showHover(null); };
    private readonly blur = (): void => { this.showHover(null); };

    private readonly keyDown = (event: KeyboardEvent): void => {
        if (!this.options) return;
        const direction = this.options.viewAsBlack ? -1 : 1;
        const delta: Record<string, [number, number]> = {
            ArrowUp: [-direction, 0], ArrowDown: [direction, 0],
            ArrowLeft: [0, -direction], ArrowRight: [0, direction],
        };
        if (delta[event.key]) {
            event.preventDefault();
            this.keyboardCell = {
                r: THREE.MathUtils.clamp(this.keyboardCell.r + delta[event.key][0], 0, 7),
                c: THREE.MathUtils.clamp(this.keyboardCell.c + delta[event.key][1], 0, 7),
            };
            this.showHover(this.keyboardCell);
            const { r, c } = this.keyboardCell;
            const piece = this.options.state.board[r][c];
            const color = BOARD_COLORS[r][c];
            const square = this.options.symbolMode ? `${color} character ${COLOR_CHARACTERS[color]}` : color;
            const tower = piece ? `${piece.player} ${piece.color} character ${COLOR_CHARACTERS[piece.color]} tower, rank ${piece.sumo}` : 'empty';
            this.renderer.domElement.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, ${square} square, ${tower}. Arrow keys to navigate, Enter to select or move.`);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (this.options.canInteract) this.onCellClick(this.keyboardCell.r, this.keyboardCell.c);
        }
    };

    private readonly contextLost = (event: Event): void => {
        event.preventDefault();
        this.fail();
    };

    private readonly fail = (): void => {
        if (this.disposed || this.failed) return;
        this.failed = true;
        queueMicrotask(() => { if (!this.disposed) this.onFailure(); });
    };
}

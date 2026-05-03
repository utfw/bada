import * as THREE from 'three';
import {
  GYRO_SMOOTHING,
  TOUCH_SENSITIVITY,
  MOUSE_SENSITIVITY,
} from '../utils/constants';

export class DeviceControls {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  private targetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private currentEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  private isDragging = false;
  private previousPos = { x: 0, y: 0 };
  private dragYaw = 0;
  private dragPitch = 0;

  private boundListeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListener;
    options?: AddEventListenerOptions;
  }> = [];

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.init();
  }

  private init(): void {
    this.initPointerControls();
  }

  private initPointerControls(): void {
    const sensitivity = (e: PointerEvent) =>
      e.pointerType === 'touch' ? TOUCH_SENSITIVITY : MOUSE_SENSITIVITY;

    this.addListener(
      this.domElement,
      'pointerdown',
      ((e: PointerEvent) => {
        this.isDragging = true;
        this.previousPos = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }) as EventListener,
    );

    this.addListener(
      this.domElement,
      'pointermove',
      ((e: PointerEvent) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.previousPos.x;
        const dy = e.clientY - this.previousPos.y;
        this.dragYaw   -= dx * sensitivity(e);
        this.dragPitch -= dy * sensitivity(e);
        this.dragPitch = THREE.MathUtils.clamp(this.dragPitch, -Math.PI / 2, Math.PI / 2);
        this.previousPos = { x: e.clientX, y: e.clientY };
      }) as EventListener,
    );

    this.addListener(this.domElement, 'pointerup', (() => {
      this.isDragging = false;
    }) as EventListener);

    this.addListener(this.domElement, 'pointercancel', (() => {
      this.isDragging = false;
    }) as EventListener);
  }

  private addListener(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.boundListeners.push({ target, type, listener, options });
  }

  setPresetView(position: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.dragPitch = euler.x;
    this.dragYaw   = euler.y;
    this.targetEuler.set(euler.x, euler.y, 0, 'YXZ');
    this.currentEuler.set(euler.x, euler.y, 0, 'YXZ');
  }

  update(_delta: number): void {
    this.targetEuler.set(this.dragPitch, this.dragYaw, 0, 'YXZ');
    this.currentEuler.x = THREE.MathUtils.lerp(this.currentEuler.x, this.targetEuler.x, GYRO_SMOOTHING);
    this.currentEuler.y = THREE.MathUtils.lerp(this.currentEuler.y, this.targetEuler.y, GYRO_SMOOTHING);
    this.camera.quaternion.setFromEuler(this.currentEuler);
  }

  dispose(): void {
    for (const { target, type, listener, options } of this.boundListeners) {
      target.removeEventListener(type, listener, options);
    }
    this.boundListeners.length = 0;
  }
}

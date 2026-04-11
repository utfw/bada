import * as THREE from 'three';
import {
  GYRO_SMOOTHING,
  TOUCH_SENSITIVITY,
  MOUSE_SENSITIVITY,
} from '../utils/constants';

type ControlMode = 'gyro' | 'touch' | 'mouse';

export class DeviceControls {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;
  private mode: ControlMode = 'mouse';

  // Target and current Euler for touch/mouse
  private targetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private currentEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  // Gyroscope
  private deviceQuaternion = new THREE.Quaternion();
  private screenOrientation = 0;

  // Drag state
  private isDragging = false;
  private previousPos = { x: 0, y: 0 };
  private dragYaw = 0;
  private dragPitch = 0;

  // Stored listeners for cleanup
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

  private async init(): Promise<void> {
    if (await this.tryGyroscope()) {
      this.mode = 'gyro';
    } else if ('ontouchstart' in window) {
      this.mode = 'touch';
      this.initTouchControls();
    } else {
      this.mode = 'mouse';
      this.initMouseControls();
    }
  }

  async requestGyroPermission(): Promise<boolean> {
    return this.tryGyroscope().then((ok) => {
      if (ok) this.mode = 'gyro';
      return ok;
    });
  }

  private async tryGyroscope(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as
      | { requestPermission?: () => Promise<string> }
      | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const permission = await DOE.requestPermission();
        if (permission !== 'granted') return false;
      } catch {
        return false;
      }
    }

    return new Promise((resolve) => {
      let resolved = false;

      const handler = (event: DeviceOrientationEvent) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('deviceorientation', handler);

        if (event.alpha !== null) {
          this.addListener(
            window,
            'deviceorientation',
            this.onDeviceOrientation as EventListener,
          );
          this.addListener(
            window,
            'orientationchange',
            this.onScreenOrientationChange as EventListener,
          );
          resolve(true);
        } else {
          resolve(false);
        }
      };

      window.addEventListener('deviceorientation', handler);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('deviceorientation', handler);
          resolve(false);
        }
      }, 1000);
    });
  }

  private onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    if (
      event.alpha === null ||
      event.beta === null ||
      event.gamma === null
    )
      return;

    const alpha = THREE.MathUtils.degToRad(event.alpha);
    const beta = THREE.MathUtils.degToRad(event.beta);
    const gamma = THREE.MathUtils.degToRad(event.gamma);

    this.setObjectQuaternion(
      this.deviceQuaternion,
      alpha,
      beta,
      gamma,
      this.screenOrientation,
    );
  };

  private setObjectQuaternion(
    quaternion: THREE.Quaternion,
    alpha: number,
    beta: number,
    gamma: number,
    orient: number,
  ): void {
    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(
      -Math.sqrt(0.5),
      0,
      0,
      Math.sqrt(0.5),
    );

    euler.set(beta, alpha, -gamma, 'YXZ');
    quaternion.setFromEuler(euler);
    quaternion.multiply(q1);
    quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
  }

  private onScreenOrientationChange = (): void => {
    this.screenOrientation = THREE.MathUtils.degToRad(
      screen.orientation?.angle ?? 0,
    );
  };

  private addListener(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.boundListeners.push({ target, type, listener, options });
  }

  private initTouchControls(): void {
    this.addListener(this.domElement, 'touchstart', ((e: TouchEvent) => {
      this.isDragging = true;
      this.previousPos = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }) as EventListener);

    this.addListener(
      this.domElement,
      'touchmove',
      ((e: TouchEvent) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const dx = e.touches[0].clientX - this.previousPos.x;
        const dy = e.touches[0].clientY - this.previousPos.y;
        this.dragYaw -= dx * TOUCH_SENSITIVITY;
        this.dragPitch -= dy * TOUCH_SENSITIVITY;
        this.dragPitch = THREE.MathUtils.clamp(
          this.dragPitch,
          -Math.PI / 2,
          Math.PI / 2,
        );
        this.previousPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }) as EventListener,
      { passive: false },
    );

    this.addListener(this.domElement, 'touchend', (() => {
      this.isDragging = false;
    }) as EventListener);
  }

  private initMouseControls(): void {
    this.addListener(this.domElement, 'mousedown', ((e: MouseEvent) => {
      this.isDragging = true;
      this.previousPos = { x: e.clientX, y: e.clientY };
    }) as EventListener);

    this.addListener(this.domElement, 'mousemove', ((e: MouseEvent) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.previousPos.x;
      const dy = e.clientY - this.previousPos.y;
      this.dragYaw -= dx * MOUSE_SENSITIVITY;
      this.dragPitch -= dy * MOUSE_SENSITIVITY;
      this.dragPitch = THREE.MathUtils.clamp(
        this.dragPitch,
        -Math.PI / 2,
        Math.PI / 2,
      );
      this.previousPos = { x: e.clientX, y: e.clientY };
    }) as EventListener);

    this.addListener(window, 'mouseup', (() => {
      this.isDragging = false;
    }) as EventListener);
  }

  setPresetView(position: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(target);

    // Sync internal drag state from the resulting camera orientation
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.dragPitch = euler.x;
    this.dragYaw = euler.y;
    this.targetEuler.set(euler.x, euler.y, 0, 'YXZ');
    this.currentEuler.set(euler.x, euler.y, 0, 'YXZ');
  }

  update(_delta: number): void {
    if (this.mode === 'gyro') {
      this.camera.quaternion.slerp(this.deviceQuaternion, GYRO_SMOOTHING);
    } else {
      this.targetEuler.set(this.dragPitch, this.dragYaw, 0, 'YXZ');
      this.currentEuler.x = THREE.MathUtils.lerp(
        this.currentEuler.x,
        this.targetEuler.x,
        GYRO_SMOOTHING,
      );
      this.currentEuler.y = THREE.MathUtils.lerp(
        this.currentEuler.y,
        this.targetEuler.y,
        GYRO_SMOOTHING,
      );
      this.camera.quaternion.setFromEuler(this.currentEuler);
    }
  }

  dispose(): void {
    for (const { target, type, listener, options } of this.boundListeners) {
      target.removeEventListener(type, listener, options);
    }
    this.boundListeners.length = 0;
  }
}

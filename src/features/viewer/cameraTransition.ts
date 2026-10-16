import { Quaternion, Vector3 } from 'three';

export type CameraPose = { position: Vector3; quaternion: Quaternion };
export type CameraTransition = {
  from: CameraPose;
  to: CameraPose;
  startedAt: number;
  duration: number;
};

export function createCameraTransition(from: CameraPose, to: CameraPose, startedAt: number, duration = 1100): CameraTransition {
  return {
    from: { position: from.position.clone(), quaternion: from.quaternion.clone() },
    to: { position: to.position.clone(), quaternion: to.quaternion.clone() },
    startedAt,
    duration,
  };
}

export function sampleCameraTransition(transition: CameraTransition, now: number, camera: CameraPose) {
  const progress = Math.max(0, Math.min(1, (now - transition.startedAt) / transition.duration));
  if (progress === 0 || progress === 1) {
    const endpoint = progress === 0 ? transition.from : transition.to;
    camera.position.copy(endpoint.position);
    camera.quaternion.copy(endpoint.quaternion);
    return progress === 1;
  }
  // Zero speed and acceleration at both ends avoids a stop/start feel on the orbit camera.
  const eased = progress ** 3 * (10 + progress * (-15 + progress * 6));
  camera.position.lerpVectors(transition.from.position, transition.to.position, eased);
  camera.quaternion.slerpQuaternions(transition.from.quaternion, transition.to.quaternion, eased);
  return progress === 1;
}

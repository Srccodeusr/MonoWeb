import { config } from '../config';
import { log } from '../log';
import { Runtime } from './types';
import { DockerRuntime } from './docker';
import { ProcessRuntime } from './process';

let cached: Runtime | null = null;

/** Picks the engine once at boot: docker -> podman -> native process sandbox. */
export async function getRuntime(): Promise<Runtime> {
  if (cached) return cached;
  const want = config.runtime;
  if (want === 'process') { cached = new ProcessRuntime(); }
  else {
    const probe = await DockerRuntime.probe();
    if (probe.ok) {
      cached = new DockerRuntime(probe.podman ? 'podman' : 'docker');
    } else if (want === 'docker' || want === 'podman') {
      throw new Error(`RUNTIME=${want} but no container engine answered on ${config.socket}`);
    } else {
      log.warn(`No container engine on ${config.socket}; falling back to the native process runtime`);
      cached = new ProcessRuntime();
    }
  }
  log.info(`Runtime: ${cached.name}`);
  return cached;
}

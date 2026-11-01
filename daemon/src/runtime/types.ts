import { PortMap } from '../safe';

export interface Limits { ramMB: number; cpuPercent: number; diskMB: number; swapMB: number; pids: number }

export interface ServerSpec {
  id: string;
  image: string;
  startup: string;
  stopCommand: string;
  env: Record<string, string>;
  ports: PortMap[];
  limits: Limits;
  /** SFTP logins allowed for this server (password hashes only). */
  sftp?: { username: string; hash: string; readOnly: boolean }[];
}

export interface PowerState { state: 'running' | 'offline' | 'starting'; startedAt?: string; exitCode?: number }

export interface Stats {
  running: boolean;
  cpuPercent: number;
  memBytes: number;
  memLimit: number;
  netRx: number;
  netTx: number;
}

export interface InstallOptions {
  id: string;
  dir: string;
  image: string;
  script: string;
  entrypoint: string;
  env: Record<string, string>;
}

export interface Runtime {
  readonly name: string;
  info(): Promise<Record<string, unknown>>;
  start(spec: ServerSpec, dir: string): Promise<void>;
  stop(spec: ServerSpec): Promise<void>;
  kill(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  state(id: string): Promise<PowerState>;
  stats(id: string, spec: ServerSpec): Promise<Stats>;
  sendCommand(id: string, command: string): Promise<void>;
  /** Streams console output. Returns a function that stops the stream. */
  logs(id: string, tail: number, onData: (chunk: string) => void, onEnd: () => void): () => void;
  install(opts: InstallOptions, onLine: (line: string) => void): Promise<number>;
  updateLimits(spec: ServerSpec): Promise<void>;
}

import { config, assertConfig } from './config';
import { startHttp } from './http';
import { registerRoutes, startWatchdogs } from './app';
import { getRuntime } from './runtime';
import { log } from './log';
import { startSftp } from './sftp';
import { sweepOldTransfers } from './transfer';

async function main(): Promise<void> {
  assertConfig();
  const rt = await getRuntime();
  if (rt.name === 'process') {
    const info: any = await rt.info();
    if (info.sandbox === 'none' && process.getuid?.() === 0 && process.env.ALLOW_UNSANDBOXED_ROOT !== 'true') {
      throw new Error('Refusing to run customer processes as root without a sandbox. Install bubblewrap (apt install bubblewrap), run the daemon as an unprivileged user, or install Docker/Podman. (Override: ALLOW_UNSANDBOXED_ROOT=true)');
    }
    if (info.sandbox === 'none') log.warn('Process runtime is UNSANDBOXED. Install bubblewrap and run the daemon as a dedicated unprivileged user.');
  }
  registerRoutes();
  startWatchdogs();
  sweepOldTransfers(); setInterval(sweepOldTransfers, 3600_000).unref();
  startSftp();
  const server = startHttp();
  const shutdown = (sig: string) => { log.info(`${sig} received, shutting down`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', r => log.error('unhandledRejection', String(r)));
  log.info(`MonoNode daemon ${config.version} ready (runtime: ${rt.name}, ports ${config.portMin}-${config.portMax})`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

import fs from 'fs';
import crypto from 'crypto';
import { config } from './config';
import { log } from './log';
import { authenticateSftp } from './sftpAuth';
import { SftpError, SftpSession, Attrs } from './sftpCore';

type StatusTable = Record<string, number>;
const CODE: Record<string, string> = { EOF: 'EOF', NO_SUCH_FILE: 'NO_SUCH_FILE', PERMISSION_DENIED: 'PERMISSION_DENIED', FAILURE: 'FAILURE', BAD_MESSAGE: 'BAD_MESSAGE', OP_UNSUPPORTED: 'OP_UNSUPPORTED' };

const handleBuf = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const handleNum = (b: Buffer) => (b.length === 4 ? b.readUInt32BE() : -1);

/**
 * Connects an ssh2 SFTP stream to a SftpSession. Kept free of any ssh2 import so it can be tested with a fake stream.
 * Symlink operations are refused on purpose: a symlink is the classic way out of a server's directory.
 */
export function wireSftp(sftp: any, fsx: SftpSession, STATUS: StatusTable): void {
  const status = (reqid: number, name: string) => sftp.status(reqid, STATUS[name]);
  const run = (reqid: number, fn: () => void) => {
    try { fn(); }
    catch (e: any) { status(reqid, e instanceof SftpError ? CODE[e.code] : 'FAILURE'); if (!(e instanceof SftpError)) log.warn('sftp error', e?.message); }
  };
  const attrsOut = (a: Attrs) => ({ mode: a.mode, uid: a.uid, gid: a.gid, size: a.size, atime: a.atime, mtime: a.mtime });

  sftp.on('REALPATH', (reqid: number, p: string) => run(reqid, () => { const r = fsx.realpath(p); sftp.name(reqid, [{ filename: r, longname: r, attrs: {} }]); }));
  sftp.on('STAT', (reqid: number, p: string) => run(reqid, () => sftp.attrs(reqid, attrsOut(fsx.stat(p)))));
  sftp.on('LSTAT', (reqid: number, p: string) => run(reqid, () => sftp.attrs(reqid, attrsOut(fsx.stat(p)))));
  sftp.on('FSTAT', (reqid: number, h: Buffer) => run(reqid, () => sftp.attrs(reqid, attrsOut(fsx.fstat(handleNum(h))))));
  sftp.on('OPEN', (reqid: number, p: string, flags: number) => run(reqid, () => sftp.handle(reqid, handleBuf(fsx.open(p, flags)))));
  sftp.on('READ', (reqid: number, h: Buffer, offset: number, length: number) => run(reqid, () => sftp.data(reqid, fsx.read(handleNum(h), offset, length))));
  sftp.on('WRITE', (reqid: number, h: Buffer, offset: number, data: Buffer) => run(reqid, () => { fsx.write(handleNum(h), offset, data); status(reqid, 'OK'); }));
  sftp.on('CLOSE', (reqid: number, h: Buffer) => run(reqid, () => { fsx.close(handleNum(h)); status(reqid, 'OK'); }));
  sftp.on('OPENDIR', (reqid: number, p: string) => run(reqid, () => sftp.handle(reqid, handleBuf(fsx.opendir(p)))));
  sftp.on('READDIR', (reqid: number, h: Buffer) => run(reqid, () => sftp.name(reqid, fsx.readdir(handleNum(h)).map(e => ({ filename: e.filename, longname: e.longname, attrs: attrsOut(e.attrs) })))));
  sftp.on('MKDIR', (reqid: number, p: string) => run(reqid, () => { fsx.mkdir(p); status(reqid, 'OK'); }));
  sftp.on('RMDIR', (reqid: number, p: string) => run(reqid, () => { fsx.rmdir(p); status(reqid, 'OK'); }));
  sftp.on('REMOVE', (reqid: number, p: string) => run(reqid, () => { fsx.remove(p); status(reqid, 'OK'); }));
  sftp.on('RENAME', (reqid: number, a: string, b: string) => run(reqid, () => { fsx.rename(a, b); status(reqid, 'OK'); }));
  // chmod/chown/utimes and links are accepted-but-ignored or refused: permissions are managed by the node.
  sftp.on('SETSTAT', (reqid: number) => status(reqid, 'OK'));
  sftp.on('FSETSTAT', (reqid: number) => status(reqid, 'OK'));
  for (const op of ['READLINK', 'SYMLINK', 'EXTENDED']) sftp.on(op, (reqid: number) => status(reqid, 'OP_UNSUPPORTED'));
  sftp.on('end', () => fsx.closeAll());
  sftp.on('close', () => fsx.closeAll());
}

function hostKey(): string {
  if (fs.existsSync(config.sftpHostKey)) return fs.readFileSync(config.sftpHostKey, 'utf8');
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'sec1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  fs.writeFileSync(config.sftpHostKey, privateKey, { mode: 0o600 });
  return privateKey;
}

/** Starts the SFTP listener when SFTP_PORT is set and the optional `ssh2` package is installed. */
export function startSftp(): void {
  if (!config.sftpPort) return;
  let ssh2: any;
  try { ssh2 = require('ssh2'); } catch { log.warn('SFTP_PORT is set but the optional package "ssh2" is not installed. Run `npm install` in the daemon folder. SFTP is disabled.'); return; }
  const STATUS = ssh2.utils.sftp.STATUS_CODE as StatusTable;
  const server = new ssh2.Server({ hostKeys: [hostKey()], ident: 'SSH-2.0-MonoNode' }, (client: any, info: any) => {
    let login: ReturnType<typeof authenticateSftp> = null;
    const ip = String(info?.ip || '').replace(/^::ffff:/, '');
    client.on('authentication', (ctx: any) => {
      if (ctx.method !== 'password') return ctx.reject(['password']);
      const found = authenticateSftp(String(ctx.username), String(ctx.password), ip);
      if (!found) return ctx.reject(['password']);
      login = found; ctx.accept();
    });
    client.on('ready', () => {
      client.on('session', (accept: any) => {
        const session = accept();
        session.on('sftp', (acceptSftp: any) => {
          if (!login) return;
          const spec = login.spec;
          wireSftp(acceptSftp(), new SftpSession(spec.id, login.readOnly, spec.limits.diskMB), STATUS);
        });
        for (const kind of ['shell', 'exec', 'pty']) session.on(kind, (_a: any, reject: any) => reject?.());
      });
    });
    client.on('error', () => undefined);
  });
  server.on('error', (e: Error) => log.error('SFTP server error', e));
  server.listen(config.sftpPort, config.host, () => log.info(`SFTP listening on ${config.host}:${config.sftpPort}`));
}

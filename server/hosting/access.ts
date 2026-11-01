import { DatabaseSchema } from '../db';
import { User } from '../../src/types';
import { HostServer, SubuserPermission, SUBUSER_PERMISSIONS } from '../../src/hostingTypes';
import { effectivePlan } from './plans';

export interface Access {
  server: HostServer;
  role: 'owner' | 'subuser';
  permissions: Set<SubuserPermission>;
  owner: User;
}

const ALL = new Set<SubuserPermission>(SUBUSER_PERMISSIONS);

/**
 * Who may touch a server and how.
 *  - the owner can do everything;
 *  - a team member gets only the permissions the owner granted, and ONLY while the owner is on a plan that includes
 *    subusers (a lapsed plan silently suspends team access; it returns when the plan does).
 */
export function resolveAccess(db: DatabaseSchema, userId: string, serverId: string): Access | null {
  const server = db.servers.find(s => s.id === serverId);
  if (!server) return null;
  const owner = db.users.find(u => u.id === server.ownerId);
  if (!owner) return null;
  if (server.ownerId === userId) return { server, role: 'owner', permissions: ALL, owner };
  const sub = db.subusers.find(x => x.serverId === serverId && x.userId === userId);
  if (!sub) return null;
  const plan = effectivePlan(owner, db.hostingPlans, db.settings.hosting!);
  if (!plan?.features.subusers) return null;
  return { server, role: 'subuser', permissions: new Set(sub.permissions), owner };
}

export function can(a: Access, perm: SubuserPermission | 'owner'): boolean {
  return perm === 'owner' ? a.role === 'owner' : a.permissions.has(perm);
}

/** Servers a user can see: their own plus those shared with them (while sharing is allowed by the owner's plan). */
export function accessibleServers(db: DatabaseSchema, userId: string): { server: HostServer; role: 'owner' | 'subuser' }[] {
  const out: { server: HostServer; role: 'owner' | 'subuser' }[] = db.servers.filter(s => s.ownerId === userId).map(server => ({ server, role: 'owner' as const }));
  for (const sub of db.subusers.filter(x => x.userId === userId)) {
    const a = resolveAccess(db, userId, sub.serverId);
    if (a) out.push({ server: a.server, role: 'subuser' });
  }
  return out;
}

export function sanitizePermissions(input: unknown): SubuserPermission[] {
  const list = Array.isArray(input) ? input : [];
  return [...new Set(list.filter((p): p is SubuserPermission => (SUBUSER_PERMISSIONS as readonly string[]).includes(p)))];
}

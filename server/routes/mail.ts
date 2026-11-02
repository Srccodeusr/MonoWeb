import { Router, Response } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, requireRole, AuthenticatedRequest, createAuditLog } from '../auth';
import { Mail, UserRole } from '../../src/types';

const router = Router();

// All mail routes require a logged-in account
router.use(authMiddleware);

const STAFF_ROLES: UserRole[] = ['admin', 'super_admin', 'support', 'moderator'];

function displayName(u: { displayName?: string; username?: string; email: string }): string {
  return u.displayName || u.username || u.email.split('@')[0];
}

// GET /api/v1/mail - current user's inbox, newest first
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const inbox = db.mail
    .filter(m => m.recipientId === req.user!.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ success: true, data: inbox });
});

// GET /api/v1/mail/unread-count - for the navbar mail icon badge
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const count = db.mail.filter(m => m.recipientId === req.user!.id && !m.isRead).length;
  res.json({ success: true, data: { count } });
});

// GET /api/v1/mail/sent - mail this staff member has sent (grouped client-side by batchId)
router.get('/sent', requireRole(STAFF_ROLES), async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const sent = db.mail
    .filter(m => m.senderId === req.user!.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ success: true, data: sent });
});

// GET /api/v1/mail/:id - single mail item (recipient only)
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const mail = db.mail.find(m => m.id === req.params.id);

  if (!mail) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mail not found' } });
  }

  const isStaff = STAFF_ROLES.includes(req.user!.role);
  if (mail.recipientId !== req.user!.id && !(isStaff && mail.senderId === req.user!.id)) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
  }

  res.json({ success: true, data: mail });
});

// PATCH /api/v1/mail/:id/read - mark a mail item as read
router.patch('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const mail = db.mail.find(m => m.id === req.params.id && m.recipientId === req.user!.id);

  if (!mail) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mail not found' } });
  }

  if (!mail.isRead) {
    mail.isRead = true;
    mail.readAt = new Date().toISOString();
    saveDbSync();
  }

  res.json({ success: true, data: mail });
});

// POST /api/v1/mail/mark-all-read - clear the unread badge in one action
router.post('/mark-all-read', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const now = new Date().toISOString();
  let changed = 0;

  db.mail.forEach(m => {
    if (m.recipientId === req.user!.id && !m.isRead) {
      m.isRead = true;
      m.readAt = now;
      changed++;
    }
  });

  if (changed > 0) saveDbSync();
  res.json({ success: true, message: `${changed} message(s) marked as read.` });
});

// DELETE /api/v1/mail/:id - remove a mail item from the current user's inbox
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const mail = db.mail.find(m => m.id === req.params.id && m.recipientId === req.user!.id);

  if (!mail) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mail not found' } });
  }

  db.mail = db.mail.filter(m => m.id !== mail.id);
  saveDbSync();

  res.json({ success: true, message: 'Mail deleted.' });
});

// POST /api/v1/mail/send - staff/admin/owner send mail to one user or broadcast to everyone
router.post('/send', requireRole(STAFF_ROLES), async (req: AuthenticatedRequest, res: Response) => {
  const { recipientId, subject, body } = req.body;

  if (!recipientId || !subject?.trim() || !body?.trim()) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Recipient, subject, and message body are required.' } });
  }

  const db = await getDb();
  const sender = req.user!;
  const isBroadcast = recipientId === 'all';

  // "All Users" means every account. It used to skip the sender's own account,
  // so on a fresh install (where the admin is the only account) a broadcast
  // found zero recipients and failed. This also matches the "(N)" count shown
  // in the compose dropdown, which counts every user.
  const targets = isBroadcast
    ? db.users
    : db.users.filter(u => u.id === recipientId);

  if (targets.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: isBroadcast
          ? 'There are no user accounts to send this to yet.'
          : 'The selected user no longer exists. Refresh the page and pick the recipient again.'
      }
    });
  }

  const batchId = `mbatch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  const newMail: Mail[] = targets.map((u, i) => ({
    id: `mail_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 8)}`,
    batchId,
    senderId: sender.id,
    senderName: displayName(sender),
    senderRole: sender.role,
    recipientId: u.id,
    recipientName: displayName(u),
    recipientEmail: u.email,
    subject: subject.trim(),
    body: body.trim(),
    isRead: false,
    isBroadcast,
    createdAt: now
  }));

  db.mail.unshift(...newMail);
  saveDbSync();

  await createAuditLog(
    sender.id,
    sender.email,
    sender.role,
    isBroadcast ? 'MAIL_BROADCAST_SENT' : 'MAIL_SENT',
    batchId,
    isBroadcast
      ? `Broadcast mail "${subject.trim()}" sent to ${targets.length} user(s)`
      : `Mail "${subject.trim()}" sent to ${targets[0].email}`
  );

  res.json({ success: true, message: isBroadcast ? `Mail broadcast to ${targets.length} user(s).` : 'Mail sent.', data: { batchId, recipientCount: targets.length } });
});

export default router;

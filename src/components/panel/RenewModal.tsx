import React from 'react';
import { Coins, Star } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Btn, Modal, fmtDate } from '../ui/kit';
import { usePanel, PanelServer } from './PanelContext';
import { EarnFlow } from './EarnFlow';

interface Props { server: PanelServer; open: boolean; onClose: () => void; onNavigate: (p: string, params?: any) => void; notify: (t: 'success' | 'error', m: string) => void }

export const RenewModal: React.FC<Props> = ({ server, open, onClose, onNavigate, notify }) => {
  const { data, refresh } = usePanel();
  if (!data) return null;
  const { renew, plan, economy } = data;
  const methods = plan.renewMethods;
  const coinsOk = renew.coins && methods.includes('coins');
  const done = async (r: { expiresAt?: string; hours?: number }) => { await refresh(); notify('success', `Renewed until ${fmtDate(r.expiresAt)}`); onClose(); };

  const withCoins = async () => {
    const r = await apiRequest(`/hosting/servers/${server.id}/renew`, { method: 'POST', body: JSON.stringify({ method: 'coins' }) });
    if (r.success) return done(r.data);
    notify('error', r.error?.message || 'Could not renew.');
  };

  return (
    <Modal open={open} onClose={onClose} title={`Renew “${server.name}”`}>
      <div className="space-y-5">
        <p className="text-xs text-zinc-400">{server.status === 'expired' ? 'This server has expired and will be deleted 24 hours after expiry unless you renew it.' : `Expires ${fmtDate(server.expiresAt)}. Renewing now adds time on top of what is left.`}</p>
        {(methods.includes('ads') || methods.includes('blog')) && <EarnFlow purpose="renew" serverId={server.id} onDone={done} onError={m => notify('error', m)} />}
        {coinsOk && (
          <Btn variant="dark" className="w-full !py-3" onClick={withCoins}><Coins className="h-4 w-4 text-amber-400" />Renew with {renew.coinPrice} {economy.coinName} (+{renew.coinDays} days)<span className="text-zinc-500 ml-1">· you have {data.user.coins}</span></Btn>
        )}
        {(methods.includes('payment') || plan.isFree) && (
          <Btn variant="primary" className="w-full !py-3" onClick={() => { onClose(); onNavigate('upgrade'); }}><Star className="h-4 w-4" />{plan.isFree ? 'Go Premium: no ads, direct renewals' : 'Renew your plan'}</Btn>
        )}
      </div>
    </Modal>
  );
};

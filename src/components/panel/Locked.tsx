import React from 'react';
import { Lock } from 'lucide-react';
import { Btn, Card } from '../ui/kit';

/** Shown instead of a paid feature on the free plan: explains what it is and links to the upgrade page. */
export const Locked: React.FC<{ title: string; text: string; onUpgrade: () => void }> = ({ title, text, onUpgrade }) => (
  <Card className="text-center py-10 space-y-3">
    <div className="mx-auto h-12 w-12 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-center"><Lock className="h-5 w-5 text-amber-400" /></div>
    <p className="text-sm font-bold text-white">{title}</p>
    <p className="text-xs text-zinc-400 max-w-sm mx-auto">{text}</p>
    <Btn variant="primary" onClick={onUpgrade}>See paid plans</Btn>
  </Card>
);

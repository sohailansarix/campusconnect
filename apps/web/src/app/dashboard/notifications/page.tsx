'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, ExternalLink, Mail, Settings2 } from 'lucide-react';
import { NOTIFICATION_TYPES } from '@campusconnect/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useList, useAsync } from '@/hooks/use-api';
import { get, patch, put } from '@/lib/api';
import { formatRelative, humanise } from '@/lib/utils';

type Notification = { id: string; type: string; title: string; body: string; actionUrl: string | null; readAt: string | null; createdAt: string };
type Preferences = {
  setting: { emailEnabled: boolean; pushEnabled: boolean; whatsappEnabled: boolean; digestFrequency: string; quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string };
  preferences: { type: (typeof NOTIFICATION_TYPES)[number]; channels: string[]; mutable: boolean }[];
};

export default function NotificationsPage() {
  const notifications = useList<Notification>('/notifications', { initialParams: { pageSize: 30, sortBy: 'createdAt', sortOrder: 'desc' } });
  const preferences = useAsync(() => get<Preferences>('/notifications/preferences'));
  const [saving, setSaving] = React.useState(false);

  const markRead = async (ids?: string[]) => {
    try {
      await patch('/notifications/read', ids ? { ids } : {});
      await notifications.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update notifications');
    }
  };

  const updatePreference = (type: Preferences['preferences'][number]['type'], enabled: boolean) => {
    preferences.setData((current) => {
      if (!current) return current as never;
      return {
        ...current,
        preferences: current.preferences.map((item) => {
          if (item.type !== type) return item;
          const channels = new Set(item.channels);
          if (enabled) channels.add('EMAIL');
          else channels.delete('EMAIL');
          // In-app is the durable inbox channel; SYSTEM must always retain it.
          channels.add('IN_APP');
          return { ...item, channels: [...channels] };
        }),
      };
    });
  };

  const savePreferences = async () => {
    const current = preferences.data;
    if (!current) return;
    setSaving(true);
    try {
      await put('/notifications/preferences', {
        emailEnabled: current.setting.emailEnabled,
        digestFrequency: current.setting.digestFrequency,
        preferences: current.preferences.map(({ type, channels }) => ({ type, channels })),
      });
      toast.success('Notification preferences saved');
      await preferences.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Preferences could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-primary">Your activity</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Notifications</h1><p className="mt-2 text-sm text-muted-foreground">Event updates, attendance, certificates and account messages.</p></div>{notifications.items.some((item) => !item.readAt) && <Button variant="outline" onClick={() => void markRead()}><CheckCheck className="size-4" /> Mark all read</Button>}</div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <section aria-label="Notification inbox">
          {notifications.loading ? <div className="space-y-3" aria-busy="true">{[0, 1, 2, 3].map((key) => <div key={key} className="shimmer h-24 rounded-xl bg-muted" />)}</div> : notifications.error ? <ErrorState title="Could not load notifications" description={notifications.error} requestId={notifications.requestId} onRetry={() => void notifications.refetch()} /> : notifications.items.length ? <div className="space-y-3">{notifications.items.map((notification) => {
            const safeAction = notification.actionUrl?.startsWith('/') && !notification.actionUrl.startsWith('//') ? notification.actionUrl : null;
            return <Card key={notification.id} className={notification.readAt ? 'opacity-80' : 'border-primary/30 bg-primary/[0.025]'}><div className="flex items-start gap-3"><span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${notification.readAt ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}><Bell className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{notification.title}</h2>{!notification.readAt && <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{notification.body}</p><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{humanise(notification.type)} · {formatRelative(notification.createdAt)}</span>{safeAction && <Link href={safeAction} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Open <ExternalLink className="size-3" /></Link>}{!notification.readAt && <button className="font-medium hover:text-foreground" onClick={() => void markRead([notification.id])}>Mark read</button>}</div></div></div></Card>;
          })}</div> : <EmptyState icon={<Bell />} title="You are all caught up" description="Important event, certificate and account updates will show here." />}
        </section>

        <aside>
          <Card>
            <div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Settings2 className="size-4" /></span><div><h2 className="font-semibold">Delivery preferences</h2><p className="mt-1 text-xs text-muted-foreground">In-app alerts always remain in your inbox.</p></div></div>
            {preferences.loading ? <div className="shimmer mt-5 h-52 rounded-lg bg-muted" aria-busy="true" /> : preferences.error ? <ErrorState className="mt-5" compact title="Could not load preferences" description={preferences.error} onRetry={() => void preferences.refetch()} /> : preferences.data && <>
              <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border p-3"><span className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4 text-muted-foreground" /> Email delivery</span><Switch checked={preferences.data.setting.emailEnabled} onChange={(checked) => preferences.setData((current) => current ? { ...current, setting: { ...current.setting, emailEnabled: checked } } : current as never)} label="Enable email notifications" /></div>
              <div className="mt-5 space-y-1"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email by category</p>{preferences.data.preferences.map((item) => <div key={item.type} className="flex items-center justify-between gap-3 border-b border-border/70 py-2.5 last:border-0"><span className="text-xs">{humanise(item.type)}{!item.mutable && <span className="ml-1 text-muted-foreground">(required)</span>}</span><Switch checked={item.channels.includes('EMAIL')} onChange={(checked) => updatePreference(item.type, checked)} label={`Email ${humanise(item.type)}`} /></div>)}</div>
              <Button className="mt-5 w-full" loading={saving} onClick={() => void savePreferences()}>Save preferences</Button>
            </>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { get } from '@/lib/api';

/**
 * Unread notification count.
 *
 * Polled every 45 seconds while the tab is visible. Polling stops when the tab is
 * hidden, so a student who leaves the dashboard open overnight does not generate
 * 2,000 requests — a small thing that matters on a metered campus connection.
 *
 * TODO(Phase 3): replace with a server-sent-event stream once notifications are a
 * live surface rather than a badge.
 */
const POLL_INTERVAL_MS = 45_000;

export function useUnreadCount(enabled = true) {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchCount = async () => {
      // Skip entirely while the tab is in the background.
      if (document.visibilityState === 'hidden') return;

      try {
        const result = await get<{ unreadCount: number }>('/notifications/unread-count');
        if (!cancelled) setCount(result.unreadCount);
      } catch {
        // A failed poll is not worth surfacing — the next one will likely succeed.
      }
    };

    void fetchCount();
    timer = setInterval(() => void fetchCount(), POLL_INTERVAL_MS);

    // Refresh immediately when the user comes back to the tab, so the badge is
    // current the moment they look at it rather than up to 45s stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchCount();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return count;
}

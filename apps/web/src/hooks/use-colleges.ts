'use client';

import * as React from 'react';
import { get } from '@/lib/api';

export type CollegeOption = {
  id: string;
  name: string;
  shortName: string | null;
  slug: string;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  departments: { id: string; name: string; code: string; degree: string | null }[];
};

/**
 * Loads the public college list for the signup form.
 *
 * Fetched once per session and cached in a module-level promise, so navigating
 * between login and register does not re-request a list that changes a few times a
 * year. Cleared on a hard reload, which is the right granularity here.
 */
let cachedPromise: Promise<CollegeOption[]> | null = null;

async function loadColleges(): Promise<CollegeOption[]> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = get<CollegeOption[]>('/colleges/public', { anonymous: true }).catch((error) => {
    // Do not cache a failure — the next mount should be allowed to retry.
    cachedPromise = null;
    throw error;
  });

  return cachedPromise;
}

export function useColleges() {
  const [colleges, setColleges] = React.useState<CollegeOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void loadColleges()
      .then((result) => {
        if (cancelled) return;
        setColleges(result);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load colleges');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { colleges, loading, error };
}

/** Test seam and for an explicit refresh after an admin adds a college. */
export function clearCollegesCache(): void {
  cachedPromise = null;
}

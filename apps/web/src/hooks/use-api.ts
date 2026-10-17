'use client';

import * as React from 'react';
import { apiList } from '@/lib/api';

/**
 * Generic async-data hook.
 *
 * Deliberately minimal — no cache, no dedupe beyond what `api.ts` already does for
 * refresh. At this scale a per-component fetch is simpler to reason about than a
 * query client, and the expensive pages use the API's pagination rather than
 * pulling everything and filtering client-side.
 *
 * The three states every screen needs (`loading`, `error`, `data`) plus `refetch`
 * are what make it possible to honour the brief's "loading and error states on
 * every screen" without repeating the same effect in twenty components.
 */

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** The API's request id, for quoting in a bug report. */
  requestId?: string;
  refetch: () => Promise<void>;
  setData: (updater: T | ((previous: T | null) => T)) => void;
};

export function useAsync<T>(
  fetcher: () => Promise<T>,
  options: {
    /** Skip the request entirely — for a hook that is disabled until a param exists. */
    enabled?: boolean;
    deps?: React.DependencyList;
    /** Re-run when the window regains focus. Off by default; on for dashboards. */
    refreshOnFocus?: boolean;
  } = {},
): AsyncState<T> {
  const { enabled = true, deps = [], refreshOnFocus = false } = options;

  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [requestId, setRequestId] = React.useState<string | undefined>(undefined);

  // Guards against a slow response from a previous render overwriting a newer one.
  const requestRef = React.useRef(0);

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = React.useCallback(async () => {
    const requestId_ = ++requestRef.current;

    setLoading(true);
    setError(null);

    try {
      const result = await fetcherRef.current();
      if (requestRef.current !== requestId_) return;
      setData(result);
    } catch (caught) {
      if (requestRef.current !== requestId_) return;

      const message = caught instanceof Error ? caught.message : 'Something went wrong';
      setError(message);
      setRequestId((caught as { requestId?: string })?.requestId);
    } finally {
      if (requestRef.current === requestId_) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  React.useEffect(() => {
    if (!refreshOnFocus || !enabled) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshOnFocus, enabled, run]);

  return {
    data,
    loading,
    error,
    requestId,
    refetch: run,
    setData: (updater) =>
      setData((previous) =>
        typeof updater === 'function' ? (updater as (p: T | null) => T)(previous) : updater,
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Paginated list hook                                                        */
/* -------------------------------------------------------------------------- */

export type ListParams = Record<string, string | number | boolean | undefined | null | string[]>;

export type PaginatedResult<T> = {
  items: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    [key: string]: unknown;
  };
};

/**
 * List hook with pagination, sorting and filtering.
 *
 * Filters are part of the dependency set, so changing a filter re-fetches from
 * page 1 — which is what a user expects and what a naive implementation usually
 * gets wrong by leaving the page number alone and showing an empty page 4.
 */
export function useList<T>(
  path: string,
  options: {
    initialParams?: ListParams;
    enabled?: boolean;
  } = {},
) {
  const { initialParams = {}, enabled = true } = options;

  const [params, setParams] = React.useState<ListParams>({ page: 1, pageSize: 20, ...initialParams });

  const query = React.useMemo(() => {
    const clean: Record<string, string | number | boolean | string[]> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      clean[key] = value;
    }
    return clean;
  }, [params]);

  const state = useAsync<PaginatedResult<T>>(
    async () => {
      const result = await apiList<T>(path, {
        query: query as Record<string, string | number | boolean>,
      });

      // `apiList` preserves the response envelope, including pagination metadata.
      return {
        items: result.data,
        meta: result.meta as PaginatedResult<T>['meta'],
      };
    },
    { enabled, deps: [path, JSON.stringify(query)] },
  );

  const setFilter = React.useCallback((patch: ListParams) => {
    setParams((previous) => {
      // Reset to page 1 whenever a filter changes. Keeping the page number is the
      // classic bug that makes a filtered list look empty.
      const isFilterChange = Object.keys(patch).some((key) => key !== 'page' && key !== 'pageSize');
      return { ...previous, ...patch, ...(isFilterChange ? { page: 1 } : {}) };
    });
  }, []);

  const resetFilters = React.useCallback(() => {
    setParams({ page: 1, pageSize: 20, ...initialParams });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextPage = React.useCallback(() => {
    setParams((previous) => ({ ...previous, page: (Number(previous.page) || 1) + 1 }));
  }, []);

  const previousPage = React.useCallback(() => {
    setParams((previous) => ({ ...previous, page: Math.max(1, (Number(previous.page) || 1) - 1) }));
  }, []);

  const goToPage = React.useCallback((page: number) => {
    setParams((previous) => ({ ...previous, page }));
  }, []);

  return {
    ...state,
    items: state.data?.items ?? [],
    meta: state.data?.meta ?? null,
    params,
    setFilter,
    resetFilters,
    nextPage,
    previousPage,
    goToPage,
    hasFilters: Object.keys(query).some((key) => key !== 'page' && key !== 'pageSize'),
  };
}

/* -------------------------------------------------------------------------- */
/* Mutation helper                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Wraps a write so forms get consistent pending/error handling.
 *
 * Returns the result on success and re-throws on failure, so a React Hook Form
 * `onSubmit` can `await mutate(...)` and let Zod/resolver errors surface normally.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  mutator: (...args: TArgs) => Promise<TResult>,
): {
  mutate: (...args: TArgs) => Promise<TResult | null>;
  loading: boolean;
  error: string | null;
  reset: () => void;
} {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mutate = React.useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setLoading(true);
      setError(null);

      try {
        return await mutator(...args);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [mutator],
  );

  return { mutate, loading, error, reset: () => setError(null) };
}

/* -------------------------------------------------------------------------- */
/* Debounced value                                                            */
/* -------------------------------------------------------------------------- */

/** Debounces a rapidly-changing value — search inputs, filter sliders. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

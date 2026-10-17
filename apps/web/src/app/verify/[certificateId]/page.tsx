'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BadgeCheck, CalendarDays, CircleAlert, ShieldCheck } from 'lucide-react';
import type { CertificateVerification } from '@campusconnect/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { get } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { formatDate } from '@/lib/utils';

export default function VerifyCertificatePage() {
  const { certificateId } = useParams<{ certificateId: string }>();
  const verification = useAsync(() => get<CertificateVerification>(`/certificates/verify/${encodeURIComponent(certificateId)}`, { anonymous: true }), { deps: [certificateId] });
  const result = verification.data;

  return (
    <main className="container flex min-h-[70vh] max-w-3xl flex-col justify-center py-12">
      <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> CampusConnect home</Link>
      {verification.loading ? <div className="shimmer h-80 rounded-2xl bg-muted" aria-busy="true" /> : verification.error ? (
        <ErrorState title="Verification is temporarily unavailable" description={verification.error} requestId={verification.requestId} onRetry={() => void verification.refetch()} />
      ) : result ? (
        <Card className="overflow-hidden p-0" variant="elevated">
          <div className={`px-6 py-7 text-white sm:px-8 ${result.valid ? 'bg-gradient-to-r from-emerald-700 to-teal-600' : 'bg-gradient-to-r from-slate-700 to-slate-600'}`}>
            <div className="flex items-center gap-3">{result.valid ? <BadgeCheck className="size-8" /> : <CircleAlert className="size-8" />}<div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/75">CampusConnect certificate check</p><h1 className="mt-1 text-2xl font-bold">{result.valid ? 'Certificate verified' : result.status === 'REVOKED' ? 'Certificate revoked' : 'Certificate not found'}</h1></div></div>
          </div>
          <div className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2"><Badge variant={result.valid ? 'verified' : 'neutral'}><ShieldCheck className="size-3.5" /> {result.status}</Badge><span className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs">{result.certificateId}</span></div>
            {result.valid ? (
              <>
                <p className="text-sm leading-6 text-muted-foreground">This record confirms that <span className="font-semibold text-foreground">{result.recipientName}</span> earned the certificate below from <span className="font-semibold text-foreground">{result.issuer.collegeName}</span>.</p>
                <dl className="grid gap-5 rounded-xl border border-border p-4 sm:grid-cols-2 sm:p-5">
                  <VerifyField label="Recipient" value={result.recipientName} />
                  <VerifyField label="Issued by" value={result.issuer.collegeName} />
                  <VerifyField label="Achievement" value={result.event?.title ?? result.course?.title ?? result.type.replaceAll('_', ' ')} />
                  <VerifyField label="Issued on" value={result.issuedAt ? formatDate(result.issuedAt) : '—'} />
                  {result.event && <div className="flex items-start gap-2 text-sm text-muted-foreground"><CalendarDays className="mt-0.5 size-4" /><span>Event held {formatDate(result.event.startAt)}{result.event.venue ? ` · ${result.event.venue}` : ''}</span></div>}
                </dl>
              </>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">We could not confirm an active certificate with this ID. Check the ID printed on the document or contact the issuing institution.</p>
            )}
            {result.revokedReason && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Revocation note: {result.revokedReason}</p>}
            <p className="text-xs text-muted-foreground">Checked {formatDate(result.verifiedAt)} · Verification shows only the recipient name, issuing college, achievement and issue date.</p>
            <Button variant="outline" asChild><Link href="/events">Explore campus events</Link></Button>
          </div>
        </Card>
      ) : null}
    </main>
  );
}

function VerifyField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>;
}

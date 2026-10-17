'use client';

import * as React from 'react';
import Link from 'next/link';
import { Award, Download, ExternalLink, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useList } from '@/hooks/use-api';
import { get } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type Certificate = {
  id: string;
  certificateId: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  position: string | null;
  issuedAt: string;
  event: { title: string; slug: string; startAt: string } | null;
  college: { name: string };
};

export default function CertificatesPage() {
  const certificates = useList<Certificate>('/certificates/mine', { initialParams: { pageSize: 50, sortBy: 'issuedAt', sortOrder: 'desc' } });
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const download = async (certificate: Certificate) => {
    setDownloading(certificate.certificateId);
    try {
      const result = await get<{ url: string }>(`/certificates/${certificate.certificateId}/download`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The certificate PDF could not be prepared');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Verified achievements</p><h1 className="mt-1 text-2xl font-bold tracking-tight">My certificates</h1><p className="mt-2 text-sm text-muted-foreground">Certificates are linked to the events you attended and can be verified by anyone with the public link.</p></div>
      <div className="mt-7">
        {certificates.loading ? <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((key) => <div key={key} className="shimmer h-28 rounded-xl bg-muted" />)}</div> : certificates.error ? (
          <ErrorState title="Could not load your certificates" description={certificates.error} requestId={certificates.requestId} onRetry={() => void certificates.refetch()} />
        ) : certificates.items.length === 0 ? (
          <EmptyState icon={<Award />} title="Your certificates will appear here" description="Attend a certificate-enabled event. The organiser can issue your verified certificate after check-in." action={<Button asChild><Link href="/events">Find an event</Link></Button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {certificates.items.map((certificate) => (
              <Card key={certificate.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><Award className="size-5" /></div><StatusBadge status={certificate.status} /></div>
                <h2 className="mt-4 text-base font-semibold">{certificate.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{certificate.event?.title ?? certificate.type.replaceAll('_', ' ')} · {certificate.college.name}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2"><Badge variant="outline" className="font-mono">{certificate.certificateId}</Badge><span className="text-xs text-muted-foreground">Issued {formatDate(certificate.issuedAt)}</span></div>
                {certificate.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{certificate.description}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  {certificate.status === 'ISSUED' && <Button size="sm" loading={downloading === certificate.certificateId} onClick={() => void download(certificate)}><Download className="size-4" /> Download PDF</Button>}
                  <Button size="sm" variant="outline" asChild><Link href={`/verify/${certificate.certificateId}`}><ShieldCheck className="size-4" /> Verify</Link></Button>
                  {certificate.event && <Link className="inline-flex h-9 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground" href={`/events/${certificate.event.slug}`}><ExternalLink className="size-3.5" /> Event</Link>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

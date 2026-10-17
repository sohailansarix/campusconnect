import Link from 'next/link';
import { ArrowRight, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function PhaseNotice({ product, phase, description, href = '/dashboard', linkLabel = 'Return to your dashboard' }: { product: string; phase: string; description: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-3xl items-center justify-center">
      <Card className="w-full p-8 text-center sm:p-12" variant="elevated">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Layers3 className="size-7" /></span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">{product} · {phase}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">This workspace is coming in a later phase</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        <Button className="mt-6" variant="outline" asChild><Link href={href}>{linkLabel}<ArrowRight className="size-4" /></Link></Button>
      </Card>
    </div>
  );
}

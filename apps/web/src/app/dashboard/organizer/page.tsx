'use client';

import Link from 'next/link';
import { ArrowRight, Award, CalendarPlus, CalendarRange, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSession } from '@/lib/session';

export default function OrganizerHomePage() {
  const { user } = useSession();

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <div><p className="text-sm font-medium text-primary">Campus operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Welcome, {user?.fullName.split(' ')[0] ?? 'organiser'}</h1><p className="mt-2 text-sm text-muted-foreground">Create events, check in attendees and turn participation into verified certificates.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <ActionCard icon={<CalendarRange />} title="Manage events" description="Review your event status and keep registrations moving." href="/dashboard/organizer/events" action="Open events" />
        <ActionCard icon={<CalendarPlus />} title="Create an event" description="Start a draft, then send it through the college approval workflow." href="/dashboard/organizer/events/new" action="Create event" />
        <ActionCard icon={<ScanLine />} title="Scan attendance" description="Use the event QR scanner and audited manual check-in fallback." href="/dashboard/organizer/scan" action="Open scanner" />
        <ActionCard icon={<Award />} title="Issue certificates" description="Bulk issue certificates to students with a verified check-in." href="/dashboard/organizer/certificates" action="Issue certificates" />
      </div>
      <Card className="flex flex-wrap items-center justify-between gap-4 border-primary/20 bg-primary/[0.035]"><div><p className="font-semibold">Approval queue</p><p className="mt-1 text-sm text-muted-foreground">Faculty and college admins can review submitted event proposals.</p></div><Button variant="outline" asChild><Link href="/dashboard/organizer/approvals">Review pending events <ArrowRight className="size-4" /></Link></Button></Card>
    </div>
  );
}

function ActionCard({ icon, title, description, href, action }: { icon: React.ReactNode; title: string; description: string; href: string; action: string }) {
  return <Card className="flex flex-col"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{description}</p><Button className="mt-5 self-start" variant="outline" asChild><Link href={href}>{action}<ArrowRight className="size-4" /></Link></Button></Card>;
}

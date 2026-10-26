'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { CircuitSvg } from '@/components/circuit/CircuitSvg';
import type { SceneProgress } from '@/components/circuit/CircuitScene';
import { LazyStage } from '@/components/motion/LazyStage';
import { RollingNumber } from '@/components/motion/RollingNumber';
import { Reveal } from '@/components/motion/Reveal';
import { BrakeIn } from '@/components/motion/BrakeIn';
import { Button, DataTable, Field, Input, Select, Checkbox, Tabs, Text, Heading, type Column } from '@/components/ds';

const CircuitScene = dynamic(() => import('@/components/circuit/CircuitScene'), { ssr: false });

export interface DemoStanding {
  position: number;
  name: string;
  team: string;
  color: string;
  points: number;
  wins: number;
}

const columns: Column<DemoStanding>[] = [
  { key: 'pos', header: 'Pos', numeric: true, width: '3.5rem', cell: (r) => r.position },
  { key: 'name', header: 'Driver', rowHeader: true, cell: (r) => <span className="font-[650]">{r.name}</span> },
  { key: 'team', header: 'Team', hideBelow: 'sm', cell: (r) => <span className="text-fg-2">{r.team}</span> },
  { key: 'wins', header: 'Wins', numeric: true, hideBelow: 'md', cell: (r) => r.wins },
  { key: 'pts', header: 'Points', numeric: true, cell: (r) => <span className="font-[650]">{r.points}</span> },
];

export function StandingsTabs({ drivers, constructors, caption }: { drivers: DemoStanding[]; constructors: DemoStanding[]; caption: string }) {
  const teamColumns: Column<DemoStanding>[] = [
    { key: 'pos', header: 'Pos', numeric: true, width: '3.5rem', cell: (r) => r.position },
    { key: 'name', header: 'Constructor', rowHeader: true, cell: (r) => <span className="font-[650]">{r.name}</span> },
    { key: 'wins', header: 'Wins', numeric: true, hideBelow: 'sm', cell: (r) => r.wins },
    { key: 'pts', header: 'Points', numeric: true, cell: (r) => <span className="font-[650]">{r.points}</span> },
  ];
  return (
    <Tabs
      label="Standings"
      items={[
        { id: 'drivers', label: 'Drivers', content: <DataTable caption={`${caption}: drivers`} columns={columns} rows={drivers} rowKey={(r) => r.name} accent={(r) => r.color} highlight={(r) => r.position === 1} highlightLabel="championship leader" /> },
        { id: 'constructors', label: 'Constructors', content: <DataTable caption={`${caption}: constructors`} columns={teamColumns} rows={constructors} rowKey={(r) => r.name} accent={(r) => r.color} density="compact" /> },
      ]}
    />
  );
}

/** The real next circuit: WebGL when allowed and in view, the SVG outline otherwise. */
export function CircuitStage({ circuitId, name }: { circuitId: string; name: string }) {
  const [progress] = useState<SceneProgress>(() => ({ current: 1 }));
  return (
    <LazyStage
      label={`${name} circuit layout`}
      className="aspect-[4/3] w-full bg-surface-1"
      fallback={<CircuitSvg circuitId={circuitId} className="aspect-[4/3] w-full p-[8%] text-ink" title={`${name} circuit layout`} />}
    >
      {({ ready }) => <CircuitScene circuitId={circuitId} progress={progress} onReady={ready} className="absolute inset-0" />}
    </LazyStage>
  );
}

/** Rolling digits driven by a real control, not a fake ticker. */
export function RollingDemo({ start }: { start: number }) {
  const [value, setValue] = useState(start);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <span className="font-display text-stat-xl font-normal-width text-fg"><RollingNumber value={value} /></span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setValue((v) => Math.max(0, v - 1))} aria-label="Decrease">−1</Button>
        <Button variant="secondary" onClick={() => setValue((v) => v + 1)} aria-label="Increase">+1</Button>
        <Button variant="ghost" onClick={() => setValue((v) => v + 25)}>+25</Button>
      </div>
    </div>
  );
}

export function RevealDemo({ surname, caption }: { surname: string; caption: string }) {
  return (
    <Reveal className="grid gap-4">
      <div data-reveal>
        <Heading level={3} size="display-l">
          <BrakeIn>{surname}</BrakeIn>
        </Heading>
      </div>
      <Text data-reveal tone="muted" measure>{caption}</Text>
    </Reveal>
  );
}

export function FormDemo() {
  const [email, setEmail] = useState('');
  const invalid = email.length > 0 && !/^\S+@\S+\.\S+$/.test(email);
  return (
    <form className="grid max-w-xl gap-6" onSubmit={(e) => e.preventDefault()} aria-label="Field states (preview, does not submit)">
      <Field label="Email address" hint="Preview only: this form does not send anything." error={invalid ? 'Enter an email address like name@example.com.' : undefined}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" />
      </Field>
      <Field label="Favourite circuit" optional>
        <Select defaultValue="">
          <option value="" disabled>Choose a circuit</option>
          <option>Suzuka</option>
          <option>Spa-Francorchamps</option>
          <option>Interlagos</option>
        </Select>
      </Field>
      <Checkbox label="Race-week edition" description="One email before each Grand Prix." />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" icon="arrow-right">Primary action</Button>
        <Button type="button" variant="secondary">Secondary</Button>
        <Button type="button" variant="ghost">Ghost</Button>
        <Button type="button" loading>Saving</Button>
        <Button type="button" disabled>Disabled</Button>
      </div>
    </form>
  );
}

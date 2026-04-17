"use client";

import { Filter, Frown, Plus, Search } from "lucide-react";
import { Badge } from "../_components/ui/badge";
import { Button } from "../_components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, CardMeta, CardTitle } from "../_components/ui/card";
import { Chip } from "../_components/ui/chip";
import { EmptyState } from "../_components/ui/empty-state";
import { IconButton } from "../_components/ui/icon-button";
import { Skeleton } from "../_components/ui/skeleton";

export default function DesignPage() {
  return (
    <div className="max-w-5xl mx-auto p-8 space-y-12">
      <header>
        <h1 className="text-[24px] leading-[32px] font-semibold tracking-[-0.01em] text-foreground">
          Beeb Sheets — Design System
        </h1>
        <p className="text-[12px] leading-[16px] font-medium tracking-[0.01em] text-muted mt-2">
          Dev-only showcase of shared UI primitives. Never linked from the app.
        </p>
      </header>

      <Section title="Typography">
        <div className="space-y-3">
          <p className="text-[24px] leading-[32px] font-semibold tracking-[-0.01em] text-foreground">Display / 24px / 600</p>
          <p className="text-[18px] leading-[24px] font-semibold tracking-[-0.005em] text-foreground">Title / 18px / 600</p>
          <p className="text-[14px] leading-[20px] text-foreground">Body / 14px / 400</p>
          <p className="text-[12px] leading-[16px] font-medium tracking-[0.01em] text-foreground">Label / 12px / 500</p>
          <p className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted">Caption / 11px / 500</p>
          <p className="text-[10px] leading-[12px] font-semibold tracking-[0.04em] uppercase text-muted">Micro / 10px / 600 / UPPER</p>
        </div>
      </Section>

      <Section title="Button variants">
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="primary" loading>Loading</Button>
        </div>
        <div className="flex flex-wrap gap-3 items-center mt-4">
          <Button size="sm" variant="secondary" leadingIcon={Plus}>Small</Button>
          <Button size="md" variant="secondary" leadingIcon={Plus}>Medium</Button>
          <Button size="lg" variant="secondary" leadingIcon={Plus}>Large</Button>
        </div>
      </Section>

      <Section title="Icon button">
        <div className="flex gap-3">
          <IconButton icon={Search} aria-label="Search" variant="ghost" size="sm" />
          <IconButton icon={Search} aria-label="Search" variant="ghost" size="md" />
          <IconButton icon={Search} aria-label="Search" variant="ghost" size="lg" />
          <IconButton icon={Filter} aria-label="Filter" variant="solid" size="md" />
        </div>
      </Section>

      <Section title="Card variants">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card variant="default">
            <CardHeader>
              <div>
                <CardTitle>Default card</CardTitle>
                <CardMeta>Base surface, subtle border</CardMeta>
              </div>
              <Badge variant="accent">Default</Badge>
            </CardHeader>
            <CardBody>
              <p className="text-[14px] leading-[20px] text-muted">Body content lives here.</p>
            </CardBody>
          </Card>

          <Card variant="raised">
            <CardHeader>
              <div>
                <CardTitle>Raised card</CardTitle>
                <CardMeta>For emphasis</CardMeta>
              </div>
              <Badge variant="success">Live</Badge>
            </CardHeader>
            <CardBody>
              <p className="text-[14px] leading-[20px] text-muted">Shadow + brighter surface.</p>
            </CardBody>
            <CardFooter>
              <Button size="sm" variant="ghost">Cancel</Button>
              <Button size="sm" variant="primary">Save</Button>
            </CardFooter>
          </Card>

          <Card variant="sunken" padding="sm">
            <p className="text-[12px] text-muted">Sunken card, used for filter bars and toolbars.</p>
          </Card>

          <Card variant="outline" interactive>
            <CardTitle>Outline + interactive</CardTitle>
            <CardMeta>Hover me</CardMeta>
          </Card>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="neutral" size="sm">sm</Badge>
          <Badge variant="accent" size="sm">sm</Badge>
        </div>
      </Section>

      <Section title="Chips">
        <div className="flex flex-wrap gap-2 items-center">
          <Chip>All</Chip>
          <Chip selected>Selected</Chip>
          <Chip count={12}>With count</Chip>
          <Chip selected count={3} onRemove={() => {}}>Removable</Chip>
          <Chip size="sm">Small</Chip>
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="space-y-3">
          <Skeleton shape="text" w="40%" />
          <Skeleton shape="text" w="70%" />
          <Skeleton shape="rect" h={48} />
          <div className="flex gap-3 items-center">
            <Skeleton shape="circle" w={32} h={32} />
            <Skeleton shape="text" w={120} />
          </div>
        </div>
      </Section>

      <Section title="Empty state">
        <Card variant="default">
          <EmptyState
            icon={Frown}
            title="No matchups found"
            description="Try adjusting your filters or check back when today's lineups post."
            action={<Button variant="secondary" size="sm">Clear filters</Button>}
          />
        </Card>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[10px] leading-[12px] font-semibold tracking-[0.04em] uppercase text-muted mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

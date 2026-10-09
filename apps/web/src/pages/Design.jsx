/* /design — living gallery of @mirqam/ui. This is the visual contract with
   Mirqam Bot: review it in light/dark and AR/EN before shipping UI changes.
   Developer-facing page; copy here is intentionally not translated. */
import * as UI from '@mirqam/ui'
import { useState } from 'react'
import { LocaleToggle } from '../components/AppShell.jsx'
import PassPreview from '../components/PassPreview.jsx'

const { Badge, Button, Card, CompanyIdentity, EmptyState, Field, Input, Logo, Modal, Pattern, Select, Skeleton, Stat, Textarea, ThemeToggle, useToast } = UI

const swatches = [
  ['NAVY', 'bg-navy-800', '#172740 · primary actions'],
  ['INK', 'bg-navy-950', '#0e1726 · sidebar, hero, toasts'],
  ['TEAL', 'bg-brand-500', '#23949a · focus, indicators'],
  ['ACCESSIBLE TEAL', 'bg-brand-700', '#0f6f74 · small teal text'],
  ['CLOUD', 'bg-sand-50', '#f5f7f8 · page'],
  ['ICE', 'bg-sand-100', '#eaf4f4 · tinted panels'],
  ['SLATE', 'bg-slate-500', '#69788a · secondary text'],
]
const semantic = ['canvas', 'surface', 'soft', 'tint', 'line', 'primary', 'accent', 'muted']
const icons = Object.entries(UI).filter(([name]) => /^Mq[A-Z]/.test(name))

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

export default function Design() {
  const [modal, setModal] = useState(false)
  const toast = useToast()
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-10">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Logo className="h-12" label="نقاط" sublabel="LOYALTY & GIFT CARDS" />
        <div className="flex gap-2">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>
      <h1 className="mb-2 text-3xl font-bold">@mirqam/ui</h1>
      <p className="mb-10 text-sm text-muted">Mirqam unified design language — tokens, primitives, icons. Toggle theme and direction to review every state.</p>

      <Section title="Brand palette">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {swatches.map(([name, cls, note]) => (
            <div key={name} className="mq-card overflow-hidden">
              <div className={`h-16 ${cls}`} />
              <div className="p-3 text-xs">
                <p className="font-bold">{name}</p>
                <p className="text-muted">{note}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 mb-2 text-xs font-semibold text-muted">Semantic tokens (switch with theme)</p>
        <div className="flex flex-wrap gap-2">
          {semantic.map((s) => (
            <span key={s} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs">
              <i className="h-4 w-4 rounded-full border border-line" style={{ background: `var(--color-${s})` }} />
              {s}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Typography — IBM Plex Sans Arabic">
        <Card>
          <p className="text-[clamp(32px,4vw,56px)] font-bold leading-snug tracking-[-1.2px]">ولاء عملائك في محفظتهم</p>
          <p className="mt-2 text-2xl font-bold">عنوان القسم · Section heading</p>
          <p className="mt-2 text-base leading-loose text-muted">نص المحتوى بارتفاع سطر 1.8 لقراءة عربية مريحة. Body copy at 1.8 line-height.</p>
          <p className="tnum mt-3 text-3xl font-bold">1,234,567 · 0123456789</p>
        </Card>
      </Section>

      <Section title="Buttons & badges">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary (navy)</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['green', 'blue', 'amber', 'red', 'teal', 'gray'].map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Form controls">
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="رقم الجوال" hint="Hint text">
              {(p) => <Input {...p} dir="ltr" placeholder="05XXXXXXXX" />}
            </Field>
            <Field label="With error" error="رقم الجوال غير صحيح">
              {(p) => <Input {...p} defaultValue="123" />}
            </Field>
            <Field label="Select">
              {(p) => (
                <Select {...p}>
                  <option>نقاط</option>
                  <option>أختام</option>
                </Select>
              )}
            </Field>
            <Field label="Textarea">{(p) => <Textarea {...p} rows={2} />}</Field>
          </div>
        </Card>
      </Section>

      <Section title="Cards, stats, empty & loading">
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="الأعضاء" value="1,284" hint="+42 خلال 30 يوماً" icon={UI.MqUsers} />
          <Stat label="رصيد قائم" value="58,900" icon={UI.MqCoins} tone="amber" />
          <Stat label="مكتسبة" value="210,450" icon={UI.MqTrendUp} tone="green" />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card title="Empty state" bodyClass="">
            <EmptyState icon={UI.MqUsers} title="لا يوجد أعضاء بعد" desc="أضف أول عميل من شاشة الكاشير." action={<Button size="sm">إضافة</Button>} />
          </Card>
          <Card title="Skeleton">
            <Skeleton rows={2} />
          </Card>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setModal(true)}>Open modal</Button>
          <Button variant="outline" onClick={() => toast('تم الحفظ بنجاح')}>
            Toast
          </Button>
          <Button variant="outline" onClick={() => toast('تعذر الحفظ', 'err')}>
            Error toast
          </Button>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="عنوان النافذة" footer={<Button onClick={() => setModal(false)}>تم</Button>}>
          <p className="text-sm">Scale-only entry, opaque from frame one, no backdrop blur (anti-flicker rule).</p>
        </Modal>
      </Section>

      <Section title="Wallet pass mock (Phase 2 makes this real)">
        <div className="flex flex-wrap gap-6">
          <PassPreview
            merchant="مقهى السحاب"
            programName="بطاقة القهوة"
            type="stamps"
            balance={7}
            memberName="نورة"
            labels={{ balance: 'أختام', member: 'العضو' }}
          />
          <PassPreview merchant="Cloud Café" programName="Rewards" balance={1250} memberName="Noura" labels={{ balance: 'Points', member: 'Member' }} />
        </div>
      </Section>

      <Section title={`Icons (${icons.length}) — 48 grid · 2.35 stroke · qaf-diamond`}>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-12">
          {icons.map(([name, Icon]) => (
            <div key={name} title={name} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface p-2">
              <Icon className="h-6 w-6" />
              <span className="w-full truncate text-center text-[8px] text-muted" dir="ltr">
                {name.slice(2)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Patterns & brand panels">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="mp-welcome relative h-40 overflow-hidden rounded-[28px] text-brand-300">
            <Pattern variant="waves" opacity={0.15} />
          </div>
          <div className="mp-welcome relative h-40 overflow-hidden rounded-[28px] text-brand-300">
            <Pattern variant="diamonds" opacity={0.12} />
          </div>
        </div>
      </Section>

      <Section title="Company identity (required on public pages)">
        <CompanyIdentity />
      </Section>
    </div>
  )
}

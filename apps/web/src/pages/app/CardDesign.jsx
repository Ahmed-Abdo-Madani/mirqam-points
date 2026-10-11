import { Button, Field, Input } from '@mirqam/ui'
import { BACK_FIELDS, BARCODES, FRONT_FIELDS, LAYOUTS, MAX_NOTES, STAMP_SHAPES, TEMPLATES } from '@mirqam-points/shared'
import PassPreview from '../../components/PassPreview.jsx'
import { useI18n } from '../../i18n/index.jsx'

/* Labels the wallet card prints, in the console's language. */
export function passLabels(t, type) {
  return {
    balance: t(type === 'stamps' ? 'pass.stamps' : 'pass.points'),
    member: t('pass.member'),
    remaining: t('design.front.remaining'),
    lifetime: t('design.front.lifetime'),
    code: t('design.front.code'),
    reward: t('design.back.reward'),
    terms: t('design.back.terms'),
    link: t('design.back.link'),
    termsText: t('design.termsText'),
    rewardReady: t('members.rewardReady'),
  }
}

const COLOR_KEYS = ['background', 'foreground', 'label']

function TemplateCard({ tpl, active, onPick, name }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={`grid gap-1.5 rounded-2xl border p-2 text-start transition ${active ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line hover:border-brand-500/50'}`}
    >
      <span className="flex h-12 items-end justify-between rounded-xl p-2" style={{ background: tpl.background, color: tpl.foreground }}>
        <span className="h-2.5 w-8 rounded-full" style={{ background: tpl.label }} />
        <span className="flex gap-1">
          {[1, 2, 3].map((n) => (
            <span key={n} className="h-2.5 w-2.5 rounded-full" style={{ background: tpl.stampColor, opacity: n < 3 ? 1 : 0.3 }} />
          ))}
        </span>
      </span>
      <span className="text-xs font-semibold">{name}</span>
    </button>
  )
}

function Check({ checked, disabled, onChange, children }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="h-4 w-4 accent-brand-600" />
      {children}
    </label>
  )
}

export function CardDesignForm({ design, type, onChange }) {
  const { t } = useI18n()
  const stamps = type === 'stamps'
  const set = (patch) => onChange({ ...design, ...patch })
  const toggle = (key, value, max) => {
    const list = design[key]
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value].slice(0, max)
    set({ [key]: next })
  }
  const notes = design.notes ?? []
  const setNote = (i, patch) => set({ notes: notes.map((n, j) => (j === i ? { ...n, ...patch } : n)) })
  const layouts = LAYOUTS.filter((l) => l !== 'strip' || stamps)

  return (
    <div className="grid gap-5">
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">{t('design.templates')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.filter((tpl) => stamps || !tpl.stampsOnly).map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              name={t(`design.template.${tpl.id}`)}
              active={design.background === tpl.background && design.layout === tpl.layout && design.label === tpl.label}
              onPick={() =>
                set({
                  layout: tpl.layout,
                  background: tpl.background,
                  foreground: tpl.foreground,
                  label: tpl.label,
                  stampColor: tpl.stampColor,
                  stampShape: tpl.stampShape,
                })
              }
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">{t('design.layoutLabel')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {layouts.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={design.layout === l}
              onClick={() => set({ layout: l })}
              className={`rounded-2xl border p-3 text-start transition ${design.layout === l ? 'border-brand-500 bg-tint' : 'border-line hover:border-brand-500/50'}`}
            >
              <span className="block text-sm font-bold">{t(`design.layout.${l}`)}</span>
              <span className="mt-0.5 block text-xs text-muted">{t(`design.layoutHint.${l}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className={`grid gap-3 ${stamps ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {[...COLOR_KEYS, ...(stamps ? ['stampColor'] : [])].map((k) => (
          <label key={k} className="grid gap-1.5 text-xs font-semibold">
            {k === 'stampColor' ? t('design.stampColor') : t(`programs.color.${k}`)}
            <input
              type="color"
              value={design[k]}
              onChange={(e) => set({ [k]: e.target.value })}
              className="h-11 w-full cursor-pointer rounded-xl border border-line bg-surface p-1"
            />
          </label>
        ))}
      </div>

      {stamps && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">{t('design.shapeLabel')}</legend>
          <div className="flex flex-wrap gap-2">
            {STAMP_SHAPES.map((s) => (
              <Button key={s} type="button" size="sm" variant={design.stampShape === s ? 'primary' : 'outline'} onClick={() => set({ stampShape: s })}>
                {t(`design.shape.${s}`)}
              </Button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">{t('design.barcodeLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {BARCODES.map((b) => (
            <Button key={b} type="button" size="sm" variant={design.barcode === b ? 'primary' : 'outline'} onClick={() => set({ barcode: b })}>
              {t(`design.barcode.${b}`)}
            </Button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">{t('design.barcodeHint')}</p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold">{t('design.frontLabel')}</legend>
        <p className="mb-2 text-xs text-muted">{t('design.frontHint')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FRONT_FIELDS.filter((f) => f !== 'remaining' || stamps).map((f) => (
            <Check
              key={f}
              checked={design.front.includes(f)}
              disabled={!design.front.includes(f) && design.front.length >= 3}
              onChange={() => toggle('front', f, 3)}
            >
              {t(`design.front.${f}`)}
            </Check>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('design.backLabel')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BACK_FIELDS.map((f) => (
            <Check key={f} checked={design.back.includes(f)} onChange={() => toggle('back', f, BACK_FIELDS.length)}>
              {t(`design.back.${f}`)}
            </Check>
          ))}
        </div>
        <Field label={t('programs.rewardText')} hint={t('programs.rewardTextHint')} className="mt-3">
          {(p) => <Input {...p} value={design.rewardText ?? ''} onChange={(e) => set({ rewardText: e.target.value })} maxLength={140} />}
        </Field>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold">{t('design.notesLabel')}</legend>
        <p className="mb-2 text-xs text-muted">{t('design.notesHint')}</p>
        <div className="grid gap-2">
          {notes.map((n, i) => (
            <div key={i} className="grid gap-2 rounded-2xl border border-line p-3 sm:grid-cols-[1fr_2fr_auto]">
              <Input
                aria-label={t('design.noteLabel')}
                placeholder={t('design.noteLabel')}
                value={n.label}
                maxLength={40}
                onChange={(e) => setNote(i, { label: e.target.value })}
              />
              <Input
                aria-label={t('design.noteValue')}
                placeholder={t('design.noteValue')}
                value={n.value}
                maxLength={400}
                onChange={(e) => setNote(i, { value: e.target.value })}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => set({ notes: notes.filter((_, j) => j !== i) })}>
                {t('design.noteRemove')}
              </Button>
            </div>
          ))}
        </div>
        {notes.length < MAX_NOTES && (
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set({ notes: [...notes, { label: '', value: '' }] })}>
            {t('design.noteAdd')}
          </Button>
        )}
      </fieldset>
    </div>
  )
}

/** Front/back preview of the card with a side switch. */
export function CardPreview({ side, onSide, merchant, logoUrl, programName, type, stampsRequired, memberName, design }) {
  const { t } = useI18n()
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{t('programs.passPreview')}</p>
        <fieldset className="flex gap-1 border-0 p-0">
          {['front', 'back'].map((s) => (
            <Button key={s} type="button" size="sm" variant={side === s ? 'primary' : 'ghost'} onClick={() => onSide(s)}>
              {t(s === 'front' ? 'design.previewFront' : 'design.previewBack')}
            </Button>
          ))}
        </fieldset>
      </div>
      <PassPreview
        side={side}
        merchant={merchant}
        logoUrl={logoUrl}
        programName={programName}
        type={type}
        balance={type === 'stamps' ? Math.min(3, stampsRequired) : 120}
        stampsRequired={stampsRequired}
        lifetime={type === 'stamps' ? 12 : 480}
        memberName={memberName}
        labels={passLabels(t, type)}
        design={design}
      />
      <p className="mt-2 max-w-[340px] text-xs text-muted">{t('design.previewNote')}</p>
    </div>
  )
}

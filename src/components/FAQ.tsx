import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { NavigateTarget } from '../data/studioData';
import { useLanguage } from '../i18n/LanguageContext';

type FaqCategory = 'todas' | 'agendamento' | 'dor' | 'politicas';

interface FaqItemMeta {
  id: string;
  category: Exclude<FaqCategory, 'todas'>;
  actionTab?: NavigateTarget;
}

const FAQ_META: FaqItemMeta[] = [
  { id: 'como-agendar', category: 'agendamento', actionTab: 'orcamento' },
  { id: 'preparo-sessao', category: 'agendamento' },
  { id: 'duracao-sessao', category: 'agendamento' },
  { id: 'areas-menos-sensiveis', category: 'dor', actionTab: 'mapa' },
  { id: 'areas-muito-sensiveis', category: 'dor', actionTab: 'mapa' },
  { id: 'anestesico-pausas', category: 'dor' },
  { id: 'politica-sinal', category: 'politicas' },
  { id: 'idade-anamnese', category: 'politicas' },
  { id: 'biosseguranca-materiais', category: 'politicas' },
  { id: 'clube-indicacao', category: 'politicas', actionTab: 'indicacao' },
];

interface FAQProps {
  onNavigateTab: (tab: NavigateTarget) => void;
  studioWhatsapp: string;
}

export const FAQ: React.FC<FAQProps> = ({ onNavigateTab, studioWhatsapp }) => {
  const { domain } = useLanguage();
  const faq = domain.faq;

  const [category, setCategory] = useState<FaqCategory>('todas');
  const [openId, setOpenId] = useState<string | null>(FAQ_META[0].id);

  const visibleItems =
    category === 'todas'
      ? FAQ_META
      : FAQ_META.filter((item) => item.category === category);

  const waUrl = `https://wa.me/${studioWhatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(faq.waPrefill)}`;

  return (
    <section className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2">
        <div
          className="text-sm font-bold tracking-widest uppercase"
          style={{ color: 'var(--accent-gold)' }}
        >
          {faq.kicker}
        </div>
        <h2>{faq.title}</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          {faq.lead}
        </p>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={faq.filterAria}>
        {(
          [
            ['todas', faq.categories.todas],
            ['agendamento', faq.categories.agendamento],
            ['dor', faq.categories.dor],
            ['politicas', faq.categories.politicas],
          ] as [FaqCategory, string][]
        ).map(([key, label]) => {
          const active = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className="px-4 py-2 rounded border text-sm font-bold uppercase tracking-wider cursor-pointer transition-colors"
              style={{
                background: active ? 'var(--r)' : 'transparent',
                color: active ? 'var(--btn-text)' : 'var(--text)',
                borderColor: active ? 'var(--r)' : 'var(--border-strong)',
                minHeight: '44px',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Accordion List */}
      <div className="space-y-3">
        {visibleItems.map((item) => {
          const isOpen = openId === item.id;
          const localized = faq.items[item.id];
          if (!localized) return null;
          return (
            <div key={item.id} className="si-card p-0 overflow-hidden">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${item.id}`}
                onClick={() => setOpenId(isOpen ? null : item.id)}
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 cursor-pointer transition-colors"
                style={{
                  background: isOpen ? 'var(--card-alt)' : 'transparent',
                  color: 'var(--text)',
                  minHeight: '56px',
                }}
              >
                <div className="space-y-0.5">
                  <span
                    className="block text-xs font-bold uppercase tracking-wider"
                    style={{ color: 'var(--accent-gold)' }}
                  >
                    {localized.categoryLabel}
                  </span>
                  <span className="block text-xl font-bold leading-snug">
                    {localized.question}
                  </span>
                </div>
                <span className="shrink-0" style={{ color: 'var(--r)' }}>
                  {isOpen ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
                </span>
              </button>

              {isOpen && (
                <div
                  id={`faq-panel-${item.id}`}
                  className="px-5 pb-5 pt-3 border-t space-y-3"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <p className="text-lg leading-relaxed" style={{ color: 'var(--text)' }}>
                    {localized.answer}
                  </p>
                  {item.actionTab && localized.actionLabel && (
                    <button
                      type="button"
                      className="si-btn si-btn-outline si-btn-sm"
                      onClick={() => onNavigateTab(item.actionTab!)}
                    >
                      {localized.actionLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Direct Support Callout */}
      <div className="si-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h3 style={{ color: 'var(--accent-gold)' }}>{faq.stillDoubtsTitle}</h3>
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>
            {faq.stillDoubtsBody}
          </p>
        </div>
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="si-btn shrink-0"
        >
          {faq.askWhatsapp}
        </a>
      </div>
    </section>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { FileDown } from 'lucide-react';
import {
  ANAMNESE_QUESTIONS,
  BODY_PAIN_ZONES,
  formatBRL,
  QUOTE_STYLES,
  SIZE_TIERS,
  STUDIO_DEFAULTS,
} from '../data/studioData';
import { ClientUser, SavedQuote } from './AuthGateTab';
import { STUDIO_LOGO_URI } from '../assets/studioMedia';
import { fmt, useLanguage } from '../i18n/LanguageContext';
import { inspectForThreats } from '../services/securityGuard';
import { PriceRange } from '../services/studioSync';

interface QuoteSectionProps {
  user: ClientUser | null;
  selectedStyle: string;
  onChangeStyle: (s: string) => void;
  selectedZone: string;
  onChangeZone: (z: string) => void;
  publicCoupon: string;
  studioWhatsapp: string;
  studioInstagram?: string;
  studioName?: string;
  logoUrl?: string;
  sizeTierPrices?: PriceRange[];
  onSaveQuote: (q: SavedQuote) => void;
  onGoToLogin: () => void;
  onToast: (msg: string) => void;
  onPrintSheet: (html: string) => void;
}

export const QuoteSection: React.FC<QuoteSectionProps> = ({
  user,
  selectedStyle,
  onChangeStyle,
  selectedZone,
  onChangeZone,
  publicCoupon,
  studioWhatsapp,
  studioInstagram = STUDIO_DEFAULTS.instagram,
  studioName = STUDIO_DEFAULTS.studioName,
  logoUrl,
  sizeTierPrices,
  onSaveQuote,
  onGoToLogin,
  onToast,
  onPrintSheet,
}) => {
  const { domain, locale, tQuoteStyle, tZoneName } = useLanguage();
  const q = domain.quote;

  const [sizeIdx, setSizeIdx] = useState(0);
  const [couponInput, setCouponInput] = useState(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      return ref ? ref.toUpperCase().slice(0, 32) : '';
    } catch {
      return '';
    }
  });
  const [clientName, setClientName] = useState(user?.name || '');
  const [clientWa, setClientWa] = useState(user?.whatsapp || '');
  const [idea, setIdea] = useState('');
  const [photos, setPhotos] = useState<(File | null)[]>([null, null, null]);
  const [anamnese, setAnamnese] = useState<boolean[]>(() => ANAMNESE_QUESTIONS.map(() => false));
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [signed, setSigned] = useState(false);
  const [resultModal, setResultModal] = useState<{
    coupon: string;
    whatsappText: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  // Sync user defaults only when logged-in user identity changes (allows manual editing/clearing cleanly)
  useEffect(() => {
    const uid = user?.email || null;
    if (uid && lastUserIdRef.current !== uid) {
      lastUserIdRef.current = uid;
      setClientName(user?.name || '');
      setClientWa(user?.whatsapp || '');
    } else if (!uid) {
      lastUserIdRef.current = null;
    }
  }, [user]);

  // Preserve signature pixels across viewport resizes
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const fitCanvas = () => {
      const rect = cv.getBoundingClientRect();
      const targetW = Math.round(rect.width);
      const targetH = Math.round(rect.height);
      if (targetW <= 0 || targetH <= 0) return;
      if (cv.width === targetW && cv.height === targetH) return;

      let backup: string | null = null;
      if (cv.width > 0 && cv.height > 0 && signed) {
        try {
          backup = cv.toDataURL('image/png');
        } catch {
          backup = null;
        }
      }
      cv.width = targetW;
      cv.height = targetH;
      if (backup) {
        const img = new Image();
        img.onload = () => {
          const ctx = cv.getContext('2d');
          ctx?.drawImage(img, 0, 0, targetW, targetH);
        };
        img.src = backup;
      }
    };
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    return () => window.removeEventListener('resize', fitCanvas);
  }, [user, signed]);

  if (!user) {
    return (
      <section className="max-w-3xl mx-auto px-4 py-10">
        <div className="si-card tab-stagger-block space-y-4 text-center py-10">
          <div className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase" style={{ color: 'var(--accent-gold)' }}>
            {q.restrictedKicker}
          </div>
          <h2 className="tab-stagger-title">{q.restrictedTitle}</h2>
          <p className="tab-stagger-lead max-w-xl mx-auto text-lg" style={{ color: 'var(--text-muted)' }}>
            {q.restrictedBody}
          </p>
          <div className="tab-stagger-actions pt-2">
            <button type="button" className="si-btn" onClick={onGoToLogin}>
              {q.goToLogin}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const allZoneKeys = Array.from(new Set(BODY_PAIN_ZONES.map((z) => z.name))).concat('Outra região');
  const cleanCoupon = couponInput.trim().toUpperCase();
  const hasDiscount =
    cleanCoupon.length > 0 &&
    (cleanCoupon === publicCoupon.toUpperCase() || cleanCoupon === user.coupon.toUpperCase());

  const baseTier = SIZE_TIERS[sizeIdx] || SIZE_TIERS[0];
  const overrideTier = sizeTierPrices?.[sizeIdx];
  const minVal = overrideTier ? overrideTier.min : baseTier.min;
  const maxVal = overrideTier ? overrideTier.max : baseTier.max;

  const mult = hasDiscount ? 0.8 : 1;
  const estimateText = baseTier.startingFrom
    ? fmt(q.startingFrom, { val: formatBRL(minVal * mult) })
    : `${formatBRL(minVal * mult)} – ${formatBRL(maxVal * mult)}`;

  const selectedTierLabel = domain.sizeTiers[sizeIdx] || baseTier.label;
  const localizedStyle = tQuoteStyle(selectedStyle);
  const localizedZone = tZoneName(selectedZone);

  const attentionCount = anamnese.slice(0, 5).filter(Boolean).length;

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    drawingRef.current = true;
    setSigned(true);
    const pt = getCanvasPoint(e);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--r').trim() || '#F22929';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const pt = getCanvasPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (cv && ctx) {
      ctx.clearRect(0, 0, cv.width, cv.height);
    }
    setSigned(false);
  };

  const handleFinalize = () => {
    if (!inspectForThreats(clientName, 'Nome do orçamento').safe) return;
    if (!inspectForThreats(idea, 'Descrição da ideia').safe) return;

    const cleanName = clientName.replace(/[<>]/g, '').trim();
    const cleanWa = clientWa.replace(/\D/g, '');
    if (!cleanName || cleanWa.length < 10) {
      onToast(q.toastNeedContact);
      return;
    }
    if (!acceptedTerms || !signed) {
      onToast(q.toastNeedTerms);
      return;
    }

    const selectedAnamnese = domain.anamneseQuestions.filter((_, i) => anamnese[i]);
    const waMessage = `${fmt(q.waHello, { name: cleanName })}\n• ${q.waStyle}: ${localizedStyle}\n• ${q.waRegion}: ${localizedZone}\n• ${q.waSize}: ${selectedTierLabel}\n• ${q.waEstimate}: ${estimateText}${hasDiscount ? ' ' + q.discountApplied : ''}\n• ${q.waIdea}: ${idea.trim() || '—'}\n• ${q.waAnamnese}: ${selectedAnamnese.length ? fmt(q.waAnamneseEval, { count: selectedAnamnese.length }) : q.waAnamneseNone}\n• ${q.waTermsSigned}`;

    const photosCount = photos.filter(Boolean).length;
    onSaveQuote({
      id: String(Date.now()),
      date: new Date().toISOString(),
      style: localizedStyle,
      place: localizedZone,
      size: selectedTierLabel,
      estimate: estimateText,
      idea: idea.trim(),
      couponUsed: hasDiscount ? cleanCoupon : undefined,
      photosCount,
    });

    setResultModal({
      coupon: user.coupon || publicCoupon,
      whatsappText: waMessage,
    });
    onToast(q.toastSaved);
  };

  const handleBuildPDF = () => {
    const esc = (s: string) =>
      String(s || '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
    const selectedAnamnese = domain.anamneseQuestions.filter((_, i) => anamnese[i]);
    const photoLabels = q.photoLabels;
    let signatureDataUrl = '';
    if (signed && canvasRef.current) {
      try {
        signatureDataUrl = canvasRef.current.toDataURL('image/png');
      } catch {
        signatureDataUrl = '';
      }
    }
    const generatedAt = new Date().toLocaleString(locale);
    const activeLogo = logoUrl || STUDIO_LOGO_URI;
    const html = `
      <div class="ps-header">
        <div class="ps-brand">
          <img src="${activeLogo}" alt="Logo ${esc(studioName)}" class="ps-logo" />
          <div>
            <h1 style="font-size:24px;letter-spacing:0.04em;text-transform:uppercase">${esc(studioName)}</h1>
            <p style="margin:0;font-size:12px;color:#444">${esc(STUDIO_DEFAULTS.address)}</p>
            <p style="margin:0;font-size:12px;color:#444">WhatsApp: ${esc(studioWhatsapp)} · Instagram: @${esc(studioInstagram)}</p>
          </div>
        </div>
        <div style="text-align:right">
          <strong style="font-size:14px;text-transform:uppercase;color:#9c1f1f">${esc(q.pdfDocTitle)}</strong>
          <div style="font-size:11px;color:#444">${esc(fmt(q.pdfIssuedAt, { date: generatedAt }))}</div>
        </div>
      </div>

      <div class="ps-section">
        <h2 style="font-size:16px;text-transform:uppercase;color:#9c1f1f">${esc(q.pdfClientSection)}</h2>
        <div class="ps-grid">
          <p style="margin:2px 0"><b>${esc(q.pdfClient)}:</b> ${esc(clientName || user.name)}</p>
          <p style="margin:2px 0"><b>WhatsApp:</b> ${esc(clientWa || user.whatsapp)}</p>
          <p style="margin:2px 0"><b>E-mail:</b> ${esc(user.email)}</p>
          <p style="margin:2px 0"><b>${esc(q.pdfCoupon)}:</b> ${hasDiscount ? esc(cleanCoupon) + ' (20% off)' : esc(q.pdfNone)}</p>
          <p style="margin:2px 0"><b>${esc(q.styleLabel)}:</b> ${esc(localizedStyle)}</p>
          <p style="margin:2px 0"><b>${esc(q.zoneLabel)}:</b> ${esc(localizedZone)}</p>
          <p style="margin:2px 0"><b>${esc(q.pdfSizeSelected)}:</b> ${esc(selectedTierLabel)}</p>
          <p style="margin:2px 0"><b>${esc(q.pdfTermsAccepted)}:</b> ${acceptedTerms ? esc(q.pdfYes) : esc(q.pdfPending)}</p>
        </div>
        <p style="margin:8px 0 0 0"><b>${esc(q.pdfIdeaDesc)}:</b> ${esc(idea.trim() || q.pdfNotInformed)}</p>
      </div>

      <div class="ps-highlight">
        <div>
          <strong style="font-size:14px;text-transform:uppercase">${esc(q.pdfEstimateTitle)}</strong>
          <div style="font-size:11px;color:#444">${esc(q.pdfEstimateNote)}</div>
        </div>
        <div style="font-size:22px;font-weight:700;color:#9c1f1f">${esc(estimateText)}</div>
      </div>

      <div class="ps-section">
        <h3 style="font-size:15px;text-transform:uppercase">${esc(q.pdfAnamneseSection)}</h3>
        <p style="margin:4px 0 0 0">${
          selectedAnamnese.length
            ? selectedAnamnese.map((item) => `• ${esc(item)}`).join('<br>')
            : esc(q.pdfAnamneseNone)
        }</p>
      </div>

      <div class="ps-section">
        <h3 style="font-size:15px;text-transform:uppercase">${esc(q.pdfPhotosSection)}</h3>
        <p style="margin:4px 0 0 0">${photoLabels
          .map((lbl, i) => `<b>${esc(lbl)}:</b> ${esc(photos[i]?.name || q.pdfPhotoNotSent)}`)
          .join('<br>')}</p>
      </div>

      <div class="ps-section">
        <h3 style="font-size:15px;text-transform:uppercase">${esc(q.pdfContractSection)}</h3>
        <p style="margin:4px 0">${esc(q.pdfContractP1)}</p>
        <p style="margin:4px 0">${esc(q.pdfContractP2)}</p>
        <p style="margin:4px 0">${esc(fmt(q.pdfContractP3, { studio: studioName }))}</p>
        <p style="margin:4px 0 0 0"><b>${esc(q.pdfDigitalSig)}:</b> ${signed ? esc(q.pdfSigRecorded) : esc(q.pdfSigPending)}</p>
        ${
          signatureDataUrl
            ? `<img src="${signatureDataUrl}" alt="${esc(q.pdfSigLine)}" class="ps-sig-img" />`
            : `<p style="margin-top:34px">____________________________________<br>${esc(q.pdfSigLine)}</p>`
        }
      </div>

      <p style="font-size:11px;color:#555;margin-top:8px;text-align:center">
        ${esc(fmt(q.pdfFooter, { studio: studioName }))}
      </p>
    `;
    onPrintSheet(html);
    onToast(q.toastPdf);
    setTimeout(() => window.print(), 100);
  };

  return (
    <section className="max-w-4xl mx-auto px-4 py-8 space-y-5">
      <div>
        <div className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase" style={{ color: 'var(--accent-gold)' }}>
          {q.kicker}
        </div>
        <h2 className="tab-stagger-title">{q.title}</h2>
      </div>

      <div className="si-card tab-stagger-block space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="qs" className="block font-semibold mb-1">
              {q.styleLabel}
            </label>
            <select
              id="qs"
              className="si-input"
              value={selectedStyle}
              onChange={(e) => onChangeStyle(e.target.value)}
            >
              {QUOTE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {tQuoteStyle(s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="qp" className="block font-semibold mb-1">
              {q.zoneLabel}
            </label>
            <select
              id="qp"
              className="si-input"
              value={selectedZone}
              onChange={(e) => onChangeZone(e.target.value)}
            >
              {allZoneKeys.map((z) => (
                <option key={z} value={z}>
                  {tZoneName(z)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="qz" className="block font-semibold mb-1">
              {q.sizeLabel}
            </label>
            <select
              id="qz"
              className="si-input"
              value={sizeIdx}
              onChange={(e) => setSizeIdx(Number(e.target.value))}
            >
              {SIZE_TIERS.map((s, i) => (
                <option key={s.label} value={i}>
                  {domain.sizeTiers[i] || s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="qc" className="block font-semibold mb-1">
              {q.couponLabel}
            </label>
            <input
              id="qc"
              className="si-input"
              placeholder={q.couponPlaceholder}
              autoCapitalize="characters"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
            />
          </div>
        </div>

        {/* Live Price Estimate */}
        <div
          className="p-4 rounded border flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--card-alt)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>
            {q.initialEstimate}
          </span>
          <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--r)' }}>
            {estimateText}{' '}
            {hasDiscount && (
              <span className="text-base font-bold" style={{ color: 'var(--pain-low-text)' }}>
                {q.discountApplied}
              </span>
            )}
          </div>
        </div>

        {/* Client Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="qn" className="block font-semibold mb-1">
              {q.yourName}
            </label>
            <input
              id="qn"
              className="si-input"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="qw" className="block font-semibold mb-1">
              {q.whatsapp}
            </label>
            <input
              id="qw"
              inputMode="tel"
              className="si-input"
              value={clientWa}
              onChange={(e) => setClientWa(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="qd" className="block font-semibold mb-1">
            {q.describeIdea}
          </label>
          <textarea
            id="qd"
            rows={3}
            className="si-input"
            placeholder={q.ideaPlaceholder}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
          />
        </div>

        {/* 3 Angle Photos */}
        <div className="space-y-2 pt-2">
          <h3 style={{ color: 'var(--accent-gold)' }}>{q.photosTitle}</h3>
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>
            {q.photosDesc}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {q.photoLabels.map((label, idx) => (
              <div
                key={idx}
                className="p-3 rounded border space-y-2"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
              >
                <label htmlFor={`qf${idx + 1}`} className="block font-semibold text-base">
                  {label}
                </label>
                <input
                  id={`qf${idx + 1}`}
                  type="file"
                  accept="image/*"
                  className="si-input text-sm"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setPhotos((prev) => {
                      const next = [...prev];
                      next[idx] = file;
                      return next;
                    });
                  }}
                />
                <small className="block text-sm break-all" style={{ color: 'var(--text-muted)' }}>
                  {photos[idx] ? photos[idx]!.name : q.noPhotoSelected}
                </small>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Anamnese */}
        <div className="space-y-2 pt-2">
          <h3 style={{ color: 'var(--accent-gold)' }}>{q.anamneseTitle}</h3>
          <div className="space-y-2">
            {domain.anamneseQuestions.map((questionText, i) => (
              <label key={i} className="flex items-center gap-3 cursor-pointer py-1">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-[var(--r)] shrink-0"
                  checked={anamnese[i]}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAnamnese((prev) => prev.map((val, idx) => (idx === i ? checked : val)));
                  }}
                />
                <span className="text-base">{questionText}</span>
              </label>
            ))}
          </div>
          <div
            className="p-3 rounded border font-semibold text-base"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
          >
            {attentionCount > 0
              ? fmt(q.anamneseAttention, { count: attentionCount })
              : q.anamneseNone}
          </div>
        </div>

        {/* Contract & Terms */}
        <div className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 style={{ color: 'var(--accent-gold)' }}>{q.contractTitle}</h3>
          <p className="text-base">{q.contractP1}</p>
          <p className="text-base">
            <strong>{q.contractP2Strong}</strong> {q.contractP2}
          </p>
          <p className="text-base">
            <strong>{q.contractP3Strong}</strong> {q.contractP3}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {q.contractNote}
          </p>

          <label className="flex items-center gap-3 cursor-pointer pt-1">
            <input
              type="checkbox"
              className="w-5 h-5 accent-[var(--r)] shrink-0"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
            />
            <span className="font-bold text-base">{q.acceptTerms}</span>
          </label>
        </div>

        {/* Digital Signature */}
        <div className="space-y-2">
          <label className="block font-semibold">{q.signLabel}</label>
          <canvas
            ref={canvasRef}
            className="sig-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
          <div className="flex flex-wrap gap-3 pt-1">
            <button type="button" className="si-btn si-btn-outline si-btn-sm" onClick={clearSignature}>
              {q.clearSign}
            </button>
            <button type="button" className="si-btn si-btn-outline" onClick={handleBuildPDF}>
              <FileDown size={18} />
              {q.savePdf}
            </button>
            <button type="button" className="si-btn" onClick={handleFinalize}>
              {q.finalizeWa}
            </button>
          </div>
        </div>
      </div>

      {/* Result Modal */}
      {resultModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.78)' }}
          role="dialog"
          aria-modal="true"
          aria-label={q.modalAria}
        >
          <div className="si-card max-w-lg w-full space-y-4">
            <h3 style={{ color: 'var(--accent-gold)' }}>{q.modalTitle}</h3>
            <p>{q.modalBody}</p>
            <p>
              <strong>{q.modalCodeLabel}</strong>{' '}
              <span style={{ color: 'var(--r)' }}>{resultModal.coupon}</span>
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <a
                className="si-btn"
                href={`https://wa.me/${studioWhatsapp}?text=${encodeURIComponent(resultModal.whatsappText)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {q.openWa}
              </a>
              <button type="button" className="si-btn si-btn-outline" onClick={handleBuildPDF}>
                <FileDown size={18} />
                {q.savePdf}
              </button>
              <button type="button" className="si-btn si-btn-outline" onClick={() => setResultModal(null)}>
                {domain.painMap ? 'Fechar' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

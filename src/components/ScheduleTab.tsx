import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileDown,
  Layers,
  Lock,
  MessageCircle,
  Share2,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { BODY_PAIN_ZONES, QUOTE_STYLES } from '../data/studioData';
import { useLanguage } from '../i18n/LanguageContext';
import { GeneratedAppointmentPdf, createAppointmentOrderPdf } from '../services/bookingPdf';
import { readVerifiedStorage, writeSignedStorage } from '../services/securityGuard';
import {
  BOOKING_TIERS,
  BookingTierId,
  LocalBookingReceipt,
  ScheduleSlotRecord,
  blockAllOpenSlotsForDay,
  bookAppointmentSlot,
  buildAppointmentWhatsAppText,
  buildAppointmentWhatsAppUrl,
  buildSlotId,
  formatIsoDateBR,
  getBookingTier,
  getDayAvailabilityForTier,
  getUpcomingDates,
  isPastTimeSlot,
  subscribeToScheduleSlots,
  toggleAdminSlotBlock,
} from '../services/scheduleService';
import { ClientUser } from './AuthGateTab';

const LOCAL_BOOKINGS_KEY = 'schullz_client_bookings_v1';

interface ScheduleTabProps {
  user: ClientUser | null;
  selectedStyle: string;
  onChangeStyle: (s: string) => void;
  selectedZone: string;
  onChangeZone: (z: string) => void;
  studioName: string;
  studioWhatsapp: string;
  studioInstagram?: string;
  logoUrl?: string;
  publicCoupon: string;
  isAdmin: boolean;
  onToast: (msg: string) => void;
}

export const ScheduleTab: React.FC<ScheduleTabProps> = ({
  user,
  selectedStyle,
  onChangeStyle,
  selectedZone,
  onChangeZone,
  studioName,
  studioWhatsapp,
  studioInstagram,
  logoUrl,
  publicCoupon,
  isAdmin,
  onToast,
}) => {
  const { locale, tQuoteStyle, tZoneName } = useLanguage();

  const days = useMemo(() => getUpcomingDates(21, locale), [locale]);
  const defaultDay = useMemo(
    () => days.find((d) => !d.isMondayClosed)?.iso || days[0]?.iso || '',
    [days]
  );

  const [slotsById, setSlotsById] = useState<Record<string, ScheduleSlotRecord>>({});
  const [selectedTierId, setSelectedTierId] = useState<BookingTierId>('pequeno');
  const [selectedDate, setSelectedDate] = useState<string>(defaultDay);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [clientName, setClientName] = useState<string>(user?.name || '');
  const [clientWhatsapp, setClientWhatsapp] = useState<string>(user?.whatsapp || '');
  const [notes, setNotes] = useState<string>('');
  const [depositAccepted, setDepositAccepted] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [adminBusySlot, setAdminBusySlot] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<LocalBookingReceipt | null>(null);
  const [lastPdf, setLastPdf] = useState<GeneratedAppointmentPdf | null>(null);
  const [myBookings, setMyBookings] = useState<LocalBookingReceipt[]>(() =>
    readVerifiedStorage<LocalBookingReceipt[]>(LOCAL_BOOKINGS_KEY, [])
  );
  const waAutoAnchorRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (user?.name && !clientName) setClientName(user.name);
    if (user?.whatsapp && !clientWhatsapp) setClientWhatsapp(user.whatsapp);
  }, [user, clientName, clientWhatsapp]);

  useEffect(() => {
    const unsub = subscribeToScheduleSlots(setSlotsById);
    return () => unsub();
  }, []);

  const selectedTier = useMemo(() => getBookingTier(selectedTierId), [selectedTierId]);
  const activeDayAvail = useMemo(
    () => getDayAvailabilityForTier(selectedDate, slotsById, selectedTierId),
    [selectedDate, slotsById, selectedTierId]
  );

  // Clear selectedTime if it becomes unavailable due to booking, block, or tier change
  useEffect(() => {
    if (!selectedTime) return;
    const slotId = buildSlotId(selectedDate, selectedTime);
    if (
      activeDayAvail.isClosed ||
      activeDayAvail.remainingForTier <= 0 ||
      Boolean(slotsById[slotId]) ||
      isPastTimeSlot(selectedDate, selectedTime) ||
      !activeDayAvail.slots.includes(selectedTime)
    ) {
      setSelectedTime('');
    }
  }, [activeDayAvail, slotsById, selectedDate, selectedTime]);

  const handleAdminToggleSlot = async (time: string) => {
    const slotId = buildSlotId(selectedDate, time);
    const existing = slotsById[slotId];
    setAdminBusySlot(slotId);
    try {
      const res = await toggleAdminSlotBlock(selectedDate, time, existing);
      onToast(
        res === 'blocked'
          ? `Horário ${time} (${formatIsoDateBR(selectedDate)}) bloqueado na agenda.`
          : `Horário ${time} (${formatIsoDateBR(selectedDate)}) liberado para clientes.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao atualizar horário.');
    } finally {
      setAdminBusySlot(null);
    }
  };

  const handleAdminBlockDay = async () => {
    setAdminBusySlot('day');
    try {
      const count = await blockAllOpenSlotsForDay(selectedDate, slotsById);
      onToast(
        count > 0
          ? `${count} horário(s) do dia ${formatIsoDateBR(selectedDate)} foram bloqueados.`
          : 'Todos os horários deste dia já estavam ocupados ou bloqueados.'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao bloquear o dia.');
    } finally {
      setAdminBusySlot(null);
    }
  };

  const buildPdfForReceipt = async (receipt: LocalBookingReceipt): Promise<GeneratedAppointmentPdf> => {
    return createAppointmentOrderPdf({
      bookingId: receipt.id,
      date: receipt.date,
      time: receipt.time,
      clientName: receipt.clientName,
      clientWhatsapp: receipt.clientWhatsapp,
      style: receipt.style,
      bodyZone: receipt.bodyZone,
      size: receipt.size,
      notes: receipt.notes,
      couponCode: user?.coupon || publicCoupon,
      studioName,
      studioWhatsapp,
      studioInstagram,
      logoUrl,
    });
  };

  const handleSharePdfAndPixWhatsApp = async (
    receipt: LocalBookingReceipt,
    existingPdf?: GeneratedAppointmentPdf | null
  ) => {
    const pdf = existingPdf || (await buildPdfForReceipt(receipt));
    const waText = buildAppointmentWhatsAppText({
      studioName,
      bookingId: receipt.id,
      date: receipt.date,
      time: receipt.time,
      clientName: receipt.clientName,
      clientWhatsapp: receipt.clientWhatsapp,
      style: receipt.style,
      bodyZone: receipt.bodyZone,
      size: receipt.size,
      notes: receipt.notes,
      couponCode: user?.coupon || publicCoupon,
    });

    if (navigator.canShare && navigator.canShare({ files: [pdf.file] })) {
      try {
        await navigator.share({
          title: `Pedido de Agendamento · ${studioName}`,
          text: waText,
          files: [pdf.file],
        });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }

    pdf.download();
    if (waAutoAnchorRef.current) {
      waAutoAnchorRef.current.href = receipt.whatsappUrl;
      waAutoAnchorRef.current.click();
    }
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) {
      onToast('Selecione uma data e um horário disponível antes de continuar.');
      return;
    }
    if (!depositAccepted) {
      onToast('Confirme ciência da regra do sinal de 50% para prosseguir com o agendamento.');
      return;
    }

    setSubmitting(true);
    try {
      const { bookingId, slotId, sizeLabel } = await bookAppointmentSlot({
        date: selectedDate,
        time: selectedTime,
        tierId: selectedTierId,
        clientName,
        clientWhatsapp,
        style: selectedStyle,
        bodyZone: selectedZone,
        notes,
      });

      const cleanName = clientName.trim();
      const cleanWaDigits = clientWhatsapp.replace(/\D/g, '');
      const cleanNotes = notes.trim();
      const appliedCoupon = user?.coupon || publicCoupon;

      const waUrl = buildAppointmentWhatsAppUrl({
        studioWhatsapp,
        studioName,
        bookingId,
        date: selectedDate,
        time: selectedTime,
        clientName: cleanName,
        clientWhatsapp: cleanWaDigits,
        style: selectedStyle,
        bodyZone: selectedZone,
        size: sizeLabel,
        notes: cleanNotes,
        couponCode: appliedCoupon,
      });

      const receipt: LocalBookingReceipt = {
        id: bookingId,
        slotId,
        date: selectedDate,
        time: selectedTime,
        tierId: selectedTierId,
        clientName: cleanName,
        clientWhatsapp: cleanWaDigits,
        style: selectedStyle,
        bodyZone: selectedZone,
        size: sizeLabel,
        notes: cleanNotes,
        whatsappUrl: waUrl,
        createdAt: new Date().toISOString(),
      };

      const pdf = await buildPdfForReceipt(receipt);
      pdf.download();
      setLastPdf(pdf);

      const updatedBookings = [receipt, ...myBookings].slice(0, 10);
      setMyBookings(updatedBookings);
      writeSignedStorage(LOCAL_BOOKINGS_KEY, updatedBookings);
      setLastReceipt(receipt);
      setSelectedTime('');
      setNotes('');
      onToast('Pedido em PDF baixado! Encaminhando para o WhatsApp para solicitar a chave PIX.');

      // Forward to WhatsApp right after saving & downloading the PDF order
      if (waAutoAnchorRef.current) {
        waAutoAnchorRef.current.href = waUrl;
        window.setTimeout(() => {
          waAutoAnchorRef.current?.click();
        }, 300);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Não foi possível concluir o agendamento.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2">
        <div
          className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase"
          style={{ color: 'var(--accent-gold)' }}
        >
          Agenda Online · WhatsApp
        </div>
        <h2 className="tab-stagger-title">Agendamento de Sessão</h2>
        <p className="tab-stagger-lead text-base" style={{ color: 'var(--text-muted)' }}>
          Selecione o porte da tatuagem, a data e o horário disponível na agenda do estúdio {studioName}.
        </p>
      </div>

      {/* Important Policy & Operating Hours Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div
          className="lg:col-span-3 si-card border-2 space-y-2"
          style={{ borderColor: 'var(--r)', background: 'var(--card-alt)' }}
        >
          <div className="flex items-center gap-2 font-bold text-base uppercase tracking-wider" style={{ color: 'var(--r)' }}>
            <AlertTriangle size={19} />
            Regra de Confirmação · Sinal de 50%
          </div>
          <p className="text-base m-0 font-semibold leading-relaxed" style={{ color: 'var(--text)' }}>
            A confirmação do agendamento só pode ser feita após o envio do pagamento de{' '}
            <strong style={{ color: 'var(--accent-gold)' }}>50% do valor total da tattoo</strong>, como valor de sinal, separação de materiais, preparação e alteração de arte e acompanhamento via WhatsApp.
          </p>
        </div>

        <div
          className="lg:col-span-2 si-card space-y-2"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--card-alt)' }}
        >
          <div className="flex items-center gap-2 font-bold text-base uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
            <Clock size={18} />
            Horários de Atendimento
          </div>
          <ul className="text-sm space-y-1.5 m-0 p-0 list-none">
            <li>
              <strong>Terça a Sexta:</strong> 14:00 às 21:00
            </li>
            <li>
              <strong>Sábado e Domingo:</strong> 11:30 às 23:00
            </li>
            <li style={{ color: 'var(--text-muted)' }}>
              <strong>Segunda-feira:</strong> Fechado
            </li>
          </ul>
        </div>
      </div>

      <a
        ref={waAutoAnchorRef}
        href={lastReceipt?.whatsappUrl || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="hidden"
        aria-hidden="true"
      >
        WhatsApp
      </a>

      {/* Confirmation Banner after reservation */}
      {lastReceipt && (
        <div
          className="si-card border-2 space-y-4"
          style={{ borderColor: 'var(--pain-low)', background: 'var(--card-alt)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-lg" style={{ color: 'var(--pain-low-text)' }}>
              <CheckCircle2 size={22} />
              Pedido em PDF gerado — Solicite a chave PIX no WhatsApp
            </div>
            <span className="font-mono text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
              {lastReceipt.id}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div>
              <strong>Data:</strong> {formatIsoDateBR(lastReceipt.date)}
            </div>
            <div>
              <strong>Horário:</strong> {lastReceipt.time}
            </div>
            <div>
              <strong>Porte:</strong> {lastReceipt.size}
            </div>
          </div>

          <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
            O arquivo <strong>{lastPdf?.filename || `Pedido-Agendamento-${lastReceipt.id}.pdf`}</strong> foi baixado no seu aparelho. Envie o PDF no WhatsApp do estúdio e solicite a <strong>chave PIX</strong> para pagar o sinal de 50% e confirmar sua vaga:
          </p>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void handleSharePdfAndPixWhatsApp(lastReceipt, lastPdf)}
              className="si-btn"
            >
              <Share2 size={18} />
              Enviar PDF + Pedir Chave PIX no WhatsApp
            </button>

            <a
              href={lastReceipt.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="si-btn si-btn-outline si-btn-sm"
            >
              <MessageCircle size={16} />
              Abrir WhatsApp (Pedir Chave PIX)
            </a>

            <button
              type="button"
              className="si-btn si-btn-outline si-btn-sm"
              onClick={async () => {
                const pdf = lastPdf || (await buildPdfForReceipt(lastReceipt));
                setLastPdf(pdf);
                pdf.download();
                onToast('PDF do pedido baixado novamente!');
              }}
            >
              <FileDown size={16} />
              Baixar Pedido PDF
            </button>

            <button
              type="button"
              className="si-btn si-btn-outline si-btn-sm"
              onClick={() => setLastReceipt(null)}
            >
              Fechar aviso
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Work Size / Capacity Tier */}
      <div className="si-card space-y-3">
        <h3 className="flex items-center gap-2" style={{ color: 'var(--accent-gold)' }}>
          <Layers size={20} />
          1. Escolha o porte da tatuagem
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {BOOKING_TIERS.map((tier) => {
            const active = selectedTierId === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedTierId(tier.id)}
                className="text-left p-3.5 rounded border cursor-pointer transition-colors space-y-1.5"
                style={{
                  background: active ? 'var(--card-alt)' : 'transparent',
                  borderColor: active ? 'var(--r)' : 'var(--border-strong)',
                  borderWidth: active ? '2px' : '1px',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-base" style={{ color: active ? 'var(--r)' : 'var(--text)' }}>
                    {tier.shortTitle}
                  </strong>
                </div>
                <div
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'var(--accent-gold)' }}
                >
                  {tier.maxPerDay === 1
                    ? '1 vaga por dia'
                    : `Até ${tier.maxPerDay} horários/dia`}
                </div>
                <p className="text-xs m-0 leading-snug" style={{ color: 'var(--text-muted)' }}>
                  {tier.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Select Date */}
      <div className="si-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2" style={{ color: 'var(--accent-gold)' }}>
            <Calendar size={20} />
            2. Escolha o dia
          </h3>
          {isAdmin && !activeDayAvail.isClosed && (
            <button
              type="button"
              disabled={adminBusySlot === 'day'}
              onClick={handleAdminBlockDay}
              className="si-btn si-btn-outline si-btn-sm"
            >
              <ShieldCheck size={14} />
              {adminBusySlot === 'day' ? 'Bloqueando...' : 'Admin: Bloquear dia inteiro'}
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 tabs-bar" role="listbox" aria-label="Datas disponíveis">
          {days.map((d) => {
            const isSelected = selectedDate === d.iso;
            const avail = getDayAvailabilityForTier(d.iso, slotsById, selectedTierId);
            const isClosed = avail.isClosed;
            return (
              <button
                key={d.iso}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setSelectedDate(d.iso);
                  setSelectedTime('');
                }}
                className="flex flex-col items-center justify-center min-w-[86px] px-3 py-2.5 rounded border cursor-pointer shrink-0 transition-colors"
                style={{
                  background: isSelected ? 'var(--r)' : isClosed ? 'var(--card-alt)' : 'transparent',
                  color: isSelected ? 'var(--btn-text)' : isClosed ? 'var(--text-muted)' : 'var(--text)',
                  borderColor: isSelected ? 'var(--r)' : 'var(--border-strong)',
                  opacity: isClosed && !isSelected ? 0.6 : 1,
                }}
              >
                <span className="text-xs font-bold uppercase tracking-wider opacity-85">
                  {d.isToday ? 'Hoje' : d.weekdayShort}
                </span>
                <span className="f text-2xl leading-none my-0.5">{d.dayNumber}</span>
                <span className="text-[11px] uppercase font-semibold">{d.monthShort}</span>
                <span
                  className="mt-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={{
                    background: isSelected ? 'rgba(0,0,0,0.2)' : 'var(--card-alt)',
                    color: isSelected
                      ? 'var(--btn-text)'
                      : isClosed
                        ? 'var(--text-muted)'
                        : avail.remainingForTier > 0
                          ? 'var(--pain-low-text)'
                          : 'var(--pain-ext-text)',
                  }}
                >
                  {isClosed
                    ? 'Fechado'
                    : avail.remainingForTier > 0
                      ? avail.remainingForTier === 1
                        ? '1 vaga'
                        : `${avail.remainingForTier} vagas`
                      : 'Lotado'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 3: Select Time Slot */}
      <div className="si-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2" style={{ color: 'var(--accent-gold)' }}>
              <Clock size={20} />
              3. Horários em {formatIsoDateBR(selectedDate)} ({activeDayAvail.hoursLabel})
            </h3>
            {!activeDayAvail.isClosed && (
              <p className="text-xs m-0 mt-1" style={{ color: 'var(--text-muted)' }}>
                Porte selecionado: <strong>{selectedTier.shortTitle}</strong> ·{' '}
                {activeDayAvail.remainingForTier > 0
                  ? `${activeDayAvail.remainingForTier} vaga(s) restante(s) para este porte hoje.`
                  : 'Limite diário preenchido neste dia para este porte.'}
              </p>
            )}
          </div>
          {isAdmin && !activeDayAvail.isClosed && (
            <span className="text-xs font-semibold" style={{ color: 'var(--accent-gold)' }}>
              Modo Admin: clique para bloquear ou liberar horário
            </span>
          )}
        </div>

        {activeDayAvail.isClosed ? (
          <div className="p-4 rounded border text-center" style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}>
            <p className="m-0 font-semibold" style={{ color: 'var(--text-muted)' }}>
              Estúdio fechado às segundas-feiras. Atendimento de Terça a Sexta (14:00 às 21:00) e Sábado e Domingo (11:30 às 23:00).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {activeDayAvail.slots.map((time) => {
              const slotId = buildSlotId(selectedDate, time);
              const existing = slotsById[slotId];
              const past = isPastTimeSlot(selectedDate, time);
              const dayCapReached = activeDayAvail.remainingForTier <= 0;
              const unavailable = Boolean(existing || past || dayCapReached);
              const isSelected = selectedTime === time;
              const isBusy = adminBusySlot === slotId;

              return (
                <div key={time} className="space-y-1.5">
                  <button
                    type="button"
                    disabled={unavailable && !isAdmin}
                    onClick={() => {
                      if (isAdmin && existing) {
                        void handleAdminToggleSlot(time);
                        return;
                      }
                      if (!unavailable) {
                        setSelectedTime(time);
                      }
                    }}
                    className="w-full flex flex-col items-center justify-center p-3.5 rounded border font-bold transition-colors"
                    style={{
                      background: isSelected
                        ? 'var(--r)'
                        : existing || dayCapReached
                          ? 'var(--card-alt)'
                          : 'transparent',
                      color: isSelected
                        ? 'var(--btn-text)'
                        : unavailable
                          ? 'var(--text-muted)'
                          : 'var(--text)',
                      borderColor: isSelected
                        ? 'var(--r)'
                        : existing
                          ? 'var(--border-subtle)'
                          : 'var(--border-strong)',
                      cursor: unavailable && !isAdmin ? 'not-allowed' : 'pointer',
                      opacity: past ? 0.5 : 1,
                    }}
                  >
                    <span className="text-2xl tabular-nums">{time}</span>
                    <span
                      className="inline-flex items-center gap-1 text-xs uppercase mt-0.5"
                      style={{
                        color: isSelected
                          ? 'var(--btn-text)'
                          : existing?.status === 'booked'
                            ? 'var(--pain-ext-text)'
                            : existing?.status === 'blocked' || dayCapReached
                              ? 'var(--text-muted)'
                              : past
                                ? 'var(--text-muted)'
                                : 'var(--pain-low-text)',
                      }}
                    >
                      {existing ? (
                        <>
                          <Lock size={12} />
                          {existing.status === 'booked' ? 'Reservado' : 'Bloqueado'}
                        </>
                      ) : past ? (
                        'Encerrado'
                      ) : dayCapReached ? (
                        <>
                          <Lock size={12} />
                          Limite do dia atingido
                        </>
                      ) : isSelected ? (
                        'Selecionado'
                      ) : (
                        'Disponível'
                      )}
                    </span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleAdminToggleSlot(time)}
                      className="w-full py-1 px-2 rounded border text-[11px] font-bold uppercase cursor-pointer inline-flex items-center justify-center gap-1"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        color: existing ? 'var(--pain-low-text)' : 'var(--accent-gold)',
                        background: 'var(--card-alt)',
                      }}
                    >
                      {existing ? <Unlock size={11} /> : <Lock size={11} />}
                      {isBusy ? '...' : existing ? 'Liberar' : 'Bloquear'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 4: Client Form + 50% Deposit Confirmation + WhatsApp Link */}
      <form onSubmit={handleConfirmBooking} className="si-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 style={{ color: 'var(--accent-gold)' }}>4. Seus dados e envio do sinal de 50%</h3>
          {selectedTime ? (
            <span className="text-sm font-bold px-3 py-1 rounded" style={{ background: 'var(--r)', color: 'var(--btn-text)' }}>
              {formatIsoDateBR(selectedDate)} · {selectedTime}
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Selecione um horário livre acima
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            <span className="block mb-1">Nome completo *</span>
            <input
              type="text"
              required
              maxLength={60}
              className="si-input"
              placeholder="Seu nome"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </label>

          <label className="block text-sm font-semibold">
            <span className="block mb-1">WhatsApp com DDD *</span>
            <input
              type="tel"
              required
              inputMode="tel"
              maxLength={20}
              className="si-input"
              placeholder="(47) 99999-9999"
              value={clientWhatsapp}
              onChange={(e) => setClientWhatsapp(e.target.value)}
            />
          </label>

          <label className="block text-sm font-semibold">
            <span className="block mb-1">Estilo</span>
            <select
              className="si-input"
              value={selectedStyle}
              onChange={(e) => onChangeStyle(e.target.value)}
            >
              {QUOTE_STYLES.map((st) => (
                <option key={st} value={st}>
                  {tQuoteStyle(st)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-semibold">
            <span className="block mb-1">Parte do corpo</span>
            <select
              className="si-input"
              value={selectedZone}
              onChange={(e) => onChangeZone(e.target.value)}
            >
              {BODY_PAIN_ZONES.map((z) => (
                <option key={z.name} value={z.name}>
                  {tZoneName(z.name)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm font-semibold">
          <span className="block mb-1">Ideia ou observações (opcional)</span>
          <input
            type="text"
            maxLength={240}
            className="si-input"
            placeholder="Ex: Referência preta e cinza, cobertura..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {/* Mandatory awareness checkbox for 50% deposit */}
        <label
          className="flex items-start gap-3 p-3.5 rounded border cursor-pointer"
          style={{
            borderColor: depositAccepted ? 'var(--pain-low)' : 'var(--border-strong)',
            background: 'var(--card-alt)',
          }}
        >
          <input
            type="checkbox"
            checked={depositAccepted}
            onChange={(e) => setDepositAccepted(e.target.checked)}
            className="mt-1 w-5 h-5 accent-[var(--r)] shrink-0 cursor-pointer"
          />
          <span className="text-sm leading-snug">
            Estou ciente de que a confirmação do agendamento só é efetivada após o envio do pagamento de{' '}
            <strong>50% do valor total da tattoo</strong> (sinal, separação de materiais, preparação/alteração da arte e acompanhamento via WhatsApp).
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting || !selectedTime || !depositAccepted}
            className="si-btn"
          >
            <MessageCircle size={18} />
            {submitting
              ? 'Reservando horário...'
              : selectedTime
                ? `Confirmar, Gerar PDF e Pedir Chave PIX no WhatsApp`
                : 'Escolha um horário acima para reservar'}
          </button>

          <a
            href={`https://wa.me/${studioWhatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="si-btn si-btn-outline si-btn-sm"
          >
            Tirar dúvida no WhatsApp
          </a>
        </div>
      </form>

      {/* Client's Local Booking History */}
      {myBookings.length > 0 && (
        <div className="si-card space-y-3">
          <h3 style={{ color: 'var(--accent-gold)' }}>Seus horários agendados neste aparelho</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myBookings.map((b) => (
              <div
                key={b.id}
                className="p-3.5 rounded border space-y-2"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-base" style={{ color: 'var(--r)' }}>
                    {formatIsoDateBR(b.date)} · {b.time}
                  </strong>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {b.id}
                  </span>
                </div>
                <div className="text-sm">
                  {tQuoteStyle(b.style)} · {tZoneName(b.bodyZone)} ({b.size})
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="si-btn si-btn-outline si-btn-sm"
                    onClick={() => void handleSharePdfAndPixWhatsApp(b)}
                  >
                    <Share2 size={14} />
                    Enviar PDF + Pedir PIX
                  </button>
                  <button
                    type="button"
                    className="si-btn si-btn-outline si-btn-sm"
                    onClick={async () => {
                      const pdf = await buildPdfForReceipt(b);
                      pdf.download();
                      onToast(`PDF ${pdf.filename} baixado!`);
                    }}
                  >
                    <FileDown size={14} />
                    Baixar PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

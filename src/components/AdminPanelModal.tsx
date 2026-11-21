import React, { useEffect, useState } from 'react';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import {
  Bell,
  Calendar,
  CheckCircle2,
  FileDown,
  Megaphone,
  MessageCircle,
  Palette,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Store,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PRICE_GROUPS, SIZE_TIERS, STUDIO_DEFAULTS, formatBRL } from '../data/studioData';
import { auth, googleProvider } from '../firebase';
import {
  AppIssueEvent,
  getAppIssues,
  notifyAppIssue,
  requestNotificationPermission,
  subscribeAppIssues,
} from '../services/appMonitor';
import {
  checkAdminLockout,
  inspectForThreats,
  recordUnauthorizedAdminAttempt,
  resetAdminLockout,
} from '../services/securityGuard';
import {
  DEFAULT_ACCENT_GOLD_COLOR,
  DEFAULT_BG_DARK_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_REMOTE_CONFIG,
  RemoteStudioConfig,
  compressBannerImage,
  compressLogoImage,
  getCurrentPromoMonthLabel,
  isAuthorizedAdminUser,
  publishStudioConfig,
} from '../services/studioSync';
import {
  AppointmentRecord,
  buildClientCallbackWhatsAppUrl,
  formatIsoDateBR,
  subscribeToAdminAppointments,
  updateAppointmentStatus,
} from '../services/scheduleService';
import { downloadTwaManifestTemplate } from '../services/apkService';
import { SavedQuote } from './AuthGateTab';
import { STUDIO_LOGO_URI } from '../assets/studioMedia';
import { fmt, useLanguage } from '../i18n/LanguageContext';

interface AdminPanelModalProps {
  open: boolean;
  onClose: () => void;
  firebaseAdminUser: User | null;
  remoteConfig: RemoteStudioConfig;
  savedQuotes: SavedQuote[];
  onToast: (msg: string) => void;
}

type AdminSectionTab = 'agenda' | 'promo' | 'brand' | 'prices' | 'playstore';

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  open,
  onClose,
  firebaseAdminUser,
  remoteConfig,
  savedQuotes,
  onToast,
}) => {
  const { ui } = useLanguage();
  const [section, setSection] = useState<AdminSectionTab>('agenda');
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [issues, setIssues] = useState<AppIssueEvent[]>(() => getAppIssues());
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [updatingAptId, setUpdatingAptId] = useState<string | null>(null);

  // Editable draft synchronized with remoteConfig
  const [draftName, setDraftName] = useState(remoteConfig.studioName);
  const [draftWa, setDraftWa] = useState(remoteConfig.whatsapp);
  const [draftIg, setDraftIg] = useState(remoteConfig.instagram);
  const [draftCoupon, setDraftCoupon] = useState(remoteConfig.publicCoupon);
  const [draftLogo, setDraftLogo] = useState(remoteConfig.logoDataUrl);
  const [draftPromoDataUrl, setDraftPromoDataUrl] = useState(remoteConfig.promoBannerDataUrl);
  const [draftPromoTitle, setDraftPromoTitle] = useState(remoteConfig.promoBannerTitle);
  const [draftPromoMonth, setDraftPromoMonth] = useState(
    remoteConfig.promoBannerMonth || getCurrentPromoMonthLabel()
  );
  const [draftApkUrl, setDraftApkUrl] = useState(remoteConfig.apkDownloadUrl);
  const [draftPrimary, setDraftPrimary] = useState(remoteConfig.primaryColor);
  const [draftGold, setDraftGold] = useState(remoteConfig.accentGoldColor);
  const [draftBgDark, setDraftBgDark] = useState(remoteConfig.bgDarkColor);
  const [draftSleeveMin, setDraftSleeveMin] = useState(remoteConfig.fullSleeveMin);
  const [draftSizeTiers, setDraftSizeTiers] = useState(remoteConfig.sizeTiers);
  const [draftPriceItems, setDraftPriceItems] = useState(remoteConfig.priceItems);

  useEffect(() => {
    setDraftName(remoteConfig.studioName);
    setDraftWa(remoteConfig.whatsapp);
    setDraftIg(remoteConfig.instagram);
    setDraftCoupon(remoteConfig.publicCoupon);
    setDraftLogo(remoteConfig.logoDataUrl);
    setDraftPromoDataUrl(remoteConfig.promoBannerDataUrl);
    setDraftPromoTitle(remoteConfig.promoBannerTitle);
    setDraftPromoMonth(remoteConfig.promoBannerMonth || getCurrentPromoMonthLabel());
    setDraftApkUrl(remoteConfig.apkDownloadUrl);
    setDraftPrimary(remoteConfig.primaryColor);
    setDraftGold(remoteConfig.accentGoldColor);
    setDraftBgDark(remoteConfig.bgDarkColor);
    setDraftSleeveMin(remoteConfig.fullSleeveMin);
    setDraftSizeTiers(remoteConfig.sizeTiers);
    setDraftPriceItems(remoteConfig.priceItems);
  }, [remoteConfig, open]);

  useEffect(() => {
    return subscribeAppIssues(setIssues);
  }, []);

  const isAdmin = isAuthorizedAdminUser(firebaseAdminUser);

  useEffect(() => {
    if (!isAdmin) {
      setAppointments([]);
      return;
    }
    return subscribeToAdminAppointments(setAppointments);
  }, [isAdmin]);

  if (!open) return null;
  const flattenedPriceLabels = PRICE_GROUPS.flatMap((g) =>
    g.items.map((item) => `${g.group} · ${item.title}`)
  );

  const handleGoogleAdminSignIn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const lock = checkAdminLockout();
    if (lock.locked) {
      setAuthError(`Acesso temporariamente bloqueado por segurança (${lock.remainingSec}s).`);
      return;
    }

    const cleanInput = adminEmailInput.trim().toLowerCase();
    if (!cleanInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanInput)) {
      setAuthError('Digite um e-mail válido no campo acima para acessar.');
      return;
    }

    if (!inspectForThreats(cleanInput, 'E-mail Admin').safe) {
      setAuthError('Entrada bloqueada por segurança.');
      return;
    }

    if (cleanInput !== STUDIO_DEFAULTS.adminEmail.toLowerCase()) {
      const res = recordUnauthorizedAdminAttempt(cleanInput);
      setAuthError(
        res.locked
          ? `E-mail não autorizado. Bloqueio de segurança ativado (${res.remainingSec}s).`
          : 'Este e-mail não possui permissão de administrador. Tentativa registrada.'
      );
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      googleProvider.setCustomParameters({
        prompt: 'select_account',
        login_hint: cleanInput,
      });
      const cred = await signInWithPopup(auth, googleProvider);
      if (
        !isAuthorizedAdminUser(cred.user) ||
        cred.user.email?.trim().toLowerCase() !== cleanInput
      ) {
        const res = recordUnauthorizedAdminAttempt(cred.user.email);
        await signOut(auth);
        setAuthError(
          res.locked
            ? `Conta Google não autorizada. Bloqueio de segurança ativado (${res.remainingSec}s).`
            : 'A conta Google selecionada não corresponde ao e-mail administrador autorizado.'
        );
        return;
      }
      resetAdminLockout();
      setAdminEmailInput('');
      onToast(`Bem-vindo(a), Admin (${cred.user.email})!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na autenticação Google.';
      if (!/popup-closed-by-user/i.test(msg)) {
        setAuthError(msg);
        notifyAppIssue({
          category: 'security',
          title: 'Schullz Ink · Falha no Login Admin',
          message: msg,
        });
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAdminSignOut = async () => {
    await signOut(auth);
    setAdminEmailInput('');
    setAuthError(null);
    onToast('Sessão administrativa encerrada.');
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressLogoImage(file);
      setDraftLogo(compressed);
      onToast('Logo carregada na pré-visualização. Clique em Publicar para atualizar todos os usuários.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao processar logo.');
    }
  };

  const handlePromoBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const compressed = await compressBannerImage(file);
      setDraftPromoDataUrl(compressed);
      if (!draftPromoMonth.trim()) {
        setDraftPromoMonth(getCurrentPromoMonthLabel());
      }
      onToast('Banner carregado! Clique em Publicar para exibir na tela inicial dos clientes.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao processar banner promocional.');
    }
  };

  const handlePublish = async () => {
    if (!inspectForThreats(draftName, 'Nome do estúdio').safe) return;
    if (!inspectForThreats(draftIg, 'Instagram').safe) return;
    if (!inspectForThreats(draftCoupon, 'Cupom público').safe) return;
    if (!inspectForThreats(draftPromoTitle, 'Título do banner').safe) return;
    if (!inspectForThreats(draftPromoMonth, 'Mês do banner').safe) return;
    if (!inspectForThreats(draftApkUrl, 'URL do APK').safe) return;

    setPublishing(true);
    try {
      const nextVersion = await publishStudioConfig(
        {
          studioName: draftName,
          whatsapp: draftWa,
          instagram: draftIg,
          publicCoupon: draftCoupon,
          logoDataUrl: draftLogo,
          promoBannerDataUrl: draftPromoDataUrl,
          promoBannerTitle: draftPromoTitle,
          promoBannerMonth: draftPromoDataUrl ? draftPromoMonth : '',
          apkDownloadUrl: draftApkUrl,
          primaryColor: draftPrimary,
          accentGoldColor: draftGold,
          bgDarkColor: draftBgDark,
          fullSleeveMin: draftSleeveMin,
          sizeTiers: draftSizeTiers,
          priceItems: draftPriceItems,
        },
        remoteConfig.configVersion
      );
      onToast(`Alterações publicadas (v${nextVersion})! Todos os apps serão atualizados automaticamente.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao publicar alterações.');
    } finally {
      setPublishing(false);
    }
  };

  const handleTestNotification = async () => {
    const perm = await requestNotificationPermission();
    notifyAppIssue({
      category: 'update',
      title: `${draftName || STUDIO_DEFAULTS.studioName} · Teste de Alerta`,
      message: 'Notificações com a logo na barra do celular estão ativas para erros, conexão e segurança.',
    });
    if (perm === 'granted') {
      onToast('Notificação enviada para a barra do sistema com a logo do estúdio!');
    } else {
      onToast('Alerta exibido na barra superior do app (permissão do sistema não concedida).');
    }
  };

  const resetColors = () => {
    setDraftPrimary(DEFAULT_PRIMARY_COLOR);
    setDraftGold(DEFAULT_ACCENT_GOLD_COLOR);
    setDraftBgDark(DEFAULT_BG_DARK_COLOR);
  };

  const resetPrices = () => {
    setDraftSizeTiers(DEFAULT_REMOTE_CONFIG.sizeTiers);
    setDraftPriceItems(DEFAULT_REMOTE_CONFIG.priceItems);
    setDraftSleeveMin(DEFAULT_REMOTE_CONFIG.fullSleeveMin);
  };

  const hasValidDomain =
    typeof window !== 'undefined' && window.location.protocol === 'https:';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.82)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ui.admin.title}
    >
      <div
        className="si-card max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <img
              src={draftLogo || STUDIO_LOGO_URI}
              alt={draftName}
              className="w-10 h-10 rounded-full object-cover border"
              style={{ borderColor: 'var(--r)' }}
            />
            <div>
              <h3 style={{ color: 'var(--accent-gold)' }}>{ui.admin.title}</h3>
              <small style={{ color: 'var(--text-muted)' }}>
                Sincronização em tempo real · v{remoteConfig.configVersion}
              </small>
            </div>
          </div>
          <button
            type="button"
            aria-label={ui.common.close}
            onClick={onClose}
            className="p-2 rounded border cursor-pointer"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text)' }}
          >
            <X size={18} />
          </button>
        </div>

        {!isAdmin ? (
          <form onSubmit={handleGoogleAdminSignIn} className="space-y-4 py-2">
            <div
              className="p-4 rounded border space-y-3"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--card-alt)' }}
            >
              <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--accent-gold)' }}>
                <ShieldCheck size={18} />
                Área do Artista · Acesso do Administrador
              </div>
              <p className="text-base m-0" style={{ color: 'var(--text-muted)' }}>
                Preencha seu e-mail administrativo para validar o acesso e gerenciar banners promocionais, preços, logo e cores do aplicativo.
              </p>

              <div>
                <label htmlFor="admin-email-manual" className="block text-sm font-semibold mb-1">
                  E-mail do Administrador
                </label>
                <input
                  id="admin-email-manual"
                  type="email"
                  required
                  autoComplete="off"
                  className="si-input"
                  placeholder="Digite seu e-mail de administrador"
                  value={adminEmailInput}
                  onChange={(e) => {
                    setAdminEmailInput(e.target.value);
                    if (authError) setAuthError(null);
                  }}
                />
              </div>
            </div>

            {authError && (
              <div
                role="alert"
                className="p-3 rounded border text-sm font-semibold"
                style={{ borderColor: 'var(--r)', color: 'var(--pain-ext-text)', background: 'var(--card-alt)' }}
              >
                {authError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="si-btn"
                disabled={authLoading}
              >
                {authLoading ? 'Verificando conta...' : 'Verificar E-mail e Entrar'}
              </button>
              <button type="button" className="si-btn si-btn-outline" onClick={onClose}>
                {ui.common.close}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span style={{ color: 'var(--pain-low-text)' }}>
                {ui.admin.connectedAs} <strong>{firebaseAdminUser?.email}</strong>
              </span>
              <button
                type="button"
                className="si-btn si-btn-outline si-btn-sm"
                onClick={handleAdminSignOut}
              >
                {ui.admin.logoutBtn}
              </button>
            </div>

            {/* Section Tabs */}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['agenda', `Agenda (${appointments.filter((a) => a.status !== 'cancelled').length})`, <Calendar key="c" size={15} />],
                  ['promo', 'Banner do Mês', <Megaphone key="m" size={15} />],
                  ['brand', 'Logo, Cores & Info', <Palette key="p" size={15} />],
                  ['prices', 'Preços em Tempo Real', <Save key="s" size={15} />],
                  ['playstore', 'Play Store & Segurança', <Store key="t" size={15} />],
                ] as [AdminSectionTab, string, React.ReactNode][]
              ).map(([id, label, icon]) => {
                const active = section === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSection(id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border text-sm font-bold uppercase tracking-wider cursor-pointer"
                    style={{
                      background: active ? 'var(--r)' : 'transparent',
                      color: active ? 'var(--btn-text)' : 'var(--text)',
                      borderColor: active ? 'var(--r)' : 'var(--border-strong)',
                    }}
                  >
                    {icon}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* SECTION -1: ADMIN SCHEDULE & APPOINTMENTS */}
            {section === 'agenda' && (
              <div className="space-y-3">
                <div
                  className="p-4 rounded border space-y-2"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                >
                  <strong style={{ color: 'var(--accent-gold)' }}>
                    Agendamentos Online Recebidos ({appointments.length})
                  </strong>
                  <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
                    Confirme sessões, converse direto no WhatsApp do cliente ou cancele para liberar o horário automaticamente na agenda pública. Você também pode bloquear dias e horários direto na aba Agendar.
                  </p>
                </div>

                {appointments.length === 0 ? (
                  <div
                    className="p-6 rounded border text-center text-sm"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                  >
                    Nenhum agendamento online registrado ainda.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {appointments.map((apt) => {
                      const isCancelled = apt.status === 'cancelled';
                      const isConfirmed = apt.status === 'confirmed';
                      const busy = updatingAptId === apt.id;
                      const clientWaUrl = buildClientCallbackWhatsAppUrl({
                        clientWhatsapp: apt.clientWhatsapp,
                        clientName: apt.clientName,
                        date: apt.date,
                        time: apt.time,
                        studioName: draftName || remoteConfig.studioName,
                      });

                      return (
                        <div
                          key={apt.id}
                          className="p-3.5 rounded border space-y-2"
                          style={{
                            borderColor: isConfirmed
                              ? 'var(--pain-low)'
                              : isCancelled
                                ? 'var(--border-subtle)'
                                : 'var(--accent-gold)',
                            background: 'var(--card-alt)',
                            opacity: isCancelled ? 0.65 : 1,
                          }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-bold text-base">
                              {formatIsoDateBR(apt.date)} às {apt.time} — {apt.clientName}
                            </div>
                            <span
                              className="text-xs font-bold uppercase px-2 py-0.5 rounded border"
                              style={{
                                borderColor: isConfirmed
                                  ? 'var(--pain-low)'
                                  : isCancelled
                                    ? 'var(--r)'
                                    : 'var(--accent-gold)',
                                color: isConfirmed
                                  ? 'var(--pain-low-text)'
                                  : isCancelled
                                    ? 'var(--pain-ext-text)'
                                    : 'var(--accent-gold)',
                              }}
                            >
                              {isConfirmed ? 'Confirmado' : isCancelled ? 'Cancelado' : 'Pendente'}
                            </span>
                          </div>

                          <div className="text-sm space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                            <div>
                              <strong>WhatsApp:</strong> {apt.clientWhatsapp} · <strong>Estilo:</strong> {apt.style}
                            </div>
                            <div>
                              <strong>Local:</strong> {apt.bodyZone} · <strong>Tamanho:</strong> {apt.size}
                            </div>
                            {apt.notes && (
                              <div>
                                <strong>Obs:</strong> {apt.notes}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1">
                            <a
                              href={clientWaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="si-btn si-btn-sm"
                            >
                              <MessageCircle size={14} />
                              WhatsApp do Cliente
                            </a>

                            {!isConfirmed && !isCancelled && (
                              <button
                                type="button"
                                disabled={busy}
                                className="si-btn si-btn-outline si-btn-sm"
                                style={{ borderColor: 'var(--pain-low)', color: 'var(--pain-low-text)' }}
                                onClick={async () => {
                                  setUpdatingAptId(apt.id);
                                  try {
                                    await updateAppointmentStatus(apt.id, apt.slotId, 'confirmed');
                                    onToast(`Agendamento de ${apt.clientName} confirmado!`);
                                  } catch (err) {
                                    onToast(err instanceof Error ? err.message : 'Erro ao confirmar.');
                                  } finally {
                                    setUpdatingAptId(null);
                                  }
                                }}
                              >
                                <CheckCircle2 size={14} />
                                Confirmar
                              </button>
                            )}

                            {!isCancelled && (
                              <button
                                type="button"
                                disabled={busy}
                                className="si-btn si-btn-outline si-btn-sm"
                                style={{ borderColor: 'var(--r)', color: 'var(--pain-ext-text)' }}
                                onClick={async () => {
                                  setUpdatingAptId(apt.id);
                                  try {
                                    await updateAppointmentStatus(apt.id, apt.slotId, 'cancelled');
                                    onToast(`Horário ${apt.time} (${formatIsoDateBR(apt.date)}) liberado na agenda.`);
                                  } catch (err) {
                                    onToast(err instanceof Error ? err.message : 'Erro ao cancelar.');
                                  } finally {
                                    setUpdatingAptId(null);
                                  }
                                }}
                              >
                                <Trash2 size={14} />
                                Cancelar e Liberar Horário
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 0: MONTHLY PROMOTIONAL BANNER */}
            {section === 'promo' && (
              <div className="space-y-4">
                <div
                  className="p-4 rounded border space-y-3"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong style={{ color: 'var(--accent-gold)' }}>
                      Upload de Banner Promocional Mensal
                    </strong>
                    <span
                      className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border"
                      style={{
                        borderColor: draftPromoDataUrl ? 'var(--pain-low)' : 'var(--border-strong)',
                        color: draftPromoDataUrl ? 'var(--pain-low-text)' : 'var(--text-muted)',
                      }}
                    >
                      {draftPromoDataUrl ? 'Ativo na tela inicial' : 'Oculto para clientes'}
                    </span>
                  </div>
                  <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
                    Para os clientes, este banner só fica visível quando você enviar uma imagem e publicar. Todo mês você pode trocar a imagem por aqui ou direto na aba Início.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold mb-1">Mês / Campanha</label>
                      <input
                        className="si-input text-sm"
                        maxLength={32}
                        placeholder="Ex: Novembro 2026"
                        value={draftPromoMonth}
                        onChange={(e) => setDraftPromoMonth(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Título / Chamada (opcional)</label>
                      <input
                        className="si-input text-sm"
                        maxLength={80}
                        placeholder="Ex: Flash Day com 20% OFF"
                        value={draftPromoTitle}
                        onChange={(e) => setDraftPromoTitle(e.target.value)}
                      />
                    </div>
                  </div>

                  {draftPromoDataUrl ? (
                    <div className="space-y-2">
                      <img
                        src={draftPromoDataUrl}
                        alt="Pré-visualização do banner promocional"
                        className="w-full max-h-60 object-contain rounded border bg-black"
                        style={{ borderColor: 'var(--border-strong)' }}
                      />
                    </div>
                  ) : (
                    <div
                      className="p-6 rounded border-2 border-dashed text-center text-sm"
                      style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
                    >
                      Nenhuma imagem promocional selecionada no momento.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <label className="si-btn si-btn-sm cursor-pointer">
                      <Upload size={15} />
                      {draftPromoDataUrl ? 'Trocar imagem do banner' : 'Selecionar imagem promocional'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handlePromoBannerUpload}
                      />
                    </label>
                    {draftPromoDataUrl && (
                      <button
                        type="button"
                        className="si-btn si-btn-outline si-btn-sm"
                        style={{ borderColor: 'var(--r)', color: 'var(--pain-ext-text)' }}
                        onClick={() => {
                          setDraftPromoDataUrl('');
                          setDraftPromoTitle('');
                        }}
                      >
                        <Trash2 size={14} />
                        Remover banner
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 1: BRAND, LOGO, COLORS */}
            {section === 'brand' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">{ui.admin.displayName}</label>
                    <input
                      className="si-input"
                      value={draftName}
                      maxLength={60}
                      onChange={(e) => setDraftName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{ui.admin.waLabel}</label>
                    <input
                      className="si-input"
                      value={draftWa}
                      maxLength={15}
                      onChange={(e) => setDraftWa(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">{ui.admin.igLabel}</label>
                    <input
                      className="si-input"
                      value={draftIg}
                      maxLength={40}
                      onChange={(e) => setDraftIg(e.target.value.replace(/^@/, ''))}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Cupom público (20% off)</label>
                    <input
                      className="si-input font-mono"
                      value={draftCoupon}
                      maxLength={32}
                      onChange={(e) => setDraftCoupon(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>

                {/* Logo Customizer */}
                <div
                  className="p-4 rounded border space-y-3"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <img
                      src={draftLogo || STUDIO_LOGO_URI}
                      alt="Pré-visualização da logo"
                      className="w-16 h-16 rounded-full object-cover border-2 shrink-0"
                      style={{ borderColor: draftPrimary }}
                    />
                    <div className="space-y-2 flex-1 min-w-[200px]">
                      <div className="font-bold">Logo do perfil &amp; notificações</div>
                      <div className="flex flex-wrap gap-2">
                        <label className="si-btn si-btn-sm cursor-pointer">
                          <Upload size={15} />
                          Trocar imagem da logo
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handleLogoUpload}
                          />
                        </label>
                        {draftLogo && (
                          <button
                            type="button"
                            className="si-btn si-btn-outline si-btn-sm"
                            onClick={() => setDraftLogo('')}
                          >
                            <RotateCcw size={14} />
                            Logo padrão
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Colors Customizer */}
                <div
                  className="p-4 rounded border space-y-3"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong style={{ color: 'var(--accent-gold)' }}>Personalização de cores do app</strong>
                    <button
                      type="button"
                      onClick={resetColors}
                      className="si-btn si-btn-outline si-btn-sm"
                    >
                      <RotateCcw size={14} />
                      Restaurar cores
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-semibold mb-1">Cor principal</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={draftPrimary}
                          onChange={(e) => setDraftPrimary(e.target.value)}
                          className="w-11 h-11 rounded border cursor-pointer bg-transparent"
                        />
                        <input
                          className="si-input font-mono text-sm"
                          value={draftPrimary}
                          maxLength={7}
                          onChange={(e) => setDraftPrimary(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Cor destaque (ouro)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={draftGold}
                          onChange={(e) => setDraftGold(e.target.value)}
                          className="w-11 h-11 rounded border cursor-pointer bg-transparent"
                        />
                        <input
                          className="si-input font-mono text-sm"
                          value={draftGold}
                          maxLength={7}
                          onChange={(e) => setDraftGold(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Fundo modo escuro</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={draftBgDark}
                          onChange={(e) => setDraftBgDark(e.target.value)}
                          className="w-11 h-11 rounded border cursor-pointer bg-transparent"
                        />
                        <input
                          className="si-input font-mono text-sm"
                          value={draftBgDark}
                          maxLength={7}
                          onChange={(e) => setDraftBgDark(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 2: LIVE PRICING */}
            {section === 'prices' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
                    Valores em Reais (R$) atualizados na hora na tabela de Preços e no Simulador de Orçamento de todos os usuários.
                  </p>
                  <button type="button" className="si-btn si-btn-outline si-btn-sm shrink-0" onClick={resetPrices}>
                    <RotateCcw size={14} />
                    Padrão
                  </button>
                </div>

                <div className="space-y-2">
                  <strong style={{ color: 'var(--accent-gold)' }}>Faixas do Simulador de Orçamento</strong>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SIZE_TIERS.map((tier, idx) => (
                      <div
                        key={tier.label}
                        className="p-3 rounded border space-y-1.5"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                      >
                        <div className="font-bold text-sm">{tier.label}</div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs">
                            Mín (R$)
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              className="si-input text-sm mt-0.5"
                              value={draftSizeTiers[idx]?.min ?? tier.min}
                              onChange={(e) => {
                                const minVal = Math.max(0, Number(e.target.value) || 0);
                                setDraftSizeTiers((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { min: minVal, max: Math.max(minVal, item.max) } : item
                                  )
                                );
                              }}
                            />
                          </label>
                          <label className="text-xs">
                            Máx (R$)
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              className="si-input text-sm mt-0.5"
                              value={draftSizeTiers[idx]?.max ?? tier.max}
                              onChange={(e) => {
                                const maxVal = Math.max(0, Number(e.target.value) || 0);
                                setDraftSizeTiers((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { min: Math.min(item.min, maxVal), max: maxVal } : item
                                  )
                                );
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <strong style={{ color: 'var(--accent-gold)' }}>Tabela da Aba Preços</strong>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {flattenedPriceLabels.map((label, idx) => (
                      <div
                        key={label}
                        className="p-3 rounded border space-y-1.5"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                      >
                        <div className="font-bold text-sm">{label}</div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs">
                            Mín (R$)
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              className="si-input text-sm mt-0.5"
                              value={draftPriceItems[idx]?.min ?? 0}
                              onChange={(e) => {
                                const minVal = Math.max(0, Number(e.target.value) || 0);
                                setDraftPriceItems((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { min: minVal, max: Math.max(minVal, item.max) } : item
                                  )
                                );
                              }}
                            />
                          </label>
                          <label className="text-xs">
                            Máx (R$)
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              className="si-input text-sm mt-0.5"
                              value={draftPriceItems[idx]?.max ?? 0}
                              onChange={(e) => {
                                const maxVal = Math.max(0, Number(e.target.value) || 0);
                                setDraftPriceItems((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { min: Math.min(item.min, maxVal), max: maxVal } : item
                                  )
                                );
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-1">
                    <label className="block text-sm font-semibold mb-1">
                      Fechamento de membro completo — a partir de ({formatBRL(draftSleeveMin)})
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      className="si-input text-sm max-w-xs"
                      value={draftSleeveMin}
                      onChange={(e) => setDraftSleeveMin(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: PLAY STORE READINESS, APK & SECURITY LOG */}
            {section === 'playstore' && (
              <div className="space-y-4">
                <div
                  className="p-4 rounded border space-y-3"
                  style={{ borderColor: 'var(--border-strong)', background: 'var(--card-alt)' }}
                >
                  <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--accent-gold)' }}>
                    <Smartphone size={18} />
                    Download Direto de APK Android (.apk)
                  </div>
                  <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
                    Quando um arquivo <code>.apk</code> assinado estiver hospedado em <code>/downloads/SchullzInkTattoo.apk</code> ou na URL HTTPS abaixo, o botão <strong>Baixar neste aparelho</strong> inicia o download direto do arquivo APK no navegador do celular (sem abrir nova aba).
                  </p>
                  <div>
                    <label htmlFor="admin-apk-url" className="block text-sm font-semibold mb-1">
                      URL direta do arquivo APK (opcional)
                    </label>
                    <input
                      id="admin-apk-url"
                      type="text"
                      className="si-input font-mono text-sm"
                      placeholder="https://.../SchullzInkTattoo.apk ou /downloads/SchullzInkTattoo.apk"
                      maxLength={500}
                      value={draftApkUrl}
                      onChange={(e) => setDraftApkUrl(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="si-btn si-btn-outline si-btn-sm"
                      onClick={() => {
                        downloadTwaManifestTemplate({
                          studioName: draftName || remoteConfig.studioName,
                          primaryColor: draftPrimary,
                          bgDarkColor: draftBgDark,
                        });
                        onToast('Arquivo twa-manifest.json baixado! Execute npx @bubblewrap/cli build para gerar o APK assinado.');
                      }}
                    >
                      <FileDown size={15} />
                      Baixar twa-manifest.json (Gerar APK/AAB)
                    </button>
                  </div>
                </div>

                <div
                  className="p-4 rounded border space-y-2"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                >
                  <strong style={{ color: 'var(--accent-gold)' }}>Checklist para Publicar na Google Play Store (TWA)</strong>
                  <ul className="space-y-1.5 text-sm">
                    {[
                      ['Manifesto PWA & Ícones 192/512 + Maskable', true],
                      ['Service Worker AutoUpdate (sempre versão mais recente)', true],
                      ['Arquivo /.well-known/assetlinks.json configurado', true],
                      ['Regras Zero-Trust Firestore & Anti-Adulteração ativa', true],
                      ['Termos LGPD & Assinatura Digital em PDF', true],
                      ['Domínio HTTPS em produção', hasValidDomain],
                    ].map(([text, ok]) => (
                      <li key={String(text)} className="flex items-center gap-2">
                        <CheckCircle2
                          size={16}
                          style={{ color: ok ? 'var(--pain-low-text)' : 'var(--accent-gold)' }}
                        />
                        <span>{String(text)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
                    Para compilar o APK assinado e o pacote .aab da Play Store: execute <code>npx @bubblewrap/cli init --manifest https://SEU_DOMINIO/manifest.webmanifest</code> seguido de <code>npx @bubblewrap/cli build</code> e atualize a impressão SHA-256 em <code>/.well-known/assetlinks.json</code>.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong style={{ color: 'var(--accent-gold)' }}>
                      Monitor de Erros, Conexão &amp; Segurança ({issues.length})
                    </strong>
                    <button
                      type="button"
                      onClick={handleTestNotification}
                      className="si-btn si-btn-outline si-btn-sm"
                    >
                      <Bell size={14} />
                      Testar notificação c/ logo
                    </button>
                  </div>
                  {issues.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--pain-low-text)' }}>
                      Nenhum alerta de segurança, erro ou conexão registrado nesta sessão.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto">
                      {issues.map((ev) => (
                        <div
                          key={ev.id}
                          className="p-2.5 rounded border text-xs"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                        >
                          <div className="font-bold uppercase" style={{ color: ev.category === 'security' ? 'var(--r)' : 'var(--accent-gold)' }}>
                            {ev.category} · {ev.title}
                          </div>
                          <div>{ev.message}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <h3 style={{ color: 'var(--accent-gold)' }}>
                    {fmt(ui.admin.savedQuotesTitle, { count: savedQuotes.length })}
                  </h3>
                  {savedQuotes.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {ui.admin.noQuotes}
                    </p>
                  ) : (
                    savedQuotes.map((q) => (
                      <div
                        key={q.id}
                        className="p-2.5 rounded border text-sm"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-alt)' }}
                      >
                        <strong>{q.style}</strong> · {q.place} · {q.size} ({q.estimate})
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Global Publish Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-strong)' }}>
              <button
                type="button"
                disabled={publishing}
                onClick={handlePublish}
                className="si-btn"
              >
                <Save size={18} />
                {publishing ? 'Sincronizando com usuários...' : 'Publicar no app de todos os usuários'}
              </button>
              <button type="button" className="si-btn si-btn-outline" onClick={onClose}>
                {ui.common.close}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

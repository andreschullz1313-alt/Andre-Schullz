/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LayoutGroup, motion } from 'motion/react';
import { ArrowUp, Lock, Menu, Settings, Share2, X } from 'lucide-react';
import {
  APP_VERSION,
  CATEGORIES,
  FolderId,
  formatBRL,
  NavigateTarget,
  PORTFOLIO_WORKS,
  PortfolioWork,
  PRICE_GROUPS,
  TabId,
  TABS,
  TUTORIAL_VERSION_KEY,
} from './data/studioData';
import { AuthGateTab, ClientUser, SavedQuote } from './components/AuthGateTab';
import { PainMap3D } from './components/PainMap3D';
import { QuoteSection } from './components/QuoteSection';
import { FontScale, SettingsDrawer } from './components/SettingsDrawer';
import { GuestInstallModal, ShareInstallPanel } from './components/ShareInstallModal';
import { IntroLoader } from './components/IntroLoader';
import { SideScrollBar } from './components/SideScrollBar';
import { OfflineGlitchScreen } from './components/OfflineGlitchScreen';
import { InstagramFeed } from './components/InstagramFeed';
import { PortfolioGallery } from './components/PortfolioGallery';
import { StudioFoldersHub } from './components/StudioFoldersHub';
import { OnboardingTutorial } from './components/OnboardingTutorial';
import { AdminPanelModal } from './components/AdminPanelModal';
import { ErrorNotificationBar } from './components/ErrorNotificationBar';
import { MonthlyPromoBanner } from './components/MonthlyPromoBanner';
import { ScheduleTab } from './components/ScheduleTab';
import { STUDIO_LOGO_URI } from './assets/studioMedia';
import { fmt, LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { DEFAULT_LANGUAGE, isValidLanguageCode, LanguageCode } from './i18n/types';
import { UI_TRANSLATIONS } from './i18n/uiTranslations';
import { auth } from './firebase';
import { clearAppIssuesByCategory, setMonitorLogoUrl } from './services/appMonitor';
import { readVerifiedStorage, writeSignedStorage } from './services/securityGuard';
import {
  applyRemoteThemeAndLogo,
  DEFAULT_REMOTE_CONFIG,
  isAuthorizedAdminUser,
  RemoteStudioConfig,
  subscribeToStudioConfig,
} from './services/studioSync';

const SESSION_KEY = 'schullz_active_client_v1';
const QUOTES_KEY = 'schullz_saved_quotes_v1';
const SETTINGS_KEY = 'schullz_studio_settings_v1';
const PREFS_KEY = 'schullz_a11y_prefs_v1';

interface A11yPrefs {
  isDark: boolean;
  fontScale: FontScale;
  highContrast: boolean;
  language: LanguageCode;
}

function readLocalPrefs(): A11yPrefs {
  const raw = readVerifiedStorage<Partial<A11yPrefs>>(PREFS_KEY, {});
  return {
    isDark: typeof raw.isDark === 'boolean' ? raw.isDark : true,
    fontScale:
      raw.fontScale === 'large' || raw.fontScale === 'xlarge' ? raw.fontScale : 'normal',
    highContrast: Boolean(raw.highContrast),
    language: isValidLanguageCode(raw.language) ? raw.language : DEFAULT_LANGUAGE,
  };
}

function generatePublicCoupon(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SCHULLZ20-${suffix}`;
}

interface AppContentProps {
  prefs: A11yPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<A11yPrefs>>;
  onChangeLanguage: (lang: LanguageCode) => void;
  toastMsg: string | null;
  showToast: (msg: string) => void;
}

const AppContent: React.FC<AppContentProps> = ({
  prefs,
  setPrefs,
  onChangeLanguage,
  toastMsg,
  showToast,
}) => {
  const { ui, domain, tCategory, tWorkTitle } = useLanguage();

  // Remote-synced studio config (cached securely locally + live Firestore listener)
  const [remoteConfig, setRemoteConfig] = useState<RemoteStudioConfig>(() => {
    const cached = readVerifiedStorage<Partial<RemoteStudioConfig>>(SETTINGS_KEY, {});
    return {
      ...DEFAULT_REMOTE_CONFIG,
      ...cached,
      publicCoupon: cached.publicCoupon || generatePublicCoupon(),
    };
  });

  // Firebase Admin Auth user (for verified andreschullz1313@gmail.com admin session)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(() => auth.currentUser);

  // Client Session & Saved Quotes (integrity-protected against localStorage tampering)
  const [clientUser, setClientUser] = useState<ClientUser | null>(() =>
    readVerifiedStorage<ClientUser | null>(SESSION_KEY, null)
  );
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>(() =>
    readVerifiedStorage<SavedQuote[]>(QUOTES_KEY, [])
  );

  // Tab Navigation with Smooth CSS Enter/Exit Transitions (Login is ALWAYS first tab unless ?tab=...)
  const [activeTab, setActiveTab] = useState<TabId>('login');
  const [renderedTab, setRenderedTab] = useState<TabId>('login');
  const [tabStage, setTabStage] = useState<'idle' | 'exiting' | 'entering'>('idle');
  const exitTimerRef = useRef<number | null>(null);
  const enterRafRef = useRef<number | null>(null);

  // Portfolio Sub-state
  const [portfolioView, setPortfolioView] = useState<'works' | 'instagram'>('works');
  const [portfolioCategory, setPortfolioCategory] = useState<string>('Todos');
  const [lightboxWork, setLightboxWork] = useState<PortfolioWork | null>(null);

  // Pain Map & Quote Sync State
  const [selectedBodyZone, setSelectedBodyZone] = useState<string>('Antebraço externo');
  const [quoteStyle, setQuoteStyle] = useState<string>('Realismo');

  // Drawers, Modals, Print Sheet
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [printHtml, setPrintHtml] = useState<string>('');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [guestInstallOpen, setGuestInstallOpen] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('instalar') === '1';
    } catch {
      return false;
    }
  });
  const [guestInviteCoupon] = useState<string | null>(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      return ref ? ref.toUpperCase().slice(0, 32) : null;
    } catch {
      return null;
    }
  });
  const [activeFolder, setActiveFolder] = useState<FolderId>('contato');
  const [connPhase, setConnPhase] = useState<'online' | 'offline' | 'welcoming'>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online'
  );
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialReason, setTutorialReason] = useState<'first' | 'update' | 'manual'>('first');
  const lastRemoteVersionRef = useRef<number>(remoteConfig.configVersion);
  const lastPromoBannerRef = useRef<string>(remoteConfig.promoBannerDataUrl);

  // Subscribe to Firebase Auth changes
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setFirebaseUser(u));
  }, []);

  // Real-time Firestore listener: pushes admin updates (banner, prices, logo, colors, info) to ALL user apps automatically
  useEffect(() => {
    const unsub = subscribeToStudioConfig((incoming) => {
      setRemoteConfig(incoming);
      writeSignedStorage(SETTINGS_KEY, incoming);
      const promoChanged =
        Boolean(incoming.promoBannerDataUrl) &&
        incoming.promoBannerDataUrl !== lastPromoBannerRef.current;
      lastPromoBannerRef.current = incoming.promoBannerDataUrl;

      if (incoming.configVersion > lastRemoteVersionRef.current) {
        lastRemoteVersionRef.current = incoming.configVersion;
        if (promoChanged) {
          showToast('Novo banner promocional disponível na tela Início!');
        } else {
          showToast(`${incoming.studioName} atualizado automaticamente.`);
        }
      }
    });
    return () => unsub();
  }, [showToast]);

  // Apply remote theme colors + logo URL to document & app monitor
  useEffect(() => {
    applyRemoteThemeAndLogo(remoteConfig, prefs, STUDIO_LOGO_URI);
    setMonitorLogoUrl(remoteConfig.logoDataUrl || STUDIO_LOGO_URI);
  }, [remoteConfig, prefs.isDark, prefs.highContrast]);

  useEffect(() => {
    const onOnline = () => {
      clearAppIssuesByCategory('connection');
      setConnPhase((prev) => (prev === 'offline' ? 'welcoming' : 'online'));
    };
    const onOffline = () => setConnPhase('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Show onboarding tutorial once on first access, or again if app version updated
  useEffect(() => {
    if (!introDone || guestInstallOpen) return;
    try {
      const seenVersion = localStorage.getItem(TUTORIAL_VERSION_KEY);
      if (!seenVersion) {
        setTutorialReason('first');
        setTutorialOpen(true);
      } else if (seenVersion !== APP_VERSION) {
        setTutorialReason('update');
        setTutorialOpen(true);
      }
    } catch {
      // ignore storage errors
    }
  }, [introDone, guestInstallOpen]);

  useEffect(() => {
    const onAppUpdated = () => {
      try {
        localStorage.removeItem(TUTORIAL_VERSION_KEY);
      } catch {
        // ignore
      }
      if (introDone) {
        setTutorialReason('update');
        setTutorialOpen(true);
      }
    };
    window.addEventListener('schullz-app-updated', onAppUpdated);
    return () => window.removeEventListener('schullz-app-updated', onAppUpdated);
  }, [introDone]);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 280);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [renderedTab]);

  // Translate horizontal left/right swipe & trackpad gestures into vertical scrolling
  useEffect(() => {
    const EXCLUDED_SELECTOR =
      'canvas, #tabs, .tabs-bar, input, textarea, select, [role="slider"], [role="dialog"]';

    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(EXCLUDED_SELECTOR)) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0) {
        window.scrollBy({ top: e.deltaX, behavior: 'auto' });
      }
    };

    let activeTouch = false;
    let lastX = 0;
    let lastY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        activeTouch = false;
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest(EXCLUDED_SELECTOR)) {
        activeTouch = false;
        return;
      }
      activeTouch = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeTouch || e.touches.length !== 1) return;
      const curX = e.touches[0].clientX;
      const curY = e.touches[0].clientY;
      const dx = curX - lastX;
      const dy = curY - lastY;
      lastX = curX;
      lastY = curY;

      if (Math.abs(dx) > Math.abs(dy) * 1.15 && Math.abs(dx) > 2) {
        window.scrollBy({ top: -dx * 1.15, behavior: 'auto' });
      }
    };

    const onTouchEnd = () => {
      activeTouch = false;
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const scrollToTop = () => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  const switchTab = useCallback(
    (nextTab: TabId) => {
      if (nextTab === activeTab) return;
      setActiveTab(nextTab);

      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      if (enterRafRef.current) cancelAnimationFrame(enterRafRef.current);

      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        setRenderedTab(nextTab);
        setTabStage('idle');
        window.scrollTo({ top: 0 });
        return;
      }

      setTabStage('exiting');
      exitTimerRef.current = window.setTimeout(() => {
        setRenderedTab(nextTab);
        setTabStage('entering');
        window.scrollTo({ top: 0 });
        enterRafRef.current = requestAnimationFrame(() => {
          enterRafRef.current = requestAnimationFrame(() => {
            setTabStage('idle');
          });
        });
      }, 190);
    },
    [activeTab]
  );

  // Support Play Store / PWA shortcut deep link ?tab=...
  useEffect(() => {
    try {
      const tabParam = new URLSearchParams(window.location.search).get('tab') as TabId | null;
      if (tabParam && TABS.some((t) => t.id === tabParam)) {
        switchTab(tabParam);
      }
    } catch {
      // ignore
    }
  }, [switchTab]);

  const navigateToTarget = useCallback(
    (target: NavigateTarget) => {
      if (
        target === 'contato' ||
        target === 'faq' ||
        target === 'preparacao' ||
        target === 'pos-tattoo' ||
        target === 'loja'
      ) {
        const mappedFolder: FolderId = target === 'loja' ? 'pos-tattoo' : target;
        setActiveFolder(mappedFolder);
        switchTab('central');
        return;
      }
      switchTab(target);
    },
    [switchTab]
  );

  const handleCloseTutorial = useCallback(() => {
    try {
      localStorage.setItem(TUTORIAL_VERSION_KEY, APP_VERSION);
    } catch {
      // ignore storage errors
    }
    setTutorialOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      if (enterRafRef.current) cancelAnimationFrame(enterRafRef.current);
    };
  }, []);

  const handleLoginSuccess = (u: ClientUser) => {
    setClientUser(u);
    writeSignedStorage(SESSION_KEY, u);
    showToast(fmt(ui.toasts.welcomeUser, { name: u.name }));
  };

  const handleLogout = () => {
    setClientUser(null);
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(`schullz_sig_v1_${SESSION_KEY}`);
    } catch {
      // ignore
    }
    showToast(ui.toasts.loggedOut);
    switchTab('login');
  };

  const handleSaveQuote = (q: SavedQuote) => {
    const next = [q, ...savedQuotes];
    setSavedQuotes(next);
    writeSignedStorage(QUOTES_KEY, next);
  };

  const handleUseZoneInQuote = (zoneName: string) => {
    setSelectedBodyZone(zoneName);
    switchTab('orcamento');
    if (!clientUser) {
      showToast(ui.toasts.loginToQuoteZone);
    } else {
      showToast(fmt(ui.toasts.zoneSelected, { zone: zoneName }));
    }
  };

  const handleWantStyle = (category: string) => {
    const styleToSet = category === 'Todos' ? 'Realismo' : category;
    setQuoteStyle(styleToSet);
    setLightboxWork(null);
    switchTab('orcamento');
    if (!clientUser) {
      showToast(ui.toasts.loginToQuoteStyle);
    }
  };

  const isAdminVerified = isAuthorizedAdminUser(firebaseUser);
  const activeLogo = remoteConfig.logoDataUrl || STUDIO_LOGO_URI;
  const igClean = remoteConfig.instagram.replace(/^@/, '');
  const igUrl = `https://instagram.com/${igClean}/`;
  const waUrl = `https://wa.me/${remoteConfig.whatsapp.replace(/\D/g, '')}`;

  const tabPanelClass =
    tabStage === 'exiting'
      ? 'tab-panel tab-exiting'
      : tabStage === 'entering'
      ? 'tab-panel tab-entering'
      : 'tab-panel';

  let flatPriceIdx = 0;

  return (
    <>
      {!introDone && (
        <IntroLoader
          studioName={remoteConfig.studioName}
          logoUrl={activeLogo}
          onComplete={() => setIntroDone(true)}
        />
      )}
      <div className="min-h-screen flex flex-col app-shell" aria-hidden={!introDone}>
        {/* Sticky Top Header, Error Notification Bar & Tab Bar */}
        <div
          id="top"
          className="sticky top-0 z-30 border-b"
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-strong)',
          }}
        >
          <ErrorNotificationBar
            logoUrl={activeLogo}
            studioName={remoteConfig.studioName}
            onRetryConnection={() => {
              if (navigator.onLine) {
                clearAppIssuesByCategory('connection');
                showToast('Conexão restabelecida!');
              } else {
                showToast('Sem conexão no momento.');
              }
            }}
          />

          <header className="max-w-6xl mx-auto flex items-center justify-between gap-3 px-4 py-2.5">
            <button
              type="button"
              onClick={() => switchTab('inicio')}
              className="flex items-center gap-3 text-left cursor-pointer bg-transparent border-0 p-0"
            >
              <img
                src={activeLogo}
                alt={`Logo ${remoteConfig.studioName}`}
                className="w-12 h-12 rounded-full object-cover border-2 shrink-0"
                style={{ borderColor: 'var(--r)' }}
              />
              <div>
                <div className="f text-2xl leading-none" style={{ color: 'var(--r)' }}>
                  {remoteConfig.studioName}
                </div>
                <small
                  className="block text-xs font-bold tracking-[0.22em] uppercase mt-0.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {ui.header.subtitle}
                </small>
              </div>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href={igUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Instagram ${remoteConfig.studioName}`}
                className="flex items-center justify-center rounded border transition-colors"
                style={{
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text)',
                  width: '44px',
                  height: '44px',
                }}
              >
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>

              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label={ui.header.settingsAria}
                className="flex items-center gap-2 px-3 rounded border font-bold cursor-pointer transition-colors"
                style={{
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text)',
                  background: 'var(--card)',
                  minHeight: '44px',
                }}
              >
                <Settings size={18} />
                <span className="hidden sm:inline text-sm uppercase tracking-wider">
                  {ui.header.settingsBtn}
                </span>
                <Menu size={18} />
              </button>
            </div>
          </header>

          {/* Horizontal Tab Navigation */}
          <nav
            id="tabs"
            aria-label={ui.header.navAria}
            className="tabs-bar border-t overflow-x-auto"
            style={{
              background: 'var(--card)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="max-w-6xl mx-auto flex items-center gap-1 px-3 py-1.5">
              {TABS.map((t) => {
                const isSelected = activeTab === t.id;
                const isLocked = Boolean(t.requiresAuth && !clientUser);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => switchTab(t.id)}
                    aria-current={isSelected ? 'page' : undefined}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-base font-bold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    style={{
                      background: isSelected ? 'var(--r)' : 'transparent',
                      color: isSelected ? 'var(--btn-text)' : 'var(--text)',
                      border: isSelected ? '1px solid var(--r)' : '1px solid transparent',
                      minHeight: '42px',
                    }}
                  >
                    {isLocked && <Lock size={14} aria-hidden="true" />}
                    <span>{ui.tabs[t.id]}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {/* Main Single-Tab Stage */}
        <main className="flex-1 tab-stage">
          <div key={renderedTab} className={tabPanelClass}>
            {/* TAB 1 (DEFAULT): LOGIN & CADASTRO */}
            {renderedTab === 'login' && (
              <AuthGateTab
                user={clientUser}
                savedQuotes={savedQuotes}
                onLoginSuccess={handleLoginSuccess}
                onLogout={handleLogout}
                onNavigateTab={switchTab}
                onToast={showToast}
                publicCoupon={remoteConfig.publicCoupon}
                isFirebaseAdmin={isAdminVerified}
                onOpenAdminPanel={() => setAdminOpen(true)}
              />
            )}

            {/* TAB 2: PÁGINA INICIAL */}
            {renderedTab === 'inicio' && (
              <div>
                <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
                  <MonthlyPromoBanner
                    remoteConfig={remoteConfig}
                    isAdmin={isAdminVerified}
                    isClientLoggedIn={Boolean(clientUser)}
                    whatsappUrl={waUrl}
                    onRequestQuote={() => switchTab(clientUser ? 'orcamento' : 'login')}
                    onOpenAdminPanel={() => setAdminOpen(true)}
                    onToast={showToast}
                  />
                  <div
                    className="tab-stagger-kicker text-sm font-bold tracking-[0.25em] uppercase"
                    style={{ color: 'var(--accent-gold)' }}
                  >
                    {ui.home.kicker}
                  </div>
                  <h1 className="tab-stagger-title" style={{ color: 'var(--r)' }}>
                    {ui.home.title}
                  </h1>
                  <p className="tab-stagger-lead max-w-2xl text-xl" style={{ color: 'var(--text)' }}>
                    {ui.home.lead}
                  </p>
                  <div className="tab-stagger-actions flex flex-wrap gap-3 pt-1">
                    <button
                      type="button"
                      className="si-btn"
                      onClick={() => switchTab(clientUser ? 'orcamento' : 'login')}
                    >
                      {clientUser ? ui.home.ctaQuoteLoggedIn : ui.home.ctaQuoteLoggedOut}
                    </button>
                    <button
                      type="button"
                      className="si-btn si-btn-outline"
                      onClick={() => switchTab('agendamento')}
                    >
                      {ui.tabs.agendamento}
                    </button>
                    <button type="button" className="si-btn si-btn-outline" onClick={() => switchTab('portfolio')}>
                      {ui.home.ctaWorks}
                    </button>
                    <button type="button" className="si-btn si-btn-outline" onClick={() => switchTab('mapa')}>
                      {ui.home.ctaPainMap}
                    </button>
                  </div>

                  <div className="tab-stagger-block">
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block font-bold tracking-[0.16em] uppercase underline underline-offset-4 py-2"
                      style={{ color: 'var(--accent-gold)' }}
                    >
                      {ui.home.ctaWhatsapp}
                    </a>
                  </div>

                  <div className="tab-stagger-grid grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                    <div className="si-card si-card-interactive" tabIndex={0}>
                      <div className="f text-5xl" style={{ color: 'var(--r)' }}>
                        20%
                      </div>
                      <p className="mt-1 font-semibold">{ui.home.stat1Text}</p>
                    </div>
                    <div className="si-card si-card-interactive" tabIndex={0}>
                      <div className="f text-5xl" style={{ color: 'var(--r)' }}>
                        100%
                      </div>
                      <p className="mt-1 font-semibold">{ui.home.stat2Text}</p>
                    </div>
                    <div className="si-card si-card-interactive" tabIndex={0}>
                      <div className="f text-5xl" style={{ color: 'var(--r)' }}>
                        1:1
                      </div>
                      <p className="mt-1 font-semibold">{ui.home.stat3Text}</p>
                    </div>
                  </div>
                </section>

                <div className="torn" />

                <section className="max-w-5xl mx-auto px-4 py-10 space-y-5">
                  <div
                    className="tab-stagger-kicker text-sm font-bold tracking-[0.25em] uppercase"
                    style={{ color: 'var(--accent-gold)' }}
                  >
                    {ui.home.studioKicker}
                  </div>
                  <h2 className="tab-stagger-title">{ui.home.studioTitle}</h2>
                  <p className="tab-stagger-lead max-w-3xl text-lg" style={{ color: 'var(--text)' }}>
                    {ui.home.studioLead}
                  </p>

                  <div className="tab-stagger-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                    {ui.home.process.map(([num, title, desc]) => (
                      <div key={num} className="si-card si-card-interactive space-y-1.5" tabIndex={0}>
                        <span className="f text-3xl block" style={{ color: 'var(--r)' }}>
                          {num}
                        </span>
                        <h3>{title}</h3>
                        <p style={{ color: 'var(--text-muted)' }}>{desc}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* TAB 3: TRABALHOS REALIZADOS E INSTAGRAM OFICIAL */}
            {renderedTab === 'portfolio' && (
              <section className="max-w-6xl mx-auto px-4 py-8 space-y-6">
                <div>
                  <div
                    className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase"
                    style={{ color: 'var(--accent-gold)' }}
                  >
                    {ui.portfolio.kicker}
                  </div>
                  <h2 className="tab-stagger-title">{ui.portfolio.title}</h2>
                </div>

                <div className="tab-stagger-actions flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPortfolioView('works')}
                    className="px-4 py-2 rounded font-bold uppercase tracking-wider border cursor-pointer"
                    style={{
                      background: portfolioView === 'works' ? 'var(--r)' : 'transparent',
                      color: portfolioView === 'works' ? 'var(--btn-text)' : 'var(--text)',
                      borderColor: portfolioView === 'works' ? 'var(--r)' : 'var(--border-strong)',
                      minHeight: '44px',
                    }}
                  >
                    {ui.portfolio.tabWorks}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortfolioView('instagram')}
                    className="px-4 py-2 rounded font-bold uppercase tracking-wider border cursor-pointer"
                    style={{
                      background: portfolioView === 'instagram' ? 'var(--r)' : 'transparent',
                      color: portfolioView === 'instagram' ? 'var(--btn-text)' : 'var(--text)',
                      borderColor: portfolioView === 'instagram' ? 'var(--r)' : 'var(--border-strong)',
                      minHeight: '44px',
                    }}
                  >
                    {ui.portfolio.tabInstagram} @{igClean}
                  </button>
                </div>

                {portfolioView === 'works' && (
                  <LayoutGroup id="portfolio-category-filters">
                    <div
                      className="tab-stagger-lead flex flex-wrap gap-2"
                      role="group"
                      aria-label={ui.portfolio.filterAria}
                    >
                      {CATEGORIES.map((cat) => {
                        const active = portfolioCategory === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setPortfolioCategory(cat)}
                            aria-pressed={active}
                            className="relative px-3.5 py-1.5 rounded border text-sm font-bold uppercase tracking-wider cursor-pointer transition-colors duration-200 overflow-hidden"
                            style={{
                              background: 'transparent',
                              color: active ? 'var(--accent-gold)' : 'var(--text)',
                              borderColor: active ? 'var(--accent-gold)' : 'var(--border-subtle)',
                              minHeight: '40px',
                            }}
                          >
                            {active && (
                              <motion.span
                                layoutId="portfolio-category-active"
                                transition={{
                                  type: 'spring',
                                  stiffness: 380,
                                  damping: 30,
                                }}
                                aria-hidden="true"
                                className="absolute inset-0 rounded-[3px]"
                                style={{ background: 'var(--card-alt)' }}
                              />
                            )}
                            <span className="relative z-10">{tCategory(cat)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </LayoutGroup>
                )}

                {portfolioView === 'works' ? (
                  <PortfolioGallery
                    works={PORTFOLIO_WORKS.filter(
                      (w) => portfolioCategory === 'Todos' || w.category === portfolioCategory
                    )}
                    category={portfolioCategory}
                    onSelectWork={(work) => setLightboxWork(work)}
                    onWantStyle={handleWantStyle}
                    onResetCategory={() => setPortfolioCategory('Todos')}
                  />
                ) : (
                  <InstagramFeed
                    username={igClean}
                    studioName={remoteConfig.studioName}
                    onViewPortfolioWorks={() => setPortfolioView('works')}
                    onSelectWork={(work) => setLightboxWork(work)}
                  />
                )}
              </section>
            )}

            {/* TAB 4: MAPA CORPORAL 3D DA DOR */}
            {renderedTab === 'mapa' && (
              <section className="max-w-5xl mx-auto px-4 py-8 space-y-5">
                <div>
                  <div
                    className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase"
                    style={{ color: 'var(--accent-gold)' }}
                  >
                    {domain.painMap.hudTitle}
                  </div>
                  <h2 className="tab-stagger-title">{ui.tabs.mapa}</h2>
                  <p className="tab-stagger-lead" style={{ color: 'var(--text-muted)' }}>
                    {domain.painMap.hudHint}
                  </p>
                </div>

                <div className="tab-stagger-block">
                  <PainMap3D
                    isDark={prefs.isDark}
                    selectedZone={selectedBodyZone}
                    onSelectZone={(z) => setSelectedBodyZone(z)}
                    onUseInQuote={handleUseZoneInQuote}
                  />
                </div>
              </section>
            )}

            {/* TAB 5: TABELA DE PREÇOS (PROTEGIDA POR LOGIN, PREÇOS EM TEMPO REAL) */}
            {renderedTab === 'precos' && (
              <section className="max-w-5xl mx-auto px-4 py-8 space-y-6">
                {!clientUser ? (
                  <div className="si-card tab-stagger-block max-w-2xl mx-auto text-center py-10 space-y-4">
                    <div className="text-sm font-bold tracking-widest uppercase" style={{ color: 'var(--accent-gold)' }}>
                      {ui.prices.restrictedKicker}
                    </div>
                    <h2>{ui.prices.restrictedTitle}</h2>
                    <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
                      {ui.prices.restrictedBody}
                    </p>
                    <button type="button" className="si-btn" onClick={() => switchTab('login')}>
                      {ui.prices.goToLogin}
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <div
                        className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase"
                        style={{ color: 'var(--accent-gold)' }}
                      >
                        {ui.prices.kicker}
                      </div>
                      <h2 className="tab-stagger-title">{ui.prices.title}</h2>
                      <p className="tab-stagger-lead" style={{ color: 'var(--text)' }}>
                        {ui.prices.lead}
                      </p>
                    </div>

                    {PRICE_GROUPS.map((grp, grpIdx) => {
                      const localizedGrp = domain.priceGroups[grpIdx];
                      return (
                        <div key={grp.group} className="space-y-3">
                          <h3 className="tab-stagger-title text-2xl" style={{ color: 'var(--accent-gold)' }}>
                            {localizedGrp?.group || grp.group}
                          </h3>
                          <div className="tab-stagger-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {grp.items.map((item, itemIdx) => {
                              const currentIdx = flatPriceIdx++;
                              const overridePrice = remoteConfig.priceItems[currentIdx];
                              const minVal = overridePrice ? overridePrice.min : item.min;
                              const maxVal = overridePrice ? overridePrice.max : item.max;
                              const localizedItem = localizedGrp?.items[itemIdx] || item;
                              return (
                                <div key={item.title} className="si-card si-card-interactive flex flex-col justify-between gap-3" tabIndex={0}>
                                  <div className="space-y-1.5">
                                    <h3>{localizedItem.title}</h3>
                                    <p className="text-base" style={{ color: 'var(--text-muted)' }}>
                                      {localizedItem.description}
                                    </p>
                                  </div>
                                  <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                    <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--r)' }}>
                                      {formatBRL(minVal)} – {formatBRL(maxVal)}
                                    </div>
                                    <div className="text-sm font-semibold tabular-nums" style={{ color: 'var(--pain-low-text)' }}>
                                      {fmt(ui.prices.withReferral, {
                                        min: formatBRL(minVal * 0.8),
                                        max: formatBRL(maxVal * 0.8),
                                      })}
                                    </div>
                                    <button
                                      type="button"
                                      className="si-btn si-btn-outline si-btn-sm w-full mt-2"
                                      onClick={() => switchTab('orcamento')}
                                    >
                                      {ui.prices.requestQuote}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    <p className="tab-stagger-block text-base font-semibold pt-2" style={{ color: 'var(--accent-gold)' }}>
                      {remoteConfig.fullSleeveMin === 2500
                        ? ui.prices.fullSleeveNote
                        : `${ui.prices.fullSleeveNote.replace(/R\$ 2\.500|\$2,500/, formatBRL(remoteConfig.fullSleeveMin))}`}
                    </p>
                  </>
                )}
              </section>
            )}

            {/* TAB 6: ORÇAMENTO AUTOMÁTICO */}
            {renderedTab === 'orcamento' && (
              <QuoteSection
                user={clientUser}
                selectedStyle={quoteStyle}
                onChangeStyle={setQuoteStyle}
                selectedZone={selectedBodyZone}
                onChangeZone={setSelectedBodyZone}
                publicCoupon={remoteConfig.publicCoupon}
                studioWhatsapp={remoteConfig.whatsapp}
                studioInstagram={remoteConfig.instagram}
                studioName={remoteConfig.studioName}
                logoUrl={activeLogo}
                sizeTierPrices={remoteConfig.sizeTiers}
                onSaveQuote={handleSaveQuote}
                onGoToLogin={() => switchTab('login')}
                onToast={showToast}
                onPrintSheet={setPrintHtml}
              />
            )}

            {/* TAB 7: AGENDAMENTO ONLINE + WHATSAPP */}
            {renderedTab === 'agendamento' && (
              <ScheduleTab
                user={clientUser}
                selectedStyle={quoteStyle}
                onChangeStyle={setQuoteStyle}
                selectedZone={selectedBodyZone}
                onChangeZone={setSelectedBodyZone}
                studioName={remoteConfig.studioName}
                studioWhatsapp={remoteConfig.whatsapp}
                studioInstagram={remoteConfig.instagram}
                logoUrl={activeLogo}
                publicCoupon={remoteConfig.publicCoupon}
                isAdmin={isAdminVerified}
                onToast={showToast}
              />
            )}

            {/* TAB 8: CENTRAL DE GUIAS */}
            {renderedTab === 'central' && (
              <StudioFoldersHub
                activeFolder={activeFolder}
                onSelectFolder={setActiveFolder}
                onNavigate={navigateToTarget}
                studioName={remoteConfig.studioName}
                studioWhatsapp={remoteConfig.whatsapp}
                studioInstagram={remoteConfig.instagram}
                onSelectPortfolioWork={(work) => setLightboxWork(work)}
              />
            )}

            {/* TAB 8: CLUBE DE INDICAÇÃO */}
            {renderedTab === 'indicacao' && (
              <section className="max-w-5xl mx-auto px-4 py-8 space-y-6">
                <div className="space-y-2">
                  <div
                    className="tab-stagger-kicker text-sm font-bold tracking-widest uppercase"
                    style={{ color: 'var(--accent-gold)' }}
                  >
                    {ui.referral.kicker}
                  </div>
                  <h2 className="tab-stagger-title">{ui.referral.title}</h2>
                  <p className="tab-stagger-lead" style={{ color: 'var(--text)' }}>
                    {ui.referral.leadBefore}{' '}
                    <strong className="tracking-wider" style={{ color: 'var(--r)' }}>
                      {clientUser?.coupon || remoteConfig.publicCoupon}
                    </strong>
                    {ui.referral.leadAfter}
                  </p>
                </div>

                <div className="tab-stagger-actions flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="si-btn"
                    onClick={() => {
                      const code = clientUser?.coupon || remoteConfig.publicCoupon;
                      navigator.clipboard?.writeText(code).catch(() => {});
                      showToast(fmt(ui.toasts.codeCopied, { code }));
                    }}
                  >
                    {ui.referral.copyCode}
                  </button>
                  <button type="button" className="si-btn si-btn-outline" onClick={() => switchTab('login')}>
                    {clientUser ? ui.referral.viewAccount : ui.referral.enterClientArea}
                  </button>
                </div>

                <div className="tab-stagger-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {ui.referral.steps.map(([num, title, desc]) => (
                    <div key={num} className="si-card si-card-interactive space-y-1.5" tabIndex={0}>
                      <span className="f text-3xl block" style={{ color: 'var(--r)' }}>
                        {num}
                      </span>
                      <h3>{title}</h3>
                      <p style={{ color: 'var(--text-muted)' }}>{desc}</p>
                    </div>
                  ))}
                </div>

                <div className="tab-stagger-block">
                  <ShareInstallPanel
                    couponCode={clientUser?.coupon || remoteConfig.publicCoupon}
                    onToast={showToast}
                    logoUrl={activeLogo}
                    studioName={remoteConfig.studioName}
                    apkDownloadUrl={remoteConfig.apkDownloadUrl}
                  />
                </div>
              </section>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer
          className="border-t py-6 px-4 text-center space-y-2"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border-strong)',
            color: 'var(--text)',
          }}
        >
          <div className="f text-2xl" style={{ color: 'var(--r)' }}>
            {remoteConfig.studioName}
          </div>
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>
            {ui.footer.info}
          </p>
          <div className="pt-1">
            <button
              type="button"
              className="si-btn si-btn-outline si-btn-sm"
              onClick={() => setShareModalOpen(true)}
            >
              <Share2 size={16} />
              {ui.footer.inviteDownload}
            </button>
          </div>
          <div>
            <button
              type="button"
              className="text-sm underline cursor-pointer bg-transparent border-0"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setAdminOpen(true)}
            >
              {ui.footer.artistArea}
            </button>
          </div>
        </footer>

        <SideScrollBar activeTab={renderedTab} />

        {/* Back to Top */}
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={ui.header.backToTop}
          title={ui.header.backToTop}
          aria-hidden={!showBackToTop}
          tabIndex={showBackToTop ? 0 : -1}
          className={`fixed right-4 bottom-20 z-20 inline-flex items-center gap-1.5 px-3.5 h-12 rounded-full border-2 font-bold text-sm uppercase tracking-wider shadow-lg cursor-pointer transition-all duration-200 hover:scale-105 ${
            showBackToTop
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-3 pointer-events-none'
          }`}
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border-strong)',
            color: 'var(--accent-gold)',
          }}
        >
          <ArrowUp size={18} strokeWidth={2.5} aria-hidden="true" />
          <span className="hidden sm:inline">{ui.header.backToTopShort}</span>
        </button>

        {/* Floating WhatsApp Action */}
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="WhatsApp"
          className="fixed right-4 bottom-4 z-20 w-14 h-14 rounded-full grid place-items-center shadow-lg transition-transform hover:scale-105"
          style={{
            background: 'var(--r)',
            color: 'var(--btn-text)',
          }}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M20.5 3.5A11.8 11.8 0 0 0 2 17.7L.5 23.5l6-1.6A11.8 11.8 0 0 0 20.5 3.5ZM12 21a9 9 0 0 1-4.6-1.3l-.3-.2-3.5.9.9-3.4-.2-.4A9 9 0 1 1 12 21Zm5-6.7c-.3-.2-1.7-.9-2-.9s-.5-.2-.7.2-.8.9-1 1.1-.4.2-.7.1a7.4 7.4 0 0 1-2.2-1.4 8.2 8.2 0 0 1-1.5-1.9c-.2-.3 0-.5.2-.7l.5-.6c.2-.2.2-.4.3-.6s0-.4 0-.6-.7-1.7-.9-2.3c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.2-1.2 2.8 1.2 3.2 1.4 3.4a11.4 11.4 0 0 0 4.4 3.9c.6.3 1.1.5 1.5.6.6.2 1.2.2 1.7.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.1-1.4s-.2-.2-.5-.4Z" />
          </svg>
        </a>

        {/* Lightbox Modal for Portfolio Photos */}
        {lightboxWork && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.82)' }}
            onClick={() => setLightboxWork(null)}
            role="dialog"
            aria-modal="true"
            aria-label={tWorkTitle(lightboxWork.title)}
          >
            <div
              className="si-card max-w-lg w-full space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={lightboxWork.src}
                alt={tWorkTitle(lightboxWork.title)}
                className="w-full max-h-[58vh] object-contain rounded bg-black"
                referrerPolicy="no-referrer"
              />
              <h3>{tWorkTitle(lightboxWork.title)}</h3>
              <p className="font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
                {tCategory(lightboxWork.category)}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="si-btn"
                  onClick={() => handleWantStyle(lightboxWork.category)}
                >
                  {ui.common.wantThisStyle}
                </button>
                <button type="button" className="si-btn si-btn-outline" onClick={() => setLightboxWork(null)}>
                  {ui.common.close}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Artist / Verified Firebase Admin Modal */}
        <AdminPanelModal
          open={adminOpen}
          onClose={() => setAdminOpen(false)}
          firebaseAdminUser={firebaseUser}
          remoteConfig={remoteConfig}
          savedQuotes={savedQuotes}
          onToast={showToast}
        />

        {/* Slide-over Settings & Navigation Drawer */}
        <SettingsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          isDark={prefs.isDark}
          onToggleTheme={(dark) => setPrefs((p) => ({ ...p, isDark: dark }))}
          fontScale={prefs.fontScale}
          onChangeFontScale={(fontScale) => setPrefs((p) => ({ ...p, fontScale }))}
          highContrast={prefs.highContrast}
          onToggleHighContrast={(highContrast) => setPrefs((p) => ({ ...p, highContrast }))}
          language={prefs.language}
          onChangeLanguage={onChangeLanguage}
          activeTab={activeTab}
          onSelectTab={switchTab}
          isLoggedIn={Boolean(clientUser)}
          onOpenAdmin={() => setAdminOpen(true)}
          onOpenShareInstall={() => setShareModalOpen(true)}
          onOpenTutorial={() => {
            setTutorialReason('manual');
            setTutorialOpen(true);
          }}
        />

        {/* Share & QR Code Modal */}
        {shareModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.82)' }}
            onClick={() => setShareModalOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={ui.share.title}
          >
            <div className="max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-label={ui.common.close}
                  onClick={() => setShareModalOpen(false)}
                  className="si-btn si-btn-outline si-btn-sm"
                  style={{ background: 'var(--card)' }}
                >
                  <X size={18} />
                  {ui.common.close}
                </button>
              </div>
              <ShareInstallPanel
                couponCode={clientUser?.coupon || remoteConfig.publicCoupon}
                onToast={showToast}
                logoUrl={activeLogo}
                studioName={remoteConfig.studioName}
                apkDownloadUrl={remoteConfig.apkDownloadUrl}
              />
            </div>
          </div>
        )}

        {/* Automatic Guest Install Modal */}
        <GuestInstallModal
          open={guestInstallOpen}
          onClose={() => setGuestInstallOpen(false)}
          couponCode={guestInviteCoupon}
          onToast={showToast}
          logoUrl={activeLogo}
          studioName={remoteConfig.studioName}
          apkDownloadUrl={remoteConfig.apkDownloadUrl}
        />

        {/* Interactive Tutorial */}
        <OnboardingTutorial
          open={tutorialOpen && connPhase === 'online'}
          reason={tutorialReason}
          onClose={handleCloseTutorial}
          onNavigate={(target) => {
            handleCloseTutorial();
            navigateToTarget(target);
          }}
        />

        {/* Offline Glitch Screen */}
        {connPhase !== 'online' && (
          <OfflineGlitchScreen
            phase={connPhase}
            onReconnect={() => setConnPhase('welcoming')}
            onWelcomeComplete={() => setConnPhase('online')}
          />
        )}

        {/* Toast Notification */}
        {toastMsg && (
          <div
            role="status"
            aria-live="polite"
            className="fixed left-1/2 bottom-20 -translate-x-1/2 z-50 px-5 py-2.5 rounded font-bold shadow-xl"
            style={{
              background: 'var(--r)',
              color: 'var(--btn-text)',
            }}
          >
            {toastMsg}
          </div>
        )}
      </div>

      {/* Printable Contract Sheet */}
      <article id="print-sheet" dangerouslySetInnerHTML={{ __html: printHtml }} />
    </>
  );
};

export default function App() {
  const [prefs, setPrefs] = useState<A11yPrefs>(readLocalPrefs);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Sync theme, font scale, contrast, and <html lang>
  useEffect(() => {
    const root = document.documentElement;
    root.lang = prefs.language;
    if (prefs.isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const scaleMap: Record<FontScale, string> = {
      normal: '1',
      large: '1.14',
      xlarge: '1.26',
    };
    root.style.setProperty('--font-scale', scaleMap[prefs.fontScale]);
    if (prefs.highContrast) {
      root.setAttribute('data-contrast', 'high');
    } else {
      root.removeAttribute('data-contrast');
    }
    writeSignedStorage(PREFS_KEY, prefs);
  }, [prefs]);

  const handleChangeLanguage = useCallback(
    (nextLang: LanguageCode) => {
      setPrefs((p) => ({ ...p, language: nextLang }));
      showToast(UI_TRANSLATIONS[nextLang].settings.languageChangedToast);
    },
    [showToast]
  );

  return (
    <LanguageProvider lang={prefs.language} onChangeLang={handleChangeLanguage}>
      <AppContent
        prefs={prefs}
        setPrefs={setPrefs}
        onChangeLanguage={handleChangeLanguage}
        toastMsg={toastMsg}
        showToast={showToast}
      />
    </LanguageProvider>
  );
}

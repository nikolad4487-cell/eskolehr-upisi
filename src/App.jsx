import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  School,
  Search,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { hasSupabaseConfig, supabase } from './lib/supabase';

const EMATICA_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'schools', label: 'Škole', icon: Building2 },
  { id: 'years', label: 'Školske godine', icon: CalendarDays },
  { id: 'programs', label: 'Programi', icon: BookOpen },
  { id: 'classes', label: 'Razredi', icon: School },
  { id: 'students', label: 'Učenici', icon: Users },
  { id: 'enrollments', label: 'Upisi', icon: UserPlus },
  { id: 'admissions', label: 'e-Upisi', icon: GraduationCap },
  { id: 'transfers', label: 'Premještaji učenika', icon: ArrowRightLeft },
  { id: 'transition', label: 'Prijelaz školske godine', icon: GraduationCap },
  { id: 'sync', label: 'Sinkronizacija e-Dnevnik', icon: Database },
  { id: 'certificates', label: 'Zaključivanje i svjedodžbe', icon: FileText },
  { id: 'reports', label: 'Izvještaji', icon: ClipboardList },
  { id: 'access', label: 'Pristupi', icon: ShieldAlert },
];

const HOMEROOM_NAV_ITEMS = [
  { id: 'dashboard', label: 'Razrednički pregled', icon: LayoutDashboard },
  { id: 'students', label: 'Učenici', icon: Users },
  { id: 'enrollments', label: 'Upisi', icon: UserPlus },
  { id: 'admissions', label: 'e-Upisi', icon: GraduationCap },
  { id: 'transfers', label: 'Premještaji učenika', icon: ArrowRightLeft },
  { id: 'transition', label: 'Prijelaz školske godine', icon: GraduationCap },
  { id: 'sync', label: 'Sinkronizacija e-Dnevnik', icon: Database },
  { id: 'certificates', label: 'Zaključivanje i svjedodžbe', icon: FileText },
];

const STUDENT_NAV_ITEMS = [
  { id: 'dashboard', label: 'Moj pregled', icon: LayoutDashboard },
  { id: 'admissions', label: 'Prijave i prioriteti', icon: GraduationCap },
];

const TEACHER_ADMISSIONS_NAV_ITEMS = [
  { id: 'dashboard', label: 'Pregled modula', icon: LayoutDashboard },
  { id: 'admissions', label: 'Kandidature i ponuda', icon: GraduationCap },
];

const LOCKED_NAV_ITEMS = [
  { id: 'locked', label: 'Pristup', icon: ShieldAlert },
];

const APP_SECTIONS = {
  ematica: {
    id: 'ematica',
    label: 'e-Matica',
    shortLabel: 'e-Matica',
    subtitle: 'Administracija, matične evidencije i završni dokumenti',
  },
  srednja: {
    id: 'srednja',
    label: 'Upisi u srednju',
    shortLabel: 'Srednja',
    subtitle: 'Kandidature i rang-liste za srednje škole',
  },
  fakulteti: {
    id: 'fakulteti',
    label: 'Upisi na fakultete',
    shortLabel: 'Fakulteti',
    subtitle: 'Kandidature i rang-liste za visoka učilišta',
  },
};

const APP_MODE = import.meta.env.VITE_APP_MODULE ?? 'all';

function appAllowsSection(sectionId) {
  if (APP_MODE === 'ematica') return sectionId === APP_SECTIONS.ematica.id;
  if (APP_MODE === 'upisi') return sectionId !== APP_SECTIONS.ematica.id;
  return true;
}

const EMATICA_WORKFLOW = [
  ['Evidencija', 'Škole, godine, programi, razredi i učenici'],
  ['Statusi', 'Aktivan, ispisan, prebačen ili završio'],
  ['Prijelazi', 'Prijenos razreda i prijenosi između ustanova'],
  ['Dokumenti', 'Zaključivanje, potvrde i svjedodžbe'],
];

const SECONDARY_ADMISSIONS_WORKFLOW = [
  ['Povlačenje', 'Razrednik povlači učenike 8. razreda'],
  ['Prioriteti', 'Učenik slaže 1-10 izbora srednjih škola i smjerova'],
  ['Rangiranje', 'Sustav računa bodove, rang i kvote'],
  ['Upis', 'Kandidat se upisuje samo u jedan program'],
];

const HIGHER_ADMISSIONS_WORKFLOW = [
  ['Povlačenje', 'Razrednik povlači učenike završnih razreda'],
  ['Prioriteti', 'Učenik slaže 1-10 izbora fakulteta i programa'],
  ['Rangiranje', 'Sustav računa bodove, rang i kvote'],
  ['Upis', 'Kandidat se upisuje samo u jedan studijski program'],
];

const STUDENT_STATUSES = {
  ACTIVE: 'Aktivan',
  DROPPED_OUT: 'Ispisan',
  TRANSFERRED: 'Prebačen',
  GRADUATED: 'Završio',
};

function getPreferredSectionFromHost() {
  if (typeof window === 'undefined') return APP_SECTIONS.ematica.id;
  if (APP_MODE === 'ematica') return APP_SECTIONS.ematica.id;

  const forced = getForcedSectionFromHost();
  if (forced) return forced;

  const host = window.location.hostname.toLowerCase();
  if (host.startsWith('e-matica.') || host.startsWith('ematica.')) return APP_SECTIONS.ematica.id;
  if (APP_MODE === 'upisi') return APP_SECTIONS.srednja.id;
  return APP_SECTIONS.ematica.id;
}

function getForcedSectionFromHost() {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith('srednja.')) return APP_SECTIONS.srednja.id;
  if (host.startsWith('fakulteti.')) return APP_SECTIONS.fakulteti.id;
  if (host.startsWith('e-matica.') || host.startsWith('ematica.')) return APP_SECTIONS.ematica.id;
  if (APP_MODE === 'ematica') return APP_SECTIONS.ematica.id;
  return null;
}

function useSupabaseQuery(loader, deps = []) {
  const [state, setState] = useState({ data: [], loading: true, error: null });

  const reload = async () => {
    if (!hasSupabaseConfig) {
      setState({ data: [], loading: false, error: 'Nedostaje Supabase konfiguracija u .env datoteci.' });
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null }));
    const result = await loader();
    if (result.error) {
      setState({ data: [], loading: false, error: result.error.message });
      return;
    }
    setState({ data: result.data ?? [], loading: false, error: null });
  };

  useEffect(() => {
    reload();
  }, deps);

  return { ...state, reload };
}

function isStudentProfile(profile) {
  if (!profile) return false;

  if (profile.is_student === true || profile.student === true) return true;

  const roleKeys = ['role', 'user_role', 'account_type', 'profile_type', 'type'];
  const roleText = roleKeys
    .map((key) => profile[key])
    .filter(Boolean)
    .join(' ');

  const allText = Object.values(profile)
    .filter((value) => typeof value === 'string')
    .join(' ');

  const normalized = `${roleText} ${allText}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return normalized.includes('student') || normalized.includes('ucenik');
}

function isTeacherProfile(profile, access) {
  if (access?.is_teacher) return true;
  if (!profile) return false;
  return normalizedProfileText(profile).includes('teacher') || normalizedProfileText(profile).includes('nastavnik') || normalizedProfileText(profile).includes('professor');
}

function isAdminProfile(profile, access) {
  if (access?.is_admin) return true;
  if (!profile) return false;
  const normalized = normalizedProfileText(profile);
  if (normalized.includes('admin') || normalized.includes('administrator') || normalized.includes('ravnatelj') || normalized.includes('strucna_sluzba')) return true;
  return !isStudentProfile(profile) && !isTeacherProfile(profile, access);
}

function normalizedProfileText(profile) {
  return Object.values(profile ?? {})
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getAdmissionsTrack(profile, access) {
  const level = access?.active_school_level ?? profile?.active_school_level ?? profile?.education_level;
  if (level === 'ELEMENTARY') return 'SECONDARY';
  if (level === 'SECONDARY') return 'HIGHER_EDUCATION';
  if (level === 'HIGHER') return 'HIGHER_EDUCATION';
  return 'UNKNOWN';
}

function getActiveSchoolLevel(profile, access, studentRecord = null) {
  return access?.active_school_level
    ?? profile?.active_school_level
    ?? profile?.education_level
    ?? studentRecord?.school_level
    ?? studentRecord?.education_level
    ?? null;
}

function getClassGradeLevel(record) {
  const direct = Number(record?.grade_level);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String(record?.class_name ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function isDifferentialClass(record) {
  return String(record?.class_name ?? '').trim().toUpperCase() === '4.K';
}

function getProgramDurationYears(record) {
  const duration = Number(record?.program_duration_years ?? record?.duration_years ?? record?.program_duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function isSecondaryAdmissionsEligibleStudent(studentRecord, schoolLevel) {
  return Boolean(studentRecord)
    && schoolLevel === 'ELEMENTARY'
    && getClassGradeLevel(studentRecord) === 8
    && String(studentRecord.student_status ?? 'ACTIVE') === 'ACTIVE';
}

function isHigherAdmissionsEligibleStudent(studentRecord, schoolLevel) {
  if (!studentRecord || schoolLevel !== 'SECONDARY' || isDifferentialClass(studentRecord)) return false;
  const gradeLevel = getClassGradeLevel(studentRecord);
  const duration = getProgramDurationYears(studentRecord);
  const finalGrade = duration ?? 4;
  return gradeLevel === finalGrade && String(studentRecord.student_status ?? 'ACTIVE') === 'ACTIVE';
}

function isClassEligibleForAdmissions(record, track) {
  if (track === 'SECONDARY') return getClassGradeLevel(record) === 8;
  if (track === 'HIGHER_EDUCATION') {
    if (isDifferentialClass(record)) return false;
    const gradeLevel = getClassGradeLevel(record);
    const duration = getProgramDurationYears(record);
    return duration ? gradeLevel === duration : [4, 5].includes(gradeLevel);
  }
  return false;
}

function getDeniedLoginMessage(section, isStudent) {
  if (section === APP_SECTIONS.ematica.id) {
    return isStudent
      ? 'e-Matici mogu pristupiti samo administratori i razrednici.'
      : 'Nemate pravo pristupa e-Matici.';
  }

  if (isStudent) {
    return 'Administrator jo\u0161 nije povukao podatke iz e-Dnevnika, molimo obavijestiti razrednika.';
  }

  if (section === APP_SECTIONS.srednja.id) {
    return 'Nemate pravo pristupa portalu za upis u srednju \u0161kolu.';
  }

  if (section === APP_SECTIONS.fakulteti.id) {
    return 'Nemate pravo pristupa portalu za upis na fakultete.';
  }

  return 'Nemate pravo pristupa ovom sustavu.';
}

function App() {
  const [activePage, setActivePage] = useState('dashboard');
  const [activeSection, setActiveSection] = useState(() => getPreferredSectionFromHost());
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [access, setAccess] = useState(null);
  const [studentRecord, setStudentRecord] = useState(null);
  const [studentRecordLoading, setStudentRecordLoading] = useState(false);
  const [studentRecordChecked, setStudentRecordChecked] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setProfileLoading(Boolean(data.session?.user?.id));
      setStudentRecordChecked(false);
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setProfileLoading(Boolean(nextSession?.user?.id));
      setStudentRecordChecked(false);
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      if (!session?.user?.id) {
        setProfile(null);
        setAccess(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      setProfile(error ? null : data);

      if (data?.auth_user_id) {
        const { data: accessData } = await supabase
          .from('v_ematica_user_access')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .maybeSingle();
        setAccess(accessData ?? null);
      } else {
        setAccess(null);
      }
      setProfileLoading(false);
    };

    loadProfile();
  }, [session?.user?.id]);

  const isStudent = access?.is_student || isStudentProfile(profile);
  const isTeacher = isTeacherProfile(profile, access);
  const isAdmin = isAdminProfile(profile, access);
  const isHomeroomTeacher = Boolean(access?.is_homeroom_teacher);
  const forcedSection = getForcedSectionFromHost();
  const activeSchoolLevel = getActiveSchoolLevel(profile, access, studentRecord);

  useEffect(() => {
    const loadStudentRecord = async () => {
      if (!isStudent || !session?.user?.id) {
        setStudentRecord(null);
        setStudentRecordLoading(false);
        setStudentRecordChecked(true);
        return;
      }

      setStudentRecordChecked(false);
      setStudentRecordLoading(true);
      let result = null;

      if (profile?.id) {
        result = await supabase
          .from('v_ematica_students_current')
          .select('*')
          .eq('ednevnik_student_id', profile.id)
          .maybeSingle();
      }

      if ((!result || (!result.data && !result.error)) && session?.user?.email) {
        result = await supabase
          .from('v_ematica_students_current')
          .select('*')
          .eq('email', session.user.email)
          .maybeSingle();
      }

      setStudentRecord(result?.data ?? null);
      setStudentRecordLoading(false);
      setStudentRecordChecked(true);
    };

    loadStudentRecord();
  }, [isStudent, profile?.id, session?.user?.id, session?.user?.email]);

  const canUseEmatica = isAdmin || isHomeroomTeacher;
  const admissionsTrack = getAdmissionsTrack(profile, access);
  const canUseSecondaryAdmissions = isStudent
    ? isSecondaryAdmissionsEligibleStudent(studentRecord, activeSchoolLevel)
    : (
        (activeSchoolLevel === 'ELEMENTARY' && (isAdmin || isHomeroomTeacher))
        || (activeSchoolLevel === 'SECONDARY' && isAdmin)
      );
  const canUseHigherAdmissions = isStudent
    ? isHigherAdmissionsEligibleStudent(studentRecord, activeSchoolLevel)
    : (
        (activeSchoolLevel === 'SECONDARY' && (isAdmin || isHomeroomTeacher))
        || (activeSchoolLevel === 'HIGHER' && isAdmin)
      );
  const canUseEmaticaInApp = appAllowsSection(APP_SECTIONS.ematica.id) && canUseEmatica;
  const canUseAdmissionsInApp = (
    (appAllowsSection(APP_SECTIONS.srednja.id) && canUseSecondaryAdmissions)
    || (appAllowsSection(APP_SECTIONS.fakulteti.id) && canUseHigherAdmissions)
  );
  const canUseActiveAdmissionsSection = activeSection === APP_SECTIONS.srednja.id
    ? canUseSecondaryAdmissions
    : canUseHigherAdmissions;
  const accessChecksReady = Boolean(session)
    && !authLoading
    && !profileLoading
    && !studentRecordLoading
    && (!isStudent || studentRecordChecked);
  const deniedLoginMessage = accessChecksReady && (
    activeSection === APP_SECTIONS.ematica.id
      ? !canUseEmaticaInApp
      : !canUseActiveAdmissionsSection
  )
    ? getDeniedLoginMessage(activeSection, isStudent)
    : '';
  const adminScope = {
    schoolId: access?.active_school_id ?? profile?.active_school_id ?? '',
    schoolName: access?.active_school_name ?? '',
    isScoped: Boolean(access?.active_school_id ?? profile?.active_school_id),
  };

  useEffect(() => {
    if (!deniedLoginMessage || !session) return;

    let cancelled = false;

    const signOutDeniedUser = async () => {
      setAuthNotice(deniedLoginMessage);
      await supabase.auth.signOut();
      if (cancelled) return;
      setSession(null);
      setProfile(null);
      setAccess(null);
      setStudentRecord(null);
      setStudentRecordChecked(false);
    };

    signOutDeniedUser();

    return () => {
      cancelled = true;
    };
  }, [deniedLoginMessage, session]);

  const availableSections = useMemo(() => {
    if (forcedSection && appAllowsSection(forcedSection)) {
      return [forcedSection];
    }

    const sections = [];

    if (canUseEmaticaInApp) {
      sections.push(APP_SECTIONS.ematica.id);
    }

    if (appAllowsSection(APP_SECTIONS.srednja.id) && canUseSecondaryAdmissions) {
      sections.push(APP_SECTIONS.srednja.id);
    }

    if (appAllowsSection(APP_SECTIONS.fakulteti.id) && canUseHigherAdmissions) {
      sections.push(APP_SECTIONS.fakulteti.id);
    }

    return [...new Set(sections.filter(appAllowsSection))];
  }, [canUseEmaticaInApp, canUseHigherAdmissions, canUseSecondaryAdmissions, forcedSection]);

  useEffect(() => {
    if (!availableSections.length) return;
    if (!availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0]);
    }
  }, [activeSection, availableSections]);

  useEffect(() => {
    const preferred = getPreferredSectionFromHost();
    if (availableSections.includes(preferred) && preferred !== activeSection) {
      setActiveSection(preferred);
    }
  }, [activeSection, availableSections]);

  const admissionsNavItems = isStudent ? STUDENT_NAV_ITEMS : TEACHER_ADMISSIONS_NAV_ITEMS;
  const navItems = activeSection === APP_SECTIONS.ematica.id
    ? (canUseEmaticaInApp ? (isAdmin ? EMATICA_NAV_ITEMS : HOMEROOM_NAV_ITEMS) : LOCKED_NAV_ITEMS)
    : (canUseActiveAdmissionsSection ? admissionsNavItems : LOCKED_NAV_ITEMS);

  useEffect(() => {
    if (!navItems.some((item) => item.id === activePage)) {
      setActivePage(navItems[0]?.id ?? 'locked');
    }
  }, [activePage, navItems]);

  const page = navItems.find((item) => item.id === activePage) ?? navItems[0];
  const PageIcon = page.icon;
  const activeSectionMeta = APP_SECTIONS[activeSection] ?? APP_SECTIONS.ematica;
  const admissionsTitle = activeSection === APP_SECTIONS.fakulteti.id ? 'Upisi na fakultete' : 'Upisi u srednju';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `${activeSectionMeta.label} | ŠkoleHR Admin`;
    }
  }, [activeSectionMeta]);

  if (authLoading) {
    return <Splash label="Provjera prijave" />;
  }

  if (!hasSupabaseConfig) {
    return <ConfigMissing />;
  }

  if (!session) {
    return <Login notice={authNotice} onClearNotice={() => setAuthNotice('')} />;
  }

  if (profileLoading) {
    return <Splash label="Učitavanje korisničkog profila" />;
  }

  if (studentRecordLoading) {
    return <Splash label="Provjera prava pristupa" />;
  }

  if (deniedLoginMessage) {
    return <Splash label="Provjera prava pristupa" />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <School size={26} />
          <div>
            <strong>ŠkoleHR Admin</strong>
            <span>Samostalni sustav za e-Maticu i upise</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Glavna navigacija">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activePage === item.id ? 'active' : ''}
                onClick={() => setActivePage(item.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-footer__label">Aktivni modul</div>
          <strong>{activeSectionMeta.label}</strong>
          <span>{activeSectionMeta.subtitle}</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-main">
            <div className="section-switcher" aria-label="Moduli sustava">
              {availableSections.map((sectionId) => {
                const section = APP_SECTIONS[sectionId];
                return (
                  <button
                    key={sectionId}
                    type="button"
                    className={activeSection === sectionId ? 'active' : ''}
                    onClick={() => setActiveSection(sectionId)}
                  >
                    {section.shortLabel}
                  </button>
                );
              })}
            </div>
            <div className="page-title">
              <PageIcon size={24} />
              <h1>{page.label}</h1>
            </div>
            <p>{activeSectionMeta.subtitle}</p>
            <p className="topbar-meta">{session.user.email}</p>
          </div>
          <button className="icon-text" type="button" onClick={() => supabase.auth.signOut()} title="Odjava">
            <LogOut size={18} />
            <span>Odjava</span>
          </button>
        </header>

        <section className="content">
          {activeSection === APP_SECTIONS.ematica.id && !canUseEmaticaInApp && activePage === 'locked' && <AccessLocked section={activeSection} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'dashboard' && (isAdmin ? <Dashboard /> : <HomeroomDashboard profile={profile} />)}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && isAdmin && activePage === 'schools' && <Schools adminScope={adminScope} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && isAdmin && activePage === 'years' && <SchoolYears adminScope={adminScope} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && isAdmin && activePage === 'programs' && <Programs adminScope={adminScope} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && isAdmin && activePage === 'classes' && <Classes adminScope={adminScope} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'students' && <Students scopeProfile={profile} isAdmin={isAdmin} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'enrollments' && <Enrollments />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'admissions' && <AdmissionsModule track={admissionsTrack} profile={profile} session={session} access={access} isStudent={false} isManager />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'transfers' && <Transfers />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'transition' && <YearTransition />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'sync' && <EdnevnikSync />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && activePage === 'certificates' && <YearEndCertificates scopeProfile={profile} isAdmin={isAdmin} />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && isAdmin && activePage === 'reports' && <Reports />}
          {activeSection === APP_SECTIONS.ematica.id && canUseEmaticaInApp && isAdmin && activePage === 'access' && <AccessManagement />}

          {activeSection !== APP_SECTIONS.ematica.id && canUseActiveAdmissionsSection && activePage === 'dashboard' && (
            <AdmissionsHome
              title={admissionsTitle}
              section={activeSectionMeta}
              isStudent={isStudent}
              isManager={!isStudent}
            />
          )}
          {activeSection !== APP_SECTIONS.ematica.id && canUseActiveAdmissionsSection && activePage === 'admissions' && (
            <AdmissionsModule
              track={activeSection === APP_SECTIONS.fakulteti.id ? 'HIGHER_EDUCATION' : 'SECONDARY'}
              profile={profile}
              session={session}
              access={access}
              isStudent={isStudent}
              isManager={!isStudent}
            />
          )}
          {activeSection !== APP_SECTIONS.ematica.id && !canUseActiveAdmissionsSection && activePage === 'locked' && <AccessLocked section={activeSection} />}
        </section>
      </main>
    </div>
  );
}

function normalizeLoginEmail(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.includes('@') ? normalized : `${normalized}@eskole.me`;
}

function Login({ notice = '', onClearNotice = () => {} }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const hasEmailDomain = email.includes('@');

  const signIn = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    onClearNotice();
    const normalizedEmail = normalizeLoginEmail(email);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    setLoading(false);
    if (authError) setError(authError.message);
  };

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={signIn}>
        <School size={34} />
        <h1>ŠkoleHR Admin</h1>
        <label>
          E-mail
          <div className="email-input">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="text"
              inputMode="email"
              autoComplete="username"
              placeholder="ime.prezime"
              aria-label="E-mail ili korisnicko ime"
              required
            />
            {!hasEmailDomain && <span aria-hidden="true">@eskole.me</span>}
          </div>
        </label>
        <label>
          Lozinka
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </label>
        {notice && <p className="login-notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
          <span>Prijava</span>
        </button>
      </form>
    </main>
  );
}

function AdmissionsHome({ title, section, isStudent, isManager }) {
  return (
    <div className="stack">
      <SectionHero
        eyebrow={section.label}
        title={title}
        description={section.subtitle}
        badges={[
          isStudent ? 'Korisnik: učenik' : 'Korisnik: djelatnik',
          isManager ? 'Rad s ponudom i kandidatima' : 'Rad s prijavama i prioritetima',
          'Samostalna aplikacija',
        ]}
      />
      <Panel title={title}>
        <div className="notice">
          <GraduationCap size={18} />
          {section.subtitle}
        </div>
        <div className="report-summary">
          <Metric label="Modul" value={section.label} />
          <Metric label="Korisnik" value={isStudent ? 'Učenik' : isManager ? 'Djelatnik / administrator' : 'Korisnik'} />
          <Metric label="Pristup" value={isStudent ? 'Prijave i prioriteti' : 'Upravljanje ponudom i kandidatima'} />
          <Metric label="Status" value="Samostalna aplikacija" tone="success" />
        </div>
      </Panel>

      <Panel title="Kako ovo sada radi">
        <Table
          columns={['Područje', 'Opis']}
          rows={[
            ['e-Matica', 'Vodi škole, razrede, programe, učenike, prijelaze i dokumente.'],
            ['Upisi u srednju', 'Osnovne škole i učenici 8. razreda rade prijave za srednje škole.'],
            ['Upisi na fakultete', 'Srednje škole i učenici završnih razreda rade prijave za fakultete.'],
            ['Povezivanje s e-Dnevnikom', 'Ostaje zaseban korak integracije između različitih repozitorija i sustava.'],
          ]}
        />
      </Panel>
    </div>
  );
}

function SectionHero({ eyebrow, title, description, badges = [] }) {
  return (
    <section className="hero-panel">
      <div className="hero-panel__eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="hero-panel__badges">
        {badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>
    </section>
  );
}

function WorkflowBoard({ title, steps }) {
  return (
    <Panel title={title}>
      <div className="workflow-board">
        {steps.map(([stepTitle, description], index) => (
          <div className="workflow-step" key={stepTitle}>
            <div className="workflow-step__number">{index + 1}</div>
            <div>
              <strong>{stepTitle}</strong>
              <span>{description}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StudentDashboard({ profile, session }) {
  const record = useStudentRecord(profile, session);
  const student = Array.isArray(record.data) ? null : record.data;

  return (
    <div className="stack">
      <Panel title="Moj status">
        <DataState state={record}>
          {!student?.registry_student_id ? (
            <div className="notice">
              <ShieldAlert size={18} />
              Tvoj korisnički račun još nije povezan s e-Maticom.
            </div>
          ) : (
            <div className="student-summary">
              <Metric label="Status" value={STUDENT_STATUSES[student.student_status] ?? student.student_status} />
              <Metric label="Škola" value={student.school_name ?? '-'} />
              <Metric label="Razred" value={student.class_name ?? '-'} />
              <Metric label="e-Dnevnik" value={student.ednevnik_student_id ? 'Povezan' : 'Nije povezan'} />
            </div>
          )}
        </DataState>
      </Panel>
      <Panel title="Moji podaci">
        <DataState state={record}>
          {!student?.registry_student_id ? (
            <div className="notice">Obrati se administratoru škole za povezivanje računa.</div>
          ) : (
            <Table
              columns={['Učenik', 'OIB', 'Program', 'Školska godina', 'Blokada unosa']}
              rows={[[
                student.full_name,
                student.oib,
                student.program_name,
                student.school_year_label,
                student.data_entry_blocked ? 'Da' : 'Ne',
              ]]}
            />
          )}
        </DataState>
      </Panel>
    </div>
  );
}

function StudentEdnevnikStatus({ profile, session }) {
  const record = useStudentRecord(profile, session);
  const student = Array.isArray(record.data) ? null : record.data;

  const sync = useSupabaseQuery(async () => {
    if (!student?.registry_student_id) return { data: null, error: null };
    return supabase
      .from('v_ematica_sync_status')
      .select('*')
      .eq('registry_student_id', student.registry_student_id)
      .maybeSingle();
  }, [student?.registry_student_id]);

  const syncRow = Array.isArray(sync.data) ? null : sync.data;

  return (
    <Panel title="Moj e-Dnevnik status" action={<ReloadButton onClick={sync.reload} loading={sync.loading} />}>
      <DataState state={record}>
        {!student?.registry_student_id ? (
          <div className="notice">Tvoj račun još nije povezan s e-Maticom.</div>
        ) : (
          <DataState state={sync}>
            <Table
              columns={['Učenik', 'Status', 'Sync', 'Zadnja akcija', 'Zadnja poruka']}
              rows={[[
                student.full_name,
                STUDENT_STATUSES[student.student_status] ?? student.student_status,
                syncRow?.sync_state ?? '-',
                syncRow?.last_sync_action ?? '-',
                syncRow?.last_sync_message ?? '-',
              ]]}
            />
          </DataState>
        )}
      </DataState>
    </Panel>
  );
}

function useStudentRecord(profile, session) {
  return useSupabaseQuery(async () => {
    if (profile?.id) {
      const byProfile = await supabase
        .from('v_ematica_students_current')
        .select('*')
        .eq('ednevnik_student_id', profile.id)
        .maybeSingle();

      if (byProfile.data || byProfile.error) return byProfile;
    }

    if (session?.user?.email) {
      return supabase
        .from('v_ematica_students_current')
        .select('*')
        .eq('email', session.user.email)
        .maybeSingle();
    }

    return { data: null, error: null };
  }, [profile?.id, session?.user?.email]);
}

function AdmissionsModule({ track, profile, session, access, isStudent = false, isManager = false }) {
  const effectiveTrack = track === 'UNKNOWN' ? 'SECONDARY' : track;
  const title = effectiveTrack === 'SECONDARY' ? 'e-Upisi u srednje škole' : 'e-Upisi na fakultete';
  const activeSchoolId = access?.active_school_id ?? profile?.active_school_id ?? null;
  const activeSchoolLevel = access?.active_school_level ?? profile?.active_school_level ?? profile?.education_level;
  const targetInstitutionLevel = effectiveTrack === 'SECONDARY' ? 'SECONDARY' : 'HIGHER';
  const isTargetInstitutionManager = isManager && activeSchoolId && activeSchoolLevel === targetInstitutionLevel;
  const candidateView = effectiveTrack === 'SECONDARY' ? 'v_admissions_secondary_eligible' : 'v_admissions_higher_eligible';
  const eligibilityNote = effectiveTrack === 'SECONDARY'
    ? 'Razrednik povlači samo aktivne učenike 8. razreda. Učenik zatim sam slaže listu prioriteta za srednje škole.'
    : 'Razrednik povlači samo aktivne učenike završnih razreda srednje škole, uključujući 4. i 5. razred. Učenik zatim sam slaže listu prioriteta za fakultete.';
  const candidates = useSupabaseQuery(
    () => supabase.from('v_admission_candidates_detailed').select('*').eq('track', effectiveTrack).order('full_name'),
    [effectiveTrack]
  );
  const eligibleStudents = useSupabaseQuery(() => {
    let query = supabase.from(candidateView).select('*').order('full_name');
    if (activeSchoolId) query = query.eq('school_id', activeSchoolId);
    return query;
  }, [candidateView, activeSchoolId]);
  const offerings = useSupabaseQuery(
    () => {
      let query = supabase.from('v_admission_offerings').select('*').eq('admission_track', effectiveTrack).eq('admission_is_open', true).order('school_name').order('program_name');
      if (isTargetInstitutionManager) query = query.eq('school_id', activeSchoolId);
      return query;
    },
    [effectiveTrack, activeSchoolId, isTargetInstitutionManager]
  );
  const targetSchools = useSupabaseQuery(
    () => supabase.from('schools').select('id,name,education_level').eq('education_level', effectiveTrack === 'SECONDARY' ? 'SECONDARY' : 'HIGHER').order('name'),
    [effectiveTrack]
  );
  const years = useSupabaseQuery(() => supabase.from('school_years').select('id,label,name').order('label'), []);
  const classes = useSupabaseQuery(() => {
    let query = supabase.from('v_ematica_class_summary').select('*').order('class_name');
    if (activeSchoolId) query = query.eq('school_id', activeSchoolId);
    return query;
  }, [activeSchoolId]);
  const [candidateForm, setCandidateForm] = useState({ class_id: '', school_year_id: '' });
  const [enrollForm, setEnrollForm] = useState({ school_year_id: '' });
  const [enrollResults, setEnrollResults] = useState([]);
  const [choiceForm, setChoiceForm] = useState({ target_program_id: '', priority: 1 });
  const [workflowForm, setWorkflowForm] = useState({ candidate_id: '', points: '' });
  const [message, setMessage] = useState('');
  const eligibleClasses = classes.data.filter((item) => isClassEligibleForAdmissions(item, effectiveTrack));
  const currentCandidate = candidates.data.find((item) => item.ednevnik_student_id === profile?.id || item.email === session?.user?.email) ?? null;
  const choices = useSupabaseQuery(async () => {
    if (!currentCandidate?.candidate_id) return { data: [], error: null };
    return supabase.from('v_admission_choices_detailed').select('*').eq('candidate_id', currentCandidate.candidate_id).order('priority');
  }, [currentCandidate?.candidate_id]);
  const allChoices = useSupabaseQuery(
    () => {
      let query = supabase.from('v_admission_choices_detailed').select('*').eq('track', effectiveTrack).order('target_school_name').order('target_program_name').order('rank_position');
      if (isTargetInstitutionManager) query = query.eq('target_school_id', activeSchoolId);
      return query;
    },
    [effectiveTrack, activeSchoolId, isTargetInstitutionManager]
  );
  const offeringRows = offerings.data.map((item) => ({
    ...item,
    free_count: Math.max(Number(item.admission_capacity ?? 0) - Number(item.accepted_count ?? 0), 0),
  }));
  const workflowSteps = effectiveTrack === 'SECONDARY'
    ? SECONDARY_ADMISSIONS_WORKFLOW
    : HIGHER_ADMISSIONS_WORKFLOW;
  const submittedCount = candidates.data.filter((item) => ['SUBMITTED', 'VERIFIED', 'ACCEPTED'].includes(item.status)).length;
  const acceptedCount = candidates.data.filter((item) => item.status === 'ACCEPTED').length;
  const studentAcceptedChoice = choices.data.find((item) => item.is_accepted);
  const exportRows = candidates.data.map((item) => ({
    ucenik: item.full_name,
    smjer: item.track,
    status: item.status,
    bodovi: item.total_points,
    skolska_godina: item.school_year_label,
  }));

  const createCandidatesForClass = async (event) => {
    event.preventDefault();
    setMessage('');
    const { data, error } = await supabase.rpc('create_class_admission_candidates', {
      p_class_id: candidateForm.class_id,
      p_track: effectiveTrack,
      p_school_year_id: candidateForm.school_year_id || null,
    });

    const created = data?.filter((row) => row.result === 'CREATED').length ?? 0;
    const existing = data?.filter((row) => row.result === 'EXISTS').length ?? 0;
    setMessage(error ? error.message : `Kandidati su povučeni u e-Upise. Novo: ${created}, već postoji: ${existing}.`);
    if (!error) {
      setCandidateForm({ class_id: '', school_year_id: '' });
      candidates.reload();
    }
  };

  const addChoice = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!currentCandidate?.candidate_id) {
      setMessage('Nisi povučen kao kandidat u ovaj upisni sustav.');
      return;
    }

    const { error } = await supabase.rpc('upsert_admission_choice', {
      p_candidate_id: currentCandidate.candidate_id,
      p_target_program_id: choiceForm.target_program_id,
      p_priority: Number(choiceForm.priority),
    });

    setMessage(error ? error.message : 'Izbor je spremljen na listu prioriteta.');
    if (!error) {
      setChoiceForm({ target_program_id: '', priority: 1 });
      choices.reload();
    }
  };

  const submitChoices = async () => {
    setMessage('');
    const { error } = await supabase.rpc('submit_admission_candidate', {
      p_candidate_id: currentCandidate.candidate_id,
    });
    setMessage(error ? error.message : 'Lista prioriteta je predana.');
    if (!error) {
      choices.reload();
      candidates.reload();
    }
  };

  const updateCandidateWorkflow = async (candidateId, status = null) => {
    setMessage('');
    const pointsValue = workflowForm.candidate_id === candidateId && workflowForm.points !== '' ? Number(workflowForm.points) : null;
    const { error } = await supabase.rpc('update_admission_candidate_workflow', {
      p_candidate_id: candidateId,
      p_status: status,
      p_total_points: pointsValue,
    });

    setMessage(error ? error.message : 'Kandidat je ažuriran.');
    if (!error) {
      setWorkflowForm({ candidate_id: '', points: '' });
      candidates.reload();
      allChoices.reload();
      choices.reload();
    }
  };

  const deleteChoice = async (choiceId) => {
    setMessage('');
    const { error } = await supabase.rpc('delete_admission_choice', {
      p_choice_id: choiceId,
    });
    setMessage(error ? error.message : 'Izbor je uklonjen s liste prioriteta.');
    if (!error) {
      choices.reload();
      candidates.reload();
    }
  };

  const calculateRankings = async () => {
    setMessage('');
    const { error } = await supabase.rpc('calculate_admission_rankings', {
      p_track: effectiveTrack,
    });
    setMessage(error ? error.message : 'Rangiranje je izračunato. Svaki kandidat može biti prihvaćen samo na najvišem prioritetu u kvoti.');
    if (!error) {
      candidates.reload();
      allChoices.reload();
    }
  };

  const enrollAccepted = async () => {
    setMessage('');
    const { data, error } = await supabase.rpc('enroll_accepted_admission_candidates', {
      p_track: effectiveTrack,
      p_school_year_id: enrollForm.school_year_id || null,
      p_target_school_id: isTargetInstitutionManager ? activeSchoolId : null,
    });

    const enrolled = data?.filter((row) => row.result === 'ENROLLED').length ?? 0;
    const existing = data?.filter((row) => row.result === 'EXISTS').length ?? 0;
    setEnrollResults(data ?? []);
    setMessage(error ? error.message : `Upis prihvaćenih je proveden. Novo upisano: ${enrolled}, već postoji: ${existing}.`);
  };

  return (
    <div className="stack">
      <SectionHero
        eyebrow={effectiveTrack === 'SECONDARY' ? 'Upisi u srednju' : 'Upisi na fakultete'}
        title={title}
        description={eligibilityNote}
        badges={[
          isManager ? 'Upravljanje kandidatima' : 'Moja lista prioriteta',
          effectiveTrack === 'SECONDARY' ? '8. razred osnovne škole' : 'Završni razredi srednje škole',
          'Jedan kandidat - jedan konacni upis',
        ]}
      />

      <WorkflowBoard title="Proces upisa" steps={workflowSteps} />

      <div className="metric-grid">
        {isManager ? (
          <>
            <Metric label="Kandidati" value={candidates.data.length} />
            <Metric label="Predane prijave" value={submittedCount} />
            <Metric label="Ponudeni programi" value={offerings.data.length} />
            <Metric label="Prihvaceni" value={acceptedCount} tone="success" />
          </>
        ) : (
          <>
            <Metric label="Moj status" value={currentCandidate?.status ?? 'Nije kandidat'} />
            <Metric label="Moji izbori" value={choices.data.length} />
            <Metric label="Bodovi" value={currentCandidate?.total_points ?? '-'} />
            <Metric label="Prihvaćen izbor" value={studentAcceptedChoice?.target_program_name ?? '-'} tone={studentAcceptedChoice ? 'success' : 'default'} />
          </>
        )}
      </div>

      <Panel title={title}>
        {track === 'UNKNOWN' && (
          <p className="notice">
            Škola korisnika nema postavljen tip. Administrator treba postaviti `education_level` škole.
          </p>
        )}
        <p className="notice">{eligibilityNote}</p>
        {message && <p className="notice">{message}</p>}
      </Panel>

      {isManager && (
        <>
          <Panel title="Povlačenje kandidata po razredu">
            <form className="inline-form" onSubmit={createCandidatesForClass}>
              <select value={candidateForm.class_id} onChange={(e) => setCandidateForm({ ...candidateForm, class_id: e.target.value })} required>
                <option value="">Razred</option>
                {eligibleClasses.map((item) => <option key={item.class_id} value={item.class_id}>{item.class_name} - {item.school_name}</option>)}
              </select>
              <select value={candidateForm.school_year_id} onChange={(e) => setCandidateForm({ ...candidateForm, school_year_id: e.target.value })}>
                <option value="">Školska/akademska godina</option>
                {years.data.map((year) => <option key={year.id} value={year.id}>{year.label ?? year.name}</option>)}
              </select>
              <button className="primary" type="submit"><Users size={18} /><span>Povuci kandidate</span></button>
            </form>
          </Panel>

          <Panel title="Ponuda i kvote">
            <DataState state={offerings}>
              <Table
                columns={['Ustanova', 'Program', 'Trajanje', 'Mjesta', 'Izbora', 'Prvi izbor', 'Prihvaćeno', 'Slobodno', 'Min. bodovi']}
                rows={offeringRows.map((item) => [
                  item.school_name,
                  item.program_name,
                  item.duration_years ?? '-',
                  item.admission_capacity ?? 0,
                  item.choice_count ?? 0,
                  item.first_choice_count ?? 0,
                  item.accepted_count ?? 0,
                  item.free_count,
                  item.admission_min_points ?? '-',
                ])}
              />
            </DataState>
          </Panel>

          <Panel title="Kandidati" action={<ExportButton filename="e-upisi-kandidati.csv" rows={exportRows} />}>
            <DataState state={candidates}>
              <Table
                columns={['Kandidat', 'Status', 'Izvorna škola', 'Razred', 'Bodovi', 'Godina', 'Akcije']}
                rows={candidates.data.map((item) => [
                  item.full_name,
                  <ApplicationStatusBadge key={`${item.candidate_id}-status`} value={item.status} />,
                  item.source_school_name ?? '-',
                  item.source_class_name ?? '-',
                  item.total_points ?? '-',
                  item.school_year_label ?? '-',
                  <div className="application-actions" key={`${item.candidate_id}-actions`}>
                    <input
                      className="mini-input"
                      placeholder="Bodovi"
                      value={workflowForm.candidate_id === item.candidate_id ? workflowForm.points : ''}
                      onChange={(e) => setWorkflowForm({ candidate_id: item.candidate_id, points: e.target.value })}
                    />
                    <button className="small-button" type="button" onClick={() => updateCandidateWorkflow(item.candidate_id)}>Spremi bodove</button>
                    <button className="small-button" type="button" onClick={() => updateCandidateWorkflow(item.candidate_id, 'VERIFIED')}>Provjeri</button>
                    <button className="small-button" type="button" onClick={() => updateCandidateWorkflow(item.candidate_id, 'RETURNED')}>Vrati</button>
                    <button className="small-button danger" type="button" onClick={() => updateCandidateWorkflow(item.candidate_id, 'REJECTED')}>Odbij</button>
                  </div>,
                ])}
              />
            </DataState>
          </Panel>

          <Panel title="Rangiranje" action={<button className="primary" type="button" onClick={calculateRankings}><CheckCircle2 size={18} /><span>Izračunaj rang</span></button>}>
            <DataState state={allChoices}>
              <Table
                columns={['Kandidat', 'Prioritet', 'Ustanova', 'Program', 'Bodovi', 'Rang', 'U kvoti', 'Prihvaćen']}
                rows={allChoices.data.map((item) => [
                  item.full_name,
                  item.priority,
                  item.target_school_name,
                  item.target_program_name,
                  item.points ?? '-',
                  item.rank_position ?? '-',
                  item.is_in_quota ? 'Da' : 'Ne',
                  item.is_accepted ? 'Da' : 'Ne',
                ])}
              />
            </DataState>
          </Panel>

          <Panel title="Provedba upisa">
            <div className="inline-form compact">
              <select value={enrollForm.school_year_id} onChange={(e) => setEnrollForm({ ...enrollForm, school_year_id: e.target.value })}>
                <option value="">Godina iz kandidature</option>
                {years.data.map((year) => <option key={year.id} value={year.id}>{year.label ?? year.name}</option>)}
              </select>
              <button className="primary" type="button" onClick={enrollAccepted}>
                <CheckCircle2 size={18} />
                <span>Provedi upis prihvaćenih</span>
              </button>
            </div>
            <p className="notice">
              Prihvaćeni kandidat dobiva aktivan upis u ciljnu školu/fakultet i program. Postojeći upisi se ne dupliciraju.
            </p>
            {enrollResults.length > 0 && (
              <Table
                columns={['Učenik ID', 'Upis ID', 'Rezultat']}
                rows={enrollResults.map((item) => [item.registry_student_id, item.school_enrollment_id ?? '-', item.result])}
              />
            )}
          </Panel>
        </>
      )}

      {isStudent && (
        <>
          <Panel title="Moja lista prioriteta">
            {!currentCandidate ? (
              <div className="notice">Još nisi povučen kao kandidat u ovaj upisni sustav.</div>
            ) : (
              <>
                <div className="student-summary">
                  <Metric label="Kandidat" value={currentCandidate.full_name} />
                  <Metric label="Status" value={currentCandidate.status} />
                  <Metric label="Bodovi" value={currentCandidate.total_points ?? '-'} />
                  <Metric label="Pravo upisa" value={choices.data.find((item) => item.is_accepted)?.target_program_name ?? '-'} />
                </div>
                <form className="inline-form" onSubmit={addChoice}>
                  <select value={choiceForm.target_program_id} onChange={(e) => setChoiceForm({ ...choiceForm, target_program_id: e.target.value })} required>
                    <option value="">Škola/fakultet i program</option>
                    {offerings.data.map((item) => (
                      <option key={item.program_id} value={item.program_id}>
                        {item.school_name} - {item.program_name} ({item.admission_capacity} mjesta)
                      </option>
                    ))}
                  </select>
                  <input type="number" min="1" max="10" value={choiceForm.priority} onChange={(e) => setChoiceForm({ ...choiceForm, priority: e.target.value })} />
                  <button className="primary" type="submit"><UserPlus size={18} /><span>Dodaj izbor</span></button>
                  <button className="primary" type="button" onClick={submitChoices}><CheckCircle2 size={18} /><span>Predaj listu</span></button>
                </form>
              </>
            )}
          </Panel>

          <Panel title="Odabrani prioriteti">
            <DataState state={choices}>
              <Table
                columns={['Prioritet', 'Ustanova', 'Program', 'Bodovi', 'Rang', 'U kvoti', 'Prihvaćen', 'Akcije']}
                rows={choices.data.map((item) => [
                  item.priority,
                  item.target_school_name,
                  item.target_program_name,
                  item.points ?? currentCandidate?.total_points ?? '-',
                  item.rank_position ?? '-',
                  item.is_in_quota ? 'Da' : 'Ne',
                  item.is_accepted ? 'Da' : 'Ne',
                  <button className="small-button danger" type="button" onClick={() => deleteChoice(item.choice_id)} key={`${item.choice_id}-delete`}>Ukloni</button>,
                ])}
              />
            </DataState>
          </Panel>
        </>
      )}
    </div>
  );
}

function AccessLocked({ section = null }) {
  const message = section === APP_SECTIONS.ematica.id
    ? 'e-Matici mogu pristupiti samo administratori i razrednici.'
    : section === APP_SECTIONS.srednja.id
      ? 'Upisi u srednju dostupni su samo učenicima 8. razreda osnovne škole i ovlaštenim razrednicima/adminima.'
      : section === APP_SECTIONS.fakulteti.id
        ? 'Upisi na fakultete dostupni su samo učenicima završnog razreda srednje škole i ovlaštenim razrednicima/adminima.'
        : 'Korisnik nema dodijeljenu ulogu za ovaj sustav.';

  return (
    <Panel title="Pristup nije dodijeljen">
      <div className="empty-detail">
        <ShieldAlert size={34} />
        <p>{message}</p>
      </div>
    </Panel>
  );
}

function YearEndCertificates({ scopeProfile = null, isAdmin = true }) {
  const activeSchoolId = scopeProfile?.active_school_id ?? null;
  const classes = useSupabaseQuery(() => {
    let query = supabase.from('v_ematica_class_summary').select('*').order('class_name');
    if (activeSchoolId) query = query.eq('school_id', activeSchoolId);
    if (!isAdmin && scopeProfile?.id) {
      query = query.or(`homeroom_teacher_id.eq.${scopeProfile.id},deputy_teacher_id.eq.${scopeProfile.id},deputy_homeroom_teacher_id.eq.${scopeProfile.id}`);
    }
    return query;
  }, [activeSchoolId, isAdmin, scopeProfile?.id]);
  const summaries = useSupabaseQuery(() => {
    let query = supabase.from('v_ematica_year_end_summaries').select('*').order('full_name');
    if (activeSchoolId) query = query.eq('school_id', activeSchoolId);
    return query;
  }, [activeSchoolId]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSummary, setSelectedSummary] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [subjectNameMap, setSubjectNameMap] = useState({});
  const [certificateNumbers, setCertificateNumbers] = useState({});
  const [message, setMessage] = useState('');
  const selectedClass = classes.data.find((item) => item.class_id === selectedClassId) ?? null;
  const visibleSummaries = summaries.data.filter((item) => !selectedClassId || item.class_id === selectedClassId);
  const selectedGrades = extractGrades(selectedSummary);
  let selectedNotesText = '';
  if (typeof selectedSummary?.notes === 'string') {
    selectedNotesText = selectedSummary.notes;
  } else if (selectedSummary?.notes && typeof selectedSummary.notes === 'object') {
    const noteKeys = Object.keys(selectedSummary.notes);
    const isTechnicalPullNote = noteKeys.every((key) => ['source', 'pulled_at'].includes(key));
    if (!isTechnicalPullNote) {
      selectedNotesText = JSON.stringify(selectedSummary.notes);
    }
  }
  const exportRows = visibleSummaries.map((item) => ({
    ucenik: item.full_name,
    oib: item.oib,
    skola: item.school_name,
    razred: item.class_name,
    uspjeh: item.final_success_text,
    prosjek: item.final_grade_average,
    svjedodzba_status: item.certificate_status,
    broj_svjedodzbe: item.certificate_number,
  }));

  useEffect(() => {
    let cancelled = false;

    const loadSubjectNames = async () => {
      const grades = extractGrades(selectedSummary);
      const subjectIds = [...new Set(grades.map((grade) => grade?.subject_id).filter(Boolean))];

      if (!selectedSummary?.class_id || !subjectIds.length) {
        if (!cancelled) setSubjectNameMap({});
        return;
      }

      const nextMap = {};

      const [directSubjectsResult, classSubjectsResult] = await Promise.all([
        supabase.from('subjects').select('id,name').in('id', subjectIds),
        supabase.from('class_subjects').select('id,subject_id').eq('class_id', selectedSummary.class_id),
      ]);

      directSubjectsResult.data?.forEach((subject) => {
        if (subject?.id && subject?.name) nextMap[subject.id] = subject.name;
      });

      const relatedSubjectIds = [
        ...new Set((classSubjectsResult.data ?? []).map((item) => item?.subject_id).filter(Boolean)),
      ];

      let relatedSubjectsById = {};
      if (relatedSubjectIds.length) {
        const relatedSubjectsResult = await supabase.from('subjects').select('id,name').in('id', relatedSubjectIds);
        relatedSubjectsById = Object.fromEntries(
          (relatedSubjectsResult.data ?? [])
            .filter((subject) => subject?.id && subject?.name)
            .map((subject) => [subject.id, subject.name])
        );
      }

      (classSubjectsResult.data ?? []).forEach((item) => {
        const subjectName = relatedSubjectsById[item.subject_id];
        if (!subjectName) return;
        if (item.id) nextMap[item.id] = subjectName;
        if (item.subject_id) nextMap[item.subject_id] = subjectName;
      });

      if (!cancelled) setSubjectNameMap(nextMap);
    };

    loadSubjectNames();
    return () => {
      cancelled = true;
    };
  }, [selectedSummary]);

  const openSummaryDetails = (summary) => {
    setSelectedSummary(summary);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  };

  const pullClass = async (event) => {
    event.preventDefault();
    setMessage('');
    const { data, error } = await supabase.rpc('pull_class_year_end_to_ematica', {
      p_class_id: selectedClassId,
    });

    const pulled = data?.filter((row) => row.result === 'PULLED').length ?? 0;
    const failed = (data?.length ?? 0) - pulled;
    setMessage(error ? error.message : `Povlačenje je završeno. Uspješno: ${pulled}, greške: ${failed}.`);
    if (!error) summaries.reload();
  };

  const generateCertificate = async (summaryId) => {
    setMessage('');
    const { error } = await supabase.rpc('generate_student_certificate', {
      p_summary_id: summaryId,
    });
    setMessage(error ? error.message : 'Svjedodžba je generirana i spremna za izdavanje.');
    if (!error) summaries.reload();
  };

  const generateClassCertificates = async () => {
    if (!selectedClassId) {
      setMessage('Odaberi razred prije masovnog generiranja svjedodžbi.');
      return;
    }

    const targets = visibleSummaries.filter((item) => !item.certificate_id);
    if (!targets.length) {
      setMessage('Svi prikazani ucenici vec imaju generiranu svjedodzbu.');
      return;
    }

    setMessage('');
    let created = 0;
    const errors = [];
    for (const item of targets) {
      const { error } = await supabase.rpc('generate_student_certificate', {
        p_summary_id: item.summary_id,
      });
      if (error) {
        errors.push(`${item.full_name}: ${error.message}`);
      } else {
        created += 1;
      }
    }

    setMessage(`Generiranje je završeno. Generirano: ${created}, greške: ${errors.length}.${errors.length ? ` ${errors.slice(0, 3).join(' | ')}` : ''}`);
    summaries.reload();
  };

  const issueCertificate = async (certificateId) => {
    const number = certificateNumbers[certificateId]?.trim();
    if (!number) {
      setMessage('Upiši broj svjedodžbe prije izdavanja.');
      return;
    }

    setMessage('');
    const { error } = await supabase.rpc('issue_student_certificate', {
      p_certificate_id: certificateId,
      p_certificate_number: number,
    });
    setMessage(error ? error.message : 'Svjedodžba je izdana.');
    if (!error) summaries.reload();
  };

  const updateCertificateStatus = async (certificateId, status, reason = null) => {
    setMessage('');
    const { error } = await supabase.rpc('update_student_certificate_status', {
      p_certificate_id: certificateId,
      p_status: status,
      p_reason: reason,
    });
    setMessage(error ? error.message : 'Status svjedodžbe je ažuriran.');
    if (!error) summaries.reload();
  };

  const deleteCertificate = async (certificateId) => {
    const confirmed = window.confirm('Obrisati ovu svjedodžbu?');
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.rpc('delete_student_certificate', {
      p_certificate_id: certificateId,
    });
    setMessage(error ? error.message : 'Svjedodžba je obrisana.');
    if (!error) {
      summaries.reload();
      setSelectedSummary(null);
    }
  };

  const openCertificateDocument = (summary) => {
    const enrichedSummary = enrichSummaryGradeNames(summary, subjectNameMap);
    setDocumentPreview(enrichedSummary);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  };

  const downloadCertificateDocument = async (summary) => {
    try {
      const enrichedSummary = enrichSummaryGradeNames(summary, subjectNameMap);
      const html = buildCertificateHtmlDocument(enrichedSummary);
      const fileName = buildCertificateFileName(enrichedSummary).replace(/\.pdf$/i, '.html');
      downloadTextFile(fileName, html, 'text/html;charset=utf-8');
      setMessage('Dokument je preuzet kao HTML. Otvori ga u pregledniku i od tamo ispiši ili spremi kao PDF.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Dokument nije moguće generirati.');
    }
  };

  return (
    <div className="stack">
      <Panel title="Kraj školske godine">
        <form className="inline-form" onSubmit={pullClass}>
          <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} required>
            <option value="">Razred</option>
            {classes.data.map((item) => <option key={item.class_id} value={item.class_id}>{item.class_name} - {item.school_name}</option>)}
          </select>
          <button className="primary" type="submit"><RefreshCw size={18} /><span>Povuci iz e-Dnevnika</span></button>
          <button className="secondary" type="button" onClick={generateClassCertificates}><FileText size={18} /><span>Generiraj za razred</span></button>
        </form>
        <p className="notice">
          Na kraju godine razrednik povlači zaključne podatke iz e-Dnevnika u e-Maticu. Nakon toga se iz e-Matice generiraju i izdaju svjedodžbe.
        </p>
        {selectedClass && (
          <div className="report-summary">
            <Metric label="Razred" value={selectedClass.class_name} />
            <Metric label="Škola" value={selectedClass.school_name ?? '-'} />
            <Metric label="Aktivni" value={selectedClass.active_student_count ?? 0} tone="success" />
            <Metric label="Zaključeno" value={visibleSummaries.length} />
          </div>
        )}
        {message && <p className="notice">{message}</p>}
      </Panel>

      <Panel title="Zaključni podaci i svjedodžbe" action={<ExportButton filename="svjedodzbe.csv" rows={exportRows} />}>
        <DataState state={summaries}>
          <Table
            columns={['Učenik', 'OIB', 'Razred', 'Uspjeh', 'Prosjek', 'Svjedodžba', 'Broj', 'Akcije']}
            rows={visibleSummaries.map((item) => [
              item.full_name,
              item.oib ?? '-',
              item.class_name ?? '-',
              item.final_success_text ?? '-',
              item.final_grade_average ?? '-',
              <span key={`${item.summary_id}-certificate`} className={`status-badge application-${String(item.certificate_status ?? 'DRAFT').toLowerCase()}`}>
                {item.certificate_status ?? 'Nije generirana'}
              </span>,
              item.certificate_number ?? '-',
              <div className="application-actions" key={`${item.summary_id}-actions`}>
                <button className="small-button" type="button" onClick={() => openSummaryDetails(item)}>Detalji</button>
                {item.certificate_id && <button className="small-button" type="button" onClick={() => openCertificateDocument(item)}>Dokument</button>}
                <button className="small-button" type="button" onClick={() => generateCertificate(item.summary_id)}>Generiraj</button>
                {item.certificate_id && item.certificate_status !== 'ISSUED' && (
                  <>
                    <input
                      className="mini-input"
                      placeholder="Broj"
                      value={certificateNumbers[item.certificate_id] ?? ''}
                      onChange={(e) => setCertificateNumbers({ ...certificateNumbers, [item.certificate_id]: e.target.value })}
                    />
                    <button className="small-button" type="button" onClick={() => issueCertificate(item.certificate_id)}>Izdaj</button>
                  </>
                )}
                {item.certificate_id && item.certificate_status === 'ISSUED' && (
                  <button className="small-button" type="button" onClick={() => updateCertificateStatus(item.certificate_id, 'CANCELLED', 'Stornirano kroz e-Maticu')}>Storniraj</button>
                )}
                {item.certificate_id && item.certificate_status === 'CANCELLED' && (
                  <button className="small-button" type="button" onClick={() => updateCertificateStatus(item.certificate_id, 'READY')}>Vrati u spremno</button>
                )}
                {item.certificate_id && item.certificate_status !== 'ISSUED' && (
                  <button className="small-button danger" type="button" onClick={() => deleteCertificate(item.certificate_id)}>Obriši</button>
                )}
              </div>,
            ])}
          />
        </DataState>
      </Panel>

      {selectedSummary && (
        <Panel
          title="Detalji svjedodžbe"
          action={(
            <div className="application-actions">
              <button className="small-button" type="button" onClick={() => openCertificateDocument(selectedSummary)}>Pregled</button>
              <button className="small-button" type="button" onClick={() => downloadCertificateDocument(selectedSummary)}>Preuzmi HTML</button>
              <button className="small-button" type="button" onClick={() => setSelectedSummary(null)}>Zatvori</button>
            </div>
          )}
        >
          <div className="report-summary">
            <Metric label="Učenik" value={selectedSummary.full_name ?? '-'} />
            <Metric label="OIB" value={selectedSummary.oib ?? '-'} />
            <Metric label="Razred" value={selectedSummary.class_name ?? '-'} />
            <Metric label="Godina" value={selectedSummary.school_year_label ?? '-'} />
            <Metric label="Prosjek" value={selectedSummary.final_grade_average ?? '-'} />
            <Metric label="Uspjeh" value={selectedSummary.final_success_text ?? '-'} />
            <Metric label="Status" value={selectedSummary.certificate_status ?? 'Nije generirana'} />
            <Metric label="Broj" value={selectedSummary.certificate_number ?? '-'} />
          </div>
          <Table
            columns={['Predmet', 'Ocjena', 'Razdoblje', 'Napomena']}
            rows={selectedGrades.map((grade, index) => [
              getGradeSubjectLabel(grade, index, subjectNameMap),
              grade.value ?? grade.grade ?? '-',
              grade.term ?? grade.period ?? '-',
              grade.note ?? '-',
            ])}
          />
          {!selectedGrades.length && <p className="notice">Nema spremljenih zaključnih ocjena za odabranog učenika.</p>}
          {selectedNotesText && <p className="notice">{selectedNotesText}</p>}
        </Panel>
      )}

      {documentPreview && (
        <Panel
          title="Dokument za ispis"
          action={<button className="small-button" type="button" onClick={() => setDocumentPreview(null)}>Zatvori</button>}
        >
          <p className="notice">Ovo je pregled dokumenta unutar aplikacije. Za pouzdano spremanje koristi gumb "Preuzmi HTML", zatim otvori datoteku u pregledniku i od tamo ispiši ili spremi kao PDF.</p>
          <div className="document-preview">
            <CertificatePrintSurface summary={documentPreview} />
          </div>
        </Panel>
      )}
    </div>
  );
}


function Reports() {
  const [reportType, setReportType] = useState('students');
  const students = useSupabaseQuery(() => supabase.from('v_ematica_students_current').select('*').order('full_name'), []);
  const classes = useSupabaseQuery(() => supabase.from('v_ematica_class_summary').select('*').order('class_name'), []);
  const sync = useSupabaseQuery(() => supabase.from('v_ematica_sync_status').select('*').order('full_name'), []);
  const applications = useSupabaseQuery(() => supabase.from('v_admission_applications_detailed').select('*').order('created_at', { ascending: false }), []);
  const transfers = useSupabaseQuery(() => supabase.from('v_ematica_transfers_detailed').select('*').order('created_at', { ascending: false }), []);
  const certificates = useSupabaseQuery(() => supabase.from('v_ematica_year_end_summaries').select('*').order('full_name'), []);
  const report = getReportConfig(reportType, { students, classes, sync, applications, transfers, certificates });

  return (
    <div className="stack">
      <Panel
        title="Izvještaji"
        action={
          <div className="toolbar">
            <select value={reportType} onChange={(event) => setReportType(event.target.value)}>
              <option value="students">Učenici</option>
              <option value="classes">Razredi</option>
              <option value="sync">e-Dnevnik sync</option>
              <option value="applications">e-Upisi prijave</option>
              <option value="transfers">Premještaji</option>
              <option value="certificates">Svjedodžbe</option>
            </select>
            <ExportButton filename={report.filename} rows={report.exportRows} />
          </div>
        }
      >
        <div className="report-summary">
          {report.metrics.map((metric) => (
            <Metric key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />
          ))}
        </div>
      </Panel>

      <Panel title={report.title}>
        <DataState state={report.state}>
          <Table columns={report.columns} rows={report.rows} />
        </DataState>
      </Panel>
    </div>
  );
}

function getReportConfig(type, sources) {
  if (type === 'classes') {
    return {
      title: 'Izvještaj razreda',
      filename: 'izvjestaj-razredi.csv',
      state: sources.classes,
      columns: ['Razred', 'Škola', 'Školska godina', 'Program', 'Aktivni', 'Ispisani', 'Završili'],
      rows: sources.classes.data.map((item) => [item.class_name, item.school_name, item.school_year_label ?? item.school_year, item.program_name, item.active_student_count, item.dropped_out_student_count, item.graduated_student_count]),
      exportRows: sources.classes.data.map((item) => ({
        razred: item.class_name,
        skola: item.school_name,
        skolska_godina: item.school_year_label ?? item.school_year,
        program: item.program_name,
        aktivni: item.active_student_count,
        ispisani: item.dropped_out_student_count,
        zavrsili: item.graduated_student_count,
      })),
      metrics: [
        { label: 'Razredi', value: sources.classes.data.length },
        { label: 'Aktivni učenici', value: sources.classes.data.reduce((sum, item) => sum + Number(item.active_student_count ?? 0), 0), tone: 'success' },
        { label: 'Ispisani', value: sources.classes.data.reduce((sum, item) => sum + Number(item.dropped_out_student_count ?? 0), 0), tone: 'warning' },
        { label: 'Završili', value: sources.classes.data.reduce((sum, item) => sum + Number(item.graduated_student_count ?? 0), 0) },
      ],
    };
  }

  if (type === 'sync') {
    return {
      title: 'Izvještaj e-Dnevnik sinkronizacije',
      filename: 'izvjestaj-ednevnik-sync.csv',
      state: sources.sync,
      columns: ['Učenik', 'Status učenika', 'Sync', 'Blokada unosa', 'Zadnja poruka'],
      rows: sources.sync.data.map((item) => [
        item.full_name,
        <StatusBadge key={`${item.registry_student_id}-report-status`} value={item.student_status} />,
        <SyncBadge key={`${item.registry_student_id}-report-sync`} value={item.sync_state} />,
        item.ednevnik_data_entry_blocked ? 'Da' : 'Ne',
        item.last_sync_message ?? '-',
      ]),
      exportRows: sources.sync.data.map((item) => ({
        ucenik: item.full_name,
        status_ucenika: item.student_status,
        sync: item.sync_state,
        blokada_unosa: item.ednevnik_data_entry_blocked ? 'Da' : 'Ne',
        zadnja_poruka: item.last_sync_message,
      })),
      metrics: [
        { label: 'Povezani', value: sources.sync.data.filter((item) => item.sync_state === 'SYNCED').length, tone: 'success' },
        { label: 'Nisu povezani', value: sources.sync.data.filter((item) => item.sync_state === 'NOT_LINKED').length, tone: 'warning' },
        { label: 'Greške', value: sources.sync.data.filter((item) => item.sync_state === 'FAILED').length, tone: 'danger' },
        { label: 'Blokirani', value: sources.sync.data.filter((item) => item.ednevnik_data_entry_blocked).length, tone: 'danger' },
      ],
    };
  }

  if (type === 'applications') {
    return {
      title: 'Izvještaj e-Upisi prijava',
      filename: 'izvjestaj-e-upisi-prijave.csv',
      state: sources.applications,
      columns: ['Kandidat', 'Smjer', 'Status', 'Ciljna ustanova', 'Program', 'Bodovi'],
      rows: sources.applications.data.map((item) => [item.full_name ?? '-', item.track, <ApplicationStatusBadge key={`${item.id}-report-app-status`} value={item.status} />, item.target_school_name ?? '-', item.target_program_name ?? '-', item.points ?? '-']),
      exportRows: sources.applications.data.map((item) => ({
        kandidat: item.full_name,
        smjer: item.track,
        status: item.status,
        ciljna_ustanova: item.target_school_name,
        program: item.target_program_name,
        bodovi: item.points,
      })),
      metrics: [
        { label: 'Prijave', value: sources.applications.data.length },
        { label: 'Predane', value: sources.applications.data.filter((item) => item.status === 'SUBMITTED').length },
        { label: 'Prihvaćene', value: sources.applications.data.filter((item) => item.status === 'ACCEPTED').length, tone: 'success' },
        { label: 'Odbijene', value: sources.applications.data.filter((item) => item.status === 'REJECTED').length, tone: 'danger' },
      ],
    };
  }

  if (type === 'transfers') {
    return {
      title: 'Izvještaj premještaja',
      filename: 'izvjestaj-premjestaji.csv',
      state: sources.transfers,
      columns: ['Učenik', 'Iz', 'U', 'Status', 'Završeno'],
      rows: sources.transfers.data.map((item) => [item.full_name, `${item.from_school_name ?? '-'} / ${item.from_class_name ?? '-'}`, `${item.to_school_name ?? '-'} / ${item.to_class_name ?? '-'}`, item.status, formatDateTime(item.completed_at)]),
      exportRows: sources.transfers.data.map((item) => ({
        ucenik: item.full_name,
        iz: `${item.from_school_name ?? '-'} / ${item.from_class_name ?? '-'}`,
        u: `${item.to_school_name ?? '-'} / ${item.to_class_name ?? '-'}`,
        status: item.status,
        zavrseno: formatDateTime(item.completed_at),
      })),
      metrics: [
        { label: 'Premještaji', value: sources.transfers.data.length },
        { label: 'Završeni', value: sources.transfers.data.filter((item) => item.status === 'COMPLETED').length, tone: 'success' },
        { label: 'U tijeku', value: sources.transfers.data.filter((item) => ['PENDING', 'APPROVED'].includes(item.status)).length, tone: 'warning' },
        { label: 'Odbijeni', value: sources.transfers.data.filter((item) => item.status === 'REJECTED').length, tone: 'danger' },
      ],
    };
  }

  if (type === 'certificates') {
    return {
      title: 'Izvještaj svjedodžbi',
      filename: 'izvjestaj-svjedodzbe.csv',
      state: sources.certificates,
      columns: ['Učenik', 'Škola', 'Razred', 'Uspjeh', 'Prosjek', 'Status', 'Broj'],
      rows: sources.certificates.data.map((item) => [item.full_name, item.school_name ?? '-', item.class_name ?? '-', item.final_success_text ?? '-', item.final_grade_average ?? '-', item.certificate_status ?? 'Nije generirana', item.certificate_number ?? '-']),
      exportRows: sources.certificates.data.map((item) => ({
        ucenik: item.full_name,
        skola: item.school_name,
        razred: item.class_name,
        uspjeh: item.final_success_text,
        prosjek: item.final_grade_average,
        status: item.certificate_status,
        broj: item.certificate_number,
      })),
      metrics: [
        { label: 'Zaključeno', value: sources.certificates.data.length },
        { label: 'Spremno', value: sources.certificates.data.filter((item) => item.certificate_status === 'READY').length, tone: 'warning' },
        { label: 'Izdano', value: sources.certificates.data.filter((item) => item.certificate_status === 'ISSUED').length, tone: 'success' },
        { label: 'Bez svjedodžbe', value: sources.certificates.data.filter((item) => !item.certificate_status).length, tone: 'danger' },
      ],
    };
  }

  return {
    title: 'Izvještaj učenika',
    filename: 'izvjestaj-ucenici.csv',
    state: sources.students,
    columns: ['Učenik', 'OIB', 'Status', 'Škola', 'Razred', 'Program', 'e-Dnevnik'],
    rows: sources.students.data.map((item) => [item.full_name, item.oib, <StatusBadge key={`${item.registry_student_id}-report-student-status`} value={item.student_status} />, item.school_name ?? '-', item.class_name ?? '-', item.program_name ?? '-', item.ednevnik_student_id ? 'Povezan' : 'Nije povezan']),
    exportRows: sources.students.data.map((item) => ({
      ucenik: item.full_name,
      oib: item.oib,
      status: item.student_status,
      skola: item.school_name,
      razred: item.class_name,
      program: item.program_name,
      ednevnik: item.ednevnik_student_id ? 'Povezan' : 'Nije povezan',
    })),
    metrics: [
      { label: 'Učenici', value: sources.students.data.length },
      { label: 'Aktivni', value: sources.students.data.filter((item) => item.student_status === 'ACTIVE').length, tone: 'success' },
      { label: 'Ispisani', value: sources.students.data.filter((item) => item.student_status === 'DROPPED_OUT').length, tone: 'warning' },
      { label: 'Nisu povezani', value: sources.students.data.filter((item) => !item.ednevnik_student_id).length, tone: 'danger' },
    ],
  };
}

function AccessManagement() {
  const profiles = useSupabaseQuery(() => supabase.from('user_profiles').select('*').order('email'), []);
  const schools = useSupabaseQuery(() => supabase.from('schools').select('id,name,education_level').order('name'), []);
  const [profileForm, setProfileForm] = useState({ profile_id: '', access_role: '', active_school_id: '' });
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [message, setMessage] = useState('');
  const selectedSchool = schools.data.find((school) => school.id === selectedSchoolId) ?? null;
  const schoolProfiles = useMemo(() => {
    const rows = selectedSchoolId
      ? profiles.data.filter((profile) => profile.active_school_id === selectedSchoolId)
      : profiles.data;
    return [...rows].sort(compareProfilesByLastName);
  }, [profiles.data, selectedSchoolId]);

  const groupedProfiles = {
    admin: schoolProfiles.filter((profile) => profile.access_role === 'admin'),
    teacher: schoolProfiles.filter((profile) => profile.access_role === 'teacher'),
    student: schoolProfiles.filter((profile) => profile.access_role === 'student'),
    unset: schoolProfiles.filter((profile) => !['admin', 'teacher', 'student'].includes(profile.access_role)),
  };

  const saveProfileAccess = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase
      .from('user_profiles')
      .update({
        access_role: profileForm.access_role || null,
        active_school_id: profileForm.active_school_id || null,
      })
      .eq('id', profileForm.profile_id);

    setMessage(error ? error.message : 'Pristup korisnika je spremljen.');
    if (!error) {
      setProfileForm({ profile_id: '', access_role: '', active_school_id: '' });
      profiles.reload();
    }
  };

  const clearProfileAccess = async (profile) => {
    const confirmed = window.confirm(`Ukloniti ulogu i aktivnu školu za korisnika ${getProfileDisplayName(profile)}?`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase
      .from('user_profiles')
      .update({ access_role: null, active_school_id: null })
      .eq('id', profile.id);

    setMessage(error ? error.message : 'Pristup korisnika je uklonjen.');
    if (!error) profiles.reload();
  };

  const deleteProfile = async (profile) => {
    const confirmed = window.confirm(`Obrisati profil korisnika ${getProfileDisplayName(profile)}? Ovo ne briše Supabase Auth račun.`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.from('user_profiles').delete().eq('id', profile.id);
    setMessage(error ? error.message : 'Korisnički profil je obrisan.');
    if (!error) profiles.reload();
  };

  return (
    <div className="stack">
      <Panel title="Uloge korisnika">
        <form className="inline-form compact" onSubmit={saveProfileAccess}>
          <select value={profileForm.profile_id} onChange={(e) => setProfileForm({ ...profileForm, profile_id: e.target.value })} required>
            <option value="">Korisnik</option>
            {[...profiles.data].sort(compareProfilesByLastName).map((profile) => <option key={profile.id} value={profile.id}>{getProfileDisplayName(profile)}</option>)}
          </select>
          <select value={profileForm.access_role} onChange={(e) => setProfileForm({ ...profileForm, access_role: e.target.value })} required>
            <option value="">Uloga</option>
            <option value="admin">Admin</option>
            <option value="teacher">Nastavnik</option>
            <option value="student">Učenik</option>
          </select>
          <select value={profileForm.active_school_id} onChange={(e) => setProfileForm({ ...profileForm, active_school_id: e.target.value })}>
            <option value="">Aktivna škola</option>
            {schools.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi</span></button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>

      <Panel title="Prikaz korisnika po školi">
        <div className="inline-form compact">
          <select value={selectedSchoolId} onChange={(e) => setSelectedSchoolId(e.target.value)}>
            <option value="">Sve škole</option>
            {schools.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <div className="readout">
            <span>Odabrana škola</span>
            <strong>{selectedSchool?.name ?? 'Sve škole'}</strong>
          </div>
          <div className="readout">
            <span>Tip škole</span>
            <strong>{formatSchoolLevel(selectedSchool?.education_level)}</strong>
          </div>
        </div>
      </Panel>

      <div className="split-grid">
        <RoleUsersPanel title="Admini" profiles={groupedProfiles.admin} schools={schools.data} onClearAccess={clearProfileAccess} onDelete={deleteProfile} />
        <RoleUsersPanel title="Nastavnici" profiles={groupedProfiles.teacher} schools={schools.data} onClearAccess={clearProfileAccess} onDelete={deleteProfile} />
        <RoleUsersPanel title="Učenici" profiles={groupedProfiles.student} schools={schools.data} onClearAccess={clearProfileAccess} onDelete={deleteProfile} />
        <RoleUsersPanel title="Bez uloge" profiles={groupedProfiles.unset} schools={schools.data} onClearAccess={clearProfileAccess} onDelete={deleteProfile} />
      </div>
    </div>
  );
}

function RoleUsersPanel({ title, profiles, schools, onClearAccess, onDelete }) {
  return (
    <Panel title={`${title} (${profiles.length})`}>
      <Table
        columns={['Prezime i ime', 'E-mail', 'Aktivna škola', 'Akcije']}
        rows={profiles.map((profile) => [
          getProfileDisplayName(profile),
          profile.email ?? '-',
          schools.find((school) => school.id === profile.active_school_id)?.name ?? '-',
          <div className="row-actions" key={`${profile.id}-actions`}>
            <button className="small-button" type="button" onClick={() => onClearAccess(profile)}>Ukloni pristup</button>
            <button className="small-button danger" type="button" onClick={() => onDelete(profile)}>Obriši profil</button>
          </div>,
        ])}
      />
    </Panel>
  );
}

function Dashboard() {
  const stats = useSupabaseQuery(() => supabase.from('v_ematica_dashboard_stats').select('*').single(), []);
  const sync = useSupabaseQuery(
    () => supabase.from('v_ematica_sync_status').select('*').order('last_sync_at', { ascending: false }).limit(8),
    []
  );
  const syncIssues = useSupabaseQuery(
    () => supabase.from('v_ematica_sync_status').select('*').in('sync_state', ['NOT_LINKED', 'FAILED']).order('full_name').limit(8),
    []
  );
  const transition = useSupabaseQuery(
    () => supabase.from('v_ematica_transition_candidates').select('*').order('from_class_name').limit(8),
    []
  );

  const data = stats.data ?? {};
  return (
    <div className="stack">
      <SectionHero
        eyebrow="e-Matica"
        title="Administrativno središte sustava"
        description="Ovdje vodimo škole, školske godine, razrede, programe, učenike, prijelaze, dokumente i pripremu podataka za upisne procese."
        badges={["Matične evidencije", "Prijelazi i premještaji", "Završni dokumenti"]}
      />
      <div className="metric-grid">
        <Metric label="Aktivni učenici" value={data.active_students_count} />
        <Metric label="Ispisani" value={data.dropped_out_students_count} tone="warning" />
        <Metric label="Završili" value={data.graduated_students_count} />
        <Metric label="Nisu povezani" value={data.not_linked_to_ednevnik_count} tone="danger" />
      </div>
      <div className="split-grid">
        <Panel title="Temeljni tok rada">
          <Table
            columns={['Korak', 'Opis']}
            rows={[
              ['1. Evidencije', 'Unos i održavanje škola, godina, programa, razreda i učenika.'],
              ['2. Promjene statusa', 'Upisi, ispisi, premještaji i završetak školovanja ostaju u jednoj evidenciji.'],
              ['3. Prijelaz godine', 'Na kraju godine pripremaju se prijelazi razreda i završni statusi učenika.'],
              ['4. Dokumenti', 'Iz podataka se generiraju svjedodžbe, potvrde i druga administrativna dokumentacija.'],
            ]}
          />
        </Panel>
        <Panel title="Odvojeni moduli">
          <Table
            columns={['Modul', 'Namjena']}
            rows={[
              ['e-Matica', 'Administrativna jezgra sustava i službena evidencija.'],
              ['Upisi u srednju', 'Prijavni proces za učenike osnovnih škola i srednje škole.'],
              ['Upisi na fakultete', 'Prijavni proces za maturante i visoka učilišta.'],
              ['Integracije', 'Povezivanje s e-Dnevnikom ostaje zaseban, kontrolirani sloj.'],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Zadnji sync statusi" action={<ReloadButton onClick={sync.reload} loading={sync.loading} />}>
        <DataState state={sync}>
          <Table
            columns={['Učenik', 'Status učenika', 'Sync', 'Zadnja akcija', 'Vrijeme']}
            rows={sync.data.map((row) => [
              row.full_name,
              <StatusBadge key={`${row.registry_student_id}-student-status`} value={row.student_status} />,
              <SyncBadge key={`${row.registry_student_id}-sync-status`} value={row.sync_state} />,
              row.last_sync_action ?? '-',
              formatDateTime(row.last_sync_at),
            ])}
          />
        </DataState>
      </Panel>
      <div className="split-grid">
        <Panel title="Za riješiti: e-Dnevnik povezivanje">
          <DataState state={syncIssues}>
            <Table
              columns={['Učenik', 'Status', 'Sync']}
              rows={syncIssues.data.map((row) => [
                row.full_name,
                <StatusBadge key={`${row.registry_student_id}-issue-status`} value={row.student_status} />,
                <SyncBadge key={`${row.registry_student_id}-issue-sync`} value={row.sync_state} />,
              ])}
            />
          </DataState>
        </Panel>
        <Panel title="Prijelaz školske godine">
          <DataState state={transition}>
            <Table
              columns={['Razred', 'Cilj', 'Status', 'Aktivni']}
              rows={transition.data.map((row) => [
                row.from_class_name,
                row.suggested_to_class_name ?? '-',
                row.transition_status,
                row.active_student_count,
              ])}
            />
          </DataState>
        </Panel>
      </div>
    </div>
  );
}

function HomeroomDashboard({ profile }) {
  const classes = useSupabaseQuery(
    () => supabase
      .from('v_ematica_class_summary')
      .select('*')
      .or(`homeroom_teacher_id.eq.${profile?.id},deputy_teacher_id.eq.${profile?.id},deputy_homeroom_teacher_id.eq.${profile?.id}`)
      .order('class_name'),
    [profile?.id]
  );
  const totalStudents = classes.data.reduce((sum, item) => sum + Number(item.active_student_count ?? 0), 0);

  return (
    <div className="stack">
      <SectionHero
        eyebrow="Razredništvo"
        title="Pregled razrednika"
        description="Brzi uvid u razrede, aktivne učenike i ključne administrativne promjene za razredništvo."
        badges={['Moji razredi', 'Statusi učenika', 'Prijelaz godine']}
      />
      <div className="metric-grid">
        <Metric label="Moji razredi" value={classes.data.length} />
        <Metric label="Aktivni učenici" value={totalStudents} />
        <Metric label="Ispisani" value={classes.data.reduce((sum, item) => sum + Number(item.dropped_out_student_count ?? 0), 0)} tone="warning" />
        <Metric label="Završili" value={classes.data.reduce((sum, item) => sum + Number(item.graduated_student_count ?? 0), 0)} />
      </div>
      <Panel title="Moji razredi">
        <DataState state={classes}>
          <Table
            columns={['Razred', 'Škola', 'Program', 'Aktivni', 'Ispisani', 'Završili']}
            rows={classes.data.map((item) => [
              item.class_name,
              item.school_name,
              item.program_name,
              item.active_student_count,
              item.dropped_out_student_count,
              item.graduated_student_count,
            ])}
          />
        </DataState>
      </Panel>
    </div>
  );
}

function Schools({ adminScope = {} }) {
  const schools = useSupabaseQuery(() => {
    let query = supabase.from('schools').select('*').order('name');
    if (adminScope.isScoped) query = query.eq('id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const [form, setForm] = useState({ name: '', code: '', city: '', email: '', education_level: 'SECONDARY' });
  const [editForm, setEditForm] = useState({ id: '', name: '', code: '', city: '', email: '', education_level: 'SECONDARY', is_active: true });
  const [message, setMessage] = useState('');

  const create = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase.from('schools').insert(form);
    setMessage(error ? error.message : 'Škola je dodana.');
    if (!error) {
      setForm({ name: '', code: '', city: '', email: '', education_level: 'SECONDARY' });
      schools.reload();
    }
  };

  const startEdit = (school) => {
    setEditForm({
      id: school.id,
      name: school.name ?? '',
      code: school.code ?? '',
      city: school.city ?? '',
      email: school.email ?? '',
      education_level: school.education_level ?? 'SECONDARY',
      is_active: school.is_active !== false,
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase
      .from('schools')
      .update({
        name: editForm.name,
        code: editForm.code || null,
        city: editForm.city || null,
        email: editForm.email || null,
        education_level: editForm.education_level,
        is_active: editForm.is_active,
      })
      .eq('id', editForm.id);

    setMessage(error ? error.message : 'Škola je ažurirana.');
    if (!error) {
      setEditForm({ id: '', name: '', code: '', city: '', email: '', education_level: 'SECONDARY', is_active: true });
      schools.reload();
    }
  };

  const deleteSchool = async (school) => {
    const confirmed = window.confirm(`Obrisati školu ${school.name}?`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.from('schools').delete().eq('id', school.id);
    setMessage(error ? error.message : 'Škola je obrisana.');
    if (!error) schools.reload();
  };

  return (
    <div className="stack">
      <Panel title="Nova škola">
        {adminScope.isScoped ? (
          <p className="notice">Administriraš samo aktivnu ustanovu: {adminScope.schoolName || adminScope.schoolId}.</p>
        ) : (
          <form className="inline-form" onSubmit={create}>
            <input placeholder="Naziv škole" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="Šifra" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <input placeholder="Grad" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <input placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <select value={form.education_level} onChange={(e) => setForm({ ...form, education_level: e.target.value })}>
              <option value="ELEMENTARY">Osnovna škola</option>
              <option value="SECONDARY">Srednja škola</option>
              <option value="HIGHER">Fakultet/visoko učilište</option>
              <option value="OTHER">Ostalo</option>
            </select>
            <button className="primary" type="submit"><UserPlus size={18} /><span>Dodaj</span></button>
          </form>
        )}
        {message && <p className="notice">{message}</p>}
      </Panel>

      {editForm.id && (
        <Panel title="Uredi školu">
          <form className="inline-form" onSubmit={saveEdit}>
            <input placeholder="Naziv škole" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <input placeholder="Šifra" value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} />
            <input placeholder="Grad" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            <input placeholder="E-mail" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <select value={editForm.education_level} onChange={(e) => setEditForm({ ...editForm, education_level: e.target.value })}>
              <option value="ELEMENTARY">Osnovna škola</option>
              <option value="SECONDARY">Srednja škola</option>
              <option value="HIGHER">Fakultet/visoko učilište</option>
              <option value="OTHER">Ostalo</option>
            </select>
            <label className="checkbox-control">
              <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
              Aktivna
            </label>
            <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi</span></button>
            <button className="small-button" type="button" onClick={() => setEditForm({ id: '', name: '', code: '', city: '', email: '', education_level: 'SECONDARY', is_active: true })}>Odustani</button>
          </form>
        </Panel>
      )}

      <Panel title="Škole">
        <DataState state={schools}>
          <Table columns={['Naziv', 'Tip', 'Šifra', 'Grad', 'E-mail', 'Aktivna', 'Akcije']} rows={schools.data.map((s) => [
            s.name,
            formatSchoolLevel(s.education_level),
            s.code,
            s.city,
            s.email,
            s.is_active ? 'Da' : 'Ne',
            <div className="row-actions" key={`${s.id}-actions`}>
              <button className="small-button" type="button" onClick={() => startEdit(s)}>Uredi</button>
              <button className="small-button danger" type="button" onClick={() => deleteSchool(s)}>Obriši</button>
            </div>,
          ])} />
        </DataState>
      </Panel>
    </div>
  );
}

function SchoolYears({ adminScope = {} }) {
  const years = useSupabaseQuery(() => {
    let query = supabase.from('school_years').select('*').order('label');
    if (adminScope.isScoped) query = query.eq('school_id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const schools = useSupabaseQuery(() => {
    let query = supabase.from('schools').select('id,name').order('name');
    if (adminScope.isScoped) query = query.eq('id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const [form, setForm] = useState({ school_id: '', name: '', is_active: false });
  const [editForm, setEditForm] = useState({ id: '', school_id: '', name: '', is_active: false });
  const [message, setMessage] = useState('');

  const create = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase.from('school_years').insert({
      school_id: adminScope.isScoped ? adminScope.schoolId : form.school_id,
      name: form.name,
      label: form.name,
      is_active: form.is_active,
    });

    setMessage(error ? error.message : 'Školska godina je dodana.');
    if (!error) {
      setForm({ school_id: '', name: '', is_active: false });
      years.reload();
    }
  };

  const startEdit = (year) => {
    setEditForm({
      id: year.id,
      school_id: year.school_id ?? '',
      name: year.label ?? year.name ?? '',
      is_active: year.is_active === true,
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase
      .from('school_years')
      .update({
        school_id: adminScope.isScoped ? adminScope.schoolId : editForm.school_id,
        name: editForm.name,
        label: editForm.name,
        is_active: editForm.is_active,
      })
      .eq('id', editForm.id);

    setMessage(error ? error.message : 'Školska godina je ažurirana.');
    if (!error) {
      setEditForm({ id: '', school_id: '', name: '', is_active: false });
      years.reload();
    }
  };

  const deleteYear = async (year) => {
    const confirmed = window.confirm(`Obrisati školsku godinu ${year.label ?? year.name}?`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.from('school_years').delete().eq('id', year.id);
    setMessage(error ? error.message : 'Školska godina je obrisana.');
    if (!error) years.reload();
  };

  return (
    <div className="stack">
      <Panel title="Nova školska godina">
        <form className="inline-form compact" onSubmit={create}>
          <select value={adminScope.isScoped ? adminScope.schoolId : form.school_id} onChange={(e) => setForm({ ...form, school_id: e.target.value })} required disabled={adminScope.isScoped}>
            <option value="">Škola</option>
            {schools.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <input placeholder="Naziv, npr. 2026./2027." value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label className="checkbox-control">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Aktivna
          </label>
          <button className="primary" type="submit"><UserPlus size={18} /><span>Dodaj</span></button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>
      {editForm.id && (
        <Panel title="Uredi školsku godinu">
          <form className="inline-form compact" onSubmit={saveEdit}>
            <select value={adminScope.isScoped ? adminScope.schoolId : editForm.school_id} onChange={(e) => setEditForm({ ...editForm, school_id: e.target.value })} required disabled={adminScope.isScoped}>
              <option value="">Škola</option>
              {schools.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
            <input placeholder="Naziv" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <label className="checkbox-control">
              <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
              Aktivna
            </label>
            <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi</span></button>
            <button className="small-button" type="button" onClick={() => setEditForm({ id: '', school_id: '', name: '', is_active: false })}>Odustani</button>
          </form>
        </Panel>
      )}
      <Panel title="Školske godine">
        <DataState state={years}>
          <Table columns={['Naziv', 'Škola', 'Aktivna', 'Akcije']} rows={years.data.map((y) => [
            y.label ?? y.name,
            schools.data.find((school) => school.id === y.school_id)?.name ?? y.school_id ?? '-',
            y.is_active === false ? 'Ne' : 'Da',
            <div className="row-actions" key={`${y.id}-actions`}>
              <button className="small-button" type="button" onClick={() => startEdit(y)}>Uredi</button>
              <button className="small-button danger" type="button" onClick={() => deleteYear(y)}>Obriši</button>
            </div>,
          ])} />
        </DataState>
      </Panel>
    </div>
  );
}

function Programs({ adminScope = {} }) {
  const programs = useSupabaseQuery(() => {
    let query = supabase.from('programs').select('*').order('name');
    if (adminScope.isScoped) query = query.eq('school_id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const schools = useSupabaseQuery(() => {
    let query = supabase.from('schools').select('id,name,education_level').order('name');
    if (adminScope.isScoped) query = query.eq('id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const [form, setForm] = useState({ school_id: '', name: '', code: '', duration_years: 3, admission_capacity: 0, admission_min_points: '', admission_is_open: true });
  const [editForm, setEditForm] = useState({ id: '', name: '', code: '', duration_years: 3, admission_capacity: 0, admission_min_points: '', admission_is_open: true });
  const [message, setMessage] = useState('');

  const create = async (event) => {
    event.preventDefault();
    setMessage('');
    const schoolId = adminScope.isScoped ? adminScope.schoolId : form.school_id;
    const selectedSchool = schools.data.find((school) => school.id === schoolId);
    const { error } = await supabase.from('programs').insert({
      ...form,
      school_id: schoolId,
      duration_years: Number(form.duration_years),
      admission_capacity: Number(form.admission_capacity),
      admission_min_points: form.admission_min_points === '' ? null : Number(form.admission_min_points),
      admission_track: selectedSchool?.education_level === 'HIGHER' ? 'HIGHER_EDUCATION' : 'SECONDARY',
    });
    setMessage(error ? error.message : 'Program je dodan.');
    if (!error) {
      setForm({ school_id: '', name: '', code: '', duration_years: 3, admission_capacity: 0, admission_min_points: '', admission_is_open: true });
      programs.reload();
    }
  };

  const deleteProgram = async (program) => {
    const confirmed = window.confirm(`Obrisati program ${program.name}? Ako se koristi u razredima ili upisima, baza će odbiti brisanje.`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.from('programs').delete().eq('id', program.id);
    setMessage(error ? error.message : 'Program je obrisan.');
    if (!error) programs.reload();
  };

  const startEdit = (program) => {
    setMessage('');
    setEditForm({
      id: program.id,
      name: program.name ?? '',
      code: program.code ?? '',
      duration_years: program.duration_years ?? 3,
      admission_capacity: program.admission_capacity ?? 0,
      admission_min_points: program.admission_min_points ?? '',
      admission_is_open: program.admission_is_open !== false,
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase
      .from('programs')
      .update({
        name: editForm.name,
        code: editForm.code || null,
        duration_years: Number(editForm.duration_years),
        admission_capacity: Number(editForm.admission_capacity),
        admission_min_points: editForm.admission_min_points === '' ? null : Number(editForm.admission_min_points),
        admission_is_open: editForm.admission_is_open,
      })
      .eq('id', editForm.id);

    setMessage(error ? error.message : 'Program je ažuriran.');
    if (!error) {
      setEditForm({ id: '', name: '', code: '', duration_years: 3, admission_capacity: 0, admission_min_points: '', admission_is_open: true });
      programs.reload();
    }
  };

  return (
    <div className="stack">
      <Panel title="Novi program">
        <form className="inline-form" onSubmit={create}>
          <select value={adminScope.isScoped ? adminScope.schoolId : form.school_id} onChange={(e) => setForm({ ...form, school_id: e.target.value })} required disabled={adminScope.isScoped}>
            <option value="">Škola</option>
            {schools.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <input placeholder="Naziv programa" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Šifra" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input type="number" min="1" max="5" value={form.duration_years} onChange={(e) => setForm({ ...form, duration_years: e.target.value })} />
          <input type="number" min="0" placeholder="Upisna mjesta" value={form.admission_capacity} onChange={(e) => setForm({ ...form, admission_capacity: e.target.value })} />
          <input type="number" min="0" step="0.01" placeholder="Minimalni bodovi" value={form.admission_min_points} onChange={(e) => setForm({ ...form, admission_min_points: e.target.value })} />
          <label className="checkbox-control">
            <input type="checkbox" checked={form.admission_is_open} onChange={(e) => setForm({ ...form, admission_is_open: e.target.checked })} />
            Otvoren za e-Upise
          </label>
          <button className="primary" type="submit"><UserPlus size={18} /><span>Dodaj</span></button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>

      {editForm.id && (
        <Panel title="Uredi program">
          <form className="inline-form" onSubmit={saveEdit}>
            <input placeholder="Naziv programa" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <input placeholder="Šifra" value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} />
            <input type="number" min="1" max="5" value={editForm.duration_years} onChange={(e) => setEditForm({ ...editForm, duration_years: e.target.value })} />
            <input type="number" min="0" placeholder="Upisna mjesta" value={editForm.admission_capacity} onChange={(e) => setEditForm({ ...editForm, admission_capacity: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Minimalni bodovi" value={editForm.admission_min_points} onChange={(e) => setEditForm({ ...editForm, admission_min_points: e.target.value })} />
            <label className="checkbox-control">
              <input type="checkbox" checked={editForm.admission_is_open} onChange={(e) => setEditForm({ ...editForm, admission_is_open: e.target.checked })} />
              Otvoren za e-Upise
            </label>
            <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi</span></button>
            <button className="small-button" type="button" onClick={() => setEditForm({ id: '', name: '', code: '', duration_years: 3, admission_capacity: 0, admission_min_points: '', admission_is_open: true })}>Odustani</button>
          </form>
        </Panel>
      )}

      <Panel title="Programi">
      <DataState state={programs}>
        <Table columns={['Program', 'Škola', 'Šifra', 'Trajanje', 'Mjesta', 'Min. bodovi', 'e-Upisi', 'Akcije']} rows={programs.data.map((p) => [
          p.name,
          schools.data.find((school) => school.id === p.school_id)?.name ?? p.school_id,
          p.code,
          p.duration_years,
          p.admission_capacity ?? 0,
          p.admission_min_points ?? '-',
          p.admission_is_open ? 'Da' : 'Ne',
          <div className="row-actions" key={`${p.id}-actions`}>
            <button className="small-button" type="button" onClick={() => startEdit(p)}>Uredi</button>
            <button className="small-button danger" type="button" onClick={() => deleteProgram(p)}>Obriši</button>
          </div>,
        ])} />
      </DataState>
      </Panel>
    </div>
  );
}

function Classes({ adminScope = {} }) {
  const classes = useSupabaseQuery(() => {
    let query = supabase.from('v_ematica_class_summary').select('*').order('school_year_label', { ascending: false }).order('class_name');
    if (adminScope.isScoped) query = query.eq('school_id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const schools = useSupabaseQuery(() => {
    let query = supabase.from('schools').select('id,name').order('name');
    if (adminScope.isScoped) query = query.eq('id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const years = useSupabaseQuery(() => {
    let query = supabase.from('school_years').select('id,label,name,school_id').order('label');
    if (adminScope.isScoped) query = query.eq('school_id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const programs = useSupabaseQuery(() => {
    let query = supabase.from('programs').select('id,name,school_id').order('name');
    if (adminScope.isScoped) query = query.eq('school_id', adminScope.schoolId);
    return query;
  }, [adminScope.schoolId, adminScope.isScoped]);
  const profiles = useSupabaseQuery(() => supabase.from('user_profiles').select('*').order('email'), []);
  const [form, setForm] = useState({
    school_id: '',
    school_year_id: '',
    program_id: '',
    grade_level: 1,
    section: 'A',
  });
  const [teacherForm, setTeacherForm] = useState({ class_id: '', homeroom_teacher_id: '', deputy_homeroom_teacher_id: '' });
  const [editForm, setEditForm] = useState({ id: '', school_year_id: '', program_id: '', grade_level: 1, section: 'A', is_active: true });
  const [message, setMessage] = useState('');

  const selectedSchoolId = adminScope.isScoped ? adminScope.schoolId : form.school_id;
  const filteredPrograms = programs.data.filter((program) => !selectedSchoolId || program.school_id === selectedSchoolId);
  const teacherOptions = [...profiles.data]
    .filter((profile) => ['teacher', 'admin'].includes(profile.access_role))
    .sort(compareProfilesByLastName);
  const exportRows = classes.data.map((item) => ({
    razred: item.class_name,
    skola: item.school_name,
    skolska_godina: item.school_year_label ?? item.school_year,
    program: item.program_name,
    aktivni: item.active_student_count,
    ispisani: item.dropped_out_student_count,
    prebaceni: item.transferred_student_count,
    zavrsili: item.graduated_student_count,
    ukupno: item.total_student_count,
  }));

  const create = async (event) => {
    event.preventDefault();
    setMessage('');

    const selectedYear = years.data.find((year) => year.id === form.school_year_id);
    const section = form.section.trim().toUpperCase();
    const { error } = await supabase.from('classes').insert({
      school_id: selectedSchoolId,
      school_year_id: form.school_year_id,
      school_year: selectedYear?.label ?? selectedYear?.name ?? null,
      program_id: form.program_id || null,
      grade_level: Number(form.grade_level),
      section,
      name: `${Number(form.grade_level)}.${section}`,
      status: 'ACTIVE',
      is_active: true,
    });

    setMessage(error ? error.message : 'Razred je dodan.');
    if (!error) {
      setForm({ school_id: '', school_year_id: '', program_id: '', grade_level: 1, section: 'A' });
      classes.reload();
    }
  };

  const assignHomeroom = async (event) => {
    event.preventDefault();
    setMessage('');

    const { error } = await supabase
      .from('classes')
      .update({
        homeroom_teacher_id: teacherForm.homeroom_teacher_id || null,
        deputy_teacher_id: teacherForm.deputy_homeroom_teacher_id || null,
        deputy_homeroom_teacher_id: teacherForm.deputy_homeroom_teacher_id || null,
      })
      .eq('id', teacherForm.class_id);

    setMessage(error ? error.message : 'Razrednik i zamjenik su spremljeni.');
    if (!error) {
      setTeacherForm({ class_id: '', homeroom_teacher_id: '', deputy_homeroom_teacher_id: '' });
      classes.reload();
    }
  };

  const startEdit = (item) => {
    setEditForm({
      id: item.class_id,
      school_year_id: item.school_year_id ?? '',
      program_id: item.program_id ?? '',
      grade_level: item.grade_level ?? Number(String(item.class_name ?? '1').split('.')[0]) ?? 1,
      section: item.section ?? String(item.class_name ?? '1.A').split('.')[1] ?? 'A',
      is_active: item.is_active !== false,
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setMessage('');
    const selectedYear = years.data.find((year) => year.id === editForm.school_year_id);
    const { error } = await supabase
      .from('classes')
      .update({
        school_year_id: editForm.school_year_id,
        school_year: selectedYear?.label ?? selectedYear?.name ?? null,
        program_id: editForm.program_id || null,
        grade_level: Number(editForm.grade_level),
        section: editForm.section.trim().toUpperCase(),
        is_active: editForm.is_active,
      })
      .eq('id', editForm.id);

    setMessage(error ? error.message : 'Razred je ažuriran.');
    if (!error) {
      setEditForm({ id: '', school_year_id: '', program_id: '', grade_level: 1, section: 'A', is_active: true });
      classes.reload();
    }
  };

  const deleteClass = async (item) => {
    const confirmed = window.confirm(`Obrisati razred ${item.class_name}? Ako ima učenike ili upise, baza će odbiti brisanje.`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.from('classes').delete().eq('id', item.class_id);
    setMessage(error ? error.message : 'Razred je obrisan.');
    if (!error) classes.reload();
  };

  return (
    <div className="stack">
      <Panel title="Novi razred">
        <form className="inline-form" onSubmit={create}>
          <select value={selectedSchoolId} onChange={(e) => setForm({ ...form, school_id: e.target.value, program_id: '' })} required disabled={adminScope.isScoped}>
            <option value="">Škola</option>
            {schools.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <select value={form.school_year_id} onChange={(e) => setForm({ ...form, school_year_id: e.target.value })} required>
            <option value="">Školska godina</option>
            {years.data.map((year) => <option key={year.id} value={year.id}>{year.label ?? year.name}</option>)}
          </select>
          <select value={form.program_id} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
            <option value="">Program</option>
            {filteredPrograms.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
          </select>
          <input type="number" min="1" max="5" value={form.grade_level} onChange={(e) => setForm({ ...form, grade_level: e.target.value })} />
          <input placeholder="Odjeljenje" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} required />
          <button className="primary" type="submit"><UserPlus size={18} /><span>Dodaj</span></button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>

      <Panel title="Razrednik i zamjenik">
        <form className="inline-form compact" onSubmit={assignHomeroom}>
          <select value={teacherForm.class_id} onChange={(e) => setTeacherForm({ ...teacherForm, class_id: e.target.value })} required>
            <option value="">Razred</option>
            {classes.data.map((item) => <option key={item.class_id} value={item.class_id}>{item.class_name} - {item.school_name}</option>)}
          </select>
          <select value={teacherForm.homeroom_teacher_id} onChange={(e) => setTeacherForm({ ...teacherForm, homeroom_teacher_id: e.target.value })}>
            <option value="">Razrednik</option>
            {teacherOptions.map((profile) => <option key={profile.id} value={profile.id}>{getProfileDisplayName(profile)}</option>)}
          </select>
          <select value={teacherForm.deputy_homeroom_teacher_id} onChange={(e) => setTeacherForm({ ...teacherForm, deputy_homeroom_teacher_id: e.target.value })}>
            <option value="">Zamjenik</option>
            {teacherOptions.map((profile) => <option key={profile.id} value={profile.id}>{getProfileDisplayName(profile)}</option>)}
          </select>
          <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi</span></button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>

      {editForm.id && (
        <Panel title="Uredi razred">
          <form className="inline-form" onSubmit={saveEdit}>
            <select value={editForm.school_year_id} onChange={(e) => setEditForm({ ...editForm, school_year_id: e.target.value })} required>
              <option value="">Školska godina</option>
              {years.data.map((year) => <option key={year.id} value={year.id}>{year.label ?? year.name}</option>)}
            </select>
            <select value={editForm.program_id} onChange={(e) => setEditForm({ ...editForm, program_id: e.target.value })}>
              <option value="">Program</option>
              {filteredPrograms.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
            </select>
            <input type="number" min="1" max="5" value={editForm.grade_level} onChange={(e) => setEditForm({ ...editForm, grade_level: e.target.value })} />
            <input placeholder="Odjeljenje" value={editForm.section} onChange={(e) => setEditForm({ ...editForm, section: e.target.value })} required />
            <label className="checkbox-control">
              <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
              Aktivan
            </label>
            <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi</span></button>
            <button className="small-button" type="button" onClick={() => setEditForm({ id: '', school_year_id: '', program_id: '', grade_level: 1, section: 'A', is_active: true })}>Odustani</button>
          </form>
        </Panel>
      )}

      <Panel title="Razredi" action={<ExportButton filename="razredi.csv" rows={exportRows} />}>
        <DataState state={classes}>
          <Table
            columns={['Razred', 'Škola', 'Školska godina', 'Program', 'Razrednik', 'Zamjenik', 'Aktivni', 'Ispisani', 'Završili', 'Akcije']}
            rows={classes.data.map((item) => [
              item.class_name,
              item.school_name,
              item.school_year_label ?? item.school_year,
              item.program_name,
              getProfileDisplayName(profiles.data.find((profile) => profile.id === item.homeroom_teacher_id) ?? {}),
              getProfileDisplayName(profiles.data.find((profile) => profile.id === item.deputy_homeroom_teacher_id || profile.id === item.deputy_teacher_id) ?? {}),
              item.active_student_count,
              item.dropped_out_student_count,
              item.graduated_student_count,
              <div className="row-actions" key={`${item.class_id}-actions`}>
                <button className="small-button" type="button" onClick={() => startEdit(item)}>Uredi</button>
                <button className="small-button danger" type="button" onClick={() => deleteClass(item)}>Obriši</button>
              </div>,
            ])}
          />
        </DataState>
      </Panel>
    </div>
  );
}

function Students({ scopeProfile = null, isAdmin = true }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [syncFilter, setSyncFilter] = useState('ALL');
  const students = useSupabaseQuery(() => supabase.from('v_ematica_students_current').select('*').order('last_name'), []);
  const scopedClasses = useSupabaseQuery(
    async () => {
      if (isAdmin || !scopeProfile?.id) return { data: [], error: null };
      return supabase
        .from('v_ematica_class_summary')
        .select('class_id')
        .or(`homeroom_teacher_id.eq.${scopeProfile.id},deputy_teacher_id.eq.${scopeProfile.id},deputy_homeroom_teacher_id.eq.${scopeProfile.id}`);
    },
    [isAdmin, scopeProfile?.id]
  );
  const [form, setForm] = useState({ first_name: '', last_name: '', oib: '', email: '' });
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [message, setMessage] = useState('');
  const filtered = useMemo(() => {
    const value = query.toLowerCase();
    const scopedClassIds = new Set(scopedClasses.data.map((item) => item.class_id));
    return students.data.filter((student) => {
      if (!isAdmin && scopedClassIds.size === 0) return false;
      if (!isAdmin && scopedClassIds.size > 0 && !scopedClassIds.has(student.class_id)) return false;
      const matchesSearch = `${student.full_name} ${student.oib ?? ''} ${student.email ?? ''}`.toLowerCase().includes(value);
      const matchesStatus = statusFilter === 'ALL' || student.student_status === statusFilter;
      const linked = Boolean(student.ednevnik_student_id);
      const matchesSync = syncFilter === 'ALL' || (syncFilter === 'LINKED' ? linked : !linked);
      return matchesSearch && matchesStatus && matchesSync;
    });
  }, [students.data, scopedClasses.data, query, statusFilter, syncFilter, isAdmin]);
  const selectedStudent = students.data.find((student) => student.registry_student_id === selectedStudentId) ?? filtered[0] ?? null;
  const exportRows = filtered.map((student) => ({
    ucenik: student.full_name,
    oib: student.oib,
    status: STUDENT_STATUSES[student.student_status] ?? student.student_status,
    skola: student.school_name,
    razred: student.class_name,
    program: student.program_name,
    skolska_godina: student.school_year_label,
    ednevnik: student.ednevnik_student_id ? 'Povezan' : 'Nije povezan',
  }));

  const create = async (event) => {
    event.preventDefault();
    setMessage('');
    const payload = {
      ...form,
      oib: form.oib.trim() || null,
      email: form.email.trim() || null,
    };
    const { error } = await supabase.from('registry_students').insert(payload);
    setMessage(error ? error.message : 'Učenik je dodan u e-Maticu.');
    if (!error) {
      setForm({ first_name: '', last_name: '', oib: '', email: '' });
      students.reload();
    }
  };

  const markDroppedOut = async (student) => {
    const confirmed = window.confirm(`Označiti učenika ${student.full_name} kao ispisanog?`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.rpc('mark_registry_student_dropped_out', {
      p_registry_student_id: student.registry_student_id,
      p_exit_reason: 'Ispis evidentiran kroz e-Upisi aplikaciju.',
      p_exited_on: new Date().toISOString().slice(0, 10),
    });

    setMessage(error ? error.message : 'Učenik je označen kao ispisan.');
    students.reload();
  };

  const refreshStudents = () => {
    students.reload();
  };

  return (
    <div className="stack">
      <Panel title="Novi zapis: Učenici">
        <form className="inline-form" onSubmit={create}>
          <input placeholder="Ime" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          <input placeholder="Prezime" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
          <input placeholder="OIB" value={form.oib} onChange={(e) => setForm({ ...form, oib: e.target.value })} />
          <input placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <button className="primary" type="submit"><UserPlus size={18} /><span>Dodaj</span></button>
        </form>
      </Panel>

      <div className="master-detail">
        <Panel
          title="Učenici"
          action={
            <div className="toolbar">
              <SearchBox value={query} onChange={setQuery} />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="ALL">Svi statusi</option>
                <option value="ACTIVE">Aktivni</option>
                <option value="DROPPED_OUT">Ispisani</option>
                <option value="TRANSFERRED">Prebačeni</option>
                <option value="GRADUATED">Završili</option>
              </select>
              <select value={syncFilter} onChange={(e) => setSyncFilter(e.target.value)}>
                <option value="ALL">Svi sync statusi</option>
                <option value="LINKED">Povezani</option>
                <option value="UNLINKED">Nisu povezani</option>
              </select>
              <ExportButton filename="ucenici.csv" rows={exportRows} />
            </div>
          }
        >
          {message && <p className="notice">{message}</p>}
          <DataState state={students}>
            <Table
              columns={['Učenik', 'OIB', 'Status', 'Škola', 'Razred', 'e-Dnevnik', 'Akcije']}
              rows={filtered.map((s) => [
                s.full_name,
                s.oib,
                <StatusBadge key={`${s.registry_student_id}-status`} value={s.student_status} />,
                s.school_name ?? '-',
                s.class_name ?? '-',
                s.ednevnik_student_id ? 'Povezan' : 'Nije povezan',
                <div className="row-actions" key={`${s.registry_student_id}-actions`}>
                  <button className="small-button" type="button" onClick={() => setSelectedStudentId(s.registry_student_id)}>
                    Otvori
                  </button>
                  <button className="small-button danger" type="button" onClick={() => markDroppedOut(s)} disabled={s.student_status === 'DROPPED_OUT'}>
                    Ispiši
                  </button>
                </div>,
              ])}
            />
          </DataState>
        </Panel>

        <StudentDetailPanel
          student={selectedStudent}
          onMessage={setMessage}
          onRefresh={refreshStudents}
        />
      </div>
    </div>
  );
}

function StudentDetailPanel({ student, onMessage, onRefresh }) {
  const classes = useSupabaseQuery(() => supabase.from('v_ematica_class_summary').select('*').order('class_name'), []);
  const [edit, setEdit] = useState({
    first_name: '',
    last_name: '',
    oib: '',
    email: '',
    phone: '',
  });
  const [action, setAction] = useState({ status: '', class_id: '', reason: '' });

  useEffect(() => {
    if (!student) return;
    setEdit({
      first_name: student.first_name ?? '',
      last_name: student.last_name ?? '',
      oib: student.oib ?? '',
      email: student.email ?? '',
      phone: student.phone ?? '',
    });
  }, [student?.registry_student_id]);

  if (!student) {
    return (
      <Panel title="Profil učenika">
        <div className="empty-detail">
          <Users size={30} />
          <p>Odaberi učenika iz popisa.</p>
        </div>
      </Panel>
    );
  }

  const save = async (event) => {
    event.preventDefault();
    onMessage('');

    const { error } = await supabase
      .from('registry_students')
      .update({
        first_name: edit.first_name.trim(),
        last_name: edit.last_name.trim(),
        oib: edit.oib.trim() || null,
        email: edit.email.trim() || null,
        phone: edit.phone.trim() || null,
      })
      .eq('id', student.registry_student_id);

    onMessage(error ? error.message : 'Podaci učenika su spremljeni.');
    if (!error) onRefresh();
  };

  const changeStatus = async (event) => {
    event.preventDefault();
    if (!action.status) return;
    onMessage('');

    const { error } = await supabase.rpc('set_registry_student_status', {
      p_registry_student_id: student.registry_student_id,
      p_status: action.status,
    });

    onMessage(error ? error.message : 'Status učenika je promijenjen.');
    if (!error) {
      setAction((current) => ({ ...current, status: '' }));
      onRefresh();
    }
  };

  const transferToClass = async (event) => {
    event.preventDefault();
    if (!action.class_id) return;
    onMessage('');

    const { error } = await supabase.rpc('transfer_registry_student', {
      p_registry_student_id: student.registry_student_id,
      p_to_class_id: action.class_id,
      p_reason: action.reason || 'Premještaj evidentiran kroz profil učenika.',
    });

    onMessage(error ? error.message : 'Učenik je premješten u odabrani razred.');
    if (!error) {
      setAction((current) => ({ ...current, class_id: '', reason: '' }));
      onRefresh();
      classes.reload();
    }
  };

  const deleteStudent = async () => {
    const confirmed = window.confirm(`Obrisati učenika ${student.full_name} iz e-Matice?`);
    if (!confirmed) return;

    onMessage('');
    const { error } = await supabase
      .from('registry_students')
      .delete()
      .eq('id', student.registry_student_id);

    onMessage(error ? error.message : 'Učenik je obrisan iz e-Matice.');
    if (!error) onRefresh();
  };

  return (
    <Panel title="Profil učenika">
      <div className="detail-hero">
        <div className="avatar">{getInitials(student.full_name)}</div>
        <div>
          <h3>{student.full_name}</h3>
          <div className="detail-badges">
            <StatusBadge value={student.student_status} />
            <span className={`status-badge ${student.ednevnik_student_id ? 'active' : 'dropped_out'}`}>
              {student.ednevnik_student_id ? 'e-Dnevnik povezan' : 'e-Dnevnik nije povezan'}
            </span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <span>Škola</span>
          <strong>{student.school_name ?? '-'}</strong>
        </div>
        <div>
          <span>Razred</span>
          <strong>{student.class_name ?? '-'}</strong>
        </div>
        <div>
          <span>Program</span>
          <strong>{student.program_name ?? '-'}</strong>
        </div>
        <div>
          <span>Školska godina</span>
          <strong>{student.school_year_label ?? '-'}</strong>
        </div>
      </div>

      <form className="detail-form" onSubmit={save}>
        <label>
          Ime
          <input value={edit.first_name} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} required />
        </label>
        <label>
          Prezime
          <input value={edit.last_name} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} required />
        </label>
        <label>
          OIB
          <input value={edit.oib} onChange={(e) => setEdit({ ...edit, oib: e.target.value })} />
        </label>
        <label>
          E-mail
          <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
        </label>
        <label>
          Telefon
          <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
        </label>
        <button className="primary" type="submit">
          <CheckCircle2 size={18} />
          <span>Spremi</span>
        </button>
      </form>

      <div className="detail-actions">
        <form onSubmit={changeStatus}>
          <strong>Promjena statusa</strong>
          <select value={action.status} onChange={(e) => setAction({ ...action, status: e.target.value })}>
            <option value="">Odaberi status</option>
            <option value="ACTIVE">Aktivan</option>
            <option value="DROPPED_OUT">Ispisan</option>
            <option value="TRANSFERRED">Prebačen</option>
            <option value="GRADUATED">Završio</option>
          </select>
          <button className="small-button" type="submit" disabled={!action.status}>Primijeni</button>
        </form>

        <form onSubmit={transferToClass}>
          <strong>Premještaj u razred</strong>
          <select value={action.class_id} onChange={(e) => setAction({ ...action, class_id: e.target.value })}>
            <option value="">Ciljni razred</option>
            {classes.data.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.class_name} - {item.school_name ?? 'Škola nije upisana'}
              </option>
            ))}
          </select>
          <input placeholder="Razlog" value={action.reason} onChange={(e) => setAction({ ...action, reason: e.target.value })} />
          <button className="small-button" type="submit" disabled={!action.class_id}>Premjesti</button>
        </form>

        <div>
          <strong>Brisanje</strong>
          <button className="small-button danger" type="button" onClick={deleteStudent}>Obriši učenika</button>
        </div>
      </div>
    </Panel>
  );
}

function Enrollments() {
  const classes = useSupabaseQuery(() => supabase.from('v_ematica_class_summary').select('*').order('class_name'), []);
  const students = useSupabaseQuery(() => supabase.from('v_ematica_students_current').select('*').order('full_name'), []);
  const enrollments = useSupabaseQuery(() => supabase.from('v_student_class_enrollments_detailed').select('*').order('school_year_label', { ascending: false }).order('class_name').order('full_name'), []);
  const [form, setForm] = useState({ registry_student_id: '', class_id: '' });
  const [filters, setFilters] = useState({ class_id: '', status: 'ALL' });
  const [statusForm, setStatusForm] = useState({ enrollment_id: '', status: '', reason: '' });
  const [message, setMessage] = useState('');
  const filteredEnrollments = enrollments.data.filter((item) => {
    const matchesClass = !filters.class_id || item.class_id === filters.class_id;
    const matchesStatus = filters.status === 'ALL' || item.enrollment_status === filters.status;
    return matchesClass && matchesStatus;
  });
  const exportRows = filteredEnrollments.map((item) => ({
    ucenik: item.full_name,
    oib: item.oib,
    status_ucenika: item.student_status,
    status_upisa: item.enrollment_status,
    skola: item.school_name,
    razred: item.class_name,
    program: item.program_name,
    skolska_godina: item.school_year_label,
  }));

  const enroll = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase.rpc('sync_registry_student_to_ednevnik_class', {
      p_registry_student_id: form.registry_student_id,
      p_class_id: form.class_id,
      p_school_enrollment_id: null,
    });

    setMessage(error ? error.message : 'Učenik je upisan u razred.');
    if (!error) {
      setForm({ registry_student_id: '', class_id: '' });
      classes.reload();
      students.reload();
      enrollments.reload();
    }
  };

  const updateEnrollmentStatus = async (enrollmentId, status) => {
    setMessage('');
    const { error } = await supabase.rpc('update_student_class_enrollment_status', {
      p_class_enrollment_id: enrollmentId,
      p_status: status,
      p_exit_reason: statusForm.enrollment_id === enrollmentId ? statusForm.reason || null : null,
    });

    setMessage(error ? error.message : 'Status upisa je ažuriran.');
    if (!error) {
      setStatusForm({ enrollment_id: '', status: '', reason: '' });
      enrollments.reload();
      classes.reload();
    }
  };

  const deleteEnrollment = async (item) => {
    const confirmed = window.confirm(`Obrisati upis učenika ${item.full_name} u ${item.class_name}?`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.rpc('delete_student_class_enrollment', {
      p_class_enrollment_id: item.class_enrollment_id,
    });

    setMessage(error ? error.message : 'Upis je obrisan.');
    if (!error) {
      enrollments.reload();
      classes.reload();
    }
  };

  return (
    <div className="stack">
      <Panel title="Upis učenika u razred">
        <form className="inline-form compact" onSubmit={enroll}>
          <select value={form.registry_student_id} onChange={(e) => setForm({ ...form, registry_student_id: e.target.value })} required>
            <option value="">Učenik</option>
            {students.data.map((student) => (
              <option key={student.registry_student_id} value={student.registry_student_id}>
                {student.full_name} {student.oib ? `(${student.oib})` : ''}
              </option>
            ))}
          </select>
          <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required>
            <option value="">Razred</option>
            {classes.data.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.class_name} - {item.school_name ?? 'Škola nije upisana'}
              </option>
            ))}
          </select>
          <button className="primary" type="submit">
            <UserPlus size={18} />
            <span>Upiši</span>
          </button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>
      <Panel title="Upisi po razredima">
        <DataState state={classes}>
          <Table columns={['Razred', 'Škola', 'Program', 'Aktivni', 'Ispisani', 'Završili']} rows={classes.data.map((c) => [c.class_name, c.school_name, c.program_name, c.active_student_count, c.dropped_out_student_count, c.graduated_student_count])} />
        </DataState>
      </Panel>
      <Panel
        title="Pojedinačni upisi"
        action={
          <div className="toolbar">
            <select value={filters.class_id} onChange={(e) => setFilters({ ...filters, class_id: e.target.value })}>
              <option value="">Svi razredi</option>
              {classes.data.map((item) => <option key={item.class_id} value={item.class_id}>{item.class_name} - {item.school_name}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="ALL">Svi statusi</option>
              <option value="ACTIVE">Aktivni</option>
              <option value="DROPPED_OUT">Ispisani</option>
              <option value="TRANSFERRED">Prebačeni</option>
              <option value="GRADUATED">Završili</option>
            </select>
            <ExportButton filename="pojedinacni-upisi.csv" rows={exportRows} />
          </div>
        }
      >
        <DataState state={enrollments}>
          <Table
            columns={['Učenik', 'OIB', 'Razred', 'Program', 'Godina', 'Status upisa', 'Akcije']}
            rows={filteredEnrollments.map((item) => [
              item.full_name || item.registry_student_id || item.ednevnik_or_legacy_student_id,
              item.oib ?? '-',
              item.class_name ?? '-',
              item.program_name ?? '-',
              item.school_year_label ?? '-',
              <StatusBadge key={`${item.class_enrollment_id}-status`} value={item.enrollment_status} />,
              <div className="application-actions" key={`${item.class_enrollment_id}-actions`}>
                <input
                  className="mini-input"
                  placeholder="Razlog"
                  value={statusForm.enrollment_id === item.class_enrollment_id ? statusForm.reason : ''}
                  onChange={(e) => setStatusForm({ enrollment_id: item.class_enrollment_id, status: statusForm.status, reason: e.target.value })}
                />
                <button className="small-button" type="button" onClick={() => updateEnrollmentStatus(item.class_enrollment_id, 'ACTIVE')}>Aktivan</button>
                <button className="small-button" type="button" onClick={() => updateEnrollmentStatus(item.class_enrollment_id, 'TRANSFERRED')}>Prebačen</button>
                <button className="small-button" type="button" onClick={() => updateEnrollmentStatus(item.class_enrollment_id, 'GRADUATED')}>Završio</button>
                <button className="small-button danger" type="button" onClick={() => updateEnrollmentStatus(item.class_enrollment_id, 'DROPPED_OUT')}>Ispisan</button>
                <button className="small-button danger" type="button" onClick={() => deleteEnrollment(item)}>Obriši</button>
              </div>,
            ])}
          />
        </DataState>
      </Panel>
    </div>
  );
}

function Transfers() {
  const transfers = useSupabaseQuery(() => supabase.from('v_ematica_transfers_detailed').select('*').order('created_at', { ascending: false }), []);
  const students = useSupabaseQuery(() => supabase.from('v_ematica_students_current').select('*').order('full_name'), []);
  const classes = useSupabaseQuery(() => supabase.from('v_ematica_class_summary').select('*').order('class_name'), []);
  const [form, setForm] = useState({ registry_student_id: '', class_id: '', reason: '' });
  const [filters, setFilters] = useState({ status: 'ALL' });
  const [workflow, setWorkflow] = useState({ transfer_id: '', reason: '' });
  const [message, setMessage] = useState('');
  const filteredTransfers = transfers.data.filter((item) => filters.status === 'ALL' || item.status === filters.status);
  const exportRows = filteredTransfers.map((item) => ({
    ucenik: item.full_name,
    iz_skole: item.from_school_name,
    iz_razreda: item.from_class_name,
    u_skolu: item.to_school_name,
    u_razred: item.to_class_name,
    status: item.status,
    razlog: item.reason,
    zavrseno: formatDateTime(item.completed_at),
  }));

  const transfer = async (event) => {
    event.preventDefault();
    setMessage('');

    const { error } = await supabase.rpc('transfer_registry_student', {
      p_registry_student_id: form.registry_student_id,
      p_to_class_id: form.class_id,
      p_reason: form.reason || 'Premještaj evidentiran kroz stranicu Premještaji.',
    });

    setMessage(error ? error.message : 'Premještaj je evidentiran.');
    if (!error) {
      setForm({ registry_student_id: '', class_id: '', reason: '' });
      transfers.reload();
      students.reload();
      classes.reload();
    }
  };

  const updateTransfer = async (transferId, status) => {
    setMessage('');
    const { error } = await supabase.rpc('update_student_transfer_workflow', {
      p_transfer_id: transferId,
      p_status: status,
      p_reason: workflow.transfer_id === transferId ? workflow.reason || null : null,
    });

    setMessage(error ? error.message : 'Status premještaja je ažuriran.');
    if (!error) {
      setWorkflow({ transfer_id: '', reason: '' });
      transfers.reload();
    }
  };

  const deleteTransfer = async (item) => {
    const confirmed = window.confirm(`Obrisati zapis premještaja za ${item.full_name}?`);
    if (!confirmed) return;

    setMessage('');
    const { error } = await supabase.rpc('delete_student_transfer', {
      p_transfer_id: item.transfer_id,
    });

    setMessage(error ? error.message : 'Premještaj je obrisan.');
    if (!error) transfers.reload();
  };

  return (
    <div className="stack">
      <Panel title="Novi premještaj">
        <form className="inline-form compact" onSubmit={transfer}>
          <select value={form.registry_student_id} onChange={(e) => setForm({ ...form, registry_student_id: e.target.value })} required>
            <option value="">Učenik</option>
            {students.data.map((student) => (
              <option key={student.registry_student_id} value={student.registry_student_id}>
                {student.full_name} - {student.class_name ?? 'bez razreda'}
              </option>
            ))}
          </select>
          <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required>
            <option value="">Ciljni razred</option>
            {classes.data.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.class_name} - {item.school_name ?? 'Škola nije upisana'}
              </option>
            ))}
          </select>
          <input placeholder="Razlog" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button className="primary" type="submit">
            <ArrowRightLeft size={18} />
            <span>Premjesti</span>
          </button>
        </form>
        {message && <p className="notice">{message}</p>}
      </Panel>

      <Panel
        title="Premještaji učenika"
        action={
          <div className="toolbar">
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="ALL">Svi statusi</option>
              <option value="PENDING">U tijeku</option>
              <option value="APPROVED">Odobreni</option>
              <option value="COMPLETED">Završeni</option>
              <option value="REJECTED">Odbijeni</option>
              <option value="CANCELLED">Otkazani</option>
            </select>
            <ExportButton filename="premjestaji.csv" rows={exportRows} />
          </div>
        }
      >
        <DataState state={transfers}>
          <Table
            columns={['Učenik', 'Iz', 'U', 'Status', 'Razlog', 'Završeno', 'Akcije']}
            rows={filteredTransfers.map((t) => [
              t.full_name,
              `${t.from_school_name ?? '-'} / ${t.from_class_name ?? '-'}`,
              `${t.to_school_name ?? '-'} / ${t.to_class_name ?? '-'}`,
              t.status,
              t.reason,
              formatDateTime(t.completed_at),
              <div className="application-actions" key={`${t.transfer_id}-actions`}>
                <input
                  className="mini-input"
                  placeholder="Razlog"
                  value={workflow.transfer_id === t.transfer_id ? workflow.reason : ''}
                  onChange={(e) => setWorkflow({ transfer_id: t.transfer_id, reason: e.target.value })}
                />
                <button className="small-button" type="button" onClick={() => updateTransfer(t.transfer_id, 'PENDING')}>U tijeku</button>
                <button className="small-button" type="button" onClick={() => updateTransfer(t.transfer_id, 'APPROVED')}>Odobri</button>
                <button className="small-button" type="button" onClick={() => updateTransfer(t.transfer_id, 'COMPLETED')}>Završi</button>
                <button className="small-button danger" type="button" onClick={() => updateTransfer(t.transfer_id, 'REJECTED')}>Odbij</button>
                <button className="small-button danger" type="button" onClick={() => updateTransfer(t.transfer_id, 'CANCELLED')}>Otkaži</button>
                <button className="small-button danger" type="button" onClick={() => deleteTransfer(t)}>Obriši</button>
              </div>,
            ])}
          />
        </DataState>
      </Panel>
    </div>
  );
}

function YearTransition() {
  const candidates = useSupabaseQuery(() => supabase.from('v_ematica_transition_candidates').select('*').order('from_class_name'), []);
  const years = useSupabaseQuery(() => supabase.from('school_years').select('id,label,name').order('label'), []);
  const students = useSupabaseQuery(() => supabase.from('v_ematica_students_current').select('*').order('full_name'), []);
  const classes = useSupabaseQuery(() => supabase.from('v_ematica_class_summary').select('*').order('class_name'), []);
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [paid, setPaid] = useState({ registry_student_id: '', class_id: '' });
  const [targetForm, setTargetForm] = useState({ from_class_id: '', to_class_id: '' });
  const [message, setMessage] = useState('');

  const runTransition = async () => {
    setMessage('');
    const { error } = await supabase.rpc('promote_school_year_students', {
      p_from_school_year_id: fromYear,
      p_to_school_year_id: toYear,
    });
    setMessage(error ? error.message : 'Prijelaz školske godine je pokrenut.');
    candidates.reload();
    students.reload();
    classes.reload();
  };

  const prepareClasses = async () => {
    setMessage('');
    const { error } = await supabase.rpc('create_next_school_year_classes', {
      p_from_school_year_id: fromYear,
      p_to_school_year_id: toYear,
      p_school_id: null,
    });

    setMessage(error ? error.message : 'Ciljni razredi su pripremljeni.');
    candidates.reload();
    classes.reload();
  };

  const runPaidContinuation = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase.rpc('continue_paid_education', {
      p_registry_student_id: paid.registry_student_id,
      p_to_class_id: paid.class_id,
      p_school_enrollment_id: null,
    });

    setMessage(error ? error.message : 'Plaćeni nastavak je evidentiran.');
    if (!error) {
      setPaid({ registry_student_id: '', class_id: '' });
      candidates.reload();
      students.reload();
      classes.reload();
    }
  };

  const setTargetClass = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase.rpc('set_transition_target_class', {
      p_from_class_id: targetForm.from_class_id,
      p_to_class_id: targetForm.to_class_id || null,
    });

    setMessage(error ? error.message : 'Ciljni razred je spremljen.');
    if (!error) {
      setTargetForm({ from_class_id: '', to_class_id: '' });
      candidates.reload();
      classes.reload();
    }
  };

  const clearTargetClass = async (fromClassId) => {
    setMessage('');
    const { error } = await supabase.rpc('set_transition_target_class', {
      p_from_class_id: fromClassId,
      p_to_class_id: null,
    });

    setMessage(error ? error.message : 'Ciljni razred je uklonjen.');
    if (!error) {
      candidates.reload();
      classes.reload();
    }
  };

  return (
    <div className="stack">
      <Panel title="Pokretanje prijelaza">
        <div className="inline-form">
          <select value={fromYear} onChange={(e) => setFromYear(e.target.value)}>
            <option value="">Iz školske godine</option>
            {years.data.map((year) => <option key={year.id} value={year.id}>{year.label ?? year.name}</option>)}
          </select>
          <select value={toYear} onChange={(e) => setToYear(e.target.value)}>
            <option value="">U školsku godinu</option>
            {years.data.map((year) => <option key={year.id} value={year.id}>{year.label ?? year.name}</option>)}
          </select>
          <button className="primary" type="button" onClick={runTransition} disabled={!fromYear || !toYear}>
            <RefreshCw size={18} />
            <span>Pokreni</span>
          </button>
          <button className="icon-text" type="button" onClick={prepareClasses} disabled={!fromYear || !toYear}>
            <School size={18} />
            <span>Pripremi razrede</span>
          </button>
        </div>
        {message && <p className="notice">{message}</p>}
      </Panel>
      <Panel title="Plaćeni nastavak obrazovanja">
        <form className="inline-form compact" onSubmit={runPaidContinuation}>
          <select value={paid.registry_student_id} onChange={(e) => setPaid({ ...paid, registry_student_id: e.target.value })} required>
            <option value="">Učenik iz 3.A, 3.B ili 3.C</option>
            {students.data
              .filter((student) => ['3.A', '3.B', '3.C'].includes(String(student.class_name ?? '').toUpperCase()))
              .map((student) => (
                <option key={student.registry_student_id} value={student.registry_student_id}>
                  {student.full_name} - {student.class_name}
                </option>
              ))}
          </select>
          <select value={paid.class_id} onChange={(e) => setPaid({ ...paid, class_id: e.target.value })} required>
            <option value="">Ciljni 4. razred</option>
            {classes.data
              .filter((item) => ['4.A', '4.B', '4.C', '4.K'].includes(String(item.class_name ?? '').toUpperCase()))
              .map((item) => (
                <option key={item.class_id} value={item.class_id}>
                  {item.class_name} - {item.school_name ?? 'Škola nije upisana'}
                </option>
              ))}
          </select>
          <button className="primary" type="submit">
            <GraduationCap size={18} />
            <span>Evidentiraj</span>
          </button>
        </form>
      </Panel>
      <Panel title="Ručno povezivanje ciljnog razreda">
        <form className="inline-form compact" onSubmit={setTargetClass}>
          <select value={targetForm.from_class_id} onChange={(e) => setTargetForm({ ...targetForm, from_class_id: e.target.value })} required>
            <option value="">Polazni razred</option>
            {candidates.data.map((item) => (
              <option key={item.from_class_id} value={item.from_class_id}>
                {item.from_class_name} - {item.school_name} ({item.from_school_year_label ?? '-'})
              </option>
            ))}
          </select>
          <select value={targetForm.to_class_id} onChange={(e) => setTargetForm({ ...targetForm, to_class_id: e.target.value })}>
            <option value="">Bez ciljnog razreda</option>
            {classes.data.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.class_name} - {item.school_name ?? 'Škola nije upisana'} ({item.school_year_label ?? item.school_year ?? '-'})
              </option>
            ))}
          </select>
          <button className="primary" type="submit"><CheckCircle2 size={18} /><span>Spremi cilj</span></button>
        </form>
      </Panel>
      <Panel title="Kandidati za prijelaz">
        <DataState state={candidates}>
          <Table
            columns={['Razred', 'Predloženi razred', 'Ciljna godina', 'Status', 'Aktivni učenici', 'Akcije']}
            rows={candidates.data.map((c) => [
              c.from_class_name,
              c.suggested_to_class_name ?? '-',
              c.to_school_year_label ?? '-',
              c.transition_status,
              c.active_student_count,
              <div className="row-actions" key={`${c.from_class_id}-actions`}>
                <button className="small-button" type="button" onClick={() => setTargetForm({ from_class_id: c.from_class_id, to_class_id: c.next_class_id ?? '' })}>Uredi cilj</button>
                <button className="small-button danger" type="button" onClick={() => clearTargetClass(c.from_class_id)} disabled={!c.next_class_id}>Ukloni cilj</button>
              </div>,
            ])}
          />
        </DataState>
      </Panel>
    </div>
  );
}

function EdnevnikSync() {
  const sync = useSupabaseQuery(() => supabase.from('v_ematica_sync_status').select('*').order('full_name'), []);
  const students = useSupabaseQuery(() => supabase.from('registry_students').select('id, first_name, last_name, email, ednevnik_student_id').order('last_name'), []);
  const profiles = useSupabaseQuery(() => supabase.from('user_profiles').select('*').order('email'), []);
  const classes = useSupabaseQuery(() => supabase.from('v_ematica_class_summary').select('*').order('class_name'), []);
  const [form, setForm] = useState({ registry_student_id: '', ednevnik_student_id: '' });
  const [pullForm, setPullForm] = useState({ class_id: '' });
  const [pullResults, setPullResults] = useState([]);
  const [message, setMessage] = useState('');

  const link = async (event) => {
    event.preventDefault();
    setMessage('');
    const { error } = await supabase.rpc('link_registry_student_to_ednevnik', {
      p_registry_student_id: form.registry_student_id,
      p_ednevnik_student_id: form.ednevnik_student_id,
    });

    setMessage(error ? error.message : 'Učenik je povezan s e-Dnevnikom.');
    if (!error) {
      setForm({ registry_student_id: '', ednevnik_student_id: '' });
      sync.reload();
      students.reload();
    }
  };

  const pullFromEdnevnik = async (event) => {
    event.preventDefault();
    setMessage('');
    const { data, error } = await supabase.rpc('sync_ednevnik_class_to_ematica', {
      p_class_id: pullForm.class_id,
    });

    const synced = data?.filter((row) => row.result === 'SYNCED').length ?? 0;
    const failed = (data?.length ?? 0) - synced;
    setPullResults(data ?? []);
    setMessage(error ? error.message : `Povlačenje iz e-Dnevnika je završeno. Sinkronizirano: ${synced}, greške: ${failed}.`);
    if (!error) {
      setPullForm({ class_id: '' });
      sync.reload();
      students.reload();
      classes.reload();
    }
  };

  return (
    <div className="stack">
      <Panel title="Povuci učenike iz e-Dnevnika u e-Maticu">
        <form className="inline-form compact" onSubmit={pullFromEdnevnik}>
          <select value={pullForm.class_id} onChange={(e) => setPullForm({ ...pullForm, class_id: e.target.value })} required>
            <option value="">e-Dnevnik razred</option>
            {classes.data.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.class_name} - {item.school_name ?? 'Škola nije upisana'}
              </option>
            ))}
          </select>
          <button className="primary" type="submit">
            <RefreshCw size={18} />
            <span>Povuci iz e-Dnevnika</span>
          </button>
        </form>
        <p className="notice">
          Ako učenik već postoji u e-Matici, povezat će se po e-Dnevnik ID-u, OIB-u ili e-mailu. Ako ne postoji, sustav će ga stvoriti i povezati s razredom.
        </p>
      </Panel>

      <Panel title="Poveži učenika s e-Dnevnikom">
        <form className="inline-form compact" onSubmit={link}>
          <select value={form.registry_student_id} onChange={(e) => setForm({ ...form, registry_student_id: e.target.value })} required>
            <option value="">e-Matica učenik</option>
            {students.data.map((student) => (
              <option key={student.id} value={student.id}>
                {student.first_name} {student.last_name} {student.ednevnik_student_id ? '(povezan)' : ''}
              </option>
            ))}
          </select>
          <select value={form.ednevnik_student_id} onChange={(e) => setForm({ ...form, ednevnik_student_id: e.target.value })} required>
            <option value="">e-Dnevnik profil</option>
            {profiles.data.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.email ?? profile.id}
              </option>
            ))}
          </select>
          <button className="primary" type="submit">
            <Database size={18} />
            <span>Poveži</span>
          </button>
        </form>
        {message && <p className="notice">{message}</p>}
        {pullResults.some((row) => row.result !== 'SYNCED') && (
          <div className="sync-errors">
            {pullResults
              .filter((row) => row.result !== 'SYNCED')
              .slice(0, 8)
              .map((row) => (
                <p key={row.ednevnik_student_id}>
                  <strong>{row.ednevnik_student_id}</strong>: {row.result}
                </p>
              ))}
          </div>
        )}
      </Panel>
      <Panel title="Povlačenje u e-Dnevnik" action={<ReloadButton onClick={sync.reload} loading={sync.loading} />}>
        <DataState state={sync}>
          <Table columns={['Učenik', 'Status', 'e-Dnevnik ID', 'Sync', 'Blokada unosa', 'Zadnja poruka']} rows={sync.data.map((s) => [s.full_name, <StatusBadge key={`${s.registry_student_id}-status`} value={s.student_status} />, s.ednevnik_student_id ?? '-', s.sync_state, s.ednevnik_data_entry_blocked ? 'Da' : 'Ne', s.last_sync_message ?? '-'])} />
        </DataState>
      </Panel>
    </div>
  );
}

function CrudLayout({ title, form, toolbar, children }) {
  return (
    <div className="stack">
      <Panel title={`Novi zapis: ${title}`}>{form}</Panel>
      <Panel title={title} action={toolbar}>{children}</Panel>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, tone = 'default' }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </div>
  );
}

function StatusBadge({ value }) {
  const label = STUDENT_STATUSES[value] ?? value ?? '-';
  const tone = String(value ?? '').toLowerCase();
  return <span className={`status-badge ${tone}`}>{label}</span>;
}

function SyncBadge({ value }) {
  const label = value ?? '-';
  const tone = String(value ?? '').toLowerCase();
  return <span className={`status-badge sync-${tone}`}>{label}</span>;
}

function ApplicationStatusBadge({ value }) {
  const labels = {
    DRAFT: 'Skica',
    SUBMITTED: 'Predano',
    VERIFIED: 'Provjereno',
    RETURNED: 'Vraćeno',
    ACCEPTED: 'Prihvaćeno',
    REJECTED: 'Odbijeno',
    WITHDRAWN: 'Povučeno',
  };
  const tone = String(value ?? '').toLowerCase();
  return <span className={`status-badge application-${tone}`}>{labels[value] ?? value ?? '-'}</span>;
}

function Table({ columns, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="empty">Nema podataka</td></tr>
          ) : rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? '-'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataState({ state, children }) {
  if (state.loading) return <div className="loading"><Loader2 className="spin" size={18} /> Učitavanje</div>;
  if (state.error) return <div className="error-row"><ShieldAlert size={18} /> {state.error}</div>;
  return children;
}

function ReloadButton({ onClick, loading }) {
  return (
    <button className="icon-button" type="button" onClick={onClick} disabled={loading} title="Osvježi">
      <RefreshCw className={loading ? 'spin' : ''} size={18} />
    </button>
  );
}

function ExportButton({ rows, filename, label = 'Izvezi' }) {
  return (
    <button className="icon-text" type="button" onClick={() => downloadCsv(filename, rows)} disabled={!rows?.length}>
      <Download size={18} />
      <span>{label}</span>
    </button>
  );
}

function SearchBox({ value, onChange }) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Pretraži" />
    </label>
  );
}

function Splash({ label }) {
  return <main className="auth-screen"><div className="loading"><Loader2 className="spin" size={20} /> {label}</div></main>;
}

function ConfigMissing() {
  return (
    <main className="auth-screen">
      <div className="auth-panel">
        <ShieldAlert size={34} />
        <h1>Nedostaje Supabase konfiguracija</h1>
        <p>Postavi `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY` u `.env` datoteci.</p>
      </div>
    </main>
  );
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('hr-HR').format(new Date(value)) : '-';
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat('hr-HR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-';
}

function buildCertificateFileName(summary) {
  const rawName = String(summary?.full_name ?? 'svjedodzba')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `svjedodzba-${rawName || 'ucenik'}.pdf`;
}

function extractGrades(summary) {
  if (Array.isArray(summary?.final_grades)) return summary.final_grades;
  if (typeof summary?.final_grades === 'string') {
    try {
      const parsed = JSON.parse(summary.final_grades);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getGradeSubjectLabel(grade, index = 0, subjectNameMap = {}) {
  const explicitName = typeof grade?.subject_name === 'string' ? grade.subject_name.trim() : '';
  if (explicitName) return explicitName;

  const fallbackName = typeof grade?.subject === 'string' ? grade.subject.trim() : '';
  if (fallbackName) return fallbackName;

  const mappedName = grade?.subject_id ? subjectNameMap?.[grade.subject_id] : '';
  if (mappedName) return mappedName;

  return `Predmet ${index + 1}`;
}

function enrichSummaryGradeNames(summary, subjectNameMap = {}) {
  return {
    ...summary,
    final_grades: extractGrades(summary).map((grade, index) => ({
      ...grade,
      subject_name: getGradeSubjectLabel(grade, index, subjectNameMap),
    })),
  };
}

async function buildCertificatePdf(summary) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 42;
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const kind = detectCertificateKind(summary);
  const palette = getCertificatePalette(kind, rgb);
  const lineColor = rgb(0.72, 0.75, 0.8);
  const textColor = rgb(0.14, 0.15, 0.18);
  const mutedColor = rgb(0.33, 0.35, 0.38);

  let y = height - margin;
  const drawText = (text, x, nextY, options = {}) => {
    page.drawText(String(text ?? ''), {
      x,
      y: nextY,
      size: options.size ?? 11,
      font: options.font ?? regular,
      color: options.color ?? textColor,
    });
  };
  const drawLine = (lineY) => {
    page.drawLine({
      start: { x: margin, y: lineY },
      end: { x: width - margin, y: lineY },
      thickness: 1,
      color: lineColor,
    });
  };
  const grades = extractGrades(summary);
  const details = normalizeCertificateDetails(summary);

  drawCertificateFrame(page, width, height, margin, palette, kind, rgb);

  drawCenteredText(page, 'REPUBLIKA HRVATSKA', width / 2, y - 6, bold, 9.5, mutedColor);
  y -= 24;
  drawLine(y);
  y -= 18;
  drawCenteredText(page, details.schoolName, width / 2, y, bold, 12.5, textColor);
  y -= 12;
  drawLine(y);
  y -= 26;

  drawText(`OIB škole: ${details.schoolOib}`, margin + 10, y, { size: 9.5 });
  drawText(details.leftReferenceLine, margin + 10, y - 16, { size: 9.5 });
  drawText(details.classaLine, width - margin - 130, y, { size: 9.5 });
  drawText(details.urbrojLine, width - margin - 130, y - 16, { size: 9.5 });
  y -= 54;

  drawCenteredText(page, details.documentTitle, width / 2, y, bold, 25, textColor);
  if (details.documentSubtitle) {
    y -= 28;
    drawCenteredText(page, details.documentSubtitle, width / 2, y, bold, 13, textColor);
  }
  y -= 40;

  drawCenteredText(page, details.studentName, width / 2, y, regular, 21, textColor);
  y -= 24;
  drawCenteredText(page, `OIB: ${details.studentOib}`, width / 2, y, regular, 10.5, textColor);
  if (details.genderText) {
    drawText(details.genderText, width - margin - 54, y, { size: 10.5 });
  }
  y -= 28;

  const narrativeLines = buildCertificateNarrative(details, kind);
  narrativeLines.forEach((line) => {
    drawText(line, margin + 10, y, { size: 9.8 });
    y -= 18;
  });
  y -= 8;

  if (kind === 'YEAR_END') {
    y = drawYearEndCertificateBody(page, drawText, drawLine, regular, bold, rgb, details, grades, width, margin, y, lineColor, palette);
  } else if (kind === 'FINAL_WORK') {
    y = drawFinalWorkCertificateBody(page, drawText, regular, bold, rgb, details, width, height, margin, y, palette);
  } else {
    y = drawExamConfirmationBody(page, drawText, regular, bold, details, grades, width, margin, y, lineColor);
  }

  y -= 10;
  drawCenteredText(page, `${details.cityText}, ${details.issueDateText}.`, width / 2, y, regular, 10.5, textColor);
  y -= 48;

  drawText(details.leftSignerRole, margin + 24, y, { size: 10.5 });
  drawText('Ravnatelj', width - margin - 110, y, { size: 10.5 });
  y -= 26;
  page.drawLine({ start: { x: margin + 10, y }, end: { x: margin + 150, y }, thickness: 1, color: lineColor });
  page.drawLine({ start: { x: width - margin - 150, y }, end: { x: width - margin - 10, y }, thickness: 1, color: lineColor });
  drawCircularStamp(page, width / 2, y + 6, palette.stamp, regular, bold, rgb);
  y -= 14;
  drawText(details.leftSignerName, margin + 26, y, { size: 9.8 });
  drawText(details.rightSignerName, width - margin - 140, y, { size: 9.8 });

  const footerLines = getCertificateFooterLines(kind);
  let footerY = 42;
  footerLines.forEach((line) => {
    drawText(line, margin + 6, footerY, { size: 6.8, color: mutedColor });
    footerY -= 9;
  });
  drawText(details.formCode, width - margin - 42, 28, { size: 7.2, color: mutedColor });

  return pdfDoc.save();
}

function detectCertificateKind(summary) {
  const payload = summary?.certificate_payload && typeof summary.certificate_payload === 'object' ? summary.certificate_payload : {};
  const explicitKind = String(payload.template_type ?? payload.document_type ?? '').toUpperCase();
  if (explicitKind === 'FINAL_WORK') return 'FINAL_WORK';
  if (explicitKind === 'EXAM_CONFIRMATION') return 'EXAM_CONFIRMATION';
  return 'YEAR_END';
}

function getCertificatePalette(kind, rgb) {
  if (kind === 'FINAL_WORK') {
    return {
      border: rgb(0.88, 0.72, 0.34),
      borderLight: rgb(0.95, 0.89, 0.66),
      watermark: rgb(0.95, 0.87, 0.66),
      stamp: rgb(0.21, 0.46, 0.82),
    };
  }
  if (kind === 'EXAM_CONFIRMATION') {
    return {
      border: rgb(0.78, 0.78, 0.8),
      borderLight: rgb(0.91, 0.91, 0.92),
      watermark: rgb(0.96, 0.96, 0.97),
      stamp: rgb(0.18, 0.52, 0.82),
    };
  }
  return {
    border: rgb(0.54, 0.84, 0.84),
    borderLight: rgb(0.83, 0.96, 0.96),
    watermark: rgb(0.84, 0.96, 0.96),
    stamp: rgb(0.22, 0.47, 0.84),
  };
}

function normalizeCertificateDetails(summary) {
  const payload = summary?.certificate_payload && typeof summary.certificate_payload === 'object' ? summary.certificate_payload : {};
  const gender = resolveStudentGender(summary, payload);
  return {
    schoolName: summary?.school_name ?? 'ŠKOLA NIJE UPISANA',
    schoolOib: summary?.school_oib ?? payload.school_oib ?? '________________',
    schoolYearLabel: summary?.school_year_label ?? '',
    studentName: summary?.full_name ?? 'Nepoznat učenik',
    studentOib: summary?.oib ?? '___________',
    dateOfBirth: summary?.date_of_birth ?? payload.date_of_birth ?? null,
    birthPlace: summary?.city ?? payload.birth_place ?? '________________',
    parentGuardianName: summary?.parent_guardian_name ?? payload.parent_guardian_name ?? '________________',
    className: summary?.class_name ?? '-',
    classLevelText: getClassLevelText(summary?.class_name ?? payload.class_name ?? summary?.grade_level),
    programName: payload.program_name ?? payload.qualification_name ?? 'programa obrazovanja',
    qualificationName: payload.qualification_name ?? payload.program_name ?? '',
    schoolNameCity: payload.school_city ?? summary?.city ?? 'Zagreb',
    finalSuccessText: summary?.final_success_text ?? payload.final_success_text ?? '-',
    finalAverage: summary?.final_grade_average ?? payload.final_average ?? '-',
    certificateNumber: summary?.certificate_number ?? '',
    issueDateText: formatDate(summary?.issued_at ?? new Date()),
    cityText: payload.issue_city ?? 'Zagreb',
    gender,
    genderText: getGenderDisplayText(gender),
    classaLine: `KLASA: ${payload.classa ?? '______________'}`,
    urbrojLine: `URBROJ: ${payload.urbroj ?? '______________'}`,
    leftReferenceLine: payload.student_registry_number ? `Matični broj učenika: ${payload.student_registry_number}` : `Školska godina: ${summary?.school_year_label ?? '-'}`,
    absencesLine: payload.absences_line ?? 'Ukupno izostanaka: 0 sati; od toga neopravdano: 0 sati',
    behaviorLine: payload.behavior_line ?? 'Vladanje: uzorno',
    leftSignerRole: payload.left_signer_role ?? 'Razrednik',
    leftSignerName: payload.left_signer_name ?? '',
    rightSignerName: payload.right_signer_name ?? '',
    finalWorkMadeGrade: payload.final_work_written_grade ?? 'odličan (5)',
    finalWorkDefenseGrade: payload.final_work_defense_grade ?? 'odličan (5)',
    examTypeLabel: payload.exam_type_label ?? 'Razlikovni ispit/Dopunski ispit',
    examPeriodLabel: payload.exam_period_label ?? '',
    examGradeLevelLabel: payload.exam_grade_level_label ?? '',
    documentTitle: payload.document_title ?? 'SVJEDODŽBA',
    documentSubtitle: payload.document_subtitle ?? '',
    formCode: payload.form_code ?? (detectCertificateKind(summary) === 'FINAL_WORK' ? 'Obrazac 6' : detectCertificateKind(summary) === 'EXAM_CONFIRMATION' ? 'Potvrda' : 'Obrazac 4'),
  };
}

function resolveStudentGender(summary, payload) {
  const raw = String(
    payload.gender ?? payload.sex ?? payload.spol ?? summary?.gender ?? summary?.sex ?? summary?.spol ?? ''
  ).trim().toUpperCase();
  const firstName = String(summary?.first_name ?? summary?.full_name?.split(' ')?.[0] ?? '').trim().toLowerCase();
  const femaleNames = ['ana', 'anita', 'ema', 'ksenija', 'marija', 'marijana', 'patricija', 'vanesa'];
  const isFemale = ['F', 'Z', 'Ž', 'ŽENSKO', 'ZENSKO', 'FEMALE'].includes(raw) || femaleNames.includes(firstName);
  const key = isFemale ? 'F' : 'M';
  return { key, display: key === 'F' ? 'Ž' : 'M', words: getGenderedCertificateWords(key) };
}

function getGenderDisplayText(gender) {
  return gender?.display ? `spol: ${gender.display}` : '';
}

function getGenderedCertificateWords(gender) {
  const key = typeof gender === 'string' ? gender : gender?.key;
  if (key === 'F') {
    return {
      student: 'Učenica',
      studentLower: 'učenica',
      born: 'rođena',
      enrolled: 'upisala',
      achieved: 'postigla',
      finished: 'završila',
      acquired: 'stekla',
    };
  }
  return {
    student: 'Učenik',
    studentLower: 'učenik',
    born: 'rođen',
    enrolled: 'upisao',
    achieved: 'postigao',
    finished: 'završio',
    acquired: 'stekao',
  };
}

function buildCertificateNarrative(details, kind) {
  const words = getGenderedCertificateWords(details.gender);
  if (kind === 'FINAL_WORK') {
    return [
      `${words.born} ${formatDate(details.dateOfBirth) || '____________'} godine u ${details.birthPlace}, Republika Hrvatska, državljanstvo Republike Hrvatske,`,
      `ime i prezime roditelja/skrbnika: ${details.parentGuardianName}. Nakon završenoga razreda ${words.studentLower} je ${words.acquired} uvjete`,
      `za obranu završnog rada i ${words.achieved} sljedeći uspjeh:`,
    ];
  }
  if (kind === 'EXAM_CONFIRMATION') {
    return [
      `${words.born} ${formatDate(details.dateOfBirth) || '____________'} godine u ${details.birthPlace}, Republika Hrvatska, državljanstvo hrvatsko`,
      `Vrsta ispita: ${details.examTypeLabel}`,
      `Razdoblje polaganja ispita: ${details.examPeriodLabel || '________________'}.`,
      `Naziv programa obrazovanja prema kojem se ispit polaže: ${details.programName}.`,
      `Razred za koji se ispit polaže: ${details.examGradeLevelLabel || '________________'}.`,
    ];
  }
  return [
    `${words.born} ${formatDate(details.dateOfBirth) || '____________'} godine u ${details.birthPlace}, Republika Hrvatska, državljanstvo Republike Hrvatske,`,
    `ime i prezime roditelja/skrbnika: ${details.parentGuardianName}, ${words.enrolled} je školske godine ${details.schoolYearLabel || '____________'}`,
    `razred programa obrazovanja ${details.programName} i ${words.achieved} sljedeći uspjeh:`,
  ];
}

function drawCertificateFrame(page, width, height, margin, palette, kind, rgb) {
  if (kind === 'EXAM_CONFIRMATION') {
    page.drawRectangle({
      x: margin - 18,
      y: margin - 12,
      width: width - (margin - 18) * 2,
      height: height - (margin - 12) * 2,
      borderColor: palette.borderLight,
      borderWidth: 1,
    });
    drawSimpleCoatOfArms(page, margin + 10, height - margin - 26, 28, rgb);
    return;
  }

  for (let i = 0; i < 3; i += 1) {
    page.drawRectangle({
      x: margin - 18 + i * 5,
      y: margin - 12 + i * 5,
      width: width - (margin - 18) * 2 - i * 10,
      height: height - (margin - 12) * 2 - i * 10,
      borderColor: i % 2 === 0 ? palette.border : palette.borderLight,
      borderWidth: 1.4,
    });
  }

  if (kind === 'FINAL_WORK') {
    drawShieldWatermark(page, width / 2, height / 2 - 40, 140, palette.watermark, rgb);
  } else {
    drawSoftGridWatermark(page, width / 2, height / 2 - 20, 240, 210, palette.watermark, rgb);
  }
}

function drawYearEndCertificateBody(page, drawText, drawLine, regular, bold, rgb, details, grades, width, margin, y, lineColor, palette) {
  const leftX = margin + 12;
  const tableTop = y;
  const tableHeight = 292;
  const tableWidth = width - margin * 2 - 8;
  const splitX = leftX + tableWidth * 0.49;

  page.drawRectangle({ x: leftX, y: tableTop - tableHeight, width: tableWidth, height: tableHeight, borderColor: lineColor, borderWidth: 1 });
  page.drawLine({ start: { x: splitX, y: tableTop }, end: { x: splitX, y: tableTop - tableHeight }, thickness: 1, color: lineColor });
  drawText('Obvezni predmeti', leftX + 8, tableTop - 18, { size: 10, font: bold });

  let currentY = tableTop - 42;
  grades.slice(0, 13).forEach((grade, index) => {
    drawLeaderLine(page, leftX + 8, splitX - 14, currentY + 3, rgb(0.45, 0.45, 0.48));
    page.drawRectangle({ x: splitX + 8, y: currentY - 9, width: tableWidth - (splitX - leftX) - 16, height: 1, color: rgb(0.95, 0.97, 0.98) });
    drawText(getGradeSubjectLabel(grade, index), leftX + 8, currentY, { size: 9.6, font: regular });
    drawText(toCroatianGradeLabel(grade.value ?? grade.grade ?? '-'), splitX - 96, currentY, { size: 9.6, font: regular });
    currentY -= 20;
  });

  y = tableTop - tableHeight - 18;
  drawText(details.absencesLine, margin + 10, y, { size: 10 });
  drawText(details.behaviorLine, width - margin - 120, y, { size: 10, font: bold });
  y -= 22;
  drawCenteredText(page, `${details.gender.words.student} je s ${String(details.finalSuccessText).toLowerCase()} (${details.finalAverage}) uspjehom ${details.gender.words.finished} ${details.classLevelText}.`, width / 2, y, bold, 10.5, rgb(0.16, 0.16, 0.18));
  return y - 12;
}

function drawFinalWorkCertificateBody(page, drawText, regular, bold, rgb, details, width, height, margin, y, palette) {
  drawText(`Izrada zavr?nog rada........................ ${details.finalWorkMadeGrade}`, width / 2 - 86, y - 12, { size: 10.6, font: bold });
  drawText(`Obrana zavr?nog rada....................... ${details.finalWorkDefenseGrade}`, width / 2 - 86, y - 48, { size: 10.6, font: bold });
  drawCenteredText(page, 'OP?I USPJEH', width / 2, y - 96, bold, 17, rgb(0.28, 0.24, 0.18));
  drawCenteredText(page, String(details.finalSuccessText).toLowerCase(), width / 2, y - 126, bold, 15, rgb(0.28, 0.24, 0.18));
  drawCenteredText(page, `${details.gender.words.student} je ${details.gender.words.acquired} zanimanje/kvalifikaciju`, width / 2, y - 168, regular, 10.4, rgb(0.28, 0.24, 0.18));
  drawCenteredText(page, details.qualificationName || details.programName, width / 2, y - 198, bold, 15, rgb(0.28, 0.24, 0.18));
  return y - 222;
}

function drawExamConfirmationBody(page, drawText, regular, bold, details, grades, width, margin, y, lineColor) {
  const leftX = margin + 6;
  let currentY = y;
  grades.slice(0, 10).forEach((grade, index) => {
    drawLeaderLine(page, leftX + 6, width - margin - 26, currentY + 3, lineColor);
    const examKind = grade.term ?? grade.period ?? details.examTypeLabel;
    const examDate = grade.date ? formatDate(grade.date) : '';
    drawText(`${getGradeSubjectLabel(grade, index)}${grade.note ? ` (${grade.note})` : ''}`, leftX + 6, currentY, { size: 9.6, font: regular });
    drawText(toCroatianGradeLabel(grade.value ?? grade.grade ?? '-'), width - margin - 170, currentY, { size: 9.6, font: regular });
    drawText(`${examKind}${examDate ? `............. ${examDate}.` : ''}`, width - margin - 112, currentY, { size: 9.2, font: regular });
    currentY -= 20;
  });
  page.drawLine({ start: { x: leftX + 6, y: currentY - 8 }, end: { x: width - margin - 12, y: currentY - 8 }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  return currentY - 26;
}

function drawLeaderLine(page, x1, x2, y, color) {
  for (let x = x1; x < x2; x += 5) {
    page.drawLine({
      start: { x, y },
      end: { x: Math.min(x + 2, x2), y },
      thickness: 0.8,
      color,
    });
  }
}

function drawCenteredText(page, text, centerX, y, font, size, color) {
  const safeText = String(text ?? '');
  const textWidth = font.widthOfTextAtSize(safeText, size);
  page.drawText(safeText, { x: centerX - textWidth / 2, y, size, font, color });
}

function drawSoftGridWatermark(page, centerX, centerY, width, height, color, rgb) {
  page.drawRectangle({ x: centerX - width / 2, y: centerY - height / 2, width, height, color, opacity: 0.1 });
  for (let i = 0; i < 4; i += 1) {
    page.drawLine({
      start: { x: centerX - width / 2 + i * (width / 4), y: centerY - height / 2 },
      end: { x: centerX - width / 2 + i * (width / 4), y: centerY + height / 2 },
      thickness: 1,
      color: rgb(0.78, 0.93, 0.93),
      opacity: 0.15,
    });
  }
}

function drawShieldWatermark(page, centerX, centerY, size, color, rgb) {
  page.drawEllipse({ x: centerX, y: centerY, xScale: size * 0.9, yScale: size, color, opacity: 0.08 });
  page.drawRectangle({ x: centerX - 54, y: centerY - 74, width: 108, height: 138, color: rgb(0.96, 0.9, 0.72), opacity: 0.12 });
}

function drawSimpleCoatOfArms(page, x, y, size, rgb) {
  page.drawRectangle({ x, y, width: size, height: size * 1.25, borderColor: rgb(0.65, 0.15, 0.18), borderWidth: 1 });
  const cell = size / 4;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      page.drawRectangle({
        x: x + col * cell,
        y: y + 8 + row * cell,
        width: cell,
        height: cell,
        color: (row + col) % 2 === 0 ? rgb(0.8, 0.14, 0.18) : rgb(1, 1, 1),
      });
    }
  }
}

function drawCircularStamp(page, centerX, centerY, color, regular, bold, rgb) {
  page.drawEllipse({ x: centerX, y: centerY, xScale: 42, yScale: 42, borderColor: color, borderWidth: 1.6, opacity: 0.7 });
  page.drawEllipse({ x: centerX, y: centerY, xScale: 31, yScale: 31, borderColor: color, borderWidth: 1, opacity: 0.5 });
  drawCenteredText(page, 'M. P.', centerX, centerY - 4, bold, 12, rgb(0.18, 0.37, 0.73));
}

function getCertificateFooterLines(kind) {
  if (kind === 'FINAL_WORK') {
    return [
      '*Spol: muški (M), ženski (Ž).',
      '*Ocjena iz nastavnog predmeta: odličan (5), vrlo dobar (4), dobar (3), dovoljan (2).',
      '*Ocjena općeg uspjeha: odličan, vrlo dobar, dobar, dovoljan, nedovoljan.',
    ];
  }
  if (kind === 'EXAM_CONFIRMATION') {
    return [
      '*Dio sadržaja nastavnog predmeta pohađan je, osim na hrvatskom jeziku, na jednom od svjetskih jezika.',
      '*Ocjena iz nastavnog predmeta: odličan (5), vrlo dobar (4), dobar (3), dovoljan (2).',
    ];
  }
  return [
    '*Spol: muški (M), ženski (Ž).',
    '*Ocjena iz nastavnog predmeta: odličan (5), vrlo dobar (4), dobar (3), dovoljan (2), nedovoljan (1).',
    '*Ocjena općeg uspjeha: odličan, vrlo dobar, dobar, dovoljan, nedovoljan.',
    '*Ocjena iz vladanja: uzorno, dobro, loše.',
  ];
}

function toCroatianGradeLabel(value) {
  const normalized = String(value ?? '').trim();
  if (normalized === '5' || /odli/i.test(normalized)) return 'odličan (5)';
  if (normalized === '4' || /vrlo/i.test(normalized)) return 'vrlo dobar (4)';
  if (normalized === '3' || /dobar/i.test(normalized)) return 'dobar (3)';
  if (normalized === '2' || /dovolj/i.test(normalized)) return 'dovoljan (2)';
  if (normalized === '1' || /nedovolj/i.test(normalized)) return 'nedovoljan (1)';
  return normalized || '-';
}

function getClassLevelText(value) {
  const match = String(value ?? '').match(/\d+/);
  const level = match ? Number(match[0]) : null;
  const labels = {
    1: 'prvi razred',
    2: 'drugi razred',
    3: 'treći razred',
    4: 'četvrti razred',
    5: 'peti razred',
    6: 'šesti razred',
    7: 'sedmi razred',
    8: 'osmi razred',
  };

  return labels[level] ?? 'razred';
}

async function downloadBinaryFile(filename, bytes, mimeType, mode = 'download', targetWindow = null) {
  const dataUrl = await bytesToDataUrl(bytes, mimeType);

  if (mode === 'open') {
    if (!targetWindow || targetWindow.closed) {
      throw new Error('Prozor za ispis nije otvoren. Dopusti otvaranje skočnog prozora i pokušaj ponovno.');
    }

    targetWindow.document.open();
    targetWindow.document.write(`<!doctype html>
<html lang="hr">
  <head>
    <meta charset="utf-8" />
    <title>${filename}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #6b7280; }
      iframe { border: 0; width: 100%; height: 100%; background: white; }
    </style>
  </head>
  <body>
    <iframe id="pdfFrame" src="${dataUrl}"></iframe>
    <script>
      const frame = document.getElementById('pdfFrame');
      frame.addEventListener('load', () => {
        setTimeout(() => {
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          } catch {}
        }, 400);
      });
    </script>
  </body>
</html>`);
    targetWindow.document.close();
    return;
  }

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadTextFile(filename, text, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bytesToDataUrl(bytes, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Pretvorba PDF-a nije uspjela.'));
    reader.readAsDataURL(new Blob([bytes], { type: mimeType }));
  });
}

function formatSignerName(value) {
  const text = String(value ?? '').trim();
  if (!text || /^_+$/.test(text)) return '&nbsp;';
  return escapeHtml(text);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCertificateHtmlDocument(summary) {
  const details = normalizeCertificateDetails(summary);
  const grades = extractGrades(summary);
  const kind = detectCertificateKind(summary);
  const title = escapeHtml(`${details.documentTitle}${details.documentSubtitle ? ` - ${details.documentSubtitle}` : ''}`);
  const narrative = buildCertificateNarrative(details, kind)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
  const rows = grades.length
    ? grades.map((grade, index) => `
        <tr>
          <td>${escapeHtml(getGradeSubjectLabel(grade, index))}</td>
          <td>${escapeHtml(toCroatianGradeLabel(grade.value ?? grade.grade ?? '-'))}</td>
          <td>${escapeHtml(grade.term ?? grade.period ?? '-')}</td>
          <td>${escapeHtml(grade.note ?? '-')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">Zaključne ocjene nisu upisane u dostupnim podacima.</td></tr>';

  return `<!doctype html>
<html lang="hr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; background: #e5e7eb; font-family: Arial, Helvetica, sans-serif; color: #15171a; }
      .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: white; padding: 18mm 16mm; box-sizing: border-box; }
      .header, .school, .title, .subtitle, .name, .oib, .footer { text-align: center; }
      .header { font-size: 12pt; letter-spacing: .04em; margin-bottom: 8mm; }
      .rule { border-top: 1px solid #666; margin-bottom: 5mm; }
      .school { font-size: 14pt; font-weight: 700; margin-bottom: 5mm; }
      .meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 3mm; font-size: 10pt; }
      .title { font-size: 24pt; font-weight: 700; letter-spacing: .18em; margin-top: 9mm; }
      .subtitle { font-size: 16pt; font-weight: 700; margin-top: 3mm; }
      .name { font-size: 22pt; margin-top: 12mm; }
      .oib { font-size: 12pt; margin-top: 4mm; }
      .paragraphs { margin-top: 8mm; }
      .paragraphs p { margin: 0 0 3mm; line-height: 1.45; }
      table { width: 100%; border-collapse: collapse; margin-top: 7mm; font-size: 10pt; }
      th, td { border: 1px solid #c9ced6; padding: 2.5mm 2mm; text-align: left; vertical-align: top; }
      th { background: #f3f5f8; font-weight: 700; }
      .footer { margin-top: 12mm; font-size: 12pt; }
      .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 16mm; }
      .signatures div { display: grid; gap: 9mm; text-align: center; }
      .signatures strong { border-top: 1px solid #444; padding-top: 2mm; font-weight: 500; min-height: 7mm; }
      @page { size: A4; margin: 0; }
      @media print {
        body { background: white; }
        .page { margin: 0; }
      }
    </style>
  </head>
  <body>
    <section class="page">
      <div class="header">REPUBLIKA HRVATSKA</div>
      <div class="rule"></div>
      <div class="school">${escapeHtml(details.schoolName)}</div>
      <div class="meta">
        <span>OIB škole: ${escapeHtml(details.schoolOib)}</span>
        <span>${escapeHtml(details.classaLine)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(details.leftReferenceLine)}</span>
        <span>${escapeHtml(details.urbrojLine)}</span>
      </div>
      <div class="title">${escapeHtml(details.documentTitle)}</div>
      ${details.documentSubtitle ? `<div class="subtitle">${escapeHtml(details.documentSubtitle)}</div>` : ''}
      <div class="name">${escapeHtml(details.studentName)}</div>
      <div class="oib">OIB: ${escapeHtml(details.studentOib)}</div>
      <div class="paragraphs">${narrative}</div>
      <table>
        <thead>
          <tr>
            <th>Predmet</th>
            <th>Ocjena</th>
            <th>Razdoblje</th>
            <th>Napomena</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">${escapeHtml(`${details.cityText}, ${details.issueDateText}.`)}</div>
      <div class="signatures">
        <div>
          <span>${escapeHtml(details.leftSignerRole)}</span>
          <strong>${formatSignerName(details.leftSignerName)}</strong>
        </div>
        <div>
          <span>Ravnatelj</span>
          <strong>${formatSignerName(details.rightSignerName)}</strong>
        </div>
      </div>
    </section>
  </body>
</html>`;
}

function CertificatePrintSurface({ summary }) {
  const details = normalizeCertificateDetails(summary);
  const grades = extractGrades(summary);
  const kind = detectCertificateKind(summary);
  const mandatoryGrades = grades.slice(0, 12);
  const electiveGrades = grades.slice(12);

  return (
    <section className="print-certificate">
      <div className="print-certificate__header">REPUBLIKA HRVATSKA</div>
      <div className="print-certificate__rule" />
      <div className="print-certificate__school">{details.schoolName}</div>
      <div className="print-certificate__meta">
        <span>OIB škole: {details.schoolOib}</span>
        <span>{details.classaLine}</span>
      </div>
      <div className="print-certificate__meta">
        <span>{details.leftReferenceLine}</span>
        <span>{details.urbrojLine}</span>
      </div>
      <div className="print-certificate__title">{details.documentTitle}</div>
      {details.documentSubtitle && <div className="print-certificate__subtitle">{details.documentSubtitle}</div>}
      <div className="print-certificate__name">{details.studentName}</div>
      <div className="print-certificate__oib">OIB: {details.studentOib}</div>
      <div className="print-certificate__paragraphs">
        {buildCertificateNarrative(details, kind).map((line) => <p key={line}>{line}</p>)}
      </div>

      {kind === 'YEAR_END' && (
        <>
          <div className="print-certificate__grade-box">
            <div className="print-certificate__grade-columns">
              <div className="print-certificate__grade-column">
                <div className="print-certificate__grade-heading">Obvezni predmeti</div>
                {(mandatoryGrades.length ? mandatoryGrades : grades).map((grade, index) => (
                  <div key={`${getGradeSubjectLabel(grade, index)}-${index}`} className="print-certificate__grade-row">
                    <span>{getGradeSubjectLabel(grade, index)}</span>
                    <span className="print-certificate__grade-dots" />
                    <span>{toCroatianGradeLabel(grade.value ?? grade.grade ?? '-')}</span>
                  </div>
                ))}

                {!!electiveGrades.length && (
                  <>
                    <div className="print-certificate__grade-heading print-certificate__grade-heading--elective">Izborni predmeti</div>
                    {electiveGrades.map((grade, index) => (
                      <div key={`${getGradeSubjectLabel(grade, index + mandatoryGrades.length)}-elective-${index}`} className="print-certificate__grade-row">
                        <span>{getGradeSubjectLabel(grade, index + mandatoryGrades.length)}</span>
                        <span className="print-certificate__grade-dots" />
                        <span>{toCroatianGradeLabel(grade.value ?? grade.grade ?? '-')}</span>
                      </div>
                    ))}
                  </>
                )}

                {!grades.length && (
                  <div className="print-certificate__grade-empty">Zaključne ocjene nisu upisane u dostupnim podacima.</div>
                )}
              </div>
              <div className="print-certificate__grade-column print-certificate__grade-column--blank" />
            </div>
          </div>

          <div className="print-certificate__summary">
            <div>{details.absencesLine}</div>
            <div>{details.behaviorLine}</div>
          </div>
          <div className="print-certificate__success">
            {details.gender.words.student} je s <strong>{String(details.finalSuccessText).toLowerCase()} ({details.finalAverage})</strong> uspjehom {details.gender.words.finished} {details.classLevelText}.
          </div>
        </>
      )}

      {kind === 'FINAL_WORK' && (
        <div className="print-certificate__final-work">
          <div className="print-certificate__final-work-row">
            <span>Izrada zavr?nog rada</span>
            <span className="print-certificate__grade-dots" />
            <strong>{details.finalWorkMadeGrade}</strong>
          </div>
          <div className="print-certificate__final-work-row">
            <span>Obrana zavr?nog rada</span>
            <span className="print-certificate__grade-dots" />
            <strong>{details.finalWorkDefenseGrade}</strong>
          </div>
          <div className="print-certificate__final-work-success">OP?I USPJEH</div>
          <div className="print-certificate__final-work-score">{String(details.finalSuccessText).toLowerCase()}</div>
          <div className="print-certificate__final-work-caption">{details.gender.words.student} je {details.gender.words.acquired} zanimanje/kvalifikaciju</div>
          <div className="print-certificate__final-work-qualification">{details.qualificationName || details.programName}</div>
        </div>
      )}

      {kind === 'EXAM_CONFIRMATION' && (
        <div className="print-certificate__exam-list">
          {grades.length ? grades.map((grade, index) => (
            <div key={`${getGradeSubjectLabel(grade, index)}-exam-${index}`} className="print-certificate__exam-row">
              <span>{getGradeSubjectLabel(grade, index)}</span>
              <span className="print-certificate__grade-dots" />
              <span>{toCroatianGradeLabel(grade.value ?? grade.grade ?? '-')}</span>
              <span>{grade.note ?? grade.exam_type ?? '-'}</span>
              <span>{grade.term ?? grade.period ?? '-'}</span>
            </div>
          )) : (
            <div className="print-certificate__grade-empty">Podaci o ispitima nisu upisani u dostupnim podacima.</div>
          )}
        </div>
      )}

      <div className="print-certificate__footer">{details.cityText}, {details.issueDateText}.</div>
      <div className="print-certificate__signatures">
        <div>
          <span>{details.leftSignerRole}</span>
          <strong>{details.leftSignerName}</strong>
        </div>
        <div>
          <span>Ravnatelj</span>
          <strong>{details.rightSignerName}</strong>
        </div>
      </div>
    </section>
  );
}

function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const columns = Object.keys(rows[0]);
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replaceAll('"', '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

function getProfileDisplayName(profile) {
  const first = profile.first_name ?? profile.given_name ?? '';
  const last = profile.last_name ?? profile.family_name ?? '';
  const full = profile.full_name ?? profile.name ?? [first, last].filter(Boolean).join(' ');
  if (full) return full;
  const localPart = String(profile.email ?? profile.id ?? '').split('@')[0];
  const parts = localPart.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return `${capitalize(parts.at(-1))}, ${parts.slice(0, -1).map(capitalize).join(' ')}`;
  return profile.email ?? profile.id ?? '-';
}

function compareProfilesByLastName(a, b) {
  return profileSortKey(a).localeCompare(profileSortKey(b), 'hr');
}

function profileSortKey(profile) {
  const last = profile.last_name ?? profile.family_name;
  const first = profile.first_name ?? profile.given_name;
  if (last || first) return `${last ?? ''} ${first ?? ''}`.trim().toLowerCase();
  const localPart = String(profile.email ?? profile.id ?? '').split('@')[0];
  const parts = localPart.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`.toLowerCase();
  return localPart.toLowerCase();
}

function capitalize(value) {
  const text = String(value ?? '');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : '';
}

function formatSchoolLevel(value) {
  if (value === 'ELEMENTARY') return 'Osnovna škola';
  if (value === 'SECONDARY') return 'Srednja škola';
  if (value === 'HIGHER') return 'Fakultet/visoko učilište';
  if (value === 'OTHER') return 'Ostalo';
  return 'Nije postavljeno';
}

function getInitials(value) {
  return String(value ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

export default App;

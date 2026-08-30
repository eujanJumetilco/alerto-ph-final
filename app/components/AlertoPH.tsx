"use client";

import React, { useState, createContext, useContext, useMemo, useEffect, useRef, useCallback } from "react";
import { useUserStore } from "@/store/useUserStore";
import { useReportStore } from "@/store/useReportStore";

import {
  Shield, FileText, Clock, CheckCircle2, Bell, Menu, Plus, Filter,
  MoreVertical, ChevronLeft, Sparkles, Calendar, MapPin, Image as ImageIcon,
  Lock, Copy, Home, PlusSquare, User, Ghost, Footprints, Wallet,
  Check, Landmark, ShieldOff, Siren, Flame, AlertTriangle,
  TrendingUp, Baby, HeartHandshake, Fuel, Scissors, Phone, Mail
} from "lucide-react";

/* =========================================================================
   Categories & Statuses
   ========================================================================= */
const CATEGORY: Record<string, { icon: React.ElementType; bg: string; fg: string }> = {
  crime:              { icon: Footprints,     bg: "bg-red-50",     fg: "text-red-500"    },
  redtape:            { icon: Scissors,       bg: "bg-slate-50",   fg: "text-slate-500"  },
  scam:               { icon: Ghost,          bg: "bg-purple-50",  fg: "text-purple-600" },
  childabuse:         { icon: Baby,           bg: "bg-amber-50",   fg: "text-amber-600"  },
  womenabuse:         { icon: HeartHandshake, bg: "bg-pink-50",    fg: "text-pink-600"   },
  overpricing:        { icon: TrendingUp,     bg: "bg-orange-50",  fg: "text-orange-600" },
  fire:               { icon: Flame,          bg: "bg-red-50",     fg: "text-red-600"    },
  accident:           { icon: Siren,          bg: "bg-yellow-50",  fg: "text-yellow-600" },
  gasstationconcerns: { icon: Fuel,           bg: "bg-green-50",   fg: "text-green-600"  },
  other:              { icon: AlertTriangle,  bg: "bg-gray-50",    fg: "text-gray-500"   },
};

const STATUS: Record<string, { bg: string; fg: string }> = {
  "Under Review":  { bg: "bg-orange-50", fg: "text-orange-600" },
  Assigned:        { bg: "bg-blue-50",   fg: "text-blue-600"   },
  "Action Needed": { bg: "bg-red-50",    fg: "text-red-600"    },
  Resolved:        { bg: "bg-green-50",  fg: "text-green-600"  },
  Pending:         { bg: "bg-gray-50",   fg: "text-gray-500"   },
};

/* =========================================================================
   Types
   ========================================================================= */
interface Report {
  id: string;
  referenceNumber: string;
  title: string;
  category: string;
  typeLabel: string;
  handler: string;
  summary: string;
  timeStamp: number;
  status: string;
  description: string;
  location: string;
  images: string[];
}

interface ReportDraft {
  title: string;
  category: string;
  typeLabel: string;
  description: string;
  date: string;
  time: string;
  location: string;
  images: string[];
}

interface Stats {
  total: number;
  underReview: number;
  resolved: number;
}

interface ReportsContextValue {
  reports: Report[];
  stats: Stats;
  isLoadingReports: boolean;
  addReport: (draft: ReportDraft) => Promise<Report>;
  getReportById: (id: string) => Report | null;
  refreshReports: () => Promise<void>;
  lastCreatedId: string | null;
}

/* =========================================================================
   Reports Context
   ========================================================================= */
const ReportsContext = createContext<ReportsContextValue | null>(null);

function ReportsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUserStore();
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  // Normalize a raw DB document into the client Report shape
  function normalizeDbReport(r: any): Report {
    return {
      id: r._id?.toString() ?? r.id,
      referenceNumber: r.caseNumber,
      title: r.title ?? r.summary?.slice(0, 60), // use summary as title if no dedicated title field
      category: r.category?.toLowerCase().replace(/\s+/g, "") ?? "other",
      typeLabel: r.category ?? "Other",
      handler: r.handler ?? "Unassigned",
      summary: r.summary ?? "",
      timeStamp: r.timestamp ?? new Date(r.createdAt).getTime(),
      status: r.status ?? "Pending",
      description: r.description ?? "",
      location: r.location ?? "",
      images: r.images ?? [],
    };
  }

  // Fetch all reports for the current user from the DB
  const refreshReports = useCallback(async () => {
    if (!user?._id) return;
    setIsLoadingReports(true);
    try {
      const res = await fetch(`/api/egov?reporterId=${user._id}`);
      if (!res.ok) throw new Error(`Failed to fetch reports: ${res.status}`);
      const data = await res.json();
      setReports((data.reports ?? []).map(normalizeDbReport));
    } catch (err) {
      console.error("refreshReports error:", err);
    } finally {
      setIsLoadingReports(false);
    }
  }, [user?._id]);

  // Load reports whenever the logged-in user changes
  useEffect(() => {
    refreshReports();
  }, [refreshReports]);

  const stats = useMemo<Stats>(
    () => ({
      total: reports.length,
      underReview: reports.filter((r) => r.status === "Under Review").length,
      resolved: reports.filter((r) => r.status === "Resolved").length,
    }),
    [reports]
  );

  async function addReport(draft: ReportDraft): Promise<Report> {
    const res = await fetch("/api/egov", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "analyze",
        description: draft.description,
        location: draft.location,
        images: draft.images,
        reporterId: user!._id,   // passed from Zustand store
      }),
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    const scannedDescription = await res.json();

    // Optimistically add to local state so the UI updates immediately
    const newReport: Report = {
      id: `optimistic-${Date.now()}`,    // temp id; replaced on next refreshReports()
      referenceNumber: scannedDescription.caseNumber,
      title: scannedDescription.title,
      category: scannedDescription.reportType.toLowerCase().replace(/\s+/g, ""),
      typeLabel: scannedDescription.reportType,
      handler: scannedDescription.assignedAgency,
      summary: scannedDescription.summary,
      timeStamp: Date.now(),
      status: "Pending",
      description: draft.description,
      location: draft.location,
      images: draft.images ?? [],
    };

    useReportStore.getState().setReport({
      id: newReport.id,
      title: newReport.title,
      referenceNumber: newReport.referenceNumber,
    });

    setReports((prev) => [newReport, ...prev]);
    setLastCreatedId(newReport.id);

    // Sync with the DB in the background so real _id replaces the optimistic one
    refreshReports();

    return newReport;
  }

  function getReportById(id: string): Report | null {
    return reports.find((r) => r.id === id) || null;
  }

  const value: ReportsContextValue = {
    reports,
    stats,
    isLoadingReports,
    addReport,
    getReportById,
    refreshReports,
    lastCreatedId,
  };

  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

function useReports(): ReportsContextValue {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error("useReports must be used within ReportsProvider");
  return ctx;
}

/* =========================================================================
   UI Components
   ========================================================================= */
function StatCard({
  icon: Icon, iconBg, iconFg, value, label,
}: {
  icon: React.ElementType; iconBg: string; iconFg: string; value: number; label: string;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-gray-100 bg-gray-50 p-4 flex flex-col gap-3">
      <div className={`w-9 h-9 rounded-full ${iconBg} flex items-center justify-center`}>
        <Icon size={18} className={iconFg} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS[status] || STATUS["Under Review"];
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.fg} whitespace-nowrap`}>
      {status.toUpperCase()}
    </span>
  );
}

function ReportCard({ report, onOpen }: { report: Report; onOpen: (id: string) => void }) {
  const cat = CATEGORY[report.category] || CATEGORY.other;
  const Icon = cat.icon;
  return (
    <button
      onClick={() => onOpen(report.id)}
      className="w-full text-left flex items-start gap-3 py-4 border-b border-gray-100 last:border-b-0"
    >
      <div className={`w-11 h-11 rounded-full ${cat.bg} flex items-center justify-center shrink-0`}>
        <Icon size={20} className={cat.fg} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 text-sm leading-snug">{report.title}</p>
          <StatusBadge status={report.status} />
        </div>
        <p className="text-xs text-gray-500 mt-1">{report.typeLabel} • {report.handler}</p>
        <p className="text-xs text-gray-400 mt-0.5">{new Date(report.timeStamp).toLocaleString()}</p>
      </div>
    </button>
  );
}

function BottomNav({ current, onNavigate }: { current: string; onNavigate: (key: string) => void }) {
  const items = [
    { key: "dashboard", label: "Dashboard", icon: Home },
    { key: "create",    label: "New Report", icon: PlusSquare },
    { key: "updates",   label: "Updates",    icon: Bell },
    { key: "profile",   label: "Profile",    icon: User },
  ];
  return (
    <div className="border-t border-gray-100 bg-white px-2 pt-2 pb-3 flex items-center justify-between">
      {items.map(({ key, label, icon: Icon }) => {
        const active = current === key;
        return (
          <button
            key={key}
            onClick={() => onNavigate(key)}
            className="flex-1 flex flex-col items-center gap-1"
          >
            <Icon size={20} className={active ? "text-blue-700" : "text-gray-400"} />
            <span className={`text-[10px] font-medium ${active ? "text-blue-700" : "text-gray-400"}`}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-3">
      <button onClick={onMenu}>
        <Menu size={20} className="text-gray-700" />
      </button>
      <div className="flex items-center gap-1.5">
        <img src="/icon.png" alt="AlertoPH" className="w-[23px] h-[23px] object-contain" />
        <span className="font-bold text-blue-700 text-lg">AlertoPH</span>
      </div>
      <Bell size={20} className="text-gray-700" />
    </div>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-5 pb-4">
      <button onClick={onBack}>
        <ChevronLeft size={22} className="text-blue-700" />
      </button>
      <h1 className="text-lg font-bold text-blue-700">{title}</h1>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-blue-600">{icon}</div>
      <div className="flex flex-col">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
        <span className="text-sm text-gray-800 font-medium leading-snug mt-0.5">{value}</span>
      </div>
    </div>
  );
}

/* =========================================================================
   Sign In Screen
   ========================================================================= */
function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  const { setUser } = useUserStore();

  useEffect(() => {
    const isProduction = true; // process.env.NODE_ENV === "production";

    if (isProduction) {
      const authenticate = async () => {
        // action: "sso" → runs SSO auth + DB upsert, returns user data
        const res = await fetch("/api/egov", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sso" }),
        });

        if (!res.ok) throw new Error(`SSO API error: ${res.status}`);

        const userData = await res.json();

        // Persist user in Zustand (survives across screens via localStorage)
        setUser({
          _id: userData._id,
          name: userData.name,
          mobile: userData.mobile,
          email: userData.email,
          address: userData.address,
          photo: userData.photo,
        });

        onSignIn();
      };

      authenticate().catch((err) => console.error("SSO Authentication failed:", err));
    } else {
      // Dev mode: seed a mock user into the store so the UI has data
      setUser({
        _id: "dev-user-id",
        name: "PEDRO DELA CRUZ II",
        mobile: "+639090000002",
        email: "josie02@yopmail.com",
        address: "#100 UGO, DOÑA IMELDA, QUEZON CITY, METRO MANILA, PHILIPPINES",
        photo: "https://staging-files.oueg.info/staging/9e2be7e4-eafa-4f13-8cbd-a979d98c5b4a.jpg",
      });

      const timer = setTimeout(() => onSignIn(), 1000);
      return () => clearTimeout(timer);
    }
  }, [onSignIn, setUser]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center bg-white">
      <div className="flex flex-col items-center">
        <div className="w-24 h-24 rounded-2xl bg-white flex items-center justify-center shadow-md">
          <img src="/icon.png" alt="AlertoPH" className="w-[80px] h-[80px] object-contain" />
        </div>
        <h1 className="text-2xl font-bold text-blue-700 mt-5">AlertoPH</h1>
        <p className="text-gray-400 text-sm mt-1 mb-8">Report. Help. Protect.</p>
      </div>
      <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-700 rounded-full animate-spin mt-4"></div>
    </div>
  );
}

/* =========================================================================
   Analyzing Screen
   ========================================================================= */
function AnalyzingScreen() {
  const steps = [
    "Reading your report...",
    "Identifying incident type...",
    "Routing to the right agency...",
    "Generating case number...",
  ];
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center bg-white">
      <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-6">
        <Sparkles size={36} className="text-blue-600 animate-pulse" />
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-2">Analyzing your report</h2>
      <p className="text-sm text-gray-400 mb-8">Our AI is reviewing your submission...</p>

      <div className="w-full space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-500 ${
              i <= stepIndex ? "bg-blue-50" : "bg-gray-50 opacity-40"
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                i < stepIndex ? "bg-green-500" : i === stepIndex ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              {i < stepIndex ? (
                <Check size={12} className="text-white" strokeWidth={3} />
              ) : i === stepIndex ? (
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              ) : null}
            </div>
            <p className={`text-sm font-medium ${i <= stepIndex ? "text-blue-900" : "text-gray-400"}`}>
              {step}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
   Dashboard Screen
   ========================================================================= */
function DashboardScreen({
  onNavigate,
  onOpenReport,
}: {
  onNavigate: (key: string) => void;
  onOpenReport: (id: string) => void;
}) {
  const { reports, stats, isLoadingReports, refreshReports } = useReports();
  const { user } = useUserStore();

  // Pull first name from the full name string
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="flex flex-col h-full">
      <TopBar onMenu={() => {}} />
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <p className="text-xl font-bold text-gray-900 mb-4">Hi, {firstName}! 👋</p>

        <div className="flex gap-3 mb-6">
          <StatCard icon={FileText}     iconBg="bg-blue-50"   iconFg="text-blue-600"   value={stats.total}       label="Total" />
          <StatCard icon={Clock}        iconBg="bg-orange-50" iconFg="text-orange-500" value={stats.underReview} label="Under Review" />
          <StatCard icon={CheckCircle2} iconBg="bg-green-50"  iconFg="text-green-600"  value={stats.resolved}    label="Resolved" />
        </div>

        <div className="flex items-center justify-between mb-1">
          <p className="font-bold text-gray-900">Your Reports</p>
          <div className="flex items-center gap-3">
            <button
              onClick={refreshReports}
              className="text-xs text-blue-600 font-medium"
              disabled={isLoadingReports}
            >
              {isLoadingReports ? "Loading..." : "Refresh"}
            </button>
            <button className="flex items-center gap-1 text-sm text-gray-500">
              Filter <Filter size={14} />
            </button>
          </div>
        </div>

        <div>
          {isLoadingReports && reports.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">Loading reports...</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No reports yet. Tap + to submit one.</p>
          ) : (
            reports.map((r) => (
              <ReportCard key={r.id} report={r} onOpen={onOpenReport} />
            ))
          )}
        </div>
      </div>

      <div className="relative">
        <button
          onClick={() => onNavigate("create")}
          className="absolute right-5 -top-16 w-14 h-14 rounded-full bg-blue-700 shadow-lg flex items-center justify-center"
        >
          <Plus size={26} className="text-white" />
        </button>
      </div>

      <BottomNav current="dashboard" onNavigate={onNavigate} />
    </div>
  );
}

/* =========================================================================
   Create Report Screen
   ========================================================================= */
function CreateReportScreen({
  onNavigate,
  onSubmitted,
}: {
  onNavigate: (key: string) => void;
  onSubmitted: (reportId: string) => void;
}) {
  const { addReport } = useReports();
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [images, setImages] = useState<{ base64: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showError, setShowError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const date = new Date().toLocaleDateString();
  const time = new Date().toLocaleTimeString();

  async function handleSubmit() {
    if (!description.trim()) return;
    setIsLoading(true);
    try {
      const newReport = await addReport({
        title: description.length > 40 ? description.slice(0, 40) + "…" : description,
        category: "other",
        typeLabel: "Other",
        description,
        date,
        time,
        location,
        images: images.map((img) => img.base64),
      });
      onSubmitted(newReport.id);
    } catch (err) {
      setShowError(true);
      setTimeout(() => setShowError(false), 60000);
    } finally {
      setIsLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const remaining = 3 - images.length;
    const toProcess = files.slice(0, remaining);

    toProcess.forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImages((prev) => {
          if (prev.length >= 3) return prev;
          return [...prev, { base64: ev.target?.result as string, name: file.name }];
        });
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  if (isLoading) return <AnalyzingScreen />;

  return (
    <div className="relative flex flex-col h-full">
      <ScreenHeader title="Create Report" onBack={() => onNavigate("dashboard")} />
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex gap-3 bg-blue-50 rounded-xl p-4 mb-5">
          <Sparkles size={20} className="text-blue-600 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-900 leading-snug">
            Our AI system will analyze your report and route it to the right authorities.
          </p>
        </div>

        <label className="text-sm font-semibold text-gray-900">Describe the incident</label>
        <div className="relative mt-2 mb-5">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
            placeholder="Describe what happened..."
            rows={5}
            className="w-full rounded-xl border border-gray-200 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <span className="absolute bottom-2 right-3 text-xs text-gray-300">{description.length}/1000</span>
        </div>

        <label className="text-sm font-semibold text-gray-900">Where did it happen?</label>
        <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-3 mt-2 mb-5">
          <MapPin size={16} className="text-gray-400" />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Enter location"
            className="text-sm w-full focus:outline-none"
          />
        </div>

        <label className="text-sm font-semibold text-gray-900">
          Upload images <span className="font-normal text-gray-400">(optional · up to 3)</span>
        </label>

        {images.length > 0 && (
          <div className="flex gap-2 mt-3 mb-3 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-200 shrink-0">
                <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gray-900 bg-opacity-60 flex items-center justify-center"
                  aria-label="Remove image"
                >
                  <span className="text-white text-xs leading-none font-bold">✕</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {images.length < 3 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 w-full border border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 mt-2 mb-5 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            <ImageIcon size={16} />
            Choose from gallery
            {images.length > 0 && <span className="text-xs text-gray-400">({images.length}/3)</span>}
          </button>
        )}

        {images.length === 3 && (
          <p className="text-xs text-gray-400 mt-2 mb-5">Maximum of 3 images reached.</p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex gap-2 mb-6">
          <Lock size={14} className="text-gray-400 mt-0.5 shrink-0" />
          <p className="text-xs text-gray-400 leading-snug">
            Your identity is secure with eGovPH. Only authorized personnel can access your report.
          </p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!description.trim()}
          className="w-full bg-blue-700 disabled:bg-blue-200 text-white font-semibold py-3.5 rounded-xl"
        >
          Submit Report
        </button>

        {showError && (
          <div className="absolute inset-x-4 top-20 z-50 flex items-start gap-3 bg-red-600 text-white text-sm font-medium px-4 py-3.5 rounded-2xl shadow-lg animate-pulse">
            <span className="text-lg leading-none">⚠️</span>
            <p className="leading-snug">eGovAI API issue, please try again after 1 minute.</p>
          </div>
        )}
      </div>
      <BottomNav current="create" onNavigate={onNavigate} />
    </div>
  );
}

/* =========================================================================
   Success Screen
   ========================================================================= */
function SuccessScreen({
  reportId,
  onNavigate,
  onViewReport,
}: {
  reportId: string | null;
  onNavigate: (key: string) => void;
  onViewReport: (id: string) => void;
}) {
  const recentReport = useReportStore((state) => state.report);

  const { getReportById } = useReports();
  const report = recentReport?.id ? getReportById(recentReport.id) : null;
  const [copied, setCopied] = useState(false);

  function copyRef() {
    if (report) {
      navigator.clipboard?.writeText(report.referenceNumber).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="flex flex-col h-full px-6 pt-16 items-center text-center">
      <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center shadow-md mb-6">
        <Check size={38} className="text-white" strokeWidth={3} />
      </div>
      <h1 className="text-xl font-bold text-gray-900">Report Submitted!</h1>
      <p className="text-sm text-gray-500 mt-2 leading-snug">
        Thank you for helping build a safer community.
      </p>

      <div className="w-full border border-gray-100 rounded-2xl p-5 mt-8 text-left">
        <p className="text-xs text-gray-400">Reference Number</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-lg font-bold text-blue-700">{recentReport?.referenceNumber}</p>
          <button onClick={copyRef}>
            <Copy size={16} className="text-gray-400" />
          </button>
        </div>
        {copied && <p className="text-xs text-green-600 mt-1">Copied!</p>}
        <div className="h-px bg-gray-100 my-4" />
        <p className="text-xs text-gray-500 leading-snug">
          You can monitor the progress of your report from the dashboard.
        </p>
      </div>

      <button onClick={() => onNavigate("dashboard")} className="text-blue-700 text-sm font-medium mt-4">
        Back to Dashboard
      </button>
    </div>
  );
}

/* =========================================================================
   Report Detail Screen
   ========================================================================= */
function ReportDetailScreen({
  reportId,
  onNavigate,
}: {
  reportId: string | null;
  onNavigate: (key: string) => void;
}) {
  const { getReportById } = useReports();
  const report = reportId ? getReportById(reportId) : null;

  if (!report) {
    return (
      <div className="flex flex-col h-full">
        <ScreenHeader title="Report" onBack={() => onNavigate("dashboard")} />
        <p className="px-5 text-sm text-gray-400">Report not found.</p>
      </div>
    );
  }

  const cat = CATEGORY[report.category] || CATEGORY.other;
  const Icon = cat.icon;

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Report Details" onBack={() => onNavigate("dashboard")} />
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-12 h-12 rounded-full ${cat.bg} flex items-center justify-center`}>
            <Icon size={22} className={cat.fg} />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-base">{report.title}</p>
            <p className="text-xs text-gray-400">{report.referenceNumber}</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-y border-gray-100 py-3 mb-4">
          <span className="text-sm text-gray-500">Status</span>
          <StatusBadge status={report.status} />
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <p className="text-gray-400 text-xs mb-1">Handled by</p>
            <p className="text-gray-900">{report.handler}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">Date & Time</p>
            <p className="text-gray-900">{new Date(report.timeStamp).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">Location</p>
            <p className="text-gray-900">{report.location}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">Description</p>
            <p className="text-gray-700 leading-relaxed">{report.description}</p>
          </div>
          {report.images?.length > 0 && (
            <div>
              <p className="text-gray-400 text-xs mb-2">Attached Images</p>
              <div className="flex gap-2 flex-wrap">
                {report.images.map((src, i) => (
                  <div key={i} className="w-24 h-24 rounded-xl overflow-hidden border border-gray-200 shrink-0">
                    <img src={src} alt={`attachment-${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {report.summary && (
          <div className="bg-blue-50 rounded-xl p-4 mt-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} className="text-blue-600 shrink-0" />
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                AI-Generated Report Summary
              </p>
            </div>
            <p className="text-sm text-blue-900 leading-relaxed">{report.summary}</p>
          </div>
        )}
      </div>
      <BottomNav current="dashboard" onNavigate={onNavigate} />
    </div>
  );
}

/* =========================================================================
   Updates Screen
   ========================================================================= */
function UpdatesScreen({ onNavigate }: { onNavigate: (key: string) => void }) {
  return (
    <div className="flex flex-col h-full">
      <TopBar onMenu={() => {}} />
      <div className="flex-1 flex items-center justify-center px-8 text-center">
        <p className="text-sm text-gray-400">No new updates yet. You'll see status changes on your reports here.</p>
      </div>
      <BottomNav current="updates" onNavigate={onNavigate} />
    </div>
  );
}

/* =========================================================================
   Profile Screen
   ========================================================================= */
function ProfileScreen({ onNavigate }: { onNavigate: (key: string) => void }) {
  const { user } = useUserStore();

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <TopBar onMenu={() => {}} />

      <div className="bg-blue-700 px-6 pt-6 pb-10">
        <p className="text-blue-200 text-xs uppercase tracking-widest mb-4">My Profile</p>
        <div className="flex items-center gap-4">
          {user?.photo ? (
            <img
              src={user.photo}
              alt={user.name}
              className="w-16 h-16 rounded-full object-cover border-2 border-white shadow"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center border-2 border-white shadow">
              <User size={28} className="text-white" />
            </div>
          )}
          <div>
            <p className="text-white font-bold text-base leading-tight">{user?.name ?? "—"}</p>
            <p className="text-blue-200 text-xs mt-1">Signed in with eGovPH</p>
          </div>
        </div>
      </div>

      <div className="mx-4 -mt-5 bg-white rounded-2xl shadow-md px-5 py-4 flex flex-col gap-4">
        <InfoRow icon={<Phone size={16} />} label="Mobile" value={user?.mobile ?? "—"} />
        <div className="border-t border-gray-100" />
        <InfoRow icon={<Mail size={16} />}   label="Email"  value={user?.email   ?? "—"} />
        <div className="border-t border-gray-100" />
        <InfoRow icon={<MapPin size={16} />} label="Address" value={user?.address ?? "—"} />
      </div>

      <div className="flex-1" />
      <BottomNav current="profile" onNavigate={onNavigate} />
    </div>
  );
}

/* =========================================================================
   App Shell
   ========================================================================= */
function AppShell() {
  const [screen, setScreen] = useState("signin");
  const [activeReportId, setActiveReportId] = useState<string | null>(null);

  function navigate(key: string) { setScreen(key); }

  function handleSubmitted(reportId: string) {
    setActiveReportId(reportId);
    setScreen("success");
  }

  function handleOpenReport(reportId: string) {
    setActiveReportId(reportId);
    setScreen("detail");
  }

  return (
    <div className="min-h-screen w-full bg-gray-100 flex items-center justify-center py-6">
      <div className="w-full max-w-sm h-screen sm:h-[780px] bg-white sm:rounded-[2rem] sm:shadow-xl overflow-hidden flex flex-col">
        {screen === "signin"    && <SignInScreen onSignIn={() => navigate("dashboard")} />}
        {screen === "dashboard" && <DashboardScreen onNavigate={navigate} onOpenReport={handleOpenReport} />}
        {screen === "create"    && <CreateReportScreen onNavigate={navigate} onSubmitted={handleSubmitted} />}
        {screen === "success"   && <SuccessScreen reportId={activeReportId} onNavigate={navigate} onViewReport={handleOpenReport} />}
        {screen === "detail"    && <ReportDetailScreen reportId={activeReportId} onNavigate={navigate} />}
        {screen === "updates"   && <UpdatesScreen onNavigate={navigate} />}
        {screen === "profile"   && <ProfileScreen onNavigate={navigate} />}
      </div>
    </div>
  );
}

/* =========================================================================
   Default Export
   ========================================================================= */
export default function AlertoPH() {
  return (
    <ReportsProvider>
      <AppShell />
    </ReportsProvider>
  );
}
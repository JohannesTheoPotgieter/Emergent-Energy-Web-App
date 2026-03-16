export type WelcomeUser = {
  id?: string | number | null;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  role?: string | null;
};

type QuoteRole = "coo" | "admin" | "program-manager" | "project-manager" | "engineering" | "finance" | "procurement" | "quality" | "default";

const roleQuotes: Record<QuoteRole, string[]> = {
  coo: [
    "Today’s clarity drives tomorrow’s execution.",
    "Align the teams, remove friction, and momentum follows.",
    "Operational discipline turns strategy into results.",
  ],
  admin: [
    "Strong governance keeps every team moving with confidence.",
    "Consistency in process protects speed at scale.",
    "Reliable systems make reliable delivery possible.",
  ],
  "program-manager": [
    "Keep dependencies visible and delivery predictable.",
    "Program rhythm is built one aligned decision at a time.",
    "Focus on the critical path and unblock fast.",
  ],
  "project-manager": [
    "Progress is earned in the next practical step.",
    "Clear ownership today prevents rework tomorrow.",
    "Good planning is visible in calm execution.",
  ],
  engineering: [
    "Build quality in early to move faster later.",
    "Solve root causes, not symptoms.",
    "Good engineering choices compound over time.",
  ],
  finance: [
    "Cash clarity enables confident decisions.",
    "Accuracy today protects margins tomorrow.",
    "Healthy controls create resilient growth.",
  ],
  procurement: [
    "The right supplier decision protects schedule and cost.",
    "Lead times managed early prevent late surprises.",
    "Commercial discipline keeps execution stable.",
  ],
  quality: [
    "Quality is not a checkpoint; it is the way we work.",
    "Close findings early to keep delivery smooth.",
    "Verified quality builds trust across every handover.",
  ],
  default: [
    "Focus on the highest-impact action first.",
    "Small disciplined wins build strong days.",
    "Steady execution compounds into exceptional results.",
  ],
};

export function extractFirstName(user?: WelcomeUser | null): string | null {
  const source = user?.name || user?.username || user?.email || "";
  const trimmed = source.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    const localPart = trimmed.split("@")[0]?.trim();
    if (!localPart) return null;
    const candidate = localPart.split(/[._\-\s]+/).find(Boolean);
    return candidate ? capitalize(candidate) : null;
  }

  const firstToken = trimmed.split(/\s+/).find(Boolean);
  return firstToken ? capitalize(firstToken) : null;
}

export function formatSouthAfricanDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getWelcomeHeading(user?: WelcomeUser | null): string {
  const firstName = extractFirstName(user);
  return firstName ? `Welcome, ${firstName}` : "Welcome";
}

function normalizeRole(value?: string | null): QuoteRole {
  const normalized = (value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["coo", "chief-operating-officer", "chief-operations-officer"].includes(normalized)) return "coo";
  if (["admin", "administrator", "superadmin"].includes(normalized)) return "admin";
  if (["program-manager", "programme-manager", "eng-program-manager"].includes(normalized)) return "program-manager";
  if (["project-manager", "pm", "member", "viewer"].includes(normalized)) return "project-manager";
  if (["engineering", "engineer"].includes(normalized)) return "engineering";
  if (["finance", "financial"].includes(normalized)) return "finance";
  if (["procurement", "buyer", "purchasing"].includes(normalized)) return "procurement";
  if (["quality", "quality-manager", "qm"].includes(normalized)) return "quality";
  return "default";
}

export function getDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildQuoteSeed(user: WelcomeUser | null | undefined, role?: string | null, date: Date = new Date()): string {
  return `${user?.id ?? ""}|${user?.email ?? ""}|${normalizeRole(role)}|${getDateKey(date)}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getDeterministicRoleQuote(user?: WelcomeUser | null, role?: string | null, date: Date = new Date()): string {
  const quoteRole = normalizeRole(role || user?.role);
  const quotes = roleQuotes[quoteRole] || roleQuotes.default;
  const seed = buildQuoteSeed(user, role || user?.role, date);
  const index = hashString(seed) % quotes.length;
  return quotes[index] || roleQuotes.default[0];
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

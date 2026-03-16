import {
  buildQuoteSeed,
  formatSouthAfricanDate,
  getDeterministicRoleQuote,
  getWelcomeHeading,
} from "@/lib/home-welcome";

describe("home-welcome utilities", () => {
  test("falls back to default quote when role is missing", () => {
    const quote = getDeterministicRoleQuote({ id: 1, email: "user@example.com", name: "Jane Doe" }, undefined, new Date("2026-03-16T08:00:00Z"));
    expect(typeof quote).toBe("string");
    expect(quote.length).toBeGreaterThan(0);
  });

  test("quote selection is deterministic for same user + role + day", () => {
    const user = { id: 42, email: "coo@example.com", name: "Alex Chief", role: "COO" };
    const date = new Date("2026-03-16T12:00:00Z");
    const a = getDeterministicRoleQuote(user, user.role, date);
    const b = getDeterministicRoleQuote(user, user.role, date);

    expect(a).toBe(b);
    expect(buildQuoteSeed(user, user.role, date)).toBe(buildQuoteSeed(user, user.role, date));
  });

  test("seed changes when date changes", () => {
    const user = { id: 9, email: "finance@example.com", name: "Fin Lead", role: "Finance" };
    const first = buildQuoteSeed(user, user.role, new Date("2026-03-16T08:00:00Z"));
    const second = buildQuoteSeed(user, user.role, new Date("2026-03-17T08:00:00Z"));

    expect(first).not.toBe(second);
  });

  test("formats date in South African English style", () => {
    const formatted = formatSouthAfricanDate(new Date("2026-03-16T08:00:00Z"));
    expect(formatted).toBe("Monday, 16 March 2026");
  });

  test("missing name falls back to plain welcome heading", () => {
    expect(getWelcomeHeading(null)).toBe("Welcome");
    expect(getWelcomeHeading({})).toBe("Welcome");
    expect(getWelcomeHeading({ email: "" })).toBe("Welcome");
  });
});

import { EmailAutoLinkerDevPanel } from "@/components/email-links/EmailAutoLinkerDevPanel";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { isSuperAdmin } from "@/lib/access-control";

/**
 * Dev-only page for trialling the email auto-linker end-to-end from
 * the front end. Super-user gate on the client side + backend route
 * rejects in production regardless.
 */
export default function AdminEmailLinkerDevPage() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return (
      <PageLayout header={<PageHeader title="Email auto-linker" subtitle="Access denied." />}>
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
            <p className="text-sm font-medium">Only COO and CEO admins can use the auto-linker test panel.</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      data-testid="admin-email-linker-dev-page"
      header={
        <PageHeader
          title="Email auto-linker"
          subtitle="Synthesize inbound emails and verify the layered-signal matcher end-to-end. Replaces the old curl-based test."
        />
      }
    >
      <EmailAutoLinkerDevPanel />
    </PageLayout>
  );
}

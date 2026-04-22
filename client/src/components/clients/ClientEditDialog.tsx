import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api-error";
import { Loader2, Save, Building2 } from "lucide-react";

/**
 * Full-fidelity client edit dialog. Super-user only (backed by the
 * PATCH /api/clients/:id endpoint which requireAdmin gates).
 *
 * Lets admins edit every enriched field on a client record, including
 * the new primaryEmailDomain + additionalEmailDomains that unlock the
 * email-linking feature.
 *
 * The existing inline name-edit on /clients keeps working — this
 * dialog is opened via a separate button for bulk field edits.
 */

interface ClientEditForm {
  name: string;
  legalEntityName: string;
  tradingName: string;
  clientType: string;
  billingEntity: string;
  industry: string;
  status: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  secondaryContactName: string;
  secondaryContactEmail: string;
  primaryEmailDomain: string;
  additionalEmailDomains: string; // comma-separated in the input; split on save
}

export interface ClientForEdit {
  id: number;
  name: string;
  legalEntityName?: string | null;
  tradingName?: string | null;
  clientType?: string | null;
  billingEntity?: string | null;
  industry?: string | null;
  status?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  secondaryContactName?: string | null;
  secondaryContactEmail?: string | null;
  primaryEmailDomain?: string | null;
  additionalEmailDomains?: string[] | null;
}

export interface ClientEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientForEdit;
}

function blankForm(client: ClientForEdit): ClientEditForm {
  return {
    name: client.name ?? "",
    legalEntityName: client.legalEntityName ?? "",
    tradingName: client.tradingName ?? "",
    clientType: client.clientType ?? "",
    billingEntity: client.billingEntity ?? "",
    industry: client.industry ?? "",
    status: client.status ?? "active",
    primaryContactName: client.primaryContactName ?? "",
    primaryContactEmail: client.primaryContactEmail ?? "",
    primaryContactPhone: client.primaryContactPhone ?? "",
    secondaryContactName: client.secondaryContactName ?? "",
    secondaryContactEmail: client.secondaryContactEmail ?? "",
    primaryEmailDomain: client.primaryEmailDomain ?? "",
    additionalEmailDomains: (client.additionalEmailDomains ?? []).join(", "),
  };
}

export function ClientEditDialog({ open, onOpenChange, client }: ClientEditDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ClientEditForm>(() => blankForm(client));

  useEffect(() => {
    if (open) setForm(blankForm(client));
  }, [open, client]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const additionalDomains = form.additionalEmailDomains
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0);

      // Send only the fields the strict server schema accepts. Empty
      // strings → null where sensible so the DB clears the value.
      const body: Record<string, unknown> = {
        name: form.name.trim() || undefined,
        legalEntityName: form.legalEntityName.trim() || null,
        tradingName: form.tradingName.trim() || null,
        clientType: form.clientType || null,
        billingEntity: form.billingEntity.trim() || null,
        industry: form.industry.trim() || null,
        status: form.status || undefined,
        primaryContactName: form.primaryContactName.trim() || null,
        primaryContactEmail: form.primaryContactEmail.trim() || null,
        primaryContactPhone: form.primaryContactPhone.trim() || null,
        secondaryContactName: form.secondaryContactName.trim() || null,
        secondaryContactEmail: form.secondaryContactEmail.trim() || null,
        primaryEmailDomain: form.primaryEmailDomain.trim() || null,
        additionalEmailDomains: additionalDomains,
      };
      const res = await apiRequest("PATCH", `/api/clients/${client.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Client updated", description: form.name });
      qc.invalidateQueries({ queryKey: ["clients"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Update failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const canSubmit = form.name.trim().length > 0 && !saveMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="client-edit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" /> Edit client
          </DialogTitle>
          <DialogDescription>
            Update identity, contacts, billing, industry, and email domains used for auto-linking inbound emails.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Section title="Identity">
            <Row>
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} testid="client-edit-name" />
              <Field label="Legal entity name" value={form.legalEntityName} onChange={(v) => setForm({ ...form, legalEntityName: v })} />
            </Row>
            <Row>
              <Field label="Trading name" value={form.tradingName} onChange={(v) => setForm({ ...form, tradingName: v })} />
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Client type</Label>
                <Select value={form.clientType} onValueChange={(v) => setForm({ ...form, clientType: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="government">Government</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Row>
            <Row>
              <Field label="Industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} />
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="prospect">Prospect</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Row>
          </Section>

          <Section title="Contacts">
            <Row>
              <Field label="Primary contact name" value={form.primaryContactName} onChange={(v) => setForm({ ...form, primaryContactName: v })} />
              <Field label="Primary contact email" value={form.primaryContactEmail} onChange={(v) => setForm({ ...form, primaryContactEmail: v })} />
            </Row>
            <Row>
              <Field label="Primary contact phone" value={form.primaryContactPhone} onChange={(v) => setForm({ ...form, primaryContactPhone: v })} />
              <Field label="Secondary contact name" value={form.secondaryContactName} onChange={(v) => setForm({ ...form, secondaryContactName: v })} />
            </Row>
            <Row>
              <Field label="Secondary contact email" value={form.secondaryContactEmail} onChange={(v) => setForm({ ...form, secondaryContactEmail: v })} />
              <Field label="Billing entity" value={form.billingEntity} onChange={(v) => setForm({ ...form, billingEntity: v })} />
            </Row>
          </Section>

          <Section title="Email auto-linking (email-linking feature foundations)">
            <div className="space-y-1">
              <Label className="text-xs">Primary email domain</Label>
              <Input
                value={form.primaryEmailDomain}
                onChange={(e) => setForm({ ...form, primaryEmailDomain: e.target.value })}
                placeholder="e.g. clientabc.com (no @, no https://)"
                className="font-mono text-xs"
                data-testid="client-edit-primary-email-domain"
              />
              <p className="text-[11px] text-muted-foreground">
                When an Outlook email arrives from @thisdomain.com, it auto-attributes to this client.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Additional email domains (comma-separated)</Label>
              <Textarea
                rows={2}
                value={form.additionalEmailDomains}
                onChange={(e) => setForm({ ...form, additionalEmailDomains: e.target.value })}
                placeholder="clientabc.co.za, subsidiary.com"
                className="font-mono text-xs"
                data-testid="client-edit-additional-email-domains"
              />
            </div>
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMut.isPending}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={!canSubmit} data-testid="btn-save-client">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

function Field({
  label, value, onChange, testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <div className="space-y-1 flex-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
    </div>
  );
}

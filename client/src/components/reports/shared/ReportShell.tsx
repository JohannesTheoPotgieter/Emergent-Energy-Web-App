import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { AlertTriangle } from "lucide-react";
import ReportHeader from "@/components/reports/ReportHeader";

interface ReportShellProps {
  title: string;
  month: string;
  onMonthChange: (month: string) => void;
  status: string;
  generatedAt?: string;
  regeneratedAt?: string;
  reportId?: number;
  isLoading?: boolean;
  lastImportAt?: string;
  isStale?: boolean;
  daysSinceImport?: number;
  stalenessThresholdDays?: number;
  onRegenerate?: () => void;
  onReview?: () => void;
  onPublish?: () => void;
  onRevert?: () => void;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
  onCompare?: () => void;
  onHistory?: () => void;
  children: React.ReactNode;
}

export default function ReportShell(props: ReportShellProps) {
  return (
    <div className="container mx-auto p-6 space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/reports/center">Report Center</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{props.title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ReportHeader
        title={props.title}
        month={props.month}
        onMonthChange={props.onMonthChange}
        status={props.status}
        generatedAt={props.generatedAt}
        regeneratedAt={props.regeneratedAt}
        reportId={props.reportId}
        isLoading={props.isLoading}
        onRegenerate={props.onRegenerate}
        onReview={props.onReview}
        onPublish={props.onPublish}
        onRevert={props.onRevert}
        onExportPdf={props.onExportPdf}
        onExportExcel={props.onExportExcel}
        onCompare={props.onCompare}
        onHistory={props.onHistory}
      />

      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-4">
        <span>Last import: {props.lastImportAt ? new Date(props.lastImportAt).toLocaleString("en-ZA") : "Not available"}</span>
      </div>

      {props.isStale && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Data staleness warning: {props.daysSinceImport ?? "Unknown"} day(s) since import (threshold {props.stalenessThresholdDays ?? "n/a"} days).
        </div>
      )}

      {props.children}
    </div>
  );
}

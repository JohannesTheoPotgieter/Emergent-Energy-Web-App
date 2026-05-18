import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useSaveStageData } from "@/hooks/use-stage-data";
import { Save, Loader2 } from "lucide-react";

export type FieldValue = string | number | boolean | null | undefined;

/** Coerce a stored field value into a controlled-input-safe string. */
function toInputValue(v: FieldValue): string | number {
  if (v === null || v === undefined || v === false) return "";
  if (v === true) return "";
  return v;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "boolean";
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}

interface StageDataFormProps {
  projectId: number;
  stageCode: string;
  title: string;
  fields: FieldDef[];
  data: Record<string, FieldValue>;
  onDataChange?: (data: Record<string, FieldValue>) => void;
}

export function StageDataForm({ projectId, stageCode, title, fields, data, onDataChange }: StageDataFormProps) {
  const [localData, setLocalData] = useState<Record<string, FieldValue>>(data);
  const [dirty, setDirty] = useState(false);
  const saveMutation = useSaveStageData(projectId, stageCode);
  const prevDataRef = useRef(data);

  // Sync external data changes
  useEffect(() => {
    if (data !== prevDataRef.current) {
      setLocalData(data);
      prevDataRef.current = data;
      setDirty(false);
    }
  }, [data]);

  const handleChange = useCallback((key: string, value: FieldValue) => {
    setLocalData(prev => {
      const next = { ...prev, [key]: value };
      onDataChange?.(next);
      return next;
    });
    setDirty(true);
  }, [onDataChange]);

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const handleSave = () => {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required) {
        const val = localData[field.key];
        if (val === undefined || val === null || val === "") {
          errors[field.key] = `${field.label} is required`;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors({});
    saveMutation.mutate(localData, {
      onSuccess: () => setDirty(false),
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            variant={dirty ? "default" : "outline"}
          >
            {saveMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(field => (
            <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : ""}>
              <Label htmlFor={field.key} className="text-xs font-medium">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </Label>

              {field.type === "text" && (
                <Input
                  id={field.key}
                  value={toInputValue(localData[field.key])}
                  onChange={e => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="mt-1 h-8 text-sm"
                />
              )}

              {field.type === "number" && (
                <Input
                  id={field.key}
                  type="number"
                  value={toInputValue(localData[field.key])}
                  onChange={e => handleChange(field.key, e.target.value ? Number(e.target.value) : undefined)}
                  placeholder={field.placeholder}
                  className="mt-1 h-8 text-sm"
                />
              )}

              {field.type === "date" && (
                <Input
                  id={field.key}
                  type="date"
                  value={toInputValue(localData[field.key])}
                  onChange={e => handleChange(field.key, e.target.value)}
                  className="mt-1 h-8 text-sm"
                />
              )}

              {field.type === "textarea" && (
                <Textarea
                  id={field.key}
                  value={toInputValue(localData[field.key])}
                  onChange={e => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="mt-1 text-sm min-h-[60px]"
                  rows={2}
                />
              )}

              {field.type === "select" && field.options && (
                <Select
                  value={String(toInputValue(localData[field.key]))}
                  onValueChange={val => handleChange(field.key, val)}
                >
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue placeholder={field.placeholder || "Select..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {field.type === "boolean" && (
                <div className="mt-1 flex items-center gap-2">
                  <Switch
                    id={field.key}
                    checked={!!localData[field.key]}
                    onCheckedChange={val => handleChange(field.key, val)}
                  />
                  <span className="text-xs text-muted-foreground">{localData[field.key] ? "Yes" : "No"}</span>
                </div>
              )}
              {validationErrors[field.key] && (
                <p className="text-xs text-red-500 mt-1">{validationErrors[field.key]}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

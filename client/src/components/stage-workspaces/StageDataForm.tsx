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
  data: Record<string, any>;
  onDataChange?: (data: Record<string, any>) => void;
}

export function StageDataForm({ projectId, stageCode, title, fields, data, onDataChange }: StageDataFormProps) {
  const [localData, setLocalData] = useState<Record<string, any>>(data);
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

  const handleChange = useCallback((key: string, value: any) => {
    setLocalData(prev => {
      const next = { ...prev, [key]: value };
      onDataChange?.(next);
      return next;
    });
    setDirty(true);
  }, [onDataChange]);

  const handleSave = () => {
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
                  value={localData[field.key] || ""}
                  onChange={e => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="mt-1 h-8 text-sm"
                />
              )}

              {field.type === "number" && (
                <Input
                  id={field.key}
                  type="number"
                  value={localData[field.key] ?? ""}
                  onChange={e => handleChange(field.key, e.target.value ? Number(e.target.value) : undefined)}
                  placeholder={field.placeholder}
                  className="mt-1 h-8 text-sm"
                />
              )}

              {field.type === "date" && (
                <Input
                  id={field.key}
                  type="date"
                  value={localData[field.key] || ""}
                  onChange={e => handleChange(field.key, e.target.value)}
                  className="mt-1 h-8 text-sm"
                />
              )}

              {field.type === "textarea" && (
                <Textarea
                  id={field.key}
                  value={localData[field.key] || ""}
                  onChange={e => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="mt-1 text-sm min-h-[60px]"
                  rows={2}
                />
              )}

              {field.type === "select" && field.options && (
                <Select
                  value={localData[field.key] || ""}
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
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

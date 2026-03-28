import { GripVertical, Pin, PinOff, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReactNode } from "react";

export function DashboardWidget({ title, pinned, minimized, onPinToggle, onMinimizeToggle, children }: {
  title: string;
  pinned: boolean;
  minimized: boolean;
  onPinToggle: () => void;
  onMinimizeToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="min-h-[44px]">
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><GripVertical className="w-4 h-4 text-muted-foreground" />{title}</span>
          <span className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={onPinToggle} className="h-8 w-8">{pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}</Button>
            <Button size="icon" variant="ghost" onClick={onMinimizeToggle} className="h-8 w-8">{minimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}</Button>
          </span>
        </CardTitle>
      </CardHeader>
      {!minimized && <CardContent>{children}</CardContent>}
    </Card>
  );
}

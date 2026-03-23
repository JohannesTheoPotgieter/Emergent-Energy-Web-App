import { useState } from "react";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Search, Filter, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Column<T> {
  header: string;
  accessorKey: keyof T | ((item: T) => React.ReactNode);
  className?: string;
}

interface TrackerTableProps<T> {
  title: string;
  data: T[];
  columns: Column<T>[];
  filterColumn?: keyof T; // Simple single column filter for now
  onExport?: () => void;
  onRowClick?: (item: T) => void;
}

export function TrackerTable<T extends { id: string | number, sourceSheet?: string, rowLocator?: number }>({ 
  title, 
  data, 
  columns, 
  filterColumn,
  onExport,
  onRowClick
}: TrackerTableProps<T>) {
  const [search, setSearch] = useState("");
  const [filterValue, setFilterValue] = useState("all");

  const filteredData = data.filter(item => {
    // Search logic (naive)
    const matchesSearch = Object.values(item).some(
      val => String(val).toLowerCase().includes(search.toLowerCase())
    );
    
    // Filter logic
    if (filterValue !== "all" && filterColumn) {
       return matchesSearch && String(item[filterColumn]) === filterValue;
    }

    return matchesSearch;
  });

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <Badge variant="secondary" className="font-mono text-[11px]">
            {filteredData.length}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/50" />
            <Input
              placeholder="Search..."
              className="pl-8 h-8 text-sm bg-muted/30 border-transparent focus-visible:border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onExport}>
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                {columns.map((col, i) => (
                  <TableHead key={i} className={cn("whitespace-nowrap", col.className)}>
                    {col.header}
                  </TableHead>
                ))}
                <TableHead className="w-[80px] text-right">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length > 0 ? (
                filteredData.map((item) => (
                  <TableRow 
                    key={item.id} 
                    className={cn(
                      "data-table-row group",
                      onRowClick && "cursor-pointer hover:bg-muted/50"
                    )}
                    onClick={() => onRowClick?.(item)}
                  >
                    {columns.map((col, i) => (
                      <TableCell key={i} className={cn("py-2.5 text-sm", col.className)}>
                        {typeof col.accessorKey === 'function' 
                          ? col.accessorKey(item)
                          : String(item[col.accessorKey])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                       {(item.sourceSheet || item.rowLocator) && (
                         <Badge variant="outline" className="text-[10px] text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity">
                           {item.sourceSheet ? `${item.sourceSheet.substring(0, 3)}..` : ''} 
                           #{item.rowLocator}
                         </Badge>
                       )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="h-24 text-center text-muted-foreground">
                    No results found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

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
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
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
}

export function TrackerTable<T extends { id: string | number, sourceSheet?: string, rowLocator?: number }>({ 
  title, 
  data, 
  columns, 
  filterColumn,
  onExport 
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
    <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <CardTitle className="text-lg font-heading tracking-wide flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            {title}
            <Badge variant="secondary" className="ml-2 font-mono text-xs">
              {filteredData.length} records
            </Badge>
          </CardTitle>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search data..." 
              className="pl-9 h-9 bg-background" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={onExport}>
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-md">
              <TableRow>
                {columns.map((col, i) => (
                  <TableHead key={i} className={cn("font-semibold text-foreground whitespace-nowrap", col.className)}>
                    {col.header}
                  </TableHead>
                ))}
                <TableHead className="w-[100px] text-right">Traceability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length > 0 ? (
                filteredData.map((item) => (
                  <TableRow key={item.id} className="data-table-row group">
                    {columns.map((col, i) => (
                      <TableCell key={i} className={cn("py-3 font-mono text-sm", col.className)}>
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

import React, { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { 
  Search, 
  FileText, 
  ExternalLink, 
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
  ArrowLeft
} from "lucide-react";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import ReactMarkdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";

interface LinkedProcess {
  slug: string;
  title: string;
}

interface TemplateNode {
  id: string;
  slug: string;
  title: string;
  status: string;
  contentMarkdown?: string;
  externalUrl?: string;
  linkedProcesses: LinkedProcess[];
}

export default function TemplatesLibraryPage() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [templates, setTemplates] = useState<TemplateNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/ee-info/os/templates?search=${encodeURIComponent(search)}`, {
          credentials: "include"
        });
        if (!response.ok) {
          throw new Error("Failed to fetch templates");
        }
        const data = await response.ok ? await response.json() : [];
        setTemplates(data);
        setError(null);
      } catch (err: any) {
        console.error("Error fetching templates:", err);
        setError(err.message || "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchTemplates, 300);
    return () => clearTimeout(debounceTimer);
  }, [search]);

  return (
    <div className="container mx-auto py-6 space-y-8 animate-in fade-in duration-500">
      {/* Header & Breadcrumbs */}
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/ee-info" data-testid="link-breadcrumb-os-map">OS Map</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Templates</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Templates Library</h1>
            <p className="text-muted-foreground" data-testid="text-page-description">
              Browse and access official Emergent Energy document templates and resources.
            </p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-templates"
            />
          </div>
        </div>
      </div>

      {loading && templates.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="h-48">
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-12 text-center border-destructive/50">
          <CardContent className="space-y-4">
            <p className="text-destructive font-medium">{error}</p>
            <Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        <Card className="p-12 text-center">
          <CardContent className="space-y-4">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">No templates found matching your search.</p>
            <Button variant="outline" onClick={() => setSearch("")}>Show all templates</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <Card 
              key={template.id} 
              className="flex flex-col hover:shadow-md transition-shadow"
              data-testid={`card-template-${template.slug}`}
            >
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-xl leading-tight" data-testid={`text-template-title-${template.id}`}>
                      {template.title}
                    </CardTitle>
                    <Badge 
                      variant={template.status === "published" ? "default" : "secondary"}
                      className="capitalize"
                      data-testid={`status-template-${template.id}`}
                    >
                      {template.status}
                    </Badge>
                  </div>
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                {template.linkedProcesses.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked Processes</span>
                    <div className="flex flex-wrap gap-1.5">
                      {template.linkedProcesses.map((proc) => (
                        <Badge 
                          key={proc.slug}
                          variant="outline" 
                          className="bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer text-[10px] px-2 py-0"
                          onClick={() => setLocation(`/ee-info/os/process/${proc.slug}`)}
                          data-testid={`chip-process-${proc.slug}`}
                        >
                          {proc.title}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="pt-3 border-t">
                <Accordion type="single" collapsible className="w-full border-none">
                  <AccordionItem value="content" className="border-none">
                    <div className="flex items-center justify-between gap-2 w-full">
                      <AccordionTrigger className="py-2 hover:no-underline font-medium text-sm flex-1 justify-start gap-2" data-testid={`button-expand-template-${template.id}`}>
                        View Details
                      </AccordionTrigger>
                      {template.externalUrl && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          asChild
                          className="h-8 w-8 p-0"
                          data-testid={`button-external-link-${template.id}`}
                        >
                          <a href={template.externalUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                    <AccordionContent className="pt-4 text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert" data-testid={`content-template-${template.id}`}>
                      {template.contentMarkdown ? (
                        <ReactMarkdown>{template.contentMarkdown}</ReactMarkdown>
                      ) : (
                        <p className="text-muted-foreground italic">No internal content provided.</p>
                      )}
                      {template.externalUrl && (
                        <div className="mt-4 pt-4 border-t">
                          <Button variant="outline" className="w-full" asChild data-testid={`button-external-action-${template.id}`}>
                            <a href={template.externalUrl} target="_blank" rel="noopener noreferrer">
                              Open External Resource <ExternalLink className="ml-2 h-3 w-3" />
                            </a>
                          </Button>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

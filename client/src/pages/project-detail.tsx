import { useRoute } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, DollarSign, CreditCard, TrendingUp, BarChart3, Activity } from "lucide-react";

export default function ProjectDetailPage() {
  const [, params] = useRoute("/project/:projectName");
  const projectName = params?.projectName ? decodeURIComponent(params.projectName) : "";

  if (!projectName) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground">Project Not Found</h2>
        <p className="text-muted-foreground">No project specified.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">{projectName}</h2>
        <p className="text-muted-foreground">
          Tracker drill-down • All project data and planning controls
        </p>
      </div>

      {/* 6-Tab Navigation */}
      <Tabs defaultValue="project-plan" className="w-full">
        <TabsList className="grid w-full grid-cols-6 lg:w-auto">
          <TabsTrigger value="project-plan" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Project Plan</span>
          </TabsTrigger>
          <TabsTrigger value="revenue-tracking" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Revenue Tracking</span>
          </TabsTrigger>
          <TabsTrigger value="expenditure" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden sm:inline">Expenditure Breakdown</span>
          </TabsTrigger>
          <TabsTrigger value="finance-revenue" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Finance - Revenue</span>
          </TabsTrigger>
          <TabsTrigger value="finance-cos" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Finance - COS</span>
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Cashflow</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="project-plan" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Project Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Project Plan tab - Coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue-tracking" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Revenue Tracking tab - Coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenditure" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Expenditure Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Expenditure Breakdown tab - Coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance-revenue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Finance - Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Finance - Revenue tab - Coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance-cos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Finance - COS</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Finance - COS tab - Coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashflow" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cashflow</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Cashflow tab - Coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

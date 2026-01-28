import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useProgramData } from "@/hooks/use-program-data";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Format must be YYYY-MM"),
  category: z.enum(["REV", "COS", "OPS"]),
  amount: z.coerce.number().min(1, "Amount must be greater than 0"),
});

export default function BudgetPage() {
  const { data, addBudgetEntry } = useProgramData();
  
  const projects = data?.projects || [];
  const budgets = data?.budgets || [];
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: "",
      month: new Date().toISOString().slice(0, 7),
      category: "COS",
      amount: 0,
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    addBudgetEntry({
      projectId: parseInt(values.projectId),
      month: values.month,
      category: values.category,
      amount: values.amount.toString(),
    });
    form.reset({
      projectId: values.projectId,
      month: values.month,
      category: "COS",
      amount: 0
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
       <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Manual Budget Entry</h2>
        <p className="text-muted-foreground">
           Admin-only interface for adjusting monthly budget forecasts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Budget Record</CardTitle>
          <CardDescription>All fields are required. Records are saved to the database immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id.toString()}>
                            {project.name} ({project.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Month (YYYY-MM)</FormLabel>
                      <FormControl>
                        <Input type="month" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="REV">Revenue (REV)</SelectItem>
                          <SelectItem value="COS">Cost of Sales (COS)</SelectItem>
                          <SelectItem value="OPS">Operational Expenditure (OPS)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget Amount ($)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormDescription>Enter the planned amount for this period.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full">Save Entry</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      
      {budgets.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent Entries</CardTitle></CardHeader>
          <CardContent>
             <div className="space-y-2">
                {budgets.slice().reverse().slice(0, 5).map(b => (
                  <div key={b.id} className="flex justify-between items-center text-sm border-b pb-2">
                     <span>{projects.find(p => p.id === b.projectId)?.name} - {b.category}</span>
                     <span className="font-mono">{b.month}: ${parseFloat(b.amount || '0').toLocaleString()}</span>
                  </div>
                ))}
             </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

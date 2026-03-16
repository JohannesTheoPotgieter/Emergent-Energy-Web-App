import { useMutation, useQueryClient, UseMutationOptions, QueryKey } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { isApiError } from "@/lib/api-error";

interface MutationWithToastOptions<TData, TError, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, "onSuccess" | "onError"> {
  successMessage?: string | ((data: TData) => string);
  errorMessage?: string;
  invalidateKeys?: QueryKey[];
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: TError) => void;
}

export function useMutationWithToast<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(options: MutationWithToastOptions<TData, TError, TVariables, TContext>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    successMessage,
    errorMessage,
    invalidateKeys,
    onSuccess: userOnSuccess,
    onError: userOnError,
    ...mutationOptions
  } = options;

  return useMutation<TData, TError, TVariables, TContext>({
    ...mutationOptions,
    onSuccess: (data, variables, context) => {
      if (successMessage) {
        const msg = typeof successMessage === "function" ? successMessage(data) : successMessage;
        toast({ title: msg });
      }
      if (invalidateKeys) {
        for (const key of invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
      userOnSuccess?.(data, variables);
    },
    onError: (error, variables, context) => {
      const apiErr = isApiError(error) ? error : null;
      const message = apiErr
        ? apiErr.userMessage
        : errorMessage || (error instanceof Error ? error.message : "Something went wrong");

      const title = apiErr?.code === "VALIDATION_ERROR"
        ? "Please fix the errors below"
        : apiErr?.code === "FORBIDDEN"
        ? "Access Denied"
        : apiErr?.code === "CONFLICT"
        ? "Conflict"
        : apiErr?.retryable
        ? "Temporary issue"
        : "Error";

      const description = apiErr?.fieldErrors
        ? Object.entries(apiErr.fieldErrors).map(([k, v]) => `${k}: ${v}`).join(", ")
        : message;

      toast({
        title,
        description: apiErr?.retryable
          ? `${description} You can safely retry this action.`
          : description,
        variant: "destructive",
      });

      userOnError?.(error);
    },
  });
}

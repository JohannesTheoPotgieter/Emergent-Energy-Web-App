/**
 * EE-QA-021 — canonical mutation wrapper that guarantees user-visible feedback.
 *
 * Vanilla `useMutation` from TanStack Query doesn't surface errors to the
 * user by itself. New code must either:
 *
 *   1. Use `useApiMutation` (preferred — it toasts on error by default and
 *      can opt into a success toast with a single string), OR
 *   2. Pass an explicit `onError` callback to `useMutation` that ends in a
 *      visible signal (toast, banner, dialog).
 *
 * The CI guard `qa/tests/unit/mutation-feedback-contract.test.ts` walks
 * `client/src/**\/*.{ts,tsx}` and fails on any NEW `useMutation` call
 * without `onError` or `useApiMutation`. The 44 pre-Wave-6.3 offenders
 * are listed in `qa/fixtures/mutation-feedback-baseline.json`.
 */
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";

type ToastInput =
  | string
  | {
      title: string;
      description?: string;
    };

interface UseApiMutationExtras<TData, TVariables> {
  /**
   * Toast title (or `{ title, description }`) shown when the mutation
   * resolves successfully. Omit to skip the success toast.
   */
  successToast?: ToastInput | ((data: TData, variables: TVariables) => ToastInput | undefined);
  /**
   * Default error toast title. The error's message becomes the description.
   * Defaults to "Action failed". Pass `errorToast: false` to opt out (e.g.
   * if you render the error inline yourself), but you must still render
   * something visible — silent failures break trust.
   */
  errorToast?: string | false;
}

export type UseApiMutationOptions<TData = unknown, TError = unknown, TVariables = void, TContext = unknown> =
  Omit<UseMutationOptions<TData, TError, TVariables, TContext>, "onSuccess" | "onError"> & {
    onSuccess?: UseMutationOptions<TData, TError, TVariables, TContext>["onSuccess"];
    onError?: UseMutationOptions<TData, TError, TVariables, TContext>["onError"];
  } & UseApiMutationExtras<TData, TVariables>;

/**
 * Wrap `useMutation` so every call site has a user-visible failure path
 * by default. Idiomatic usage:
 *
 *   const save = useApiMutation({
 *     mutationFn: (vars) => apiRequest("POST", "/api/x", vars),
 *     successToast: "Saved",
 *     // errorToast defaults to "Action failed"; getErrorMessage(err) is used as description
 *   });
 *
 * To override, pass `onError` explicitly — the wrapper still adds the
 * default toast UNLESS `errorToast: false` is set, in which case the
 * caller is responsible for rendering an error.
 */
export function useApiMutation<TData = unknown, TError = unknown, TVariables = void, TContext = unknown>(
  options: UseApiMutationOptions<TData, TError, TVariables, TContext>,
) {
  const { toast } = useToast();
  const {
    onSuccess: callerOnSuccess,
    onError: callerOnError,
    successToast,
    errorToast = "Action failed",
    ...rest
  } = options;

  return useMutation<TData, TError, TVariables, TContext>({
    ...rest,
    onSuccess: (...args) => {
      const [data, variables] = args;
      // Forward all args (TanStack Query v5 passes onMutateResult + context too).
      (callerOnSuccess as ((...a: unknown[]) => void) | undefined)?.(...args);
      if (!successToast) return;
      const resolved = typeof successToast === "function" ? successToast(data, variables) : successToast;
      if (!resolved) return;
      if (typeof resolved === "string") {
        toast({ title: resolved });
      } else {
        toast({ title: resolved.title, description: resolved.description });
      }
    },
    onError: (...args) => {
      const [error] = args;
      (callerOnError as ((...a: unknown[]) => void) | undefined)?.(...args);
      if (errorToast === false) return;
      toast({
        title: errorToast,
        description: getErrorMessage(error, "Please try again or contact your administrator."),
        variant: "destructive",
      });
    },
  });
}

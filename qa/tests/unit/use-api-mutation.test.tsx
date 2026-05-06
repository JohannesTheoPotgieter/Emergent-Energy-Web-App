// @vitest-environment jsdom
/**
 * EE-QA-021 — useApiMutation contract.
 *
 * Asserts that the wrapper:
 *   - Calls toast({ variant: "destructive", ... }) on error by default.
 *   - Calls toast() on success when `successToast` is provided.
 *   - Honours `errorToast: false` (caller renders the error themselves).
 *   - Forwards caller-supplied `onSuccess` / `onError` callbacks.
 */
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { useApiMutation } from "@/hooks/use-api-mutation";

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  toastSpy.mockClear();
  cleanup();
});

describe("useApiMutation", () => {
  it("toasts a destructive error when the mutation rejects", async () => {
    let mutate: () => void = () => {};
    function Probe() {
      const m = useApiMutation({
        mutationFn: async () => {
          throw new Error("boom");
        },
      });
      mutate = () => m.mutate();
      return null;
    }
    render(wrap(<Probe />));
    mutate();
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Action failed",
        description: "boom",
        variant: "destructive",
      }),
    );
  });

  it("respects a custom errorToast title", async () => {
    let mutate: () => void = () => {};
    function Probe() {
      const m = useApiMutation({
        mutationFn: async () => {
          throw new Error("network down");
        },
        errorToast: "Could not save",
      });
      mutate = () => m.mutate();
      return null;
    }
    render(wrap(<Probe />));
    mutate();
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Could not save",
        description: "network down",
        variant: "destructive",
      }),
    );
  });

  it("does not toast when errorToast is false (caller renders inline)", async () => {
    let mutate: () => void = () => {};
    const callerOnError = vi.fn();
    function Probe() {
      const m = useApiMutation({
        mutationFn: async () => {
          throw new Error("custom");
        },
        errorToast: false,
        onError: callerOnError,
      });
      mutate = () => m.mutate();
      return null;
    }
    render(wrap(<Probe />));
    mutate();
    await waitFor(() => expect(callerOnError).toHaveBeenCalled());
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("toasts on success when successToast is provided", async () => {
    let mutate: () => void = () => {};
    function Probe() {
      const m = useApiMutation({
        mutationFn: async () => "ok",
        successToast: "Saved",
      });
      mutate = () => m.mutate();
      return null;
    }
    render(wrap(<Probe />));
    mutate();
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith({ title: "Saved" });
  });

  it("forwards caller onSuccess + onError callbacks", async () => {
    let mutateOk: () => void = () => {};
    let mutateFail: () => void = () => {};
    const onSuccess = vi.fn();
    const onError = vi.fn();
    function Probe() {
      const ok = useApiMutation({ mutationFn: async () => "ok", onSuccess });
      const fail = useApiMutation({
        mutationFn: async () => {
          throw new Error("nope");
        },
        onError,
      });
      mutateOk = () => ok.mutate();
      mutateFail = () => fail.mutate();
      return null;
    }
    render(wrap(<Probe />));
    mutateOk();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    mutateFail();
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

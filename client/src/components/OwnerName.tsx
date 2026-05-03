import { useUserNames } from "@/hooks/use-user-names";

interface OwnerNameProps {
  ownerUserId: number | null | undefined;
  fallbackName: string | null | undefined;
  emptyLabel?: string;
  className?: string;
  testId?: string;
}

export function OwnerName({
  ownerUserId,
  fallbackName,
  emptyLabel = "—",
  className,
  testId,
}: OwnerNameProps) {
  const { resolveName } = useUserNames();
  const name = resolveName(ownerUserId, fallbackName) || emptyLabel;
  return (
    <span className={className} data-testid={testId}>
      {name}
    </span>
  );
}

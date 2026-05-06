import { Redirect, useRoute } from "wouter";

export default function NcrLegacyRedirect() {
  const [, params] = useRoute<{ id: string }>("/quality/ncr/:id");
  const id = params?.id;
  return <Redirect to={id ? `/quality?ncr=${encodeURIComponent(id)}` : "/quality"} />;
}

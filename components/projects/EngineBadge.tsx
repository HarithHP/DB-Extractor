import { registry } from "@/lib/adapters/registry";
import { Badge } from "@/components/ui/badge";
import type { EngineId } from "@/lib/schemas";

export function EngineBadge({ engine }: { engine: EngineId }) {
  const adapter = registry[engine];
  return (
    <Badge variant={adapter.supportedInCurrentMilestone ? "default" : "secondary"}>
      {adapter.displayName}
    </Badge>
  );
}

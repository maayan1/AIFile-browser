import { CircleAlert } from "lucide-react";
import { t } from "@/i18n/catalog";

// NFR-10 banner: plain words only, never a code or technical detail. The engine being down is a
// real failure, so it uses `destructive` (DESIGN.md), as border and text on the background.
// Logical properties only, so `dir="rtl"` mirrors it.
export function EngineBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="alert"
      className="mx-3 my-2 flex items-center gap-2 rounded-md border border-destructive bg-background px-4 py-2 text-destructive"
    >
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      {t("engine.restarting")}
    </div>
  );
}

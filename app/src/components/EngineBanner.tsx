import { t } from "../i18n/catalog";

// NFR-10 banner: plain words only, never a code or technical detail. Logical CSS properties
// only (Tailwind 4 `px`/`py` are padding-inline/-block), so `dir="rtl"` mirrors it.
// The final look arrives with the theme in Story 1.3.
export function EngineBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div role="alert" className="rounded-md border border-red-700 px-4 py-2 text-red-800">
      {t("engine.restarting")}
    </div>
  );
}

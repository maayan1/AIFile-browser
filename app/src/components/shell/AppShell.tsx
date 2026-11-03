import { EngineBanner } from "@/components/EngineBanner";
import { FilterBar } from "./FilterBar";
import { MainArea, NavPane, PreviewPanel, StatusBar } from "./panes";
import { TopBar } from "./TopBar";

// The main window frame (UX-DR4), laid out like File Explorer. DOM order is the tab order:
// top bar → filter bar → nav pane → main list → Preview Panel → status bar (UX-DR22).
// Only logical properties, so `dir="rtl"` on <html> mirrors it all.
export function AppShell({ bannerVisible }: { bannerVisible: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <FilterBar />
      <EngineBanner visible={bannerVisible} />

      <div className="flex min-h-0 flex-1">
        <NavPane />
        <MainArea />
        <PreviewPanel />
      </div>

      <StatusBar />
    </div>
  );
}

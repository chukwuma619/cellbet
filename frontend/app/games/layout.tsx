import { AppHeader } from "@/components/app-header";

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <AppHeader />
      <main className="mx-auto flex w-full  flex-1 flex-col px-4 py-8">
        {children}
      </main>
    </div>
  );
}
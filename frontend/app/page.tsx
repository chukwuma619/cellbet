import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AppHeader } from "@/components/app-header";

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <AppHeader />
      <main className="mx-auto flex w-full  flex-1 flex-col px-4 py-8">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Games</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Provably fair crash on Nervos CKB — live rounds with verifiable
              outcomes after each settlement.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-primary/30">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Crash</CardTitle>
                  <Badge>Live</Badge>
                </div>
                <CardDescription>
                  Cash out before the multiplier crashes. Betting window before
                  each round.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/games/crash">Play Crash</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="opacity-60">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>More games</CardTitle>
                  <Badge variant="secondary">Soon</Badge>
                </div>
                <CardDescription>
                  Coin flip, dice, and more — same settlement patterns later.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="secondary" disabled>
                  Coming soon
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

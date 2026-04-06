"use client";

export function DemoCreditsCallout() {
  return (
    <div className="bg-muted/50 space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium text-foreground">Demo credits (off-chain)</p>
      <p className="text-muted-foreground leading-relaxed">
        Stakes use <span className="text-foreground">abstract demo units</span>{" "}
        in this app&apos;s database only. They are{" "}
        <span className="text-foreground">not CKB</span>, not moved on-chain,
        and have <span className="text-foreground">no real monetary value</span>.
        Your connected wallet address is used only as{" "}
        <span className="text-foreground">identity</span> for this demo. When
        this product adds a tracked non-chain balance, it will be labeled here
        the same way.
      </p>
    </div>
  );
}

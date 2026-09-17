import { GlobeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function EmptyState({ onPick }: { readonly onPick: (text: string) => void }) {
  return <section className="mx-auto max-w-lg space-y-5 py-16 text-center">
    <GlobeIcon className="mx-auto size-9 text-muted-foreground" aria-hidden />
    <h1 className="text-2xl font-semibold tracking-tight">Find your next opportunity.</h1>
    <p className="text-sm leading-6 text-muted-foreground">Paste a website URL to find opportunities. I’ll explore the site and collect everything available.</p>
    <Button variant="outline" onClick={() => onPick("Show my sources")}>Show my sources</Button>
  </section>
}

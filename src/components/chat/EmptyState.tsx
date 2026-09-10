import { MessageCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

const suggestions: ReadonlyArray<string> = [
  "Summarize the key risks in a fixed-price construction bid",
  "Write a TypeScript function that parses a CSV line, with tests",
  "Explain Effect's Layer system like I'm a React developer",
  "Draft a polite follow-up email to a subcontractor about a late quote",
]

export function EmptyState({ onPick }: { readonly onPick: (text: string) => void }) {
  return (
    <Empty className="min-h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircleIcon />
        </EmptyMedia>
        <EmptyTitle>What can I help with?</EmptyTitle>
        <EmptyDescription>Ask anything. Answers stream in as Markdown, and you can stop or retry at any point.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {suggestions.map((text) => (
            <Button
              key={text}
              variant="outline"
              className="h-auto justify-start whitespace-normal py-2.5 text-left text-sm font-normal text-muted-foreground hover:text-foreground"
              onClick={() => onPick(text)}
            >
              {text}
            </Button>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  )
}

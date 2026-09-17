import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AlertCircleIcon, RotateCcwIcon } from "lucide-react"
import { canRetryAtom, chatFailureValueAtom, isGeneratingAtom, Regenerate, sendMessageAtom } from "@/atoms/chat"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function StatusBar() {
  const generating = useAtomValue(isGeneratingAtom)
  const failure = useAtomValue(chatFailureValueAtom)
  const canRetry = useAtomValue(canRetryAtom)
  const send = useAtomSet(sendMessageAtom)

  const retry = (
    <Button variant="outline" size="sm" onClick={() => send(Regenerate)} disabled={!canRetry}>
      <RotateCcwIcon className="size-3.5" />
      Retry
    </Button>
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6" aria-live="polite" aria-atomic="true">
      {generating ? (
        <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Generating…
        </div>
      ) : failure && failure.kind === "interrupted" ? (
        <div className="flex h-8 items-center gap-3 text-xs text-muted-foreground">
          <span>Stopped.</span>
          {retry}
        </div>
      ) : failure ? (
        <Alert variant="destructive" className="my-2">
          <AlertCircleIcon />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{failure.message}</AlertDescription>
          <div className="col-start-2 mt-1.5">{retry}</div>
        </Alert>
      ) : (
        <div className="h-2" />
      )}
    </div>
  )
}

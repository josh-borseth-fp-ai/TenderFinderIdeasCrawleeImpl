import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useRef, useState } from "react"
import { CheckIcon, ExternalLinkIcon, GlobeIcon, LoaderCircleIcon } from "lucide-react"
import { conversationActionAtom, resultsAtom } from "@/atoms/chat"
import { dataOr, failureMessage, sourceEventsAtom } from "@/atoms/sources"
import type { ConversationAction, SourceCard as SourceCardData } from "@/domain/Conversation"
import { Button } from "@/components/ui/button"

function Results({ id }: { readonly id: string }) {
  const [page, setPage] = useState(1)
  const result = useAtomValue(resultsAtom(`${id}:${page}`))
  const data = dataOr(result, null)
  const error = failureMessage(result)
  if (!data) return <p role={error ? "alert" : "status"} className="text-sm text-muted-foreground">{error || "Loading opportunities…"}</p>
  const pages = Math.max(1, Math.ceil(data.collection.count / 50))
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {data.records.length === 0 ? <p className="text-sm text-muted-foreground">{data.collection.state === "running" ? "Opportunities will appear here as they are found." : "No matching opportunities were found."}</p> : <ul className="divide-y rounded-xl border">
      {data.records.map((record) => <li key={record.id}>
        <details className="px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium leading-6"><span>{record.title}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{[record.buyer, record.deadline ?? record.deadlineRaw].filter(Boolean).join(" · ") || "Open for details"}</span></summary>
          <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="my-3 inline-flex items-center gap-1 text-xs underline">View opportunity <ExternalLinkIcon className="size-3" /></a>
          <dl className="space-y-3 text-xs">{Object.entries(record).filter(([key, value]) => !["id", "sourceId", "sourceUrl", "title", "extractedAt"].includes(key) && value != null && value !== "" && (!Array.isArray(value) || value.length > 0)).map(([key, value]) => <div key={key}><dt className="font-medium capitalize">{key.replace(/([A-Z])/g, " $1")}</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">{Array.isArray(value) ? value.join("\n") : String(value)}</dd></div>)}</dl>
        </details>
      </li>)}
    </ul>}
    {pages > 1 && <nav aria-label="Opportunity pages" className="flex items-center justify-between gap-2 text-xs">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages} · {data.collection.count.toLocaleString()} opportunities</span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
    </nav>}
  </div>
}

export function SourceCard({ card, conversationId, onAdjust }: { readonly card: SourceCardData; readonly conversationId: string; readonly onAdjust: (sourceId: string, name: string) => void }) {
  const { source, job, collection } = card
  useAtomValue(sourceEventsAtom(source.id))
  const request = useRef<{ key: string; id: string } | null>(null)
  const execute = useAtomSet(conversationActionAtom, { mode: "promise" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const running = job?.state === "queued" || job?.state === "running"
  const current = collection && collection.id === job?.id
  const confirmed = collection && source.approvedVersionId === collection.versionId
  const action = async (kind: ConversationAction["action"]) => {
    if (pending) return
    const key = `${kind}:${collection?.id ?? source.id}`
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    setPending(true); setError("")
    try { await execute({ payload: { requestId: request.current.id, conversationId, action: kind, sourceId: source.id, ...(collection ? { collectionId: collection.id } : {}) }, reactivityKeys: ["chat", "sources"] }); request.current = null }
    catch (error) { setError(error instanceof Error ? error.message : "That action failed. Please try again.") }
    finally { setPending(false) }
  }
  return <section aria-label={`Opportunities from ${source.brief.name}`} className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
    <div className="flex items-start gap-3"><GlobeIcon className="mt-1 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><h2 className="break-words text-sm font-semibold">{source.brief.name}</h2><p className="mt-1 truncate text-xs text-muted-foreground">{source.brief.seedUrls[0]}</p></div>{confirmed && <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckIcon className="size-3" /> Saved</span>}</div>
    <p role="status" className="flex items-center gap-2 text-sm">{running && <LoaderCircleIcon className="size-4 animate-spin" />}{running ? `${current ? collection.count.toLocaleString() : "0"} opportunities found · ${current ? "collecting" : "exploring the website"}` : collection ? `${collection.count.toLocaleString()} ${collection.count === 1 ? "opportunity" : "opportunities"} · ${collection.state === "complete" ? "collection complete" : "incomplete collection"}` : job?.state === "needs-input" ? "Waiting for your guidance" : "Discovery needs attention"}</p>
    {collection && <>
      {!current && <p className="text-xs text-muted-foreground">These are the previous collection’s results. {job?.state === "needs-input" ? "Reply above to continue the new discovery." : running ? "The new discovery is still in progress." : "The latest discovery has not completed."}</p>}
      {collection.state !== "complete" && <p className="text-xs leading-5 text-muted-foreground">{collection.state === "running" ? "Collection is in progress. More opportunities may appear." : collection.coverage}</p>}
      <Results key={collection.id} id={collection.id} />
    </>}
    {!collection && !running && job?.state === "failed" && <p className="text-sm text-muted-foreground">Discovery could not finish. Try again or adjust what to find.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {running ? <Button size="sm" variant="outline" disabled={pending} onClick={() => void action("stop")}>Stop</Button> : <>
        {current && collection.state === "complete" && !confirmed && <Button size="sm" disabled={pending} onClick={() => void action("save")}>Save this source</Button>}
        {source.approvedVersionId && <Button size="sm" variant="outline" disabled={pending} onClick={() => void action("refresh")}>Check again</Button>}
        {(job?.state === "failed" || job?.state === "interrupted" || job?.state === "cancelled" || (current && collection.state === "partial")) && <Button size="sm" variant="outline" disabled={pending} onClick={() => void action("continue")}>{collection ? "Continue collection" : "Try again"}</Button>}
      </>}
      <Button size="sm" variant="ghost" onClick={() => onAdjust(source.id, source.brief.name)}>Adjust what to find</Button>
      {collection && collection.count > 0 && <a className="ml-auto text-xs underline" href={`/api/sources?collectionId=${encodeURIComponent(collection.id)}`}>Download CSV</a>}
    </div>
  </section>
}

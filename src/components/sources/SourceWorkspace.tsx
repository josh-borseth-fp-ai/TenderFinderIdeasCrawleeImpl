import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Tabs } from "@base-ui/react/tabs"
import { sourcesAtom, sourceDetailAtom, sourceFilesAtom, sourceCommandAtom, sourceEventsAtom, noDetailAtom, noFilesAtom, noEventsAtom, dataOr, failureMessage, isWaiting } from "@/atoms/sources"
import { useState } from "react"
import { ArrowLeftIcon, CheckCircle2Icon, FileCodeIcon, GlobeIcon, LoaderCircleIcon, PlusIcon, SendIcon, ShieldCheckIcon, SquareIcon } from "lucide-react"
import { Streamdown } from "streamdown"
import type { Job, ScraperVersion, SourceBrief, SourceCommand, ValidationReport } from "@/domain/Source"
import { emptyBrief } from "@/domain/Source"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeEffect } from "@/components/theme/ThemeEffect"
import { ModeToggle } from "@/components/theme/ModeToggle"

const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
const active = (job: Job) => job.state === "queued" || job.state === "running"
type Tab = "Scope" | "Samples" | "Validation" | "Runbook" | "Files" | "Runs"

export function SourceWorkspace() {
  const navigate = useNavigate()
  const { source: selected } = getRouteApi("/sources").useSearch()
  const sourcesResult = useAtomValue(sourcesAtom)
  const detailResult = useAtomValue(selected ? sourceDetailAtom(selected) : noDetailAtom)
  const sources = dataOr(sourcesResult, [])
  const detail = dataOr(detailResult, null)
  const events = dataOr(useAtomValue(selected ? sourceEventsAtom(selected) : noEventsAtom), [])
  const send = useAtomSet(sourceCommandAtom, { mode: "promise" })
  const busy = useAtomValue(sourceCommandAtom, isWaiting)
  const [creating, setCreating] = useState(false)
  const [actionError, setError] = useState("")
  const [prompt, setPrompt] = useState("")
  const [tab, setTab] = useState<Tab>("Scope")
  const [versionId, setVersionId] = useState<string | null>(null)
  const [file, setFile] = useState("scraper.ts")
  const version = detail?.versions.find((version) => version.id === versionId) ?? detail?.versions[0]
  const filesResult = useAtomValue(version ? sourceFilesAtom(version.id) : noFilesAtom)
  const files = dataOr(filesResult, {})
  const error = actionError || failureMessage(sourcesResult) || failureMessage(detailResult) || failureMessage(filesResult)
  const choose = (id: string) => {
    void navigate({ to: "/sources", search: { source: id } })
    setCreating(false); setVersionId(null); setTab("Scope"); setPrompt(""); setError("")
  }
  const execute = async (command: SourceCommand) => {
    setError("")
    try {
      const result = await send({ payload: { command }, reactivityKeys: ["sources"] })
      if ("source" in result && command.action === "create") choose(result.source.id)
      if (command.action === "message") setPrompt("")
      if (command.action === "generate" || command.action === "message") setVersionId(null)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  const running = detail?.jobs.find(active)
  const stale = version && version.revision !== detail?.source.revision
  const canApprove = version?.report?.passed && !stale && !running && !busy && !version.approvedAt

  return <div className="flex min-h-dvh flex-col bg-background">
    <ThemeEffect />
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
      <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Chat</a>
      <span className="text-muted-foreground">/</span><span className="text-sm font-semibold">Source desk</span>
      <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Teach once. Review. Run with confidence.</span><ModeToggle />
    </header>
    {error && <div role="alert" className="flex items-start justify-between gap-4 border-b border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive"><span className="whitespace-pre-wrap">{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">✕</button></div>}
    <div className="grid flex-1 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b bg-muted/20 p-4 lg:border-r lg:border-b-0">
        <Button className="mb-5 w-full" onClick={() => { setCreating(true); setError("") }}><PlusIcon className="size-4" /> New source</Button>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Your sources · {sources.length}</p>
        <nav aria-label="Sources" className="flex gap-2 overflow-auto lg:flex-col">
          {sources.map((source) => <button key={source.id} onClick={() => choose(source.id)} className={`flex min-w-40 flex-col gap-1 rounded-lg px-3 py-3 text-left text-sm transition-colors ${source.id === selected && !creating ? "bg-accent" : "hover:bg-accent/60"}`}>
            <span className="flex items-center gap-2 font-medium"><GlobeIcon className="size-4 shrink-0" />{source.brief.name}</span>
            <span className="pl-6 text-xs text-muted-foreground">{source.approvedVersionId ? "Approved version available" : "Not approved yet"}</span>
          </button>)}
        </nav>
      </aside>
      {creating ? <main className="mx-auto w-full max-w-2xl p-6 md:p-10">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Source onboarding</p>
        <h1 className="mb-2 text-2xl font-semibold">What should we look for?</h1>
        <p className="mb-8 text-sm text-muted-foreground">Start with a public procurement index or opportunity page. Add the information you need and anything we should leave out.</p>
        <BriefForm key="new" brief={emptyBrief()} disabled={busy} submitLabel="Create source" onSave={(brief) => execute({ action: "create", brief })} />
      </main> : !detail ? <main className="flex min-h-96 flex-col items-center justify-center p-10 text-center">
        <GlobeIcon className="mb-5 size-10 text-muted-foreground" /><h1 className="mb-2 text-2xl font-semibold">Turn a source into a scraper</h1>
        <p className="mb-6 max-w-md text-sm leading-6 text-muted-foreground">Guide the agent to the right pages, review real bid samples, and approve a reusable scraper with its own tests and runbook.</p>
        <Button onClick={() => setCreating(true)}><PlusIcon className="size-4" /> Add your first source</Button>
      </main> : <main className="min-w-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-6 py-5">
          <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-semibold">{detail.source.brief.name}</h1><p className="mt-1 truncate text-xs text-muted-foreground">{detail.source.brief.seedUrls.join(" · ")}</p></div>
          {detail.source.approvedVersionId && <Badge variant="secondary"><ShieldCheckIcon className="mr-1 size-3" /> Approved</Badge>}
          <Button variant="outline" disabled={!detail.source.approvedVersionId || !!running || busy} onClick={() => { setTab("Runs"); void execute({ action: "run", sourceId: detail.source.id }) }}>Run approved version</Button>
        </div>
        <div className="grid min-h-[calc(100dvh-160px)] xl:grid-cols-[minmax(300px,0.85fr)_minmax(420px,1.15fr)]">
          <section className="flex min-w-0 flex-col border-b xl:border-r xl:border-b-0" aria-label="Onboarding conversation">
            <div className="flex-1 space-y-5 p-6">
              <div className="rounded-xl border bg-muted/20 p-4 text-sm leading-6"><p className="font-medium">A little guidance goes a long way.</p><p className="mt-1 text-muted-foreground">Tell me which opportunities matter, what fields you need, and what to exclude. I’ll investigate the source, write a scraper, and check it against real pages.</p></div>
              {detail.messages.map((message) => <article key={message.id} className={`rounded-xl p-4 text-sm ${message.role === "user" ? "ml-5 bg-muted" : "border"}`}><p className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "Source agent"}</p><Streamdown>{message.content}</Streamdown></article>)}
              {running && <div role="status" className="rounded-xl border p-4 text-sm"><div className="flex items-center gap-2 font-medium"><LoaderCircleIcon className="size-4 animate-spin" /> {running.kind === "run" ? "Running scraper" : "Working on this source"}</div><p className="mt-2 text-muted-foreground">{running.message}</p></div>}
              {events.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Investigation and run activity</summary><ol className="mt-3 space-y-2">{events.map((event) => <li key={event.id} className="break-words border-l pl-3">{event.message}</li>)}</ol></details>}
            </div>
            <form className="sticky bottom-0 space-y-3 border-t bg-background p-4" onSubmit={(event) => { event.preventDefault(); void execute({ action: "message", sourceId: detail.source.id, content: prompt }) }}>
              <label htmlFor="source-guidance" className="sr-only">Guidance or corrections</label><textarea id="source-guidance" className={`${inputClass} min-h-24 resize-y`} placeholder="For example: collect open construction bids, include submission instructions, and skip awarded contracts…" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!!running || busy} />
              <div className="flex flex-wrap justify-between gap-2">
                {running ? <Button type="button" variant="outline" disabled={busy} onClick={() => void execute({ action: "cancel", jobId: running.id })}><SquareIcon className="size-3" /> Stop</Button> : <Button type="button" variant="outline" disabled={busy} onClick={() => void execute({ action: "generate", sourceId: detail.source.id })}>Investigate & generate</Button>}
                <Button type="submit" disabled={!!running || busy || !prompt.trim()}><SendIcon className="size-4" /> Send guidance</Button>
              </div>
            </form>
          </section>
          <Tabs.Root value={tab} onValueChange={(value) => setTab(value as Tab)} className="min-w-0 bg-muted/10" aria-label="Source review">
            <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
              <span className="text-sm font-medium">Review workspace</span>
              {version && <select aria-label="Scraper version" className="ml-auto max-w-56 rounded-md border bg-background p-1.5 text-xs" value={version.id} onChange={(event) => setVersionId(event.target.value)}>{detail.versions.map((candidate, index) => <option key={candidate.id} value={candidate.id}>Version {detail.versions.length - index} · {candidate.approvedAt ? "approved" : candidate.report?.passed ? "validated" : "candidate"}</option>)}</select>}
            </div>
            <Tabs.List className="flex overflow-x-auto border-b px-3" aria-label="Review sections">{(["Scope", "Samples", "Validation", "Runbook", "Files", "Runs"] as Tab[]).map((name) => <Tabs.Tab key={name} value={name} className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium ${tab === name ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{name}</Tabs.Tab>)}</Tabs.List>
            <Tabs.Panel key={tab} value={tab} className="p-5" aria-label={tab}>
              {tab === "Scope" && <BriefForm key={`${detail.source.id}-${detail.source.revision}`} brief={detail.source.brief} disabled={busy || !!running} submitLabel="Save scope" onSave={(brief) => execute({ action: "update", sourceId: detail.source.id, revision: detail.source.revision, brief })} />}
              {tab !== "Scope" && tab !== "Runs" && !version && <p className="py-12 text-center text-sm text-muted-foreground">Generate a scraper to review its sample records, tests, and runbook.</p>}
              {tab === "Samples" && version && <Samples version={version} />}
              {tab === "Validation" && version && <Validation report={version.report} />}
              {tab === "Runbook" && version && <div className="chat-prose prose max-w-none text-sm"><Streamdown>{files["SCRAPER.md"] ?? version.draft.runbook}</Streamdown></div>}
              {tab === "Files" && version && <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><FileCodeIcon className="size-4" /><select aria-label="Package file" value={file} onChange={(event) => setFile(event.target.value)} className="max-w-full rounded-md border bg-background p-2 text-sm">{Object.keys(files).map((name) => <option key={name}>{name}</option>)}</select><a className="ml-auto text-xs underline" href={`/api/sources?versionId=${version.id}&kind=download`}>Download package</a></div><pre className="max-h-[60vh] overflow-auto rounded-lg border bg-background p-4 text-xs leading-5"><code>{files[file] ?? "Loading files…"}</code></pre><p className="break-all font-mono text-[10px] text-muted-foreground">SHA-256 {version.digest}</p></div>}
              {tab === "Runs" && <Runs jobs={detail.jobs} />}
            </Tabs.Panel>
            {version && <div className="mx-5 mb-5 space-y-3 rounded-xl border bg-background p-4">
              <p className="text-sm font-medium">{version.approvedAt ? "This version is approved" : stale ? "Source guidance has changed" : version.report?.passed ? "Ready for your review" : "Validation is required"}</p>
              <p className="text-xs leading-5 text-muted-foreground">{stale ? "Generate a new candidate for the current scope. An existing approved version remains available for manual runs." : "Review sample values, warnings, and the runbook. Approval saves this exact package for future manual runs."}</p>
              <div className="flex flex-wrap gap-2"><Button disabled={!canApprove} onClick={() => void execute({ action: "approve", sourceId: detail.source.id, versionId: version.id, digest: version.digest, revision: detail.source.revision })}><CheckCircle2Icon className="size-4" /> {version.approvedAt ? "Approved" : "Approve version"}</Button>{!version.approvedAt && <Button variant="outline" disabled={!!running || busy || !!stale} onClick={() => void execute({ action: "validate", sourceId: detail.source.id, versionId: version.id })}>Revalidate</Button>}</div>
            </div>}
          </Tabs.Root>
        </div>
      </main>}
    </div>
  </div>
}

function BriefForm({ brief, disabled, submitLabel, onSave }: { brief: SourceBrief; disabled: boolean; submitLabel: string; onSave: (brief: SourceBrief) => Promise<void> }) {
  const [value, setValue] = useState(brief)
  const [seeds, setSeeds] = useState(brief.seedUrls.join("\n"))
  const [domains, setDomains] = useState(brief.allowedDomains.join("\n"))
  const [includes, setIncludes] = useState(brief.includePatterns.join("\n"))
  const [excludes, setExcludes] = useState(brief.excludePatterns.join("\n"))
  const [required, setRequired] = useState(brief.requiredFields.join(", "))
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean)
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault()
    const seedUrls = lines(seeds)
    const allowedDomains = lines(domains).length ? lines(domains) : seedUrls.flatMap((url) => { try { return [new URL(url).hostname] } catch { return [] } })
    void onSave({ ...value, seedUrls, allowedDomains, includePatterns: lines(includes), excludePatterns: lines(excludes), requiredFields: required.split(",").map((field) => field.trim()).filter(Boolean) })
  }}>
    <label className="block text-xs font-medium">Source name<input className={`${inputClass} mt-1.5`} required maxLength={200} value={value.name} disabled={disabled} onChange={(event) => setValue({ ...value, name: event.target.value })} placeholder="City procurement portal" /></label>
    <label className="block text-xs font-medium">Starting pages or indexes<textarea className={`${inputClass} mt-1.5 min-h-20`} required value={seeds} disabled={disabled} onChange={(event) => setSeeds(event.target.value)} placeholder="https://example.org/opportunities" /><span className="mt-1 block font-normal text-muted-foreground">One public URL per line.</span></label>
    <label className="block text-xs font-medium">What to collect<textarea className={`${inputClass} mt-1.5 min-h-28`} value={value.guidance} disabled={disabled} onChange={(event) => setValue({ ...value, guidance: event.target.value })} placeholder="Describe the bids and fields that matter to you." /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.openOnly} disabled={disabled} onChange={(event) => setValue({ ...value, openOnly: event.target.checked })} /> Collect open bids only</label>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Domains, exclusions, and required fields</summary><div className="mt-4 space-y-4">
      <label className="block text-xs font-medium">Allowed domains<textarea className={`${inputClass} mt-1.5`} value={domains} disabled={disabled} onChange={(event) => setDomains(event.target.value)} placeholder="Defaults to the starting URL domains" /><span className="mt-1 block font-normal text-muted-foreground">Exact hostnames, one per line. Include any required API or asset hosts.</span></label>
      <label className="block text-xs font-medium">Include opportunity URLs matching<textarea className={`${inputClass} mt-1.5`} value={includes} disabled={disabled} onChange={(event) => setIncludes(event.target.value)} placeholder="For example: */opportunities/*" /></label>
      <label className="block text-xs font-medium">Exclude URLs or record text matching<textarea className={`${inputClass} mt-1.5`} value={excludes} disabled={disabled} onChange={(event) => setExcludes(event.target.value)} placeholder="For example: awarded (one pattern per line)" /><span className="mt-1 block font-normal text-muted-foreground">Patterns are case-insensitive; * matches any text.</span></label>
      <label className="block text-xs font-medium">Required fields<input className={`${inputClass} mt-1.5`} value={required} disabled={disabled} onChange={(event) => setRequired(event.target.value)} /><span className="mt-1 block font-normal text-muted-foreground">Comma-separated field names. Title and sourceUrl are always required.</span></label>
    </div></details>
    <Button type="submit" disabled={disabled}>{submitLabel}</Button>
  </form>
}

function Samples({ version }: { version: ScraperVersion }) {
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">{version.samples.length} sample records. Open a record to inspect all fields and source evidence.</p>{version.samples.map((record) => <details key={record.id} className="rounded-xl border bg-background p-4"><summary className="cursor-pointer"><span className="font-medium">{record.title}</span><span className="mt-2 block text-xs text-muted-foreground">{record.buyer ?? "Buyer not provided"} · {record.status} · {record.deadline ?? record.deadlineRaw ?? "Deadline not provided"}</span></summary><a href={record.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-xs underline">View source page ↗</a><dl className="mt-4 space-y-3 text-xs">{Object.entries(record).filter(([key]) => !["id", "sourceId", "sourceUrl", "title"].includes(key)).map(([key, value]) => <div key={key}><dt className="font-medium">{key}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{value === null || value === "" ? "Not provided" : Array.isArray(value) ? value.join("\n") || "None" : String(value)}</dd></div>)}</dl></details>)}</div>
}
function Validation({ report }: { report: ValidationReport | null }) {
  if (!report) return <p className="text-sm text-muted-foreground">Validation has not completed.</p>
  return <div className="space-y-5"><Badge variant={report.passed ? "secondary" : "destructive"}>{report.passed ? "Passed" : "Needs attention"}</Badge><dl className="grid grid-cols-2 gap-4 text-sm">{[["Fixture tests", report.testsPassed ? "Passed" : "Not passed"], ["Valid records", report.recordCount], ["Visited pages", report.visitedCount], ["Excluded", report.excludedCount], ["Duplicates removed", report.duplicateCount]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl><p className="text-sm text-muted-foreground">{report.coverage}</p>{report.errors.length > 0 && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><p className="mb-2 font-semibold">Errors</p><ul className="list-inside list-disc space-y-2">{report.errors.map((error, i) => <li key={i} className="whitespace-pre-wrap break-words">{error}</li>)}</ul></div>}{report.warnings.length > 0 && <div className="rounded-lg border p-3 text-xs"><p className="mb-2 font-semibold">Review warnings</p><ul className="list-inside list-disc space-y-2 text-muted-foreground">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}</div>
}
function Runs({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <p className="text-sm text-muted-foreground">No runs yet.</p>
  return <div className="space-y-4">{jobs.map((job) => <article key={job.id} className="space-y-3 rounded-xl border bg-background p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium capitalize">{job.kind === "run" ? "Manual run" : job.kind}</span><Badge variant={job.state === "failed" ? "destructive" : "secondary"}>{job.state}</Badge></div><p className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-xs">{job.message}</p>{job.report && <><p className="text-xs text-muted-foreground">{job.report.recordCount} records · {job.report.coverage}</p><div className="flex gap-4 text-xs"><a className="underline" href={`/api/sources?jobId=${job.id}`}>Download JSON</a><a className="underline" href={`/api/sources?jobId=${job.id}&kind=csv`}>Download CSV</a></div></>}{job.versionId && <p className="break-all font-mono text-[10px] text-muted-foreground">Version {job.versionId}</p>}</article>)}</div>
}

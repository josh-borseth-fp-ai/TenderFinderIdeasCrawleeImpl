import Docker from "dockerode"
import { Effect, Schedule, Schema } from "effect"
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, chmodSync, realpathSync, readdirSync, openSync, closeSync, fstatSync, readFileSync, unlinkSync, constants, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { PassThrough, type Duplex } from "node:stream"
import { createInterface } from "node:readline"
import { MANUAL_LIMITS, RunnerResult, RunnerBatch, RuntimePin, PackageFiles } from "../../../runner/contract.ts"
export { RunnerResult } from "../../../runner/contract.ts"

export interface RunOptions { signal: AbortSignal; timeoutSeconds: number; inspect?: boolean; test?: boolean; fixture?: boolean; onProgress?: (partial: RunnerResult) => void; collectionDirectory?: string; onRecords?: (records: readonly unknown[]) => void }
export interface PackageRunner {
  identity?(signal: AbortSignal): Promise<string>
  run(files: PackageFiles, domains: readonly string[], options: RunOptions): Promise<RunnerResult>
}

const hardened: Docker.HostConfig = { CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], ReadonlyRootfs: true }
const node = ["node", "--import", "/opt/runner/node_modules/tsx/dist/loader.mjs"]

/** Read only after the worker has stopped. Its storage is untrusted: never follow
 * links out of the collection or accept unbounded/malformed delivery files. */
export function recoverRecordDelivery(directory: string, onRecords: (records: readonly unknown[]) => void) {
  const root = realpathSync(directory), delivery = join(root, "record-delivery")
  if (!existsSync(delivery)) return
  if (realpathSync(delivery) !== delivery) throw new Error("Invalid record delivery directory")
  for (const name of readdirSync(delivery)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
    const path = join(delivery, name)
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Invalid record delivery file")
      const batch = Schema.decodeSync(Schema.fromJsonString(RunnerBatch))(readFileSync(fd, "utf8"))
      if (batch.records.length > 100) throw new Error("Invalid record delivery batch")
      onRecords(batch.records)
    } finally { closeSync(fd) }
    unlinkSync(path)
  }
}

export class DockerRunner implements PackageRunner {
  constructor(
    private readonly image = process.env.SCRAPER_RUNNER_IMAGE ?? "bid-desk-runner:1",
    private readonly owner = "standalone",
    private readonly docker = new Docker(),
  ) {}

  async identity(signal: AbortSignal) {
    signal.throwIfAborted()
    const { Id: id } = await this.docker.getImage(this.image).inspect()
    if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("Invalid runtime image identity")
    await this.docker.getImage(id).tag({ repo: "bid-desk-runtime", tag: id.slice(7) })
    return id
  }

  async recover() {
    const filters = { label: [`bid-desk.owner=${this.owner}`] }
    const containers = await this.docker.listContainers({ all: true, filters })
    await Promise.all(containers.map(({ Id }) => this.docker.getContainer(Id).remove({ force: true })))
    const { Volumes } = await this.docker.listVolumes({ filters })
    await Promise.all((Volumes ?? []).map(({ Name }) => this.docker.getVolume(Name).remove()))
  }

  /** Dockerode demultiplexes Docker's transport; readline handles UTF-8 and framing. */
  private async execute(config: Docker.ContainerCreateOptions, signal: AbortSignal, onLine?: (line: string) => void, streaming = false, onStopped?: () => void) {
    signal.throwIfAborted()
    const container = this.docker.getContainer(config.name!)
    const stdout = new PassThrough(), stderr = new PassThrough()
    const chunks: Buffer[] = []
    let bytes = 0
    const collect = async (stream: PassThrough) => {
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk as Uint8Array)
        bytes += buffer.length
        if (!streaming && bytes > 30 * 1024 * 1024) throw new Error("Runner output exceeded its size limit")
        chunks.push(buffer)
        if (streaming) while (chunks.length > 1 && chunks.reduce((sum, part) => sum + part.length, 0) > 64 * 1024) chunks.shift()
      }
    }
    let attached: NodeJS.ReadWriteStream | undefined
    const cancel = () => { void container.remove({ force: true }).catch(() => {}) }
    signal.addEventListener("abort", cancel, { once: true })
    try {
      signal.throwIfAborted()
      await this.docker.createContainer({ ...config, AttachStdout: true, AttachStderr: true, abortSignal: signal })
      attached = await container.attach({ stream: true, stdout: true, stderr: true })
      this.docker.modem.demuxStream(attached, stdout, stderr)
      // The modem doesn't end its destination streams when Docker closes the attachment.
      attached.on("end", () => { stdout.end(); stderr.end() })
      attached.on("error", (error) => { stdout.destroy(error); stderr.destroy(error) })
      const lines = onLine ? createInterface({ input: stdout }) : undefined
      const reading = Promise.all([
        collect(stderr),
        collect(stdout),
        (async () => { if (lines) for await (const line of lines) onLine!(line) })(),
      ])
      // Attach a rejection handler before starting the container.
      void reading.catch(cancel)
      await container.start({ abortSignal: signal })
      const [result] = await Promise.all([container.wait(), reading])
      signal.throwIfAborted()
      return { code: result.StatusCode as number, output: Buffer.concat(chunks).toString("utf8") }
    } finally {
      signal.removeEventListener("abort", cancel)
      let removed = false
      await container.remove({ force: true }).then(() => { removed = true }).catch((error: unknown) => {
        if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) removed = true
      })
      stdout.destroy(); stderr.destroy()
      if (attached) (attached as Duplex).destroy()
      if (onStopped) {
        if (!removed) throw new Error("Could not verify worker shutdown; record delivery will resume after recovery")
        onStopped()
      }
    }
  }

  async run(files: PackageFiles, domains: readonly string[], options: RunOptions): Promise<RunnerResult> {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutSeconds * 1000)])
    const id = `bid-desk-${randomUUID()}`, gatewayName = `${id}-proxy`, volumeName = `${id}-socket`
    const directory = mkdtempSync(join(tmpdir(), "bid-desk-"))
    let gateway: Docker.Container | undefined
    let volume: Docker.Volume | undefined
    const Labels: Record<string, string> = { "bid-desk.runner": "true", "bid-desk.owner": this.owner }
    try {
      const image = files["runtime.json"] ? Schema.decodeSync(Schema.fromJsonString(RuntimePin))(files["runtime.json"]).image : this.image
      if (options.collectionDirectory) {
        if (files["runtime.json"] && Schema.decodeSync(Schema.fromJsonString(RuntimePin))(files["runtime.json"]).contractVersion !== 2) throw new Error("This saved scraper needs regeneration to support full collection.")
        mkdirSync(options.collectionDirectory, { recursive: true, mode: 0o777 })
        chmodSync(options.collectionDirectory, 0o777)
        if (!options.onRecords) throw new Error("Collection requires a durable record consumer")
        Labels["bid-desk.collection"] = createHash("sha256").update(realpathSync(options.collectionDirectory)).digest("hex")
        // A previous Docker connection failure may have left a worker alive.
        // Confirm its removal before replaying files or mounting the same queue.
        const abandoned = await this.docker.listContainers({ all: true, filters: { label: ["bid-desk.runner=true", `bid-desk.collection=${Labels["bid-desk.collection"]}`] } })
        for (const container of abandoned) await this.docker.getContainer(container.Id).remove({ force: true })
        recoverRecordDelivery(options.collectionDirectory, options.onRecords)
      }
      for (const [name, content] of Object.entries(files)) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("Unsafe package filename")
        writeFileSync(join(directory, name), content, { mode: 0o644 })
      }
      chmodSync(directory, 0o755)
      symlinkSync("/opt/runner/node_modules", join(directory, "node_modules"))
      await this.docker.getImage(image).inspect().catch(() => { throw new Error("Runtime image is unavailable. Build or restore the package's pinned image.") })
      if (!options.test) {
        volume = this.docker.getVolume(volumeName)
        await this.docker.createVolume({ Name: volumeName, Labels })
        gateway = this.docker.getContainer(gatewayName)
        await this.docker.createContainer({
          name: gatewayName, Image: image, Labels, abortSignal: signal,
          Cmd: [...node, "/opt/runner/proxy.ts", JSON.stringify(domains), ...(options.fixture ? ["--fixture"] : [])],
          Healthcheck: { Test: ["CMD", "test", "-S", "/proxy/egress.sock"], Interval: 1_000_000_000, Timeout: 1_000_000_000, Retries: 10 },
          HostConfig: { ...hardened, Memory: 256 * 1024 * 1024, NanoCpus: 500_000_000, PidsLimit: 64, Tmpfs: { "/tmp": "rw,nosuid,size=32m" }, Mounts: [{ Type: "volume", Source: volumeName, Target: "/proxy" }] },
        })
        await gateway.start({ abortSignal: signal })
        const proxy = gateway
        await Effect.runPromise(Effect.tryPromise(async () => {
          const status = await proxy.inspect({ abortSignal: signal })
          if (status.State.Health?.Status !== "healthy") throw new Error("Network gateway did not become healthy")
        }).pipe(Effect.retry(Schedule.spaced("200 millis")), Effect.timeout("12 seconds")), { signal })
      }
      const base: Docker.ContainerCreateOptions = {
        name: id, Image: image, Labels, User: "1000:1000", WorkingDir: "/work",
        HostConfig: {
          ...hardened, NetworkMode: "none", Memory: 2 * 1024 ** 3, MemorySwap: 2 * 1024 ** 3,
          NanoCpus: 2_000_000_000, PidsLimit: 256, ShmSize: 256 * 1024 ** 2, Tmpfs: { "/tmp": "rw,nosuid,size=256m,mode=1777" },
          Mounts: [
            { Type: "bind", Source: directory, Target: "/work", ReadOnly: true },
            ...(options.collectionDirectory ? [{ Type: "bind" as const, Source: options.collectionDirectory, Target: "/store" }] : []),
            ...(!options.test ? [{ Type: "volume" as const, Source: volumeName, Target: "/proxy", ReadOnly: true }] : []),
          ],
        },
      }
      if (options.test) {
        const check = await this.execute({ ...base, Cmd: ["node", "/opt/runner/node_modules/typescript/bin/tsc", "--noEmit", "--allowImportingTsExtensions", "--skipLibCheck", "--module", "nodenext", "--target", "es2022", "scraper.ts", "scraper.test.ts"] }, signal)
        if (check.code !== 0) throw new Error(`Package typecheck failed:\n${check.output.slice(-8000)}`)
        const tests = await this.execute({ ...base, Cmd: [...node, "/opt/runner/test.ts"] }, signal)
        if (tests.code !== 0) throw new Error(`Fixture tests failed or no tests executed:\n${tests.output.slice(-8000)}`)
        return { records: [], evidence: [], errors: [], visitedCount: 0, coverage: "Package typecheck and fixture tests passed." }
      }
      const partial: RunnerResult = { records: [], evidence: [], errors: [], visitedCount: 0, coverage: "Execution in progress; results are partial." }
      let decoded: RunnerResult | undefined
      const result = await this.execute({ ...base, Cmd: [...node, "/opt/runner/main.ts", ...(options.inspect ? ["--inspect"] : []), ...(options.collectionDirectory ? ["--collect"] : [])] }, signal, (line) => {
        if (line.startsWith("BID_DESK_RESULT=")) { decoded = Schema.decodeSync(Schema.fromJsonString(RunnerResult))(line.slice("BID_DESK_RESULT=".length)); return }
        if (!line.startsWith("BID_DESK_BATCH=")) return
        const batch = Schema.decodeSync(Schema.fromJsonString(RunnerBatch))(line.slice("BID_DESK_BATCH=".length))
        if (options.collectionDirectory) { options.onRecords?.(batch.records); return }
        if (partial.records.length + batch.records.length > MANUAL_LIMITS.maxRecords) throw new Error("Invalid runner checkpoint")
        partial.records.push(...batch.records); partial.visitedCount = batch.visitedCount
        options.onProgress?.(partial)
      }, !!options.collectionDirectory, options.collectionDirectory ? () => {
        // Only read worker files once removal is confirmed, including cancellation.
        if (options.collectionDirectory && options.onRecords) recoverRecordDelivery(options.collectionDirectory, options.onRecords)
      } : undefined)
      if (!decoded) throw new Error(`Runner failed (${result.code}): ${result.output.slice(-6000)}`)
      if (result.code !== 0 && decoded.errors.length === 0) decoded.errors.push(`Runner exited with code ${result.code}`)
      return decoded
    } catch (error) {
      if (signal.aborted) throw new Error(options.signal.aborted ? "Execution cancelled" : "Execution deadline exceeded")
      throw error
    } finally {
      await gateway?.remove({ force: true }).catch(() => {})
      await volume?.remove().catch(() => {})
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

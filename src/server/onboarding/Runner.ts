import Docker from "dockerode"
import { Effect, Schedule, Schema } from "effect"
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { PassThrough, type Duplex } from "node:stream"
import { createInterface } from "node:readline"
import { MANUAL_LIMITS, RunnerResult, RunnerBatch, RuntimePin, PackageFiles } from "../../../runner/contract.ts"
export { RunnerResult } from "../../../runner/contract.ts"

export interface RunOptions { signal: AbortSignal; timeoutSeconds: number; inspect?: boolean; test?: boolean; fixture?: boolean; onProgress?: (partial: RunnerResult) => void }
export interface PackageRunner {
  identity?(signal: AbortSignal): Promise<string>
  run(files: PackageFiles, domains: readonly string[], options: RunOptions): Promise<RunnerResult>
}

const hardened: Docker.HostConfig = { CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], ReadonlyRootfs: true }
const node = ["node", "--import", "/opt/runner/node_modules/tsx/dist/loader.mjs"]

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
  private async execute(config: Docker.ContainerCreateOptions, signal: AbortSignal, onLine?: (line: string) => void) {
    signal.throwIfAborted()
    const container = this.docker.getContainer(config.name!)
    const stdout = new PassThrough(), stderr = new PassThrough()
    const chunks: Buffer[] = []
    let bytes = 0
    const collect = async (stream: PassThrough) => {
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk as Uint8Array)
        bytes += buffer.length
        if (bytes > 30 * 1024 * 1024) throw new Error("Runner output exceeded its size limit")
        chunks.push(buffer)
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
      await container.remove({ force: true }).catch(() => {})
      stdout.destroy(); stderr.destroy()
      if (attached) (attached as Duplex).destroy()
    }
  }

  async run(files: PackageFiles, domains: readonly string[], options: RunOptions): Promise<RunnerResult> {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutSeconds * 1000)])
    const id = `bid-desk-${randomUUID()}`, gatewayName = `${id}-proxy`, volumeName = `${id}-socket`
    const directory = mkdtempSync(join(tmpdir(), "bid-desk-"))
    let gateway: Docker.Container | undefined
    let volume: Docker.Volume | undefined
    try {
      const image = files["runtime.json"] ? Schema.decodeSync(Schema.fromJsonString(RuntimePin))(files["runtime.json"]).image : this.image
      for (const [name, content] of Object.entries(files)) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("Unsafe package filename")
        writeFileSync(join(directory, name), content, { mode: 0o644 })
      }
      chmodSync(directory, 0o755)
      symlinkSync("/opt/runner/node_modules", join(directory, "node_modules"))
      await this.docker.getImage(image).inspect().catch(() => { throw new Error("Runtime image is unavailable. Build or restore the package's pinned image.") })
      const Labels = { "bid-desk.runner": "true", "bid-desk.owner": this.owner }
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
      const result = await this.execute({ ...base, Cmd: [...node, "/opt/runner/main.ts", ...(options.inspect ? ["--inspect"] : [])] }, signal, (line) => {
        if (line.startsWith("BID_DESK_RESULT=")) { decoded = Schema.decodeSync(Schema.fromJsonString(RunnerResult))(line.slice("BID_DESK_RESULT=".length)); return }
        if (!line.startsWith("BID_DESK_BATCH=")) return
        const batch = Schema.decodeSync(Schema.fromJsonString(RunnerBatch))(line.slice("BID_DESK_BATCH=".length))
        if (partial.records.length + batch.records.length > MANUAL_LIMITS.maxRecords) throw new Error("Invalid runner checkpoint")
        partial.records.push(...batch.records); partial.visitedCount = batch.visitedCount
        options.onProgress?.(partial)
      })
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

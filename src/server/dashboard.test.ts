import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Database as BunDatabase } from "bun:sqlite"
import { describe, expect, it } from "vitest"
import { buildDashboardPayload } from "./dashboard"
import { getStorageRoots } from "../ingest/session"

function mkStorageRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omo-storage-"))
  fs.mkdirSync(path.join(root, "session"), { recursive: true })
  fs.mkdirSync(path.join(root, "message"), { recursive: true })
  fs.mkdirSync(path.join(root, "part"), { recursive: true })
  return root
}

type BackgroundTaskFixture = {
  storageRoot: string
  projectRoot: string
  sessionId: string
}

function writeSessionMeta(storage: ReturnType<typeof getStorageRoots>, projectID: string, meta: Record<string, unknown>): void {
  const sessionMetaDir = path.join(storage.session, projectID)
  fs.mkdirSync(sessionMetaDir, { recursive: true })
  fs.writeFileSync(path.join(sessionMetaDir, `${meta.id}.json`), JSON.stringify(meta), "utf8")
}

function writeMessage(storage: ReturnType<typeof getStorageRoots>, sessionId: string, messageId: string, meta: Record<string, unknown>): void {
  const messageDir = path.join(storage.message, sessionId)
  fs.mkdirSync(messageDir, { recursive: true })
  fs.writeFileSync(path.join(messageDir, `${messageId}.json`), JSON.stringify(meta), "utf8")
}

function writeToolPart(storage: ReturnType<typeof getStorageRoots>, messageId: string, part: Record<string, unknown>): void {
  const partDir = path.join(storage.part, messageId)
  fs.mkdirSync(partDir, { recursive: true })
  fs.writeFileSync(path.join(partDir, `${part.id}.json`), JSON.stringify(part), "utf8")
}

// Builds a files-backend storage tree with a main session that launches background
// tasks via delegate_task tool parts, each linked to a child session with messages.
function mkBackgroundTasksFixture(opts: {
  tasks: Array<{
    callID: string
    messageId: string
    messageCreated: number
    description: string
    subagentType: string
    childSessionId: string
    childCreated: number
    childMessageId: string
    childMessageCreated: number
    childTool: string
  }>
}): BackgroundTaskFixture {
  const storageRoot = mkStorageRoot()
  const storage = getStorageRoots(storageRoot)
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
  const sessionId = "ses_main"
  const projectID = "proj_1"

  writeSessionMeta(storage, projectID, {
    id: sessionId,
    projectID,
    directory: projectRoot,
    time: { created: 1000, updated: 1000 },
  })

  for (const task of opts.tasks) {
    writeMessage(storage, sessionId, task.messageId, {
      id: task.messageId,
      sessionID: sessionId,
      role: "assistant",
      agent: "sisyphus",
      time: { created: task.messageCreated },
    })
    writeToolPart(storage, task.messageId, {
      id: `part_${task.callID}`,
      sessionID: sessionId,
      messageID: task.messageId,
      type: "tool",
      callID: task.callID,
      tool: "delegate_task",
      state: {
        status: "completed",
        input: {
          run_in_background: true,
          description: task.description,
          subagent_type: task.subagentType,
        },
      },
    })
    writeSessionMeta(storage, projectID, {
      id: task.childSessionId,
      projectID,
      directory: projectRoot,
      parentID: sessionId,
      title: `Background: ${task.description}`,
      time: { created: task.childCreated, updated: task.childCreated },
    })
    writeMessage(storage, task.childSessionId, task.childMessageId, {
      id: task.childMessageId,
      sessionID: task.childSessionId,
      role: "assistant",
      agent: task.subagentType,
      time: { created: task.childMessageCreated },
    })
    writeToolPart(storage, task.childMessageId, {
      id: `part_${task.childMessageId}`,
      sessionID: task.childSessionId,
      messageID: task.childMessageId,
      type: "tool",
      callID: `call_${task.childMessageId}`,
      tool: task.childTool,
      state: { status: "completed" },
    })
  }

  return { storageRoot, projectRoot, sessionId }
}

function cleanupFixture(fixture: BackgroundTaskFixture): void {
  fs.rmSync(fixture.storageRoot, { recursive: true, force: true })
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true })
}

type BackgroundTaskSpec = {
  callID: string
  messageId: string
  messageCreated: number
  description: string
  subagentType: string
  childSessionId: string
  childCreated: number
  childMessageId: string
  childMessageCreated: number
  childTool: string
}

function mkSqliteFixture(opts: {
  projectRoot: string
  tasks: BackgroundTaskSpec[]
}): { sqliteDataDir: string; sqlitePath: string } {
  const sqliteDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-data-"))
  const sqlitePath = path.join(sqliteDataDir, "opencode", "opencode.db")
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new BunDatabase(sqlitePath)
  db.run("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)")
  db.run("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
  db.run("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
  db.run(
    "INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["ses_main", "proj_1", null, opts.projectRoot, null, 1000, 1000],
  )

  for (const task of opts.tasks) {
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [
        task.messageId,
        "ses_main",
        task.messageCreated,
        task.messageCreated,
        JSON.stringify({
          id: task.messageId,
          sessionID: "ses_main",
          role: "assistant",
          agent: "sisyphus",
          time: { created: task.messageCreated },
        }),
      ],
    )
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        `part_${task.callID}`,
        task.messageId,
        "ses_main",
        task.messageCreated,
        task.messageCreated,
        JSON.stringify({
          id: `part_${task.callID}`,
          messageID: task.messageId,
          sessionID: "ses_main",
          type: "tool",
          callID: task.callID,
          tool: "delegate_task",
          state: {
            status: "completed",
            input: {
              run_in_background: true,
              description: task.description,
              subagent_type: task.subagentType,
            },
          },
        }),
      ],
    )
    db.run(
      "INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        task.childSessionId,
        "proj_1",
        "ses_main",
        opts.projectRoot,
        `Background: ${task.description}`,
        task.childCreated,
        task.childCreated,
      ],
    )
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [
        task.childMessageId,
        task.childSessionId,
        task.childMessageCreated,
        task.childMessageCreated,
        JSON.stringify({
          id: task.childMessageId,
          sessionID: task.childSessionId,
          role: "assistant",
          agent: task.subagentType,
          time: { created: task.childMessageCreated },
        }),
      ],
    )
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        `part_${task.childMessageId}`,
        task.childMessageId,
        task.childSessionId,
        task.childMessageCreated,
        task.childMessageCreated,
        JSON.stringify({
          id: `part_${task.childMessageId}`,
          messageID: task.childMessageId,
          sessionID: task.childSessionId,
          type: "tool",
          callID: `call_${task.childMessageId}`,
          tool: task.childTool,
          state: { status: "completed", input: {} },
        }),
      ],
    )
  }
  db.close()
  return { sqliteDataDir, sqlitePath }
}

describe("buildDashboardPayload", () => {
  it("surfaces 'running tool' status when session has in-flight tool", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
    const sessionId = "ses_running_tool"
    const messageId = "msg_1"
    const projectID = "proj_1"

    try {
      const sessionMetaDir = path.join(storage.session, projectID)
      fs.mkdirSync(sessionMetaDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessionMetaDir, `${sessionId}.json`),
        JSON.stringify({
          id: sessionId,
          projectID,
          directory: projectRoot,
          time: { created: 1000, updated: 1000 },
        }),
        "utf8"
      )

      const messageDir = path.join(storage.message, sessionId)
      fs.mkdirSync(messageDir, { recursive: true })
      fs.writeFileSync(
        path.join(messageDir, `${messageId}.json`),
        JSON.stringify({
          id: messageId,
          sessionID: sessionId,
          role: "assistant",
          agent: "sisyphus",
          time: { created: 1000 },
        }),
        "utf8"
      )

      const partDir = path.join(storage.part, messageId)
      fs.mkdirSync(partDir, { recursive: true })
      fs.writeFileSync(
        path.join(partDir, "part_1.json"),
        JSON.stringify({
          id: "part_1",
          sessionID: sessionId,
          messageID: messageId,
          type: "tool",
          callID: "call_1",
          tool: "delegate_task",
          state: { status: "running", input: {} },
        }),
        "utf8"
      )

      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 2000,
      })

      expect(payload.mainSession.statusPill).toBe("running tool")
      expect(payload.mainSession.currentTool).toBe("delegate_task")
      expect(payload.mainSession.agent).toBe("sisyphus")
      expect(payload.mainSession.currentModel).toBeNull()
      expect(payload.mainSession.sessionId).toBe(sessionId)
      
      expect(payload.raw).not.toHaveProperty("prompt")
      expect(payload.raw).not.toHaveProperty("input")

      expect(payload).toHaveProperty("mainSessionTasks")
      expect((payload as any).mainSessionTasks).toEqual([
        {
          id: "main-session",
          description: "Main session",
          subline: sessionId,
          agent: "sisyphus",
          lastModel: null,
          status: "running",
          toolCalls: 1,
          lastTool: "delegate_task",
          timeline: "1970-01-01T00:00:01Z: 1s",
          sessionId,
        },
      ])

      expect(payload.raw).toHaveProperty("mainSessionTasks.0.lastTool", "delegate_task")
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("includes mainSessionTasks in raw payload when no sessions exist", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))

    try {
      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 2000,
      })

      expect(payload).toHaveProperty("mainSessionTasks")
      expect((payload as any).mainSessionTasks).toEqual([])
      expect(payload.raw).toHaveProperty("mainSessionTasks")
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("surfaces 'thinking' status when latest assistant message is not completed", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
    const sessionId = "ses_thinking"
    const messageId = "msg_1"
    const projectID = "proj_1"

    try {
      const sessionMetaDir = path.join(storage.session, projectID)
      fs.mkdirSync(sessionMetaDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessionMetaDir, `${sessionId}.json`),
        JSON.stringify({
          id: sessionId,
          projectID,
          directory: projectRoot,
          time: { created: 1000, updated: 1000 },
        }),
        "utf8"
      )

      const messageDir = path.join(storage.message, sessionId)
      fs.mkdirSync(messageDir, { recursive: true })
      fs.writeFileSync(
        path.join(messageDir, `${messageId}.json`),
        JSON.stringify({
          id: messageId,
          sessionID: sessionId,
          role: "assistant",
          agent: "sisyphus",
          time: { created: 1000 },
        }),
        "utf8"
      )

      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 50_000,
      })

      expect(payload.mainSession.statusPill).toBe("thinking")
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("includes timeSeries and sanitized raw payload when no sessions exist", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))

    try {
      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 2000,
      })

      expect(payload).toHaveProperty("timeSeries")
      expect(payload.raw).toHaveProperty("timeSeries")
      expect(payload.mainSession.currentModel).toBeNull()
      expect(payload.mainSession.sessionId).toBeNull()

      const sensitiveKeys = ["prompt", "input", "output", "error", "state"]

      const hasSensitiveKeys = (value: unknown): boolean => {
        if (typeof value !== "object" || value === null) {
          return false
        }

        for (const key of Object.keys(value)) {
          if (sensitiveKeys.includes(key)) {
            return true
          }
          const nextValue = (value as Record<string, unknown>)[key]
          if (typeof nextValue === "object" && nextValue !== null) {
            if (hasSensitiveKeys(nextValue)) {
              return true
            }
          }
        }
        return false
      }

      expect(hasSensitiveKeys(payload.raw)).toBe(false)
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("includes latest model strings for main and background sessions", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
    const sessionId = "ses_with_models"
    const backgroundSessionId = "ses_bg_1"
    const messageId = "msg_1"
    const projectID = "proj_1"

    try {
      const sessionMetaDir = path.join(storage.session, projectID)
      fs.mkdirSync(sessionMetaDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessionMetaDir, `${sessionId}.json`),
        JSON.stringify({
          id: sessionId,
          projectID,
          directory: projectRoot,
          time: { created: 1000, updated: 1000 },
        }),
        "utf8"
      )
      fs.writeFileSync(
        path.join(sessionMetaDir, `${backgroundSessionId}.json`),
        JSON.stringify({
          id: backgroundSessionId,
          projectID,
          directory: projectRoot,
          parentID: sessionId,
          title: "Background: model task",
          time: { created: 1000, updated: 1100 },
        }),
        "utf8"
      )

      const messageDir = path.join(storage.message, sessionId)
      fs.mkdirSync(messageDir, { recursive: true })
      fs.writeFileSync(
        path.join(messageDir, `${messageId}.json`),
        JSON.stringify({
          id: messageId,
          sessionID: sessionId,
          role: "assistant",
          agent: "sisyphus",
          time: { created: 1000 },
        }),
        "utf8"
      )

      const partDir = path.join(storage.part, messageId)
      fs.mkdirSync(partDir, { recursive: true })
      fs.writeFileSync(
        path.join(partDir, "part_1.json"),
        JSON.stringify({
          id: "part_1",
          sessionID: sessionId,
          messageID: messageId,
          type: "tool",
          callID: "call_1",
          tool: "delegate_task",
          state: {
            status: "completed",
            input: {
              run_in_background: true,
              description: "model task",
              subagent_type: "explore",
            },
          },
        }),
        "utf8"
      )

      const backgroundMessageDir = path.join(storage.message, backgroundSessionId)
      fs.mkdirSync(backgroundMessageDir, { recursive: true })
      fs.writeFileSync(
        path.join(backgroundMessageDir, "msg_bg_1.json"),
        JSON.stringify({
          id: "msg_bg_1",
          sessionID: backgroundSessionId,
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-4o",
          time: { created: 1100 },
        }),
        "utf8"
      )

      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 2000,
      })

      expect(payload.mainSession.currentModel).toBeNull()
      expect(payload.backgroundTasks).toHaveLength(1)
      expect(payload.backgroundTasks[0]?.lastModel).toBe("openai/gpt-4o")
      expect(payload.raw).toHaveProperty("backgroundTasks.0.lastModel", "openai/gpt-4o")
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("does not include elapsed time in status pill when status is unknown", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
    const sessionId = "ses_unknown"
    const projectID = "proj_1"

    try {
      const sessionMetaDir = path.join(storage.session, projectID)
      fs.mkdirSync(sessionMetaDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessionMetaDir, `${sessionId}.json`),
        JSON.stringify({
          id: sessionId,
          projectID,
          directory: projectRoot,
          time: { created: 1000, updated: 1000 },
        }),
        "utf8"
      )

      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 65_000,
      })

      expect(payload.mainSession.statusPill).toBe("unknown")
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("includes tokenUsage totals and rows for main session", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
    const sessionId = "ses_token_usage"
    const messageId = "msg_token_1"
    const projectID = "proj_1"
    const providerID = "openai"
    const modelID = "gpt-4o"
    const expectedMessageTokens = {
      input: 12,
      output: 34,
      reasoning: 5,
      cache: {
        read: 2,
        write: 3,
      },
    }
    const expectedTotals = {
      input: 12,
      output: 34,
      reasoning: 5,
      cacheRead: 2,
      cacheWrite: 3,
      total: 56,
    }

    try {
      const sessionMetaDir = path.join(storage.session, projectID)
      fs.mkdirSync(sessionMetaDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessionMetaDir, `${sessionId}.json`),
        JSON.stringify({
          id: sessionId,
          projectID,
          directory: projectRoot,
          time: { created: 1000, updated: 1000 },
        }),
        "utf8"
      )

      const messageDir = path.join(storage.message, sessionId)
      fs.mkdirSync(messageDir, { recursive: true })
      fs.writeFileSync(
        path.join(messageDir, `${messageId}.json`),
        JSON.stringify({
          id: messageId,
          sessionID: sessionId,
          role: "assistant",
          providerID,
          modelID,
          tokens: expectedMessageTokens,
          time: { created: 1200 },
        }),
        "utf8"
      )

      type TokenUsageTotals = typeof expectedTotals
      type TokenUsageRow = {
        model: string
        input: number
        output: number
        reasoning: number
        cacheRead: number
        cacheWrite: number
        total: number
      }
      type DashboardPayloadWithTokenUsage = ReturnType<typeof buildDashboardPayload> & {
        tokenUsage: {
          totals: TokenUsageTotals
          rows: TokenUsageRow[]
        }
      }

      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 2000,
      }) as DashboardPayloadWithTokenUsage

      expect(payload).toHaveProperty("tokenUsage")
      expect(payload.tokenUsage.totals).toEqual(expectedTotals)
      expect(payload.tokenUsage.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            model: `${providerID}/${modelID}`,
            input: expectedTotals.input,
            output: expectedTotals.output,
            reasoning: expectedTotals.reasoning,
            cacheRead: expectedTotals.cacheRead,
            cacheWrite: expectedTotals.cacheWrite,
            total: expectedTotals.total,
          }),
        ])
      )
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("falls back to files when sqlite backend is unusable", () => {
    const storageRoot = mkStorageRoot()
    const storage = getStorageRoots(storageRoot)
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-project-"))
    const sqliteDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-data-"))
    const sqlitePath = path.join(sqliteDataDir, "opencode", "opencode.db")
    const sessionId = "ses_files_fallback"
    const messageId = "msg_1"
    const projectID = "proj_1"

    try {
      fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
      fs.writeFileSync(sqlitePath, "not a sqlite database", "utf8")

      const sessionMetaDir = path.join(storage.session, projectID)
      fs.mkdirSync(sessionMetaDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessionMetaDir, `${sessionId}.json`),
        JSON.stringify({
          id: sessionId,
          projectID,
          directory: projectRoot,
          time: { created: 1000, updated: 1000 },
        }),
        "utf8"
      )

      const messageDir = path.join(storage.message, sessionId)
      fs.mkdirSync(messageDir, { recursive: true })
      fs.writeFileSync(
        path.join(messageDir, `${messageId}.json`),
        JSON.stringify({
          id: messageId,
          sessionID: sessionId,
          role: "assistant",
          agent: "sisyphus",
          time: { created: 1000 },
        }),
        "utf8"
      )

      const partDir = path.join(storage.part, messageId)
      fs.mkdirSync(partDir, { recursive: true })
      fs.writeFileSync(
        path.join(partDir, "part_1.json"),
        JSON.stringify({
          id: "part_1",
          sessionID: sessionId,
          messageID: messageId,
          type: "tool",
          callID: "call_1",
          tool: "delegate_task",
          state: { status: "running", input: {} },
        }),
        "utf8"
      )

      const payload = buildDashboardPayload({
        projectRoot,
        storage,
        nowMs: 2000,
        storageBackend: {
          kind: "sqlite",
          dataDir: sqliteDataDir,
          sqlitePath,
        },
      })

      expect(payload.mainSession.sessionId).toBe(sessionId)
      expect(payload.mainSession.statusPill).toBe("running tool")
      expect(payload.mainSession.currentTool).toBe("delegate_task")
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
      fs.rmSync(sqliteDataDir, { recursive: true, force: true })
    }
  })

  it("populates startedAtMs for running background tasks and expectedDurationMs as same-agent median", () => {
    const fixture = mkBackgroundTasksFixture({
      tasks: [
        {
          callID: "call_a",
          messageId: "msg_a",
          messageCreated: 10_000,
          description: "Task A",
          subagentType: "explore",
          childSessionId: "ses_a",
          childCreated: 10_000,
          childMessageId: "msg_a1",
          childMessageCreated: 20_000,
          childTool: "grep",
        },
        {
          callID: "call_b",
          messageId: "msg_b",
          messageCreated: 30_000,
          description: "Task B",
          subagentType: "explore",
          childSessionId: "ses_b",
          childCreated: 30_000,
          childMessageId: "msg_b1",
          childMessageCreated: 40_000,
          childTool: "read",
        },
        {
          callID: "call_c",
          messageId: "msg_c",
          messageCreated: 90_000,
          description: "Task C",
          subagentType: "explore",
          childSessionId: "ses_c",
          childCreated: 90_000,
          childMessageId: "msg_c1",
          childMessageCreated: 95_000,
          childTool: "bash",
        },
      ],
    })

    try {
      const payload = buildDashboardPayload({
        projectRoot: fixture.projectRoot,
        storage: getStorageRoots(fixture.storageRoot),
        nowMs: 100_000,
      })

      expect(payload.backgroundTasks).toHaveLength(3)

      const byId = new Map(payload.backgroundTasks.map((t) => [t.id, t]))
      const taskA = byId.get("call_a")
      const taskB = byId.get("call_b")
      const taskC = byId.get("call_c")

      expect(taskA?.status).toBe("completed")
      expect(taskA?.startedAtMs).toBe(10_000)
      expect(taskB?.status).toBe("completed")
      expect(taskB?.startedAtMs).toBe(30_000)

      expect(taskC?.status).toBe("running")
      expect(taskC?.startedAtMs).toBe(90_000)

      // Completed explore durations: 20_000-10_000=10_000, 40_000-30_000=10_000 -> median 10_000
      expect(taskA?.expectedDurationMs).toBe(10_000)
      expect(taskB?.expectedDurationMs).toBe(10_000)
      expect(taskC?.expectedDurationMs).toBe(10_000)

      expect(payload.raw).toHaveProperty("backgroundTasks.0.startedAtMs")
      expect(payload.raw).toHaveProperty("backgroundTasks.0.expectedDurationMs")
    } finally {
      cleanupFixture(fixture)
    }
  })

  it("falls back to the global completed median when no same-agent completed task exists", () => {
    const fixture = mkBackgroundTasksFixture({
      tasks: [
        {
          callID: "call_a",
          messageId: "msg_a",
          messageCreated: 10_000,
          description: "Task A",
          subagentType: "explore",
          childSessionId: "ses_a",
          childCreated: 10_000,
          childMessageId: "msg_a1",
          childMessageCreated: 20_000,
          childTool: "grep",
        },
        {
          callID: "call_b",
          messageId: "msg_b",
          messageCreated: 30_000,
          description: "Task B",
          subagentType: "explore",
          childSessionId: "ses_b",
          childCreated: 30_000,
          childMessageId: "msg_b1",
          childMessageCreated: 40_000,
          childTool: "read",
        },
        {
          callID: "call_d",
          messageId: "msg_d",
          messageCreated: 85_000,
          description: "Task D",
          subagentType: "atlas",
          childSessionId: "ses_d",
          childCreated: 85_000,
          childMessageId: "msg_d1",
          childMessageCreated: 92_000,
          childTool: "bash",
        },
      ],
    })

    try {
      const payload = buildDashboardPayload({
        projectRoot: fixture.projectRoot,
        storage: getStorageRoots(fixture.storageRoot),
        nowMs: 100_000,
      })

      const byId = new Map(payload.backgroundTasks.map((t) => [t.id, t]))
      const taskD = byId.get("call_d")

      expect(taskD?.status).toBe("running")
      expect(taskD?.agent).toBe("atlas")
      // atlas has no completed tasks in the sweep -> global median of [10_000, 10_000]
      expect(taskD?.expectedDurationMs).toBe(10_000)
    } finally {
      cleanupFixture(fixture)
    }
  })

  it("emits null expectedDurationMs when no completed tasks exist in the sweep", () => {
    const fixture = mkBackgroundTasksFixture({
      tasks: [
        {
          callID: "call_c",
          messageId: "msg_c",
          messageCreated: 90_000,
          description: "Task C",
          subagentType: "explore",
          childSessionId: "ses_c",
          childCreated: 90_000,
          childMessageId: "msg_c1",
          childMessageCreated: 95_000,
          childTool: "bash",
        },
      ],
    })

    try {
      const payload = buildDashboardPayload({
        projectRoot: fixture.projectRoot,
        storage: getStorageRoots(fixture.storageRoot),
        nowMs: 100_000,
      })

      expect(payload.backgroundTasks).toHaveLength(1)
      expect(payload.backgroundTasks[0]?.status).toBe("running")
      expect(payload.backgroundTasks[0]?.startedAtMs).toBe(90_000)
      expect(payload.backgroundTasks[0]?.expectedDurationMs).toBeNull()
    } finally {
      cleanupFixture(fixture)
    }
  })

  it("produces identical startedAtMs and expectedDurationMs across files and sqlite backends", () => {
    const tasks: BackgroundTaskSpec[] = [
      {
        callID: "call_a",
        messageId: "msg_a",
        messageCreated: 10_000,
        description: "Task A",
        subagentType: "explore",
        childSessionId: "ses_a",
        childCreated: 10_000,
        childMessageId: "msg_a1",
        childMessageCreated: 20_000,
        childTool: "grep",
      },
      {
        callID: "call_b",
        messageId: "msg_b",
        messageCreated: 30_000,
        description: "Task B",
        subagentType: "explore",
        childSessionId: "ses_b",
        childCreated: 30_000,
        childMessageId: "msg_b1",
        childMessageCreated: 40_000,
        childTool: "read",
      },
      {
        callID: "call_c",
        messageId: "msg_c",
        messageCreated: 90_000,
        description: "Task C",
        subagentType: "explore",
        childSessionId: "ses_c",
        childCreated: 90_000,
        childMessageId: "msg_c1",
        childMessageCreated: 95_000,
        childTool: "bash",
      },
    ]

    const fixture = mkBackgroundTasksFixture({ tasks })
    const sqlite = mkSqliteFixture({ projectRoot: fixture.projectRoot, tasks })

    try {
      const filesPayload = buildDashboardPayload({
        projectRoot: fixture.projectRoot,
        storage: getStorageRoots(fixture.storageRoot),
        nowMs: 100_000,
      })
      const sqlitePayload = buildDashboardPayload({
        projectRoot: fixture.projectRoot,
        storage: getStorageRoots(fixture.storageRoot),
        nowMs: 100_000,
        storageBackend: {
          kind: "sqlite",
          dataDir: sqlite.sqliteDataDir,
          sqlitePath: sqlite.sqlitePath,
        },
      })

      expect(sqlitePayload.backgroundTasks).toHaveLength(3)
      expect(filesPayload.backgroundTasks).toHaveLength(3)

      const filesById = new Map(filesPayload.backgroundTasks.map((t) => [t.id, t]))
      for (const sqliteTask of sqlitePayload.backgroundTasks) {
        const filesTask = filesById.get(sqliteTask.id)
        expect(filesTask).toBeDefined()
        expect(sqliteTask.status).toBe(filesTask?.status)
        expect(sqliteTask.timeline).toBe(filesTask?.timeline)
        expect(sqliteTask.startedAtMs).toBe(filesTask?.startedAtMs)
        expect(sqliteTask.expectedDurationMs).toBe(filesTask?.expectedDurationMs)
      }
    } finally {
      cleanupFixture(fixture)
      fs.rmSync(sqlite.sqliteDataDir, { recursive: true, force: true })
    }
  })
})

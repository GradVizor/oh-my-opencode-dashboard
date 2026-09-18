import { describe, it, expect } from "vitest"
import { toDashboardPayload } from "./App"

describe('toDashboardPayload', () => {
  it('should preserve planProgress.steps from server JSON', () => {
    // #given: server JSON with planProgress.steps
    const serverJson: unknown = {
      mainSession: {
        agent: "sisyphus",
        currentTool: "dashboard_start",
        currentModel: "anthropic/claude-opus-4-5",
        lastUpdatedLabel: "just now",
        session: "test-session",
        statusPill: "busy",
      },
      planProgress: {
        name: "test-plan",
        completed: 2,
        total: 4,
        path: "/tmp/test-plan.md",
        statusPill: "in progress",
        steps: [
          { checked: true, text: "First completed task" },
          { checked: true, text: "Second completed task" },
          { checked: false, text: "Third pending task" },
          { checked: false, text: "Fourth pending task" },
        ],
      },
      backgroundTasks: [],
      timeSeries: {
        windowMs: 300000,
        buckets: 150,
        bucketMs: 2000,
        anchorMs: 1640995200000,
        serverNowMs: 1640995500000,
        series: [
          {
            id: "overall-main",
            label: "Overall",
            tone: "muted",
            values: new Array(150).fill(0),
          },
        ],
      },
    }

    // #when: converting to dashboard payload
    const payload = toDashboardPayload(serverJson)

    // #then: planProgress.steps should be preserved with correct structure
    expect(payload.planProgress.steps).toBeDefined()
    expect(payload.planProgress.steps).toEqual([
      { checked: true, text: "First completed task" },
      { checked: true, text: "Second completed task" },
      { checked: false, text: "Third pending task" },
      { checked: false, text: "Fourth pending task" },
    ])
  })

  it('should handle missing or malformed planProgress.steps defensively', () => {
    // #given: server JSON with malformed planProgress.steps
    const serverJson = {
      mainSession: {
        agent: "sisyphus",
        currentTool: "dashboard_start",
        currentModel: "anthropic/claude-opus-4-5",
        lastUpdatedLabel: "just now",
        session: "test-session",
        statusPill: "busy",
      },
      planProgress: {
        name: "test-plan",
        completed: 0,
        total: 0,
        path: "/tmp/test-plan.md",
        statusPill: "not started",
        steps: [
          { checked: true, text: "Valid step" },
          { checked: false }, // missing text
          { text: "Missing checked" }, // missing checked
          "invalid string", // wrong type
          null, // null value
          { checked: "not-boolean", text: "Invalid checked type" }, // wrong checked type
        ],
      },
      backgroundTasks: [],
      timeSeries: {
        windowMs: 300000,
        buckets: 150,
        bucketMs: 2000,
        anchorMs: 1640995200000,
        serverNowMs: 1640995500000,
        series: [
          {
            id: "overall-main",
            label: "Overall",
            tone: "muted",
            values: new Array(150).fill(0),
          },
        ],
      },
    }

    // #when: converting to dashboard payload
    const payload = toDashboardPayload(serverJson)

    // #then: should only include valid steps, ignore malformed ones
    expect(payload.planProgress.steps).toEqual([
      { checked: true, text: "Valid step" },
      { checked: false, text: "Missing checked" }, // default checked to false
      { checked: false, text: "Invalid checked type" }, // default checked to false for invalid boolean
    ])
  })

  it('should handle non-array planProgress.steps', () => {
    // #given: server JSON with non-array planProgress.steps
    const serverJson = {
      mainSession: {
        agent: "sisyphus",
        currentTool: "dashboard_start",
        currentModel: "anthropic/claude-opus-4-5",
        lastUpdatedLabel: "just now",
        session: "test-session",
        statusPill: "busy",
      },
      planProgress: {
        name: "test-plan",
        completed: 0,
        total: 0,
        path: "/tmp/test-plan.md",
        statusPill: "not started",
        steps: "not an array",
      },
      backgroundTasks: [],
      timeSeries: {
        windowMs: 300000,
        buckets: 150,
        bucketMs: 2000,
        anchorMs: 1640995200000,
        serverNowMs: 1640995500000,
        series: [
          {
            id: "overall-main",
            label: "Overall",
            tone: "muted",
            values: new Array(150).fill(0),
          },
        ],
      },
    }

    // #when: converting to dashboard payload
    const payload = toDashboardPayload(serverJson)

    // #then: should handle non-array steps gracefully
    expect(payload.planProgress.steps).toEqual([])
  })

  it('should parse mainSession.sessionId from camel or snake keys', () => {
    // #given: server JSON with main session id in camel and snake case
    const camelJson = {
      mainSession: {
        agent: "sisyphus",
        currentTool: "dashboard_start",
        currentModel: "anthropic/claude-opus-4-5",
        lastUpdatedLabel: "just now",
        session: "test-session",
        sessionId: "ses_main",
        statusPill: "busy",
      },
    }

    const snakeJson = {
      main_session: {
        agent: "sisyphus",
        current_tool: "dashboard_start",
        current_model: "anthropic/claude-opus-4-5",
        last_updated: "just now",
        session: "test-session",
        session_id: "ses_snake",
        status: "busy",
      },
    }

    // #when: converting to dashboard payload
    const camelPayload = toDashboardPayload(camelJson)
    const snakePayload = toDashboardPayload(snakeJson)

    // #then: sessionId should be preserved
    expect(camelPayload.mainSession.sessionId).toBe("ses_main")
    expect(snakePayload.mainSession.sessionId).toBe("ses_snake")
  })

  it('should preserve mainSessionTasks from server JSON', () => {
    // #given: server JSON with mainSessionTasks
    const serverJson = {
      mainSession: {
        agent: "sisyphus",
        currentTool: "dashboard_start",
        currentModel: "anthropic/claude-opus-4-5",
        lastUpdatedLabel: "just now",
        session: "test-session",
        sessionId: "ses_main",
        statusPill: "busy",
      },
      planProgress: {
        name: "test-plan",
        completed: 0,
        total: 0,
        path: "/tmp/test-plan.md",
        statusPill: "not started",
        steps: [],
      },
      mainSessionTasks: [
        {
          id: "main-session",
          description: "Main session",
          subline: "ses_main",
          agent: "sisyphus",
          lastModel: "anthropic/claude-opus-4-5",
          sessionId: "ses_main",
          status: "running",
          toolCalls: 3,
          lastTool: "delegate_task",
          timeline: "2026-01-01T00:00:00Z: 2m",
        },
      ],
      backgroundTasks: [],
      timeSeries: {
        windowMs: 300000,
        buckets: 150,
        bucketMs: 2000,
        anchorMs: 1640995200000,
        serverNowMs: 1640995500000,
        series: [
          {
            id: "overall-main",
            label: "Overall",
            tone: "muted",
            values: new Array(150).fill(0),
          },
        ],
      },
    }

    // #when
    const payload = toDashboardPayload(serverJson)

    // #then
    expect(payload.mainSessionTasks).toEqual([
      {
        id: "main-session",
        description: "Main session",
        subline: "ses_main",
        agent: "sisyphus",
        lastModel: "anthropic/claude-opus-4-5",
        sessionId: "ses_main",
        status: "running",
        toolCalls: 3,
        lastTool: "delegate_task",
        timeline: "2026-01-01T00:00:00Z: 2m",
        startedAtMs: null,
        expectedDurationMs: null,
      },
    ])
  })

  it('should preserve tokenUsage from server JSON', () => {
    type TokenUsage = {
      totals: {
        input: number
        output: number
        reasoning: number
        cacheRead: number
        cacheWrite: number
        total: number
      }
      rows: Array<{
        model: string
        input: number
        output: number
        reasoning: number
        cacheRead: number
        cacheWrite: number
        total: number
      }>
    }
    type DashboardPayloadWithTokenUsage = ReturnType<typeof toDashboardPayload> & {
      tokenUsage?: TokenUsage
    }

    // #given: server JSON with token usage totals and rows
    const tokenUsageKey = "tokenUsage"
    const serverJson: Record<string, unknown> = {
      mainSession: {
        agent: "sisyphus",
        currentTool: "dashboard_start",
        currentModel: "anthropic/claude-opus-4-5",
        lastUpdatedLabel: "just now",
        session: "test-session",
        statusPill: "busy",
      },
    }

    serverJson[tokenUsageKey] = {
      totals: {
        input: 120,
        output: 340,
        reasoning: 56,
        cacheRead: 12,
        cacheWrite: 8,
        total: 536,
      },
      rows: [
        {
          model: "anthropic/claude-opus-4-5",
          input: 100,
          output: 300,
          reasoning: 50,
          cacheRead: 10,
          cacheWrite: 5,
          total: 465,
        },
        {
          model: "openai/gpt-5.2",
          input: 20,
          output: 40,
          reasoning: 6,
          cacheRead: 2,
          cacheWrite: 3,
          total: 71,
        },
      ],
    }

    // #when: converting to dashboard payload
    const payload = toDashboardPayload(serverJson)
    const payloadWithTokenUsage = payload as DashboardPayloadWithTokenUsage

    // #then: tokenUsage should be preserved with correct shape
    expect(payloadWithTokenUsage.tokenUsage).toEqual({
      totals: {
        input: 120,
        output: 340,
        reasoning: 56,
        cacheRead: 12,
        cacheWrite: 8,
        total: 536,
      },
      rows: [
        {
          model: "anthropic/claude-opus-4-5",
          input: 100,
          output: 300,
          reasoning: 50,
          cacheRead: 10,
          cacheWrite: 5,
          total: 465,
        },
        {
          model: "openai/gpt-5.2",
          input: 20,
          output: 40,
          reasoning: 6,
          cacheRead: 2,
          cacheWrite: 3,
          total: 71,
        },
      ],
    })
  })
})

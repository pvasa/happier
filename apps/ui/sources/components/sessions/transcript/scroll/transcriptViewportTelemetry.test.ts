import { afterEach, describe, expect, it, vi } from 'vitest';

const GLOBAL_KEY = '__HAPPIER_TRANSCRIPT_VIEWPORT_EVENTS__';

type UnknownModule = Record<string, unknown>;

async function loadTelemetryModule(): Promise<UnknownModule> {
    try {
        return await import('./transcriptViewportTelemetry') as UnknownModule;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Cannot find module') || message.includes('Failed to resolve import')) {
            return {};
        }
        throw error;
    }
}

function requireFunction(
    module: UnknownModule,
    name: string,
): (...args: unknown[]) => unknown {
    const value = module[name];
    expect(typeof value).toBe('function');
    return value as (...args: unknown[]) => unknown;
}

function buildScrollWriteEvent(overrides: Record<string, unknown> = {}) {
    return {
        type: 'scroll-write',
        writer: 'web-dom-bottom',
        reason: 'initial-open',
        sessionId: 'session-1',
        platform: 'web',
        listImplementation: 'flash_v2',
        mode: 'follow-bottom',
        targetOffsetY: 120,
        previousOffsetY: 20,
        layoutHeight: 500,
        contentHeight: 900,
        distanceFromBottom: 0,
        timestampMs: 123,
        ...overrides,
    };
}

describe('transcript viewport telemetry', () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
        vi.unstubAllGlobals();
    });

    it('records nothing when disabled', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: false,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => unknown;
        };

        telemetry.record(buildScrollWriteEvent());

        expect(telemetry.snapshot()).toEqual({ events: [], droppedCount: 0 });
    });

    it('keeps the newest events in a bounded buffer', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            capacity: 2,
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => {
                events: Array<{
                    reason: string;
                    sessionId: string;
                    targetOffsetY: number;
                    timestampMs: number;
                }>;
                droppedCount: number;
            };
        };

        telemetry.record(buildScrollWriteEvent({
            reason: 'initial-open',
            sessionId: 'session-1',
            targetOffsetY: 10,
            timestampMs: 1,
        }));
        telemetry.record(buildScrollWriteEvent({
            reason: 'content-size-change',
            sessionId: 'session-2',
            targetOffsetY: 20,
            timestampMs: 2,
        }));
        telemetry.record(buildScrollWriteEvent({
            reason: 'layout-change',
            sessionId: 'session-3',
            targetOffsetY: 30,
            timestampMs: 3,
        }));

        const snapshot = telemetry.snapshot();
        expect(snapshot.droppedCount).toBe(1);
        expect(snapshot.events).toHaveLength(2);
        expect(snapshot.events.map((event) => event.targetOffsetY)).toEqual([20, 30]);
        expect(snapshot.events.map((event) => event.timestampMs)).toEqual([2, 3]);
        expect(snapshot.events.map((event) => event.reason)).toEqual(['content-size-change', 'layout-change']);
        expect(snapshot.events[0]?.sessionId).toMatch(/^session:/);
        expect(snapshot.events[1]?.sessionId).toMatch(/^session:/);
        expect(snapshot.events[0]?.sessionId).not.toBe('session-2');
        expect(snapshot.events[1]?.sessionId).not.toBe('session-3');
    });

    it('retains raw session redactions only while matching events remain buffered', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            capacity: 3,
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => {
                events: Array<{
                    sessionId: string;
                    targetOffsetY: number;
                    timestampMs: number;
                }>;
                droppedCount: number;
            };
        };

        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-a',
            targetOffsetY: 10,
            timestampMs: 1,
        }));
        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-b',
            targetOffsetY: 20,
            timestampMs: 2,
        }));
        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-a',
            targetOffsetY: 30,
            timestampMs: 3,
        }));

        const initialSnapshot = telemetry.snapshot();
        const rawSessionARedaction = initialSnapshot.events[0]?.sessionId;
        const rawSessionBRedaction = initialSnapshot.events[1]?.sessionId;
        expect(initialSnapshot.events.map((event) => event.targetOffsetY)).toEqual([10, 20, 30]);
        expect(initialSnapshot.events[2]?.sessionId).toBe(rawSessionARedaction);

        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-c',
            targetOffsetY: 40,
            timestampMs: 4,
        }));
        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-a',
            targetOffsetY: 50,
            timestampMs: 5,
        }));

        const stableSnapshot = telemetry.snapshot();
        expect(stableSnapshot.events.map((event) => event.targetOffsetY)).toEqual([30, 40, 50]);
        expect(stableSnapshot.events[0]?.sessionId).toBe(rawSessionARedaction);
        expect(stableSnapshot.events[2]?.sessionId).toBe(rawSessionARedaction);

        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-b',
            targetOffsetY: 60,
            timestampMs: 6,
        }));

        const snapshot = telemetry.snapshot();
        expect(snapshot.droppedCount).toBe(3);
        expect(snapshot.events.map((event) => event.targetOffsetY)).toEqual([40, 50, 60]);
        expect(snapshot.events[2]?.sessionId).toMatch(/^session:/);
        expect(snapshot.events[2]?.sessionId).not.toBe(rawSessionBRedaction);
        expect(snapshot.events[2]?.sessionId).not.toBe('raw-session-b');
    });

    it('omits sensitive transcript payload fields from recorded events', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => { events: Array<Record<string, unknown>>; droppedCount: number };
        };

        telemetry.record(buildScrollWriteEvent({
            text: 'transcript text must not be kept',
            content: { t: 'plain', v: { secret: 'payload' } },
            commandOutput: 'shell output',
            filePath: '/Users/example/private.txt',
            secret: 'token',
            decryptedPayload: { value: 'raw' },
        }));

        const snapshot = telemetry.snapshot();
        expect(snapshot.events).toHaveLength(1);
        expect(snapshot.events[0]).toMatchObject({
            type: 'scroll-write',
            targetOffsetY: 120,
            contentHeight: 900,
        });
        expect(snapshot.events[0]?.sessionId).not.toBe('session-1');
        expect(snapshot.events[0]).not.toHaveProperty('text');
        expect(snapshot.events[0]).not.toHaveProperty('content');
        expect(snapshot.events[0]).not.toHaveProperty('commandOutput');
        expect(snapshot.events[0]).not.toHaveProperty('filePath');
        expect(snapshot.events[0]).not.toHaveProperty('secret');
        expect(snapshot.events[0]).not.toHaveProperty('decryptedPayload');
    });

    it('sends sanitized events to an injected sink without using globals', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');
        const sink = vi.fn();

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            sink,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
        };

        telemetry.record(buildScrollWriteEvent({ text: 'do not leak' }));

        expect(sink).toHaveBeenCalledWith(expect.objectContaining({
            type: 'scroll-write',
        }));
        expect(sink.mock.calls[0]?.[0]?.sessionId).not.toBe('session-1');
        expect(sink.mock.calls[0]?.[0]).not.toHaveProperty('text');
        expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();
    });

    it('can mirror sanitized events to the console for native logcat probes', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

        const telemetry = createTranscriptViewportTelemetry({
            consoleLog: true,
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
        };

        telemetry.record(buildScrollWriteEvent({
            sessionId: 'raw-session-id',
            text: 'transcript text must not leak',
        }));

        expect(consoleLog).toHaveBeenCalledWith(
            'HAPPIER_TRANSCRIPT_VIEWPORT_EVENT',
            expect.stringContaining('"type":"scroll-write"'),
        );
        const loggedPayload = consoleLog.mock.calls[0]?.[1];
        expect(typeof loggedPayload).toBe('string');
        expect(loggedPayload).not.toContain('raw-session-id');
        expect(loggedPayload).not.toContain('transcript text must not leak');
    });

    it('keeps platform-specific index writer attribution', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => { events: Array<Record<string, unknown>>; droppedCount: number };
        };

        telemetry.record(buildScrollWriteEvent({ writer: 'web-scroll-to-index', targetOffsetY: 1 }));
        telemetry.record(buildScrollWriteEvent({ writer: 'native-scroll-to-index', targetOffsetY: 2 }));
        telemetry.record(buildScrollWriteEvent({ writer: 'legacy-scroll-to-index', targetOffsetY: 3 }));

        expect(telemetry.snapshot().events.map((event) => event.writer)).toEqual([
            'web-scroll-to-index',
            'native-scroll-to-index',
            'legacy-scroll-to-index',
        ]);
    });

    it('accepts passive drift as a typed scroll-write reason', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => { events: Array<Record<string, unknown>>; droppedCount: number };
        };

        telemetry.record(buildScrollWriteEvent({
            writer: 'mvcp-skip',
            reason: 'passive-drift',
        }));

        expect(telemetry.snapshot().events[0]).toMatchObject({
            type: 'scroll-write',
            writer: 'mvcp-skip',
            reason: 'passive-drift',
        });
    });

    it('drops coarse experiment scroll-write reasons', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => { events: Array<Record<string, unknown>>; droppedCount: number };
        };

        telemetry.record(buildScrollWriteEvent({
            writer: 'mvcp-skip',
            reason: 'experiment',
        }));

        expect(telemetry.snapshot()).toEqual({ events: [], droppedCount: 0 });
    });

    it('drops free-form measurement reasons that could smuggle sensitive text', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
            snapshot: () => { events: Array<Record<string, unknown>>; droppedCount: number };
        };

        telemetry.record({
            type: 'restore-decision',
            sessionId: 'session-raw',
            platform: 'web',
            listImplementation: 'flash_v2',
            mode: 'restore-distance',
            offsetY: 12,
            reason: '/Users/example/private.txt command output transcript snippet',
            timestampMs: 222,
        });

        expect(telemetry.snapshot().events[0]).toMatchObject({
            type: 'restore-decision',
            mode: 'restore-distance',
            offsetY: 12,
        });
        expect(telemetry.snapshot().events[0]).not.toHaveProperty('reason');
        expect(telemetry.snapshot().events[0]?.sessionId).not.toBe('session-raw');
    });

    it('does not expose the dev getter in production or while disabled', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');
        const installTranscriptViewportTelemetryGlobal = requireFunction(module, 'installTranscriptViewportTelemetryGlobal');

        const disabled = createTranscriptViewportTelemetry({ enabled: false }) as unknown;
        installTranscriptViewportTelemetryGlobal(disabled as never, { isDev: true } as never);
        expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();

        const production = createTranscriptViewportTelemetry({ enabled: true }) as unknown;
        installTranscriptViewportTelemetryGlobal(production as never, { isDev: false } as never);
        expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();
    });

    it('keeps singleton telemetry disabled outside dev even when tuning enables it', async () => {
        const module = await loadTelemetryModule();
        const recordTranscriptViewportTelemetryEvent = requireFunction(module, 'recordTranscriptViewportTelemetryEvent');
        const transcriptViewportTelemetry = module.transcriptViewportTelemetry as {
            configure: (options: { enabled: boolean; sink?: null }) => void;
            snapshot: () => { events: Array<Record<string, unknown>>; droppedCount: number };
        };
        vi.stubGlobal('__DEV__', false);
        transcriptViewportTelemetry.configure({ enabled: false, sink: null });

        recordTranscriptViewportTelemetryEvent(buildScrollWriteEvent(), {
            transcriptViewportTelemetryEnabled: true,
            transcriptViewportTelemetryMaxEvents: 16,
        });

        expect(transcriptViewportTelemetry.snapshot()).toEqual({ events: [], droppedCount: 0 });
        expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();
    });

    it('exposes a dev getter with events and dropped count when enabled', async () => {
        const module = await loadTelemetryModule();
        const createTranscriptViewportTelemetry = requireFunction(module, 'createTranscriptViewportTelemetry');
        const installTranscriptViewportTelemetryGlobal = requireFunction(module, 'installTranscriptViewportTelemetryGlobal');

        const telemetry = createTranscriptViewportTelemetry({
            enabled: true,
            capacity: 1,
            now: () => 100,
        }) as {
            record: (event: unknown) => void;
        };
        telemetry.record(buildScrollWriteEvent({ sessionId: 'session-one' }));
        telemetry.record(buildScrollWriteEvent({ sessionId: 'session-two' }));
        installTranscriptViewportTelemetryGlobal(telemetry as never, { isDev: true } as never);

        const getter = (globalThis as Record<string, unknown>)[GLOBAL_KEY];
        expect(typeof getter).toBe('function');
        const snapshot = (getter as () => { events: Array<Record<string, unknown>>; droppedCount: number })();
        expect(snapshot.droppedCount).toBe(1);
        expect(snapshot.events).toHaveLength(1);
        expect(snapshot.events[0]?.sessionId).toMatch(/^session:/);
        expect(snapshot.events[0]?.sessionId).not.toBe('session-two');
    });
});

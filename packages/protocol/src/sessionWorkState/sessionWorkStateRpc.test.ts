import { describe, expect, it } from 'vitest';

import {
    DaemonSessionGoalClearRequestV1Schema,
    DaemonSessionGoalSetRequestV1Schema,
    SessionGoalSetRequestV1Schema,
    SessionVendorPluginCatalogListResponseV1Schema,
    SessionWorkStateGetResponseV1Schema,
} from './sessionWorkStateRpc.js';
import { RPC_METHODS, SESSION_RPC_METHODS } from '../rpc.js';

describe('session work-state RPC contracts', () => {
    it('defines session-scoped RPC method ids', () => {
        expect(SESSION_RPC_METHODS.SESSION_WORK_STATE_GET).toBe('session.workState.get');
        expect(SESSION_RPC_METHODS.SESSION_GOAL_GET).toBe('session.goal.get');
        expect(SESSION_RPC_METHODS.SESSION_GOAL_SET).toBe('session.goal.set');
        expect(SESSION_RPC_METHODS.SESSION_GOAL_CLEAR).toBe('session.goal.clear');
        expect(RPC_METHODS.DAEMON_SESSION_GOAL_GET).toBe('daemon.sessionGoal.get');
        expect(RPC_METHODS.DAEMON_SESSION_GOAL_SET).toBe('daemon.sessionGoal.set');
        expect(RPC_METHODS.DAEMON_SESSION_GOAL_CLEAR).toBe('daemon.sessionGoal.clear');
        expect(SESSION_RPC_METHODS.SESSION_VENDOR_PLUGIN_CATALOG_LIST).toBe('session.vendorPluginCatalog.list');
        expect(SESSION_RPC_METHODS.SESSION_SKILL_CATALOG_LIST).toBe('session.skillCatalog.list');
    });

    it('parses work-state and vendor plugin catalog response shapes', () => {
        expect(SessionWorkStateGetResponseV1Schema.parse({ workState: null })).toEqual({ workState: null });
        expect(SessionGoalSetRequestV1Schema.parse({ objective: 'Ship goals', status: 'active', tokenBudget: null })).toEqual({
            objective: 'Ship goals',
            status: 'active',
            tokenBudget: null,
        });
        expect(SessionGoalSetRequestV1Schema.parse({ objective: 'Line one\nLine two' })).toEqual({
            objective: 'Line one\nLine two',
        });
        expect(SessionGoalSetRequestV1Schema.parse({ status: 'paused' })).toEqual({
            status: 'paused',
        });
        expect(SessionGoalSetRequestV1Schema.parse({ tokenBudget: 50_000 })).toEqual({
            tokenBudget: 50_000,
        });
        expect(SessionGoalSetRequestV1Schema.parse({ tokenBudget: null })).toEqual({
            tokenBudget: null,
        });
        expect(() => SessionGoalSetRequestV1Schema.parse({})).toThrow();
        expect(DaemonSessionGoalSetRequestV1Schema.parse({ sessionId: 's1', status: 'paused' })).toEqual({
            sessionId: 's1',
            status: 'paused',
        });
        expect(() => DaemonSessionGoalSetRequestV1Schema.parse({ status: 'paused' })).toThrow();
        expect(DaemonSessionGoalClearRequestV1Schema.parse({ sessionId: 's1' })).toEqual({ sessionId: 's1' });
        expect(SessionVendorPluginCatalogListResponseV1Schema.parse({
            vendorPlugins: [{ vendorPluginRef: 'plugin://gmail@openai-curated', name: 'gmail', enabled: true }],
        }).vendorPlugins[0]?.vendorPluginRef).toBe('plugin://gmail@openai-curated');
    });
});

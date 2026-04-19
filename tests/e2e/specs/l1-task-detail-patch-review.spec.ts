/**
 * L1 task detail patch review spec.
 * Verifies merge success and failure feedback paths in the TaskDetailPanel patch review UI.
 */

import { browser, expect, $ } from '@wdio/globals';
import { Header } from '../page-objects/components/Header';
import { StartupPage } from '../page-objects/StartupPage';
import { ensureWorkspaceOpen } from '../helpers/workspace-utils';
import { ensureCodeSessionOpen, isWorkspaceOpen } from '../helpers/workspace-helper';

type MockMode = 'success' | 'merge-error';

interface PatchReviewMockSnapshot {
  mode: string;
  taskId: string;
  calls: {
    summary: number;
    list: number;
    update: number;
    merge: number;
  };
  patches: Array<{
    patchId: string;
    status: string;
  }>;
}

async function installPatchReviewMock(mode: MockMode): Promise<string> {
  return browser.execute(async (mockMode: MockMode) => {
    type AgentPatchStatus = 'pending' | 'accepted' | 'rejected' | 'applied' | 'conflicted';
    interface AgentPatchRecord {
      patch_id: string;
      task_id: string;
      tool_call_id: string;
      relative_path: string;
      diff_preview: string;
      full_diff_ref?: string | null;
      status: AgentPatchStatus;
    }

    interface PatchReviewMockState {
      mode: string;
      taskId: string;
      calls: {
        summary: number;
        list: number;
        update: number;
        merge: number;
      };
      patches: AgentPatchRecord[];
    }

    interface AgentApiLike {
      getAgentTaskPatches: any;
      getAgentTaskPatchSummary: any;
      updateAgentTaskPatchStatus: any;
      mergeAgentTaskPatches: any;
    }

    interface AgentApiOriginalSnapshot {
      agentApi: AgentApiLike;
      getAgentTaskPatches: any;
      getAgentTaskPatchSummary: any;
      updateAgentTaskPatchStatus: any;
      mergeAgentTaskPatches: any;
    }

    interface PatchReviewMockHolder {
      originals: AgentApiOriginalSnapshot[];
      state: PatchReviewMockState;
    }

    type WindowWithPatchReviewMock = Window & {
      __OPENHARNESS_E2E_PATCH_REVIEW_MOCK__?: PatchReviewMockHolder;
      __OPENHARNESS_E2E_TASK_DETAIL__?: {
        triggerMerge?: (() => Promise<void>) | null;
      };
    };

    const w = window as WindowWithPatchReviewMock;
    w.__OPENHARNESS_E2E_TASK_DETAIL__ = {};

    const loadAgentApis = async (): Promise<AgentApiLike[]> => {
      const moduleIds = [
        '/src/infrastructure/api/service-api/AgentAPI.ts',
        '/src/infrastructure/api/service-api/AgentAPI',
      ];

      const resolved: AgentApiLike[] = [];

      for (const moduleId of moduleIds) {
        try {
          const imported = await import(moduleId) as { agentAPI?: AgentApiLike };
          const candidate = imported.agentAPI;
          if (!candidate) {
            continue;
          }
          if (!resolved.some(api => api === candidate)) {
            resolved.push(candidate);
          }
        } catch {
          // Ignore module id variants that cannot be resolved by the web bundle runtime.
        }
      }

      if (resolved.length === 0) {
        throw new Error('Unable to resolve AgentAPI module for patch review E2E mock');
      }

      return resolved;
    };

    const agentApis = await loadAgentApis();

    if (!w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__) {
      w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__ = {
        originals: agentApis.map((agentApi) => ({
          agentApi,
          getAgentTaskPatches: agentApi.getAgentTaskPatches,
          getAgentTaskPatchSummary: agentApi.getAgentTaskPatchSummary,
          updateAgentTaskPatchStatus: agentApi.updateAgentTaskPatchStatus,
          mergeAgentTaskPatches: agentApi.mergeAgentTaskPatches,
        })),
        state: {
          mode: mockMode,
          taskId: '',
          calls: {
            summary: 0,
            list: 0,
            update: 0,
            merge: 0,
          },
          patches: [],
        },
      };
    }

    const taskId = `e2e-task-detail-patch-review-${mockMode}`;
    const state: PatchReviewMockState = {
      mode: mockMode,
      taskId,
      calls: {
        summary: 0,
        list: 0,
        update: 0,
        merge: 0,
      },
      patches: [
        {
          patch_id: 'patch-e2e-001',
          task_id: taskId,
          tool_call_id: 'tool-call-e2e-001',
          relative_path: 'src/e2e_patch_review.ts',
          diff_preview: '@@ -1 +1 @@\n-console.log("old")\n+console.log("new")',
          full_diff_ref: null,
          status: 'pending',
        },
      ],
    };

    w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__.state = state;

    const summarize = (records: AgentPatchRecord[]) => {
      const summary = {
        total: records.length,
        pending: 0,
        accepted: 0,
        rejected: 0,
        applied: 0,
        conflicted: 0,
      };

      for (const record of records) {
        if (record.status === 'pending') summary.pending += 1;
        if (record.status === 'accepted') summary.accepted += 1;
        if (record.status === 'rejected') summary.rejected += 1;
        if (record.status === 'applied') summary.applied += 1;
        if (record.status === 'conflicted') summary.conflicted += 1;
      }

      return summary;
    };

    const cloneRecord = (record: AgentPatchRecord): AgentPatchRecord => ({ ...record });
    const recordsForTask = (): AgentPatchRecord[] => state.patches.map(cloneRecord);

    const mockedGetSummary = async (_incomingTaskId: string) => {
      state.calls.summary += 1;
      return summarize(recordsForTask());
    };

    const mockedGetPatches = async (_incomingTaskId: string) => {
      state.calls.list += 1;
      return recordsForTask();
    };

    const mockedUpdatePatchStatus = async (
      _incomingTaskId: string,
      patchId: string,
      nextStatus: AgentPatchStatus,
    ) => {
      state.calls.update += 1;
      const target = state.patches.find(record => record.patch_id === patchId);

      if (!target) {
        throw new Error(`Patch not found: ${patchId}`);
      }

      target.status = nextStatus;
      return cloneRecord(target);
    };

    const mockedMergePatches = async (_incomingTaskId: string) => {
      state.calls.merge += 1;

      if (mockMode === 'merge-error') {
        throw new Error('E2E forced merge failure');
      }

      const merged: AgentPatchRecord[] = [];
      for (const record of state.patches) {
        if (record.status === 'pending' || record.status === 'accepted') {
          record.status = 'applied';
          merged.push(cloneRecord(record));
        }
      }

      return merged;
    };

    for (const original of w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__.originals) {
      original.agentApi.getAgentTaskPatchSummary = mockedGetSummary;
      original.agentApi.getAgentTaskPatches = mockedGetPatches;
      original.agentApi.updateAgentTaskPatchStatus = mockedUpdatePatchStatus;
      original.agentApi.mergeAgentTaskPatches = mockedMergePatches;
    }

    const panelData = {
      toolItem: {
        id: `task-tool-e2e-${mockMode}`,
        type: 'tool',
        toolName: 'task',
        status: 'completed',
        toolResult: {
          success: true,
          result: {
            task_id: taskId,
            duration: 1200,
          },
        },
      },
      taskInput: {
        description: 'E2E patch review task',
        prompt: 'Verify patch review merge behavior',
        agentType: 'Explore',
      },
      sessionId: 'e2e-session-patch-review',
    };

    window.dispatchEvent(new CustomEvent('expand-right-panel'));
    window.dispatchEvent(new CustomEvent('agent-create-tab', {
      detail: {
        type: 'task-detail',
        title: 'E2E Patch Review',
        data: panelData,
        metadata: {
          taskId: panelData.toolItem.id,
        },
        checkDuplicate: false,
      },
    }));

    return taskId;
  }, mode);
}

async function restorePatchReviewMock(): Promise<void> {
  await browser.execute(async () => {
    interface AgentApiLike {
      getAgentTaskPatches: any;
      getAgentTaskPatchSummary: any;
      updateAgentTaskPatchStatus: any;
      mergeAgentTaskPatches: any;
    }

    interface AgentApiOriginalSnapshot {
      agentApi: AgentApiLike;
      getAgentTaskPatches: any;
      getAgentTaskPatchSummary: any;
      updateAgentTaskPatchStatus: any;
      mergeAgentTaskPatches: any;
    }

    interface PatchReviewMockHolder {
      originals: AgentApiOriginalSnapshot[];
    }

    type WindowWithPatchReviewMock = Window & {
      __OPENHARNESS_E2E_PATCH_REVIEW_MOCK__?: PatchReviewMockHolder;
      __OPENHARNESS_E2E_TASK_DETAIL__?: {
        triggerMerge?: (() => Promise<void>) | null;
      };
    };

    const w = window as WindowWithPatchReviewMock;
    const holder = w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__;
    if (!holder?.originals?.length) {
      return;
    }

    for (const original of holder.originals) {
      original.agentApi.getAgentTaskPatches = original.getAgentTaskPatches;
      original.agentApi.getAgentTaskPatchSummary = original.getAgentTaskPatchSummary;
      original.agentApi.updateAgentTaskPatchStatus = original.updateAgentTaskPatchStatus;
      original.agentApi.mergeAgentTaskPatches = original.mergeAgentTaskPatches;
    }

    delete w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__;
    delete w.__OPENHARNESS_E2E_TASK_DETAIL__;
  });
}

async function getPatchReviewMockSnapshot(): Promise<PatchReviewMockSnapshot | null> {
  return browser.execute(() => {
    interface PatchReviewMockState {
      mode: string;
      taskId: string;
      calls: {
        summary: number;
        list: number;
        update: number;
        merge: number;
      };
      patches: Array<{
        patch_id: string;
        status: string;
      }>;
    }

    type WindowWithPatchReviewMock = Window & {
      __OPENHARNESS_E2E_PATCH_REVIEW_MOCK__?: {
        state: PatchReviewMockState;
      };
    };

    const w = window as WindowWithPatchReviewMock;
    const state = w.__OPENHARNESS_E2E_PATCH_REVIEW_MOCK__?.state;
    if (!state) {
      return null;
    }

    return {
      mode: state.mode,
      taskId: state.taskId,
      calls: { ...state.calls },
      patches: state.patches.map(record => ({
        patchId: record.patch_id,
        status: record.status,
      })),
    };
  });
}

async function waitForPatchReviewPanel(taskId: string): Promise<WebdriverIO.Element> {
  const panel = await $(`.task-detail-panel__patch-review[data-task-id="${taskId}"]`);

  await panel.waitForExist({ timeout: 20000 });
  await panel.waitForDisplayed({ timeout: 20000 });

  await browser.waitUntil(async () => {
    return (await panel.$$('.task-detail-panel__patch-loading')).length === 0;
  }, {
    timeout: 10000,
    interval: 200,
    timeoutMsg: `Task detail patch review panel did not finish loading for task ${taskId}`,
  });

  await browser.waitUntil(async () => {
    return (await panel.$$('.task-detail-panel__patch-status')).length > 0;
  }, {
    timeout: 10000,
    interval: 200,
    timeoutMsg: `Task detail patch records did not render for task ${taskId}`,
  });

  return panel;
}

async function waitForMergeInvocation(): Promise<void> {
  await browser.waitUntil(async () => {
    const snapshot = await getPatchReviewMockSnapshot();
    return (snapshot?.calls.merge ?? 0) > 0;
  }, {
    timeout: 10000,
    interval: 200,
    timeoutMsg: 'Patch merge mock API was not invoked',
  });
}

async function triggerMergeThroughBridge(): Promise<void> {
  await browser.execute(async () => {
    const bridge = (window as Window & {
      __OPENHARNESS_E2E_TASK_DETAIL__?: {
        triggerMerge?: (() => Promise<void>) | null;
      };
    }).__OPENHARNESS_E2E_TASK_DETAIL__;

    const trigger = bridge?.triggerMerge;
    if (typeof trigger !== 'function') {
      throw new Error('TaskDetailPanel E2E merge bridge is not ready');
    }

    await trigger();
  });
}

describe('L1 Task Detail Patch Review', () => {
  let header: Header;
  let startupPage: StartupPage;
  let hasWorkspace = false;

  before(async () => {
    console.log('[L1] Starting task detail patch review tests');
    header = new Header();
    startupPage = new StartupPage();

    await browser.pause(3000);
    await header.waitForLoad();

    hasWorkspace = await ensureWorkspaceOpen(startupPage);
    if (!hasWorkspace) {
      hasWorkspace = await isWorkspaceOpen();
    }
    if (hasWorkspace) {
      await ensureCodeSessionOpen();
    }
  });

  beforeEach(async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    await restorePatchReviewMock();
  });

  afterEach(async () => {
    await restorePatchReviewMock();
  });

  it('should merge pending patches and show success feedback', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    const taskId = await installPatchReviewMock('success');
    const panel = await waitForPatchReviewPanel(taskId);

    await triggerMergeThroughBridge();
    await waitForMergeInvocation();

    await browser.waitUntil(async () => {
      return (await panel.$$('.task-detail-panel__patch-success')).length > 0;
    }, {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'Patch merge success message did not appear',
    });

    const successText = await (await panel.$('.task-detail-panel__patch-success')).getText();
    expect(/(成功|success)/i.test(successText)).toBe(true);

    await browser.waitUntil(async () => {
      return (await panel.$$('.task-detail-panel__patch-status--applied')).length > 0;
    }, {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'Patch status did not transition to applied',
    });

    const mergeButton = await panel.$('.task-detail-panel__patch-merge');
    await browser.waitUntil(async () => !(await mergeButton.isEnabled()), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'Patch merge button did not become disabled after merge',
    });

    const snapshot = await getPatchReviewMockSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.calls.merge).toBe(1);
    expect(snapshot?.patches.every(patch => patch.status === 'applied')).toBe(true);

  });

  it('should show merge error feedback and keep pending status', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    const taskId = await installPatchReviewMock('merge-error');
    const panel = await waitForPatchReviewPanel(taskId);

    await triggerMergeThroughBridge();
    await waitForMergeInvocation();

    await browser.waitUntil(async () => {
      return (await panel.$$('.task-detail-panel__patch-error')).length > 0;
    }, {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'Patch merge error message did not appear',
    });

    const errorText = await (await panel.$('.task-detail-panel__patch-error')).getText();
    expect(/(失败|failed|error)/i.test(errorText)).toBe(true);

    const statusCount = (await panel.$$('.task-detail-panel__patch-status')).length;
    const appliedCount = (await panel.$$('.task-detail-panel__patch-status--applied')).length;
    expect(statusCount).toBeGreaterThan(0);
    expect(appliedCount).toBe(0);

    const snapshot = await getPatchReviewMockSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.calls.merge).toBe(1);
    expect(snapshot?.patches.some(patch => patch.status === 'pending')).toBe(true);

  });
});

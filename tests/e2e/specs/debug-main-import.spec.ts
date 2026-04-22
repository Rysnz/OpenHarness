import { browser, expect } from '@wdio/globals';

describe('Debug Main Import', () => {
  it('captures entry-module import failures', async () => {
    const result = await browser.execute(async () => {
      const modules = [
        '/src/main.tsx',
        '/src/app/App.tsx',
        '/src/infrastructure/contexts/WorkspaceProvider.tsx',
        '/src/app/layout/AppLayout.tsx',
      ];

      const outcomes: Array<Record<string, unknown>> = [];

      for (const modulePath of modules) {
        try {
          await import(/* @vite-ignore */ `${modulePath}?debug=${Date.now()}`);
          outcomes.push({ modulePath, ok: true });
        } catch (error: any) {
          outcomes.push({
            modulePath,
            ok: false,
            name: error?.name ?? null,
            message: error?.message ?? String(error),
            stack: error?.stack ?? null,
          });
        }
      }

      return {
        outcomes,
        bodyHtml: document.body?.innerHTML?.slice(0, 2000) ?? '',
        rootHtml: document.getElementById('root')?.innerHTML?.slice(0, 2000) ?? '',
        bootDiagnostics: (window as any).__OPENHARNESS_BOOT_DIAGNOSTICS__ ?? null,
      };
    });

    // Keep this test intentionally non-strict; it is a diagnostics probe.
    console.log('[debug-main-import]', JSON.stringify(result, null, 2));
    expect(result).toBeDefined();
  });
});

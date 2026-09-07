import { requirePrincipal } from '@/auth';
import { errorReportCsv, getImportRun, type RowError } from '@/modules/inventory';
import { isAppError, toErrorResponse } from '@/modules/platform';

/**
 * Download the per-row error report for one import run.
 *
 * A route handler rather than a server action because the point is a *file*:
 * the operator opens it in the spreadsheet the broken upload came from, fixes
 * the named lines and re-uploads. Authorization is re-checked here exactly as it
 * is in an action — `getImportRun` refuses a run belonging to another store.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ importId: string }> },
): Promise<Response> {
  const { importId } = await context.params;

  try {
    const principal = await requirePrincipal();
    const run = await getImportRun(principal, importId);

    const errors = Array.isArray(run.errorsJson) ? (run.errorsJson as RowError[]) : [];
    const filename = `import-errors-${run.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}.csv`;

    return new Response(errorReportCsv(errors), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // `attachment` and a fixed name: never render a downloaded CSV inline.
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      const response = toErrorResponse(error);
      return Response.json(response.body, { status: response.status });
    }
    throw error;
  }
}

// Turns the helper's raw copy result into the report shown on the Results
// screen. Success is only claimed when every requested track was positively
// reported as copied. A track missing from the helper's response counts as
// failed, never as copied.

/**
 * @param {object} args
 * @param {Array}  args.requested           matches sent to the helper ({track, position, ...})
 * @param {Array}  [args.skippedDuplicates] matches skipped by duplicate handling
 * @param {object} args.helperResult        { destination, results, sourceUnchanged, aborted }
 */
export function buildReport({ requested, skippedDuplicates = [], helperResult }) {
  const byPosition = new Map((helperResult?.results ?? []).map((r) => [r.position, r]));
  const copied = [];
  const failed = [];

  for (const m of requested) {
    const r = byPosition.get(m.position);
    if (r && r.status === 'copied') {
      copied.push({ ...m });
    } else {
      failed.push({
        ...m,
        reason: r?.reason || 'No result was reported for this track, so it is treated as not copied.',
      });
    }
  }

  const sourceUnchanged = helperResult?.sourceUnchanged;
  let status;
  if (failed.length === 0 && copied.length === requested.length && requested.length > 0) status = 'success';
  else if (copied.length > 0) status = 'partial';
  else status = 'failed';

  return {
    status,
    destination: helperResult?.destination ?? null,
    copiedCount: copied.length,
    skippedCount: skippedDuplicates.length,
    failedCount: failed.length,
    copied,
    failed,
    skippedDuplicates,
    aborted: helperResult?.aborted ?? null,
    // true / false / null (unknown). The UI must not show "unchanged" for null.
    sourceUnchanged: typeof sourceUnchanged === 'boolean' ? sourceUnchanged : null,
  };
}

/** Matches to retry after a partial result: only the ones that failed. */
export function failedMatches(report) {
  return report.failed.map(({ reason, ...match }) => match);
}

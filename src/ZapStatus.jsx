/**
 * Deletion progress and result. Shared by the Zap and Caches tabs.
 */
export default function ZapStatus({ zapping, outcome }) {
  return (
    <>
      {zapping && (
        <div className="zapping">
          <div className="bar">
            <div
              className="fill"
              style={{ width: `${(zapping.done / zapping.total) * 100}%` }}
            />
          </div>
          <p className="status">
            Deleting {zapping.done} of {zapping.total}
            {zapping.path && <span className="current"> — {zapping.path}</span>}
          </p>
        </div>
      )}

      {outcome && (
        <div className="outcome">
          <p>
            Zapped {outcome.deleted.length}{" "}
            {outcome.deleted.length === 1 ? "folder" : "folders"}
            {outcome.permanent ? " permanently" : " to the Recycle Bin"} in{" "}
            {(outcome.elapsedMs / 1000).toFixed(1)}s.
          </p>
          {outcome.failed.length > 0 && (
            <ul className="failures">
              {outcome.failed.map((f) => (
                <li key={f.path}>
                  {f.path} — <em>{f.error}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

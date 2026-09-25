import { projectNote } from "./stale.js";

/**
 * Where a cache instance is, and how long its project has gone untouched.
 *
 * The note is plain text, never a warning: age does not change a row's
 * risk. withInUse is false where the row's cost line already says the
 * project is in use.
 */
export default function CacheWhere({ path, project, now, colSpan, withInUse = true }) {
  const note = projectNote(project, now);
  const shown = note && (withInUse || !note.inUse) ? note : null;

  return (
    <td className="where" colSpan={colSpan} title={path}>
      <div className="where-line">
        <span className="path">{path}</span>
        {shown && (
          <span className="project-age" title={project.path}>
            {shown.text}
          </span>
        )}
      </div>
    </td>
  );
}

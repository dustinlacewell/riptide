/**
 * Sortable column headings: one <th> per column, each a button.
 *
 * @param {Record<string, {label: string, align: "left"|"right"}>} columns
 * @param {{key: string, direction: "asc"|"desc"}} sort
 * @param {(key: string) => void} onSort called with the clicked column key
 */
export default function SortHeader({ columns, sort, onSort }) {
  return Object.entries(columns).map(([key, col]) => {
    const active = sort.key === key;
    return (
      <th
        key={key}
        className={col.align === "right" ? "num" : undefined}
        aria-sort={active ? ARIA[sort.direction] : "none"}
      >
        <button
          className={`sort${active ? " active" : ""}`}
          onClick={() => onSort(key)}
        >
          {col.label}
          <span className="arrow">{active ? ARROW[sort.direction] : ""}</span>
        </button>
      </th>
    );
  });
}

const ARIA = { asc: "ascending", desc: "descending" };
const ARROW = { asc: "▲", desc: "▼" };

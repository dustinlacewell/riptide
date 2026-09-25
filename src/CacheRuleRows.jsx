import { useEffect, useRef } from "react";
import { bytes } from "./format.js";
import { riskOf } from "./risk.js";
import RiskBadge from "./RiskBadge.jsx";
import RowPick from "./RowPick.jsx";
import Glyph from "./ui/Glyph.jsx";

/**
 * One cache rule: a summary row that expands to its instances.
 *
 * A rule matched by directory name hits once per project, so __pycache__
 * alone is eleven thousand rows. Collapsed, it is one.
 *
 * Selection is not held here. The rule's checkbox reads and writes the
 * panel's set of spared paths, so the zap plan stays a single flat path
 * list no matter which rows happen to be open.
 */
export default function CacheRuleRows({
  rule,
  refused,
  open,
  onToggle,
  spared,
  setChecked,
  onPointerDown,
  onPointerEnter,
}) {
  // Refused instances cannot be picked, so the rule's checkbox speaks for
  // the rest. With none left, the rule itself is refused.
  const pickable = rule.paths
    .filter((c) => riskOf(c, refused) !== "refused")
    .map((c) => c.path);
  const risk = pickable.length === 0 ? "refused" : riskOf(rule);

  const chosen = pickable.filter((p) => !spared.has(p)).length;
  const all = chosen === pickable.length;
  const none = chosen === 0;

  // A one-instance rule is just a row: show where it is rather than the
  // count "1", and give it no caret to open.
  const lone = rule.count === 1 ? rule.paths[0] : null;

  return (
    <>
      <tr className={ruleClass(risk, none, open)}>
        <td className="grip">
          {!lone && (
            <button
              className="twist"
              onClick={() => onToggle(rule.id)}
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} ${rule.count} locations`}
            >
              <Glyph name="caret" className={`caret${open ? " open" : ""}`} />
            </button>
          )}
        </td>
        <td>
          {risk === "refused" ? (
            <RowPick risk="refused" />
          ) : (
            <TriCheckbox
              checked={all}
              mixed={!all && !none}
              onChange={() => setChecked(pickable, !all)}
              label={rule.label}
            />
          )}
        </td>
        <td className="risk-cell">
          <RiskBadge risk={risk} note={risk === "refused" ? "Never deleted" : rule.riskNote} />
        </td>
        <td>
          <span className="cache-label">{rule.label}</span>
          <span className={risk === "refused" ? "cache-cost never" : "cache-cost"}>
            {risk === "refused" ? "Never deleted" : rule.cost}
          </span>
        </td>
        {lone ? (
          <td className="path" title={lone.path}>
            {lone.path}
          </td>
        ) : (
          <td className="rule-count">
            {rule.count.toLocaleString()} locations
            {!all && !none && (
              <span className="rule-chosen">{chosen.toLocaleString()} selected</span>
            )}
          </td>
        )}
        <td className="num">{bytes(rule.bytes)}</td>
        <td className="num">{rule.files.toLocaleString()}</td>
      </tr>

      {open &&
        !lone &&
        rule.paths.map((cache) => (
          <MemberRow
            key={cache.path}
            cache={cache}
            risk={riskOf(cache, refused)}
            spared={spared.has(cache.path)}
            setChecked={setChecked}
            onPointerDown={onPointerDown}
            onPointerEnter={onPointerEnter}
          />
        ))}
    </>
  );
}

function MemberRow({ cache, risk, spared, setChecked, onPointerDown, onPointerEnter }) {
  const refused = risk === "refused";
  const paint = refused
    ? {}
    : {
        onPointerDown: (e) => onPointerDown(e, cache.path),
        onPointerEnter: () => onPointerEnter(cache.path),
      };

  return (
    <tr className={memberClass(risk, spared)} {...paint}>
      <td className="grip" />
      <td>
        <RowPick
          risk={risk}
          checked={!spared}
          onChange={(checked) => setChecked([cache.path], checked)}
          label={cache.path}
        />
      </td>
      <td className="risk-cell">
        {refused && <span className="never">Never deleted</span>}
      </td>
      <td className="path" colSpan={2} title={cache.path}>
        {cache.path}
      </td>
      <td className="num">{bytes(cache.bytes)}</td>
      <td className="num">{cache.files.toLocaleString()}</td>
    </tr>
  );
}

function ruleClass(risk, none, open) {
  return [
    "rule",
    risk === "safe" ? "" : risk,
    none && risk !== "refused" ? "spared" : "",
    open ? "open" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function memberClass(risk, spared) {
  return [
    "member",
    risk === "safe" ? "" : risk,
    spared && risk !== "refused" ? "spared" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A checkbox that can also show "some of these".
 *
 * There is no `indeterminate` attribute or React prop — it is a property on
 * the DOM node only — so it has to be written through a ref after render.
 */
function TriCheckbox({ checked, mixed, onChange, label }) {
  const box = useRef(null);

  useEffect(() => {
    if (box.current) box.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <input
      ref={box}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={`Select all ${label}`}
    />
  );
}

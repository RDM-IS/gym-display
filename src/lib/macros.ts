/** How a macro is written, everywhere it is written.
 *
 * ONE SOURCE, because there were two and they disagreed. Status spells it
 * **fiber** (US, matching the API's `fiber_g` and every VA form Ryan fills in);
 * the Prep chips said "fibre". Ryan reads both screens in the same session, and a
 * macro that changes its name between them makes him check whether it is the same
 * number.
 *
 * Keyed by the API's own field names so there is nothing to map: if a payload
 * grows a macro, the label is looked up by the key that arrived.
 */
export const MACRO_LABELS: Record<string, string> = {
  kcal: "kcal",
  protein_g: "protein",
  carb_g: "carbs",
  fat_g: "fat",
  fiber_g: "fiber",
  sugar_g: "sugar",
  plant_meals_min: "plant meals",
};

/** The label, or the raw key when nothing has named it.
 *
 * Returning the key rather than a placeholder is deliberate: an unlabelled macro
 * should look wrong on screen so it gets a label, not blend in as "—". */
export function macroLabel(key: string): string {
  return MACRO_LABELS[key] ?? key;
}

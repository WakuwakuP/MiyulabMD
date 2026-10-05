import type { Tool } from "@modelcontextprotocol/server";
import type { featureConfig } from "./feature-config.ts";
import { toolDefinitions } from "./tool-definitions.ts";

type Features = Awaited<ReturnType<typeof featureConfig>>;
type ToolName = keyof typeof toolDefinitions;

// Preserve the SDK registration order. Differential tests compare all eight
// feature combinations with the full factory, including schemas and order.
const catalogOrder: readonly (readonly [ToolName, (keyof Features)?])[] = [
  ["list_notes"],
  ["list_folder_entries"],
  ["get_note"],
  ["create_note"],
  ["replace_in_note"],
  ["insert_in_note"],
  ["update_note"],
  ["delete_note"],
  ["set_note_access"],
  ["invite_collaborator"],
  ["search_notes"],
  ["grep_notes"],
  ["list_note_links"],
  ["list_backlinks"],
  ["list_broken_links"],
  ["resolve_wikilink"],
  ["agent_join"],
  ["agent_leave"],
  ["list_note_history"],
  ["get_revision"],
  ["restore_revision"],
  ["delete_folder"],
  ["move_folder"],
  ["move_folder_contents"],
  ["move_notes"],
  ["para_list", "hasPara"],
  ["para_archive_project", "hasPara"],
  ["set_folder_scheme", "hasSchemes"],
  ["scheme_get", "hasSchemes"],
  ["jd_allocate_id", "hasSchemes"],
  ["jd_create_id_folder", "hasSchemes"],
  ["jd_get", "hasSchemes"],
  ["jd_list_category", "hasSchemes"],
  ["jd_validate_tree", "hasSchemes"],
  ["set_edit_lock"],
  ["medallion_list_sets", "hasMedallion"],
  ["medallion_assign_folder", "hasMedallion"],
  ["medallion_unassign_folder", "hasMedallion"],
];

const toolFeatures = new Map<string, keyof Features | undefined>(
  catalogOrder.map(([name, feature]) => [name, feature]),
);
const catalog = catalogOrder.map(([name, feature]) => {
  const definition = toolDefinitions[name];
  return {
    feature,
    tool: Object.freeze({
      description: definition.description,
      // Every definition is a Zod object, converted/frozen by toolInputSchema.
      inputSchema: definition.inputSchema["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      }) as Tool["inputSchema"],
      name,
    }),
  };
});

export function requiredToolFeature(name: string) {
  return toolFeatures.get(name);
}

/** Share only immutable public metadata; feature decisions stay request-local. */
export function listToolsForFeatures(features: Features): Tool[] {
  return catalog
    .filter(({ feature }) => !feature || features[feature])
    .map(({ tool }) => tool);
}

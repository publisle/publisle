export {
  SEGMENT_KINDS,
  appendSegment,
  fieldValue,
  inlineSegments,
  insertListItem,
  listItemEdits,
  listText,
  metadataAuthors,
  metadataField,
  metadataSubjects,
  removeListItem,
  removeSegment,
  setFieldJson,
  setFieldValue,
  setListText,
  setSegmentText,
  setSegmentUrl,
  withMetadataAuthors,
  withMetadataField,
  withMetadataSubjects,
  type AuthorRow,
  type FieldSpec,
  type FieldValue,
  updateListItemChecked,
  updateListItemText,
  type InlineSegment,
  type ListItemEdit,
} from "@publisle/playground";
import { blockFields as coreBlockFields } from "@publisle/playground";
import { DEMO_EXTENSIONS } from "./templates.ts";

/** Field specs per block type, extended with the demo blocks. */
export function blockFields(type: string) {
  return coreBlockFields(type, DEMO_EXTENSIONS);
}

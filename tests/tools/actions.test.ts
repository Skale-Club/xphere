import { describe, it } from 'vitest'

describe('getFolders: returns ordered folder list scoped to org', () => {
  it.todo('returns empty array when org has no folders')
  it.todo('returns folders ordered by position ascending')
  it.todo('returns both top-level and subfolder rows')
  it.todo('returns [] on supabase error (no throw)')
})

describe('createFolder: inserts a new folder row', () => {
  it.todo('rejects unauthenticated call — returns { error: "Not authenticated." }')
  it.todo('returns error when org lookup fails')
  it.todo('inserts row with org_id, name, parent_id, position=0')
  it.todo('returns { error } on duplicate name within same parent scope')
  it.todo('calls revalidatePath("/tools") on success')
})

describe('updateFolder: renames or repositions a folder', () => {
  it.todo('rejects unauthenticated call')
  it.todo('updates name field on target row')
  it.todo('updates position field on target row')
  it.todo('returns { error } when folder not found')
})

describe('deleteFolder: removes folder and handles tool reassignment', () => {
  it.todo('rejects unauthenticated call')
  it.todo('deletes folder row — cascade removes subfolders via DB ON DELETE CASCADE')
  it.todo('orphaned tools have folder_id set to NULL via ON DELETE SET NULL on tool_configs')
  it.todo('calls revalidatePath("/tools") on success')
})

describe('deleteFolderWithTools: deletes tools in folder and subfolders, then deletes folder', () => {
  it.todo('rejects unauthenticated call — returns { error: "Not authenticated." }')
  it.todo('collects subfolder IDs and deletes tools in all folderIds')
  it.todo('deletes tool_configs in the folder before deleting the folder row')
  it.todo('DB ON DELETE CASCADE removes subfolder rows when parent is deleted')
  it.todo('calls revalidatePath("/tools") on success')
  it.todo('returns { error } if tool_configs delete fails')
  it.todo('returns { error } if folder delete fails')
})

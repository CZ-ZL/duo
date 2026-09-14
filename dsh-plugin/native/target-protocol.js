import { fail } from './definitions.js'

// Opaque content identity is owned by the Target, never guessed from its fields.
// Version fallback preserves pre-0.5 TargetService providers; those adapters are
// responsible for stable content versions and do not gain history support.
export function targetIdentity(adapter, snapshot) {
  const identity =
    typeof adapter.identity === 'function' ? adapter.identity(snapshot) : snapshot?.version
  if (typeof identity !== 'string' || !identity)
    fail('DUO_TARGET_INVALID', 'Target must return a nonempty stable content identity/version')
  return identity
}
export function validHistorySnapshot(adapter, snapshot, parent) {
  try {
    if (typeof adapter?.validateSnapshot !== 'function' || !adapter.validateSnapshot(snapshot))
      return false
    if (!parent) return true
    if (snapshot.parentId !== parent.id || snapshot.parentVersion !== parent.version) return false
    const applied = adapter.apply(snapshot, parent)
    return (
      applied.version === snapshot.version &&
      targetIdentity(adapter, applied) === targetIdentity(adapter, snapshot)
    )
  } catch {
    return false
  }
}

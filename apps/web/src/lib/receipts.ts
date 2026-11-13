// Ballot receipts kept ONLY in this browser (localStorage), so a voter can find and track them later.
// They are never sent to the server. A receipt shows that this device voted, not how.
export type SavedReceipt = {
  ballotId: string
  nullifier: string
  electionId: string
  electionSlug: string
  electionTitle: string
  at: string
}

const KEY = "secvote:receipts:v1"

export function loadReceipts(): SavedReceipt[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SavedReceipt[]) : []
  } catch {
    return []
  }
}

export function saveReceipt(r: SavedReceipt): void {
  try {
    const all = loadReceipts().filter((x) => x.ballotId !== r.ballotId)
    localStorage.setItem(KEY, JSON.stringify([r, ...all].slice(0, 50)))
  } catch {
    /* storage unavailable (private mode): the on-screen receipt is still shown */
  }
}

export function clearReceipts(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
